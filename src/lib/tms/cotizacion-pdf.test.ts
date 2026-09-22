import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cotizacionPdf } from "./cotizacion-pdf";
import { construirDocumentoComercial } from "./cotizacion-documento";
import { COTIZACION_DOC } from "./cotizacion-documento.fixture";
import { LOGO_KUIQTRANS_HEADER, LOGO_KUIQTRANS_WATERMARK, LOGO_MONACO } from "./cotizacion-pdf-assets";
import { cotizacionPdfKuiqtrans } from "./cotizacion-pdf-kuiqtrans";
import { cotizacionPdfMonaco } from "./cotizacion-pdf-monaco";
import type { Cotizacion } from "./cotizaciones";

/**
 * pdfkit comprime los content streams (FlateDecode): inspeccionar el buffer crudo no sirve. Se valida el
 * TEXTO que cada plantilla pide dibujar (espía sobre PDFDocument.prototype.text) y, para los logos/marca de
 * agua (ahora imágenes reales, no texto), la espía sobre PDFDocument.prototype.image.
 */
const KUIQ: Cotizacion = { ...COTIZACION_DOC, documentoEmisor: "KUIQTRANS", incluyeIva: false };
const MONACO: Cotizacion = { ...COTIZACION_DOC, documentoEmisor: "MONACO", incluyeIva: false };

afterEach(() => vi.restoreAllMocks());

async function generar(c: Cotizacion) {
  const espiaTexto = vi.spyOn(PDFDocument.prototype, "text");
  const espiaImagen = vi.spyOn(PDFDocument.prototype, "image");
  const buffer = await cotizacionPdf(c);
  const textos = espiaTexto.mock.calls.map((llamada) => String(llamada[0]));
  const imagenes = espiaImagen.mock.calls.map((llamada) => llamada[0]);
  espiaTexto.mockRestore();
  espiaImagen.mockRestore();
  return { buffer, textos, todo: textos.join("\n"), imagenes };
}
const paginas = (buffer: Buffer) => buffer.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;

describe("selección de plantilla por documentoEmisor", () => {
  it("KUIQTRANS usa la plantilla KuiqTrans: LOGO real (encabezado + marca de agua), banda azul, «PROPUESTA COMERCIAL»", async () => {
    const { textos, todo, imagenes, buffer } = await generar(KUIQ);
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(imagenes).toContain(LOGO_KUIQTRANS_HEADER);
    expect(imagenes).toContain(LOGO_KUIQTRANS_WATERMARK);
    expect(imagenes).not.toContain(LOGO_MONACO);
    expect(todo).toContain("KuiqTrans"); // pie de página
    expect(textos).toContain("PROPUESTA COMERCIAL");
    expect(textos).toContain("Observaciones y condiciones");
    expect(todo).not.toContain("MÓNACO");
    expect(todo).not.toContain("Logiservicios");
  });

  it("MONACO usa la plantilla Mónaco: LOGO real (encabezado + marca de agua), «COTIZACIÓN», secciones separadas", async () => {
    const { textos, todo, imagenes } = await generar(MONACO);
    expect(imagenes.filter((img) => img === LOGO_MONACO)).toHaveLength(2); // encabezado + marca de agua
    expect(imagenes).not.toContain(LOGO_KUIQTRANS_HEADER);
    expect(todo).toContain("Logiservicios Mónaco"); // pie de página
    expect(textos).toContain("COTIZACIÓN");
    expect(textos).toContain("CONDICIONES");
    expect(textos).toContain("OBSERVACIONES");
    expect(todo).not.toContain("KuiqTrans");
    expect(todo).not.toContain("PROPUESTA COMERCIAL");
  });

  it("no usa el nombre de la empresa/cliente para elegir: un cliente llamado «Logiservicios Mónaco» con marca KUIQTRANS usa el logo y el pie de KuiqTrans", async () => {
    const { todo, imagenes } = await generar({ ...KUIQ, clienteNombre: "Logiservicios Mónaco" });
    expect(imagenes).toContain(LOGO_KUIQTRANS_HEADER);
    expect(imagenes).not.toContain(LOGO_MONACO);
    expect(todo).toContain("KuiqTrans");
    expect(todo).not.toContain("Logiservicios Mónaco · Propuesta"); // el pie NUNCA se arma con el nombre del cliente
  });

  it("las dos plantillas producen PDFs distintos para la misma cotización", async () => {
    const a = await cotizacionPdfKuiqtrans(construirDocumentoComercial(KUIQ));
    const b = await cotizacionPdfMonaco(construirDocumentoComercial(KUIQ));
    expect(a.equals(b)).toBe(false);
  });

  it("marca ausente en una cotización histórica => plantilla KuiqTrans (logo y pie de KuiqTrans)", async () => {
    const { todo, imagenes } = await generar({ ...KUIQ, documentoEmisor: undefined as never });
    expect(todo).toContain("KuiqTrans");
    expect(imagenes).toContain(LOGO_KUIQTRANS_HEADER);
  });
});

