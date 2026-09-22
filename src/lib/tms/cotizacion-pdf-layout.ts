import PDFDocument from "pdfkit";
import { fechaLarga, formatoMoneda, type DocumentoComercial } from "./cotizacion-documento";

/**
 * COTIZACIONES FASE 6 — utilidades de maquetación compartidas por las
 * plantillas del documento comercial (KuiqTrans y Mónaco): creación del PDF,
 * paginación con pie "Página X de Y", tabla comercial con altura dinámica y
 * encabezado repetido, y listas con texto ajustado. Cada plantilla decide
 * colores, encabezado, pie y títulos; nada visual de una marca vive aquí.
 */

export type Pdf = PDFKit.PDFDocument;

export const MARGENES = { top: 44, bottom: 64, left: 46, right: 46 } as const;

export type OpcionesPdf = {
  /** Se dibuja al iniciar cada página posterior a la primera (deja `doc.y` debajo de la cabecera). */
  cabeceraContinuacion?: (doc: Pdf, ancho: number) => void;
  /** Pie de cada página, ya conociendo el total de páginas. */
  pie: (doc: Pdf, pagina: number, total: number, ancho: number) => void;
};

export function generarPdf(render: (doc: Pdf, ancho: number) => void, opciones: OpcionesPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "portrait", margins: { ...MARGENES }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (ch) => chunks.push(ch as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const ancho = doc.page.width - MARGENES.left - MARGENES.right;
    if (opciones.cabeceraContinuacion) {
      const cabecera = opciones.cabeceraContinuacion;
      doc.on("pageAdded", () => cabecera(doc, ancho));
    }
    try {
      render(doc, ancho);
      const { start, count } = doc.bufferedPageRange();
      for (let i = start; i < start + count; i++) {
        doc.switchToPage(i);
        // El pie se escribe en la franja inferior de la hoja: sin esto pdfkit abriría una página nueva.
        doc.page.margins.bottom = 0;
        opciones.pie(doc, i - start + 1, count, ancho);
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export type ColumnaTabla = { titulo: string; /** Peso relativo del ancho. */ peso: number; alinear?: "left" | "right" | "center" };

export type EstiloTabla = {
  fondoEncabezado: string;
  textoEncabezado: string;
  colorBorde: string;
  colorTexto: string;
  fondoFilaAlterna?: string;
  tamanoTexto?: number;
  relleno?: number;
};

/** Anchos de columna en puntos, proporcionales a `peso` y sumando exactamente `ancho`. */
export function anchosColumnas(columnas: ColumnaTabla[], ancho: number): number[] {
  const total = columnas.reduce((s, c) => s + c.peso, 0);
  return columnas.map((c) => (c.peso / total) * ancho);
}

/**
 * Tabla con filas de altura dinámica (nada se corta ni desborda), salto de
 * página automático y encabezado repetido. Acepta cualquier cantidad de filas.
 */
export function dibujarTabla(doc: Pdf, x: number, ancho: number, columnas: ColumnaTabla[], filas: string[][], estilo: EstiloTabla): void {
  const tamano = estilo.tamanoTexto ?? 9.5;
  const pad = estilo.relleno ?? 7;
  const anchos = anchosColumnas(columnas, ancho);
  const limiteInferior = () => doc.page.height - doc.page.margins.bottom;

  const alturaTexto = (texto: string, columna: number, negrita: boolean) => {
    doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(tamano);
    return doc.heightOfString(texto, { width: anchos[columna] - pad * 2 });
  };
  const alturaFila = (celdas: string[], negrita: boolean) => Math.max(...celdas.map((t, i) => alturaTexto(t, i, negrita))) + pad * 2;

  const dibujarFila = (celdas: string[], y: number, alto: number, opciones: { fondo?: string; color: string; negrita: boolean }) => {
    if (opciones.fondo) doc.rect(x, y, ancho, alto).fill(opciones.fondo);
    let cx = x;
    celdas.forEach((texto, i) => {
      doc.font(opciones.negrita ? "Helvetica-Bold" : "Helvetica").fontSize(tamano).fillColor(opciones.color)
        .text(texto, cx + pad, y + pad, { width: anchos[i] - pad * 2, align: columnas[i].alinear ?? "left" });
      cx += anchos[i];
    });
    doc.rect(x, y, ancho, alto).lineWidth(0.6).strokeColor(estilo.colorBorde).stroke();
    let bx = x;
    anchos.slice(0, -1).forEach((a) => {
      bx += a;
      doc.moveTo(bx, y).lineTo(bx, y + alto).lineWidth(0.6).strokeColor(estilo.colorBorde).stroke();
    });
  };

  const titulos = columnas.map((c) => c.titulo);
  let y = doc.y;
  const encabezado = () => {
    const alto = alturaFila(titulos, true);
    dibujarFila(titulos, y, alto, { fondo: estilo.fondoEncabezado, color: estilo.textoEncabezado, negrita: true });
    y += alto;
  };

  // El encabezado nunca queda huérfano al final de la página: debe caber junto con su primera fila.
  const primera = filas[0] ? alturaFila(filas[0], false) : 0;
  if (y + alturaFila(titulos, true) + primera > limiteInferior()) {
    doc.addPage();
    y = doc.y;
  }
  encabezado();
  filas.forEach((celdas, indice) => {
    const alto = alturaFila(celdas, false);
    if (y + alto > limiteInferior()) {
      doc.addPage();
      y = doc.y;
      encabezado();
    }
    dibujarFila(celdas, y, alto, { fondo: indice % 2 === 1 ? estilo.fondoFilaAlterna : undefined, color: estilo.colorTexto, negrita: false });
    y += alto;
  });
  doc.x = doc.page.margins.left;
  doc.y = y + 10;
}

export type EstiloLista = { color: string; colorVineta: string; tamano?: number };

/** Lista con viñetas; el texto largo se ajusta al ancho y el salto de página lo resuelve pdfkit. */
export function dibujarLista(doc: Pdf, x: number, ancho: number, items: string[], estilo: EstiloLista): void {
  const tamano = estilo.tamano ?? 9.5;
  for (const item of items) {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(tamano).fillColor(estilo.colorVineta).text("•", x, y, { width: 10, lineBreak: false });
    doc.font("Helvetica").fontSize(tamano).fillColor(estilo.color).text(item, x + 12, y, { width: ancho - 12 });
    doc.moveDown(0.25);
  }
  doc.x = doc.page.margins.left;
}

/**
 * Línea divisoria discreta (un solo trazo delgado, color neutro de la
 * marca) — separador corporativo entre bloques del documento (cliente,
 * mensaje, tabla, condiciones, cierre), sin usar bloques de color sólido.
 */
export function dibujarSeparador(doc: Pdf, x: number, ancho: number, color: string, grosor = 0.6): void {
  const y = doc.y;
  doc.moveTo(x, y).lineTo(x + ancho, y).lineWidth(grosor).strokeColor(color).stroke();
  doc.x = x;
  doc.y = y + 10;
}

/** Párrafo de texto corrido con ancho fijo. */
export function dibujarParrafo(doc: Pdf, x: number, ancho: number, texto: string, opciones: { color: string; tamano?: number; negrita?: boolean; alinear?: "left" | "right" | "center" }): void {
  doc.font(opciones.negrita ? "Helvetica-Bold" : "Helvetica").fontSize(opciones.tamano ?? 10).fillColor(opciones.color)
    .text(texto, x, doc.y, { width: ancho, align: opciones.alinear ?? "left" });
  doc.x = doc.page.margins.left;
}

/** Si queda menos de `alto` puntos en la página, pasa a la siguiente (evita títulos huérfanos). */
export function asegurarEspacio(doc: Pdf, alto: number): void {
  if (doc.y + alto > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

/**
 * Ancho/alto REAL (en píxeles) de un PNG, leído directamente del chunk IHDR
 * (bytes 16–23: firma de 8 + longitud de 4 + "IHDR" de 4). Sin dependencia
 * nueva — PDFKit no expone esto como API pública, y es lo que permite
 * calcular el CENTRO FÍSICO exacto de una marca de agua (nunca a ojo).
 */
export function dimensionesPng(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("No se pudo leer el tamaño del PNG (encabezado IHDR no encontrado).");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Dibuja una imagen a un ancho dado (alto proporcional); devuelve el tamaño con el que quedó dibujada, en puntos. */
export function dibujarImagen(doc: Pdf, buffer: Buffer, x: number, y: number, anchoDestino: number): { width: number; height: number } {
  const { width: wPx, height: hPx } = dimensionesPng(buffer);
  const altoDestino = anchoDestino * (hPx / wPx);
  doc.image(buffer, x, y, { width: anchoDestino });
  return { width: anchoDestino, height: altoDestino };
}

export type OpcionesMarcaDeAgua = {
  anchoDestino: number;
  /** Si se da, se dibuja con `doc.opacity(opacidad)` (para un logo cuyo fondo ya coincide con el de la hoja). Si el PNG ya trae su propia transparencia horneada (p. ej. KuiqTrans), se omite. */
  opacidad?: number;
};

/**
 * Marca de agua centrada en el CENTRO FÍSICO de la página — `doc.page.width`/
 * `doc.page.height`, nunca `doc.y` ni una posición aproximada: el centro de
 * la imagen dibujada coincide exactamente con el centro de la hoja, sin
 * importar cuánto texto haya arriba ni en qué página se dibuje.
 */
export function dibujarMarcaDeAgua(doc: Pdf, buffer: Buffer, opciones: OpcionesMarcaDeAgua): void {
  const { width: wPx, height: hPx } = dimensionesPng(buffer);
  const anchoDestino = opciones.anchoDestino;
  const altoDestino = anchoDestino * (hPx / wPx);
  const x = (doc.page.width - anchoDestino) / 2;
  const y = (doc.page.height - altoDestino) / 2;
  const conOpacidad = opciones.opacidad != null;
  if (conOpacidad) doc.opacity(opciones.opacidad!);
  doc.image(buffer, x, y, { width: anchoDestino });
  if (conOpacidad) doc.opacity(1);
}

/**
 * Tema de una marca: lo que cambia entre plantillas. El cuerpo del documento
 * (destinatario, saludo, tabla comercial, condiciones, vigencia y cierre) se
 * arma una sola vez en `renderDocumentoComercial` con estos ingredientes.
 */
export type TemaComercial = {
  colores: { acento: string; textoSobreAcento: string; texto: string; suave: string; borde: string; filaAlterna: string };
  /**
   * Marca de agua de la marca — se dibuja PRIMERO en cada página (antes del
   * encabezado y de todo el contenido), para quedar detrás del texto. Usa
   * `dibujarMarcaDeAgua` (centro físico real, nunca `doc.y`).
   */
  marcaDeAgua: (doc: Pdf) => void;
  /** Dibuja el encabezado de la primera página y deja `doc.y` debajo. */
  encabezado: (doc: Pdf, ancho: number, modelo: DocumentoComercial) => void;
  /** Título de sección propio de la marca. */
  seccion: (doc: Pdf, x: number, ancho: number, titulo: string) => void;
  /** true: condiciones y observaciones en una sola sección; false: dos secciones separadas. */
  seccionUnica: boolean;
  tituloCondiciones: string;
  tituloObservaciones: string;
  tituloTabla: string;
  cabeceraContinuacion: (doc: Pdf, ancho: number, modelo: DocumentoComercial) => void;
  pie: (doc: Pdf, pagina: number, total: number, ancho: number, modelo: DocumentoComercial) => void;
};

export function renderDocumentoComercial(tema: TemaComercial, modelo: DocumentoComercial): Promise<Buffer> {
  const { colores } = tema;
  return generarPdf(
    (doc, ancho) => {
      const x = doc.page.margins.left;
      // Primero la marca de agua (queda detrás de todo lo que se dibuje después).
      tema.marcaDeAgua(doc);
      tema.encabezado(doc, ancho, modelo);

      // Destinatario: el cliente es el principal; atención y cargo son opcionales.
      doc.moveDown(0.8);
      dibujarParrafo(doc, x, ancho, modelo.cliente, { color: colores.texto, tamano: 12, negrita: true });
      if (modelo.atencionNombre) dibujarParrafo(doc, x, ancho, `Atención: ${modelo.atencionNombre}`, { color: colores.texto, tamano: 10 });
      if (modelo.atencionCargo) dibujarParrafo(doc, x, ancho, modelo.atencionCargo, { color: colores.suave, tamano: 9.5 });

      doc.moveDown(0.7);
      dibujarSeparador(doc, x, ancho, colores.borde);
      dibujarParrafo(doc, x, ancho, modelo.saludo, { color: colores.texto, tamano: 10 });

      doc.moveDown(0.7);
      dibujarSeparador(doc, x, ancho, colores.borde);
      asegurarEspacio(doc, 90);
      tema.seccion(doc, x, ancho, tema.tituloTabla);
      dibujarTabla(
        doc, x, ancho,
        [
          { titulo: "Punto de carga", peso: 2.8 },
          { titulo: "Punto de descarga", peso: 2.8 },
          { titulo: "Unidad", peso: 2.1 },
          { titulo: modelo.encabezadoPrecio, peso: 2.3, alinear: "right" },
        ],
        modelo.lineas.map((l) => [l.origen, l.destino, l.unidad, formatoMoneda(l.precio, modelo.moneda)]),
        { fondoEncabezado: colores.acento, textoEncabezado: colores.textoSobreAcento, colorBorde: colores.borde, colorTexto: colores.texto, fondoFilaAlterna: colores.filaAlterna },
      );

      const estiloLista = { color: colores.texto, colorVineta: colores.acento };
      if (tema.seccionUnica) {
        const todo = [...modelo.condiciones, ...modelo.observaciones];
        if (todo.length) {
          asegurarEspacio(doc, 60);
          tema.seccion(doc, x, ancho, tema.tituloCondiciones);
          dibujarLista(doc, x, ancho, todo, estiloLista);
        }
      } else {
        if (modelo.condiciones.length) {
          asegurarEspacio(doc, 60);
          tema.seccion(doc, x, ancho, tema.tituloCondiciones);
          dibujarLista(doc, x, ancho, modelo.condiciones, estiloLista);
        }
        if (modelo.observaciones.length) {
          doc.moveDown(0.5);
          asegurarEspacio(doc, 60);
          tema.seccion(doc, x, ancho, tema.tituloObservaciones);
          dibujarLista(doc, x, ancho, modelo.observaciones, estiloLista);
        }
      }

      if (modelo.fechaVencimiento) {
        doc.moveDown(0.6);
        dibujarParrafo(doc, x, ancho, `Propuesta válida hasta el ${fechaLarga(modelo.fechaVencimiento)}.`, { color: colores.texto, tamano: 9.5, negrita: true });
      }
      doc.moveDown(0.8);
      asegurarEspacio(doc, 44);
      dibujarSeparador(doc, x, ancho, colores.borde);
      dibujarParrafo(doc, x, ancho, modelo.cierre, { color: colores.texto, tamano: 10 });
    },
    {
      // Misma regla en cada página nueva: marca de agua primero, detrás del contenido.
      cabeceraContinuacion: (doc, ancho) => {
        tema.marcaDeAgua(doc);
        tema.cabeceraContinuacion(doc, ancho, modelo);
      },
      pie: (doc, pagina, total, ancho) => tema.pie(doc, pagina, total, ancho, modelo),
    },
  );
}
