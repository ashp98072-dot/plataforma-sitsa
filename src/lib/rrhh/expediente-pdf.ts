import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { formatearFechaVisible } from "./dates";

/**
 * RRHH — EXPEDIENTE COMPLETO EN UN SOLO PDF (generador puro: sin BD ni filesystem; recibe metadatos + bytes ya leídos).
 *
 * Estructura: portada → índice (solo si hay más de 1 documento) → cada documento en orden estable.
 * - PDF: se anexan TODAS sus páginas.  - JPG/PNG: una página con la imagen centrada, proporcional y con márgenes.
 * - WebP/BMP (RRHH los admite al subir, pero no hay infraestructura segura de conversión) y cualquier otro formato: página informativa
 *   "Documento no incorporado automáticamente". Archivo faltante/corrupto/cifrado: página informativa; NUNCA se rompe el expediente.
 * El formato se decide por los BYTES (firma del archivo), no por la extensión declarada. Los mensajes no incluyen rutas ni errores técnicos.
 */

/** Orden de consolidación: catálogo REAL de documentos-tipos.ts (los no reconocidos van al final; "Foto" solo si no salió en la portada). */
export const ORDEN_TIPOS_EXPEDIENTE = [
  "DPI",
  "Licencia",
  "Contrato",
  "Antecedentes",
  "Antecedentes penales",
  "Antecedentes policíacos",
  "Tarjeta de pulmones",
  "Tarjeta de salud",
  "Tarjeta de manipulación de alimentos",
  "Manipulación de alimentos",
  "IGSS",
  "Boleta permiso",
  "Expediente RRHH",
  "Acuerdo de confidencialidad",
  "Certificación PRAIND",
  "Informe prueba de polígrafo",
  "Otro",
  "Foto",
] as const;

export type DocumentoExpediente = {
  id: number;
  tipoDocumento: string;
  nombreOriginal: string | null;
  subidoEn: string;
};

export type EntradaDocumento = {
  doc: DocumentoExpediente;
  /** null = no se pudo leer (faltante, ilegible, ruta inválida, demasiado grande). */
  bytes: Uint8Array | null;
};

export type EmpleadoExpediente = {
  codigo: string;
  nombre: string;
  dpi?: string | null;
  puesto?: string | null;
  categoriaOps?: string | null;
  estado?: string | null;
  fechaAlta?: string | null;
};

export type ResumenExpediente = { incluidos: number; omitidos: number; paginas: number };

/** Orden estable: por posición del tipo en el catálogo; mismo tipo → fecha de subida y luego id. Desconocidos al final. */
export function ordenarDocumentosExpediente<T extends DocumentoExpediente>(docs: readonly T[]): T[] {
  const rango = (t: string) => {
    const i = (ORDEN_TIPOS_EXPEDIENTE as readonly string[]).indexOf(t);
    return i === -1 ? ORDEN_TIPOS_EXPEDIENTE.length : i;
  };
  return [...docs].sort((a, b) => rango(a.tipoDocumento) - rango(b.tipoDocumento) || String(a.subidoEn).localeCompare(String(b.subidoEn)) || a.id - b.id);
}

/** Expediente-<codigo>-<nombre>.pdf en ASCII seguro (sin tildes, espacios ni caracteres de ruta/cabecera). */
export function nombreArchivoExpediente(codigo: string, nombre: string): string {
  const limpiar = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const partes = [limpiar(codigo ?? ""), limpiar(nombre ?? "")].filter(Boolean);
  return `Expediente-${partes.join("-") || "empleado"}.pdf`.slice(0, 120);
}

export type FormatoArchivo = "pdf" | "jpg" | "png" | "otro";
export function detectarFormato(bytes: Uint8Array): FormatoArchivo {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10) return "png";
  return "otro";
}

const A4: [number, number] = [595.28, 841.89];
const MARGEN = 42;
const GRIS = rgb(0.4, 0.4, 0.4);
const NEGRO = rgb(0, 0, 0);
const ITEMS_POR_PAGINA_INDICE = 34;