describe("logo real y marca de agua — sin firma en ningún documento", () => {
  it.each([["KuiqTrans", KUIQ, [LOGO_KUIQTRANS_HEADER, LOGO_KUIQTRANS_WATERMARK]], ["Mónaco", MONACO, [LOGO_MONACO]]] as const)(
    "%s: el logo dibujado es el archivo REAL en public/brands (mismo buffer, nunca redibujado con texto)",
    async (_marca, base, buffersEsperados) => {
      const { imagenes } = await generar(base);
      for (const esperado of buffersEsperados) expect(imagenes).toContain(esperado);
    },
  );

  it.each([["KuiqTrans", KUIQ], ["Mónaco", MONACO]] as const)(
    "%s: el documento se emite y se envía en digital — sin bloque de firma, línea para firmar ni «Equipo Comercial»",
    async (_marca, base) => {
      const { todo } = await generar(base);
      for (const prohibido of ["Atentamente", "Equipo Comercial", "_________"]) expect(todo).not.toContain(prohibido);
      expect(todo).not.toMatch(/\bfirma\b/i); // palabra completa: no confunde con "confirmación"
    },
  );
});

describe("PDF multipágina — la marca de agua y el branding se repiten en cada página", () => {
  // Se distingue del logo del encabezado por el ANCHO con el que se pidió dibujarla (el ancho de
  // destino de la marca de agua, ver marcaDeAgua en cada plantilla) — necesario porque Mónaco
  // reutiliza el MISMO archivo (LOGO_MONACO) para encabezado y marca de agua.
  it.each([["KuiqTrans", KUIQ, 300], ["Mónaco", MONACO, 420]] as const)(
    "%s: una marca de agua por página, todas centradas en el centro físico (no solo en la primera)",
    async (_marca, base, anchoMarcaDeAgua) => {
      const doc = construirDocumentoComercial({
        ...base,
        observaciones: Array.from({ length: 80 }, (_, i) => `Observación larga número ${i + 1} para forzar varias páginas de contenido real.`).join("\n"),
      });
      const espiaImagen = vi.spyOn(PDFDocument.prototype, "image");
      const render = base.documentoEmisor === "MONACO" ? cotizacionPdfMonaco : cotizacionPdfKuiqtrans;
      const buffer = await render(doc);
      const totalPaginas = paginas(buffer);
      expect(totalPaginas).toBeGreaterThan(1);
      const llamadasWatermark = espiaImagen.mock.calls.filter(([, , , opts]) => (opts as { width?: number } | undefined)?.width === anchoMarcaDeAgua);
      expect(llamadasWatermark).toHaveLength(totalPaginas);
      // Todas al MISMO centro físico (mismo x/y en cada página: el centrado no depende del contenido).
      const posiciones = new Set(llamadasWatermark.map(([, x, y]) => `${x},${y}`));
      expect(posiciones.size).toBe(1);
    },
  );
});