/** Texto compatible con la fuente estándar (WinAnsi): reemplaza lo no representable para que drawText nunca lance. */
function seguro(font: PDFFont, texto: string): string {
  let salida = "";
  for (const ch of String(texto ?? "").replace(/[\r\n\t]+/g, " ")) {
    try {
      font.encodeText(ch);
      salida += ch;
    } catch {
      salida += "?";
    }
  }
  return salida;
}

function recortar(font: PDFFont, texto: string, size: number, ancho: number): string {
  let t = seguro(font, texto);
  if (font.widthOfTextAtSize(t, size) <= ancho) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > ancho) t = t.slice(0, -1);
  return `${t}...`;
}

type Doc = PDFDocument;
type Fuentes = { normal: PDFFont; negrita: PDFFont };

/** Portada: datos existentes del empleado (vacío → "—"), foto opcional, fecha de generación. */
async function portada(pdf: Doc, f: Fuentes, emp: EmpleadoExpediente, foto: Uint8Array | null, generado: string, totalDocs: number) {
  const page = pdf.addPage(A4);
  const { width, height } = page.getSize();
  page.drawText("EXPEDIENTE DEL EMPLEADO", { x: MARGEN, y: height - 110, size: 24, font: f.negrita, color: NEGRO });
  page.drawRectangle({ x: MARGEN, y: height - 122, width: width - MARGEN * 2, height: 2, color: rgb(0.2, 0.3, 0.45) });
  let xTexto = MARGEN;
  if (foto) {
    try {
      const fmt = detectarFormato(foto);
      const img = fmt === "png" ? await pdf.embedPng(foto) : fmt === "jpg" ? await pdf.embedJpg(foto) : null;
      if (img) {
        const caja = { w: 110, h: 140 };
        const k = Math.min(caja.w / img.width, caja.h / img.height);
        const w = img.width * k;
        const h = img.height * k;
        page.drawImage(img, { x: MARGEN, y: height - 160 - h, width: w, height: h });
        xTexto = MARGEN + caja.w + 24;
      }
    } catch {
      // La foto es opcional: si no se puede incrustar, la portada sale igual.
    }
  }
  const v = (s: string | null | undefined) => (s && String(s).trim() ? String(s).trim() : "—");
  const filas: [string, string][] = [
    ["Nombre", v(emp.nombre)],
    ["Código", v(emp.codigo)],
    ["DPI", v(emp.dpi)],
    ["Puesto", v(emp.puesto)],
    ["Área", v(emp.categoriaOps)],
    ["Estado", v(emp.estado)],
    ["Fecha de contratación", emp.fechaAlta ? formatearFechaVisible(emp.fechaAlta) || "—" : "—"],
    ["Documentos incluidos", String(totalDocs)],
    ["Generado el", generado],
  ];
  let y = height - 175;
  for (const [etiqueta, valor] of filas) {
    page.drawText(seguro(f.normal, etiqueta.toUpperCase()), { x: xTexto, y, size: 8, font: f.normal, color: GRIS });
    page.drawText(recortar(f.negrita, valor, 13, width - xTexto - MARGEN), { x: xTexto, y: y - 15, size: 13, font: f.negrita, color: NEGRO });
    y -= 38;
  }
  if (totalDocs === 0) {
    page.drawText("El empleado no tiene documentos cargados.", { x: MARGEN, y: Math.min(y - 10, height - 560), size: 12, font: f.normal, color: GRIS });
  }
}

type ItemPlan = {
  doc: DocumentoExpediente;
  posicion: number;
  ordenEnTipo: number;
  totalEnTipo: number;
  /** Fuente PDF ya cargada (páginas a copiar) o imagen; o el motivo por el que no se incorpora. */
  pdfOrigen?: PDFDocument;
  imagen?: { bytes: Uint8Array; formato: "jpg" | "png" };
  motivo?: "no_soportado" | "no_disponible";
  paginas: number;
  paginaInicio: number;
};

const ROTULO = (d: DocumentoExpediente) => (d.nombreOriginal && d.nombreOriginal.trim() ? d.nombreOriginal.trim() : "(sin nombre)");