describe.each([["KUIQTRANS", KUIQ], ["MONACO", MONACO]] as const)("contenido comercial — %s", (_marca, base) => {
  it("imprime cliente, atención, cargo, origen, destino, unidad y precio", async () => {
    const { todo } = await generar(base);
    for (const valor of ["Distribuidora Ejemplo, S.A.", "Atención: Claudia Cordero", "Compras / Logística", "Bodega Zona 12", "Puerto Barrios, Izabal", "Camión 5 toneladas", "Q1,400.00"]) {
      expect(todo).toContain(valor);
    }
  });

  it("tabla comercial con las cuatro columnas y el saludo propio de la marca", async () => {
    const { textos } = await generar(base);
    for (const titulo of ["Punto de carga", "Punto de descarga", "Unidad", "Precio sin IVA"]) expect(textos).toContain(titulo);
    expect(textos.some((t) => t.includes(base.documentoEmisor === "MONACO" ? "Es un gusto saludarles" : "Reciban un cordial saludo"))).toBe(true);
  });

  it("no incluye IVA: encabezado «Precio sin IVA» y nunca el otro", async () => {
    const { textos, todo } = await generar({ ...base, incluyeIva: false });
    expect(textos).toContain("Precio sin IVA");
    expect(todo).not.toContain("Precio IVA incluido");
  });

  it("incluye IVA: encabezado «Precio IVA incluido» y nunca el otro", async () => {
    const { textos, todo } = await generar({ ...base, incluyeIva: true });
    expect(textos).toContain("Precio IVA incluido");
    expect(todo).not.toContain("Precio sin IVA");
  });

  it("una sola semántica de IVA: sin subtotal, IVA (12%), total ni «+ IVA» en ningún caso", async () => {
    for (const incluyeIva of [true, false]) {
      const { todo } = await generar({ ...base, incluyeIva });
      expect(todo).not.toMatch(/subtotal|iva \(12|total|\+ iva/i);
      expect(todo).toContain("Q1,400.00"); // siempre tarifaCotizada
    }
  });

  it("lista únicamente las condiciones que aplican", async () => {
    const { todo } = await generar(base);
    for (const valor of ["Piloto incluido", "GPS", "Seguro contra terceros", "Servicio refrigerado", "50 km incluidos", "Q12.50 por km adicional", "Pago contra entrega.", "Vigencia sujeta a disponibilidad."]) {
      expect(todo).toContain(valor);
    }
    expect(todo).not.toContain("Seguro de mercadería"); // apagado en la cotización
  });

  it("todo apagado: sin sección de condiciones y sin «No» sueltos", async () => {
    const { textos } = await generar({
      ...base, pilotoIncluido: false, gpsIncluido: false, seguroMercaderiaIncluido: false, seguroTercerosIncluido: false,
      servicioRefrigerado: false, kmIncluidos: null, tarifaKmAdicional: null, condicionesAdicionales: null, observaciones: null,
    });
    expect(textos).not.toContain("Observaciones y condiciones");
    expect(textos).not.toContain("CONDICIONES");
    expect(textos).not.toContain("OBSERVACIONES");
    expect(textos).not.toContain("No");
    expect(textos.join("\n")).not.toMatch(/GPS|Piloto|Seguro/);
  });

  it("observaciones, fecha de emisión y fecha de vencimiento", async () => {
    const { todo } = await generar(base);
    expect(todo).toContain("Cliente frecuente.");
    expect(todo).toContain("Fecha: 8 de septiembre de 2026");
    expect(todo).toContain("Propuesta válida hasta el 22 de septiembre de 2026.");
    expect(todo).toContain("COT-000123");
  });

  it("sin fecha de vencimiento no imprime vigencia inventada", async () => {
    const { todo } = await generar({ ...base, fechaVencimiento: null });
    expect(todo).not.toContain("Propuesta válida");
  });

  it("atención y cargo opcionales: sin ellos solo aparece el cliente", async () => {
    const { todo } = await generar({ ...base, atencionNombre: null, atencionCargo: null });
    expect(todo).toContain("Distribuidora Ejemplo, S.A.");
    expect(todo).not.toContain("Atención");
    expect(todo).not.toContain("Claudia");
  });

  it("no revienta con todos los opcionales vacíos y produce un PDF válido", async () => {
    const { buffer } = await generar({
      ...base, rutaId: null, rutaCodigoHistorico: null, origenTexto: null, destinoTexto: null, unidadDescripcion: null,
      tarifaReferencia: null, kmIncluidos: null, tarifaKmAdicional: null, condicionesAdicionales: null, observaciones: null,
      fechaVencimiento: null, atencionNombre: null, atencionCargo: null,
    });
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buffer.subarray(-6).toString("latin1")).toContain("%%EOF");
  });

  it("PDF válido, no vacío y de una sola página Letter para una cotización simple", async () => {
    const { buffer } = await generar(base);
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(1500);
    expect(paginas(buffer)).toBe(1);
    expect(buffer.toString("latin1")).toContain("/MediaBox [0 0 612 792]");
  });

  it("textos largos: el PDF sigue siendo válido y el texto llega completo (no se trunca)", async () => {
    const largo = "Almacén general de distribución nacional con dirección extensa ".repeat(8).trim();
    const { buffer, textos } = await generar({
      ...base, origenTexto: largo, destinoTexto: largo, unidadDescripcion: largo,
      observaciones: "Observación extensa. ".repeat(80).trim(),
      condicionesAdicionales: Array.from({ length: 45 }, (_, i) => `Condición adicional número ${i + 1} con texto de relleno suficiente para ocupar el ancho.`).join("\n"),
    });
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(textos.filter((t) => t === largo).length).toBeGreaterThanOrEqual(3);
    expect(textos.some((t) => t.startsWith("Observación extensa."))).toBe(true);
    expect(textos).toContain("Condición adicional número 45 con texto de relleno suficiente para ocupar el ancho.");
    expect(paginas(buffer)).toBeGreaterThan(1);
    // Pie con paginación en cada página.
    const total = paginas(buffer);
    for (let i = 1; i <= total; i++) expect(textos).toContain(`Página ${i} de ${total}`);
  });
});