async function planificar(entradas: readonly EntradaDocumento[]): Promise<ItemPlan[]> {
  const items: ItemPlan[] = [];
  const totalPorTipo = new Map<string, number>();
  for (const e of entradas) totalPorTipo.set(e.doc.tipoDocumento, (totalPorTipo.get(e.doc.tipoDocumento) ?? 0) + 1);
  const vistoPorTipo = new Map<string, number>();
  let posicion = 0;
  for (const { doc, bytes } of entradas) {
    posicion += 1;
    const n = (vistoPorTipo.get(doc.tipoDocumento) ?? 0) + 1;
    vistoPorTipo.set(doc.tipoDocumento, n);
    const base: ItemPlan = { doc, posicion, ordenEnTipo: n, totalEnTipo: totalPorTipo.get(doc.tipoDocumento) ?? 1, paginas: 1, paginaInicio: 0 };
    if (!bytes || bytes.length === 0) {
      items.push({ ...base, motivo: "no_disponible" });
      continue;
    }
    const formato = detectarFormato(bytes);
    if (formato === "pdf") {
      try {
        const origen = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
        const paginas = origen.getPageCount();
        items.push(paginas > 0 ? { ...base, pdfOrigen: origen, paginas } : { ...base, motivo: "no_disponible" });
      } catch {
        items.push({ ...base, motivo: "no_disponible" });
      }
    } else if (formato === "jpg" || formato === "png") {
      items.push({ ...base, imagen: { bytes, formato } });
    } else {
      items.push({ ...base, motivo: "no_soportado" });
    }
  }
  return items;
}

function paginaInformativa(pdf: Doc, f: Fuentes, item: ItemPlan) {
  const page = pdf.addPage(A4);
  const { width, height } = page.getSize();
  const titulo = item.motivo === "no_soportado" ? "Documento no incorporado automáticamente" : "No fue posible incorporar este documento";
  page.drawText(seguro(f.negrita, titulo), { x: MARGEN, y: height - 150, size: 18, font: f.negrita, color: NEGRO });
  page.drawText(recortar(f.normal, `${item.doc.tipoDocumento}: ${ROTULO(item.doc)}`, 12, width - MARGEN * 2), { x: MARGEN, y: height - 185, size: 12, font: f.normal, color: NEGRO });
  const detalle = item.motivo === "no_soportado"
    ? "El formato del archivo no se puede convertir automáticamente. Consúltalo desde el expediente del empleado."
    : "El archivo no está disponible o no pudo leerse. El resto del expediente se incluyó normalmente.";
  page.drawText(seguro(f.normal, detalle), { x: MARGEN, y: height - 210, size: 10, font: f.normal, color: GRIS, maxWidth: width - MARGEN * 2 });
}

async function paginaImagen(pdf: Doc, item: ItemPlan) {
  const { bytes, formato } = item.imagen!;
  const img = formato === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  // Orientación razonable: imagen apaisada → página apaisada. Nunca se estira: solo se reduce (o amplía) proporcionalmente dentro de márgenes.
  const apaisada = img.width > img.height;
  const [pw, ph] = apaisada ? [A4[1], A4[0]] : A4;
  const page = pdf.addPage([pw, ph]);
  const maxW = pw - MARGEN * 2;
  const maxH = ph - MARGEN * 2;
  const k = Math.min(maxW / img.width, maxH / img.height, 4);
  const w = img.width * k;
  const h = img.height * k;
  page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
}