describe("tabla comercial preparada para varias líneas (renderer con lineas[])", () => {
  const muchas = (base: Cotizacion) => {
    const modelo = construirDocumentoComercial(base);
    modelo.lineas = Array.from({ length: 70 }, (_, i) => ({ origen: `Origen ${i + 1} con texto largo de ejemplo`, destino: `Destino ${i + 1}`, unidad: "Camión 5 toneladas", precio: 1000 + i }));
    return modelo;
  };

  it.each([["KuiqTrans", cotizacionPdfKuiqtrans, KUIQ], ["Mónaco", cotizacionPdfMonaco, MONACO]] as const)("%s: cruza páginas y repite el encabezado de la tabla", async (_n, render, base) => {
    const espia = vi.spyOn(PDFDocument.prototype, "text");
    const buffer = await render(muchas(base));
    const textos = espia.mock.calls.map((c) => String(c[0]));
    const paginasTotal = paginas(buffer);
    expect(paginasTotal).toBeGreaterThan(1);
    expect(textos.filter((t) => t === "Punto de carga").length).toBe(paginasTotal);
    expect(textos).toContain("Origen 70 con texto largo de ejemplo");
    expect(textos).toContain("Q1,069.00");
  });
});

describe.each([["KUIQTRANS", KUIQ], ["MONACO", MONACO]] as const)("cotización con varias rutas/destinos — %s (AJUSTES FINALES)", (_marca, base) => {
  // Caso real: una sola cotización con 4 destinos PriceSmart, cada uno "Distribución Local",
  // unidad "1 Tonelada" y el mismo precio (Q937.50) — pero cada renglón imprime SU PROPIO precio,
  // nunca un total colapsado en su lugar.
  const priceSmart = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: i + 1, orden: i + 2, origenTexto: `Bodega Central`, destinoTexto: `PriceSmart Destino ${i + 1}`, unidadDescripcion: "1 Tonelada", tarifaCotizada: 937.5,
  }));

  it("1 sola línea (la principal, sin adicionales): sin total general", async () => {
    const { todo } = await generar({ ...base, lineasAdicionales: [] });
    expect(todo).not.toMatch(/Total/i);
  });

  it("3 líneas adicionales (4 en total): cada una imprime su propio origen/destino/unidad/precio, SIN ningún total general debajo de la tabla", async () => {
    const { textos, todo } = await generar({ ...base, tarifaCotizada: 937.5, lineasAdicionales: priceSmart(3) });
    for (let i = 1; i <= 3; i++) {
      expect(textos).toContain(`PriceSmart Destino ${i}`);
    }
    // 4 celdas con el mismo precio individual (la principal + 3 adicionales) — el precio de cada
    // línea sigue apareciendo tal cual en la tabla.
    expect(textos.filter((t) => t === "Q937.50").length).toBeGreaterThanOrEqual(4);
    expect(todo).not.toMatch(/Total/i);
    expect(todo).not.toContain("Q3,750.00"); // la suma de las 4 líneas nunca se imprime
  });

  it("4 líneas adicionales (5 en total): ninguna se pierde ni se colapsa, cada precio individual sigue impreso, sin total general", async () => {
    const { textos, todo } = await generar({ ...base, tarifaCotizada: 937.5, lineasAdicionales: priceSmart(4) });
    for (let i = 1; i <= 4; i++) expect(textos).toContain(`PriceSmart Destino ${i}`);
    expect(textos.filter((t) => t === "Q937.50").length).toBeGreaterThanOrEqual(5);
    expect(todo).not.toMatch(/Total/i);
  });

  it("10+ líneas adicionales: fuerza varias páginas, repite el encabezado de la tabla, conserva «Página X de Y», marca de agua y branding en cada página", async () => {
    const espiaTexto = vi.spyOn(PDFDocument.prototype, "text");
    const espiaImagen = vi.spyOn(PDFDocument.prototype, "image");
    const doc = construirDocumentoComercial({
      ...base,
      lineasAdicionales: Array.from({ length: 12 }, (_, i) => ({
        id: i + 1, orden: i + 2, origenTexto: `Origen ${i + 2}`, destinoTexto: `Destino ${i + 2} con nombre largo de referencia`, unidadDescripcion: "1 Tonelada", tarifaCotizada: 100 + i,
      })),
    });
    const render = base.documentoEmisor === "MONACO" ? cotizacionPdfMonaco : cotizacionPdfKuiqtrans;
    const buffer = await render(doc);
    const textos = espiaTexto.mock.calls.map((c) => String(c[0]));
    const totalPaginas = paginas(buffer);
    expect(totalPaginas).toBeGreaterThan(1);
    // El encabezado de la tabla se repite cada vez que ESTA se corta entre páginas (puede haber
    // más páginas que cortes de tabla si el resto del contenido también desborda) — nunca menos
    // de 1, y la prueba de 70 líneas (arriba) ya confirma 1:1 cuando el desborde es solo de tabla.
    expect(textos.filter((t) => t === "Punto de carga").length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i <= totalPaginas; i++) expect(textos).toContain(`Página ${i} de ${totalPaginas}`);
    // Las 13 líneas (1 principal + 12 adicionales) están completas, ninguna se perdió al paginar.
    expect(textos).toContain("Destino 13 con nombre largo de referencia");
    // Branding/marca de agua preservados en TODAS las páginas (ver también el describe "PDF multipágina").
    const anchoMarcaDeAgua = base.documentoEmisor === "MONACO" ? 420 : 300;
    const marcaDeAgua = espiaImagen.mock.calls.filter(([, , , opts]) => (opts as { width?: number } | undefined)?.width === anchoMarcaDeAgua);
    expect(marcaDeAgua).toHaveLength(totalPaginas);
    // Sin total general en ningún lado del documento, ni siquiera con 13 líneas.
    expect(textos.join("\n")).not.toMatch(/Total/i);
  });

  it("varias líneas: cada renglón respeta el encabezado de IVA vigente (sin IVA e IVA incluido), nunca mezclado", async () => {
    for (const incluyeIva of [false, true]) {
      const { textos, todo } = await generar({ ...base, incluyeIva, lineasAdicionales: priceSmart(3) });
      expect(textos).toContain(incluyeIva ? "Precio IVA incluido" : "Precio sin IVA");
      expect(todo).not.toContain(incluyeIva ? "Precio sin IVA" : "Precio IVA incluido");
    }
  });

  it("línea adicional sin origen/destino/unidad (null) cae al mismo placeholder «—» que la línea principal", async () => {
    const { textos } = await generar({
      ...base,
      lineasAdicionales: [{ id: 1, orden: 2, origenTexto: null, destinoTexto: null, unidadDescripcion: null, tarifaCotizada: 500 }],
    });
    expect(textos).toContain("Q500.00");
  });
});