/** Genera el PDF consolidado. Nunca lanza por un documento individual. */
export async function construirExpedientePdf(input: {
  empleado: EmpleadoExpediente;
  /** Ya en el orden final (ver ordenarDocumentosExpediente). */
  documentos: readonly EntradaDocumento[];
  fotoPortada?: Uint8Array | null;
  generado: string;
}): Promise<{ bytes: Uint8Array; resumen: ResumenExpediente }> {
  const items = await planificar(input.documentos);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Expediente ${input.empleado.nombre}`.slice(0, 200));
  pdf.setProducer("Plataforma SITSA");
  const f: Fuentes = { normal: await pdf.embedFont(StandardFonts.Helvetica), negrita: await pdf.embedFont(StandardFonts.HelveticaBold) };

  await portada(pdf, f, input.empleado, input.fotoPortada ?? null, input.generado, items.length);

  // Índice solo con 2+ documentos. Puede ocupar varias páginas; el número de página de cada documento se calcula antes de dibujarlo.
  const paginasIndice = items.length > 1 ? Math.ceil(items.length / ITEMS_POR_PAGINA_INDICE) : 0;
  let cursor = 1 + paginasIndice + 1; // página (1-based) donde empieza el primer documento
  for (const it of items) {
    it.paginaInicio = cursor;
    cursor += it.paginas;
  }
  for (let p = 0; p < paginasIndice; p++) {
    const page = pdf.addPage(A4);
    const { width, height } = page.getSize();
    page.drawText("DOCUMENTOS INCLUIDOS", { x: MARGEN, y: height - 90, size: 18, font: f.negrita, color: NEGRO });
    let y = height - 130;
    for (const it of items.slice(p * ITEMS_POR_PAGINA_INDICE, (p + 1) * ITEMS_POR_PAGINA_INDICE)) {
      const sufijo = it.totalEnTipo > 1 ? ` (${it.ordenEnTipo} de ${it.totalEnTipo})` : "";
      const nota = it.motivo ? " — no incorporado" : "";
      const linea = `${it.posicion}. ${it.doc.tipoDocumento}${sufijo} · ${ROTULO(it.doc)}${nota}`;
      page.drawText(recortar(f.normal, linea, 10, width - MARGEN * 2 - 50), { x: MARGEN, y, size: 10, font: f.normal, color: NEGRO });
      const pag = `pág. ${it.paginaInicio}`;
      page.drawText(pag, { x: width - MARGEN - f.normal.widthOfTextAtSize(pag, 10), y, size: 10, font: f.normal, color: GRIS });
      y -= 20;
    }
  }

  const inicios: { page: PDFPage; item: ItemPlan }[] = [];
  let omitidos = 0;
  for (const it of items) {
    try {
      if (it.pdfOrigen) {
        const copiadas = await pdf.copyPages(it.pdfOrigen, it.pdfOrigen.getPageIndices());
        copiadas.forEach((p) => pdf.addPage(p));
        inicios.push({ page: pdf.getPage(pdf.getPageCount() - copiadas.length), item: it });
        continue;
      }
      if (it.imagen) {
        await paginaImagen(pdf, it);
        inicios.push({ page: pdf.getPage(pdf.getPageCount() - 1), item: it });
        continue;
      }
    } catch {
      // Copia/incrustación fallida (PDF dañado a mitad, imagen corrupta): se degrada a página informativa.
      it.motivo = "no_disponible";
      it.pdfOrigen = undefined;
      it.imagen = undefined;
      it.paginas = 1;
    }
    omitidos += 1;
    paginaInformativa(pdf, f, it);
    inicios.push({ page: pdf.getPage(pdf.getPageCount() - 1), item: it });
  }

  // Encabezado discreto en la primera página de cada documento (sin página separadora extra) y pie "Página X de Y" en todas.
  for (const { page, item } of inicios) {
    const { width, height } = page.getSize();
    const sufijo = item.totalEnTipo > 1 ? ` · Documento ${item.ordenEnTipo} de ${item.totalEnTipo}` : "";
    const texto = recortar(f.normal, `${item.doc.tipoDocumento}${sufijo}`, 8, width - 40);
    page.drawText(texto, { x: 20, y: height - 14, size: 8, font: f.negrita, color: GRIS });
  }
  const total = pdf.getPageCount();
  const nombreCorto = recortar(f.normal, `Expediente de ${input.empleado.nombre}`, 8, 300);
  pdf.getPages().forEach((page, i) => {
    const { width } = page.getSize();
    const pie = `Página ${i + 1} de ${total}`;
    page.drawText(pie, { x: width - 20 - f.normal.widthOfTextAtSize(pie, 8), y: 10, size: 8, font: f.normal, color: GRIS });
    page.drawText(nombreCorto, { x: 20, y: 10, size: 8, font: f.normal, color: GRIS });
  });

  return { bytes: await pdf.save(), resumen: { incluidos: items.length - omitidos, omitidos, paginas: total } };
}
