import type PDFDocument from "pdfkit";

/**
 * OBSERVACIONES EN EXPORTACIONES (Fondos y Gastos) — utilidades compartidas por los PDF y los Excel que muestran el
 * campo `observaciones` de la cabecera (el MISMO de la base de datos; no confundir con las «Notas» fijas del pie).
 */

type PdfDoc = InstanceType<typeof PDFDocument>;

/** Texto de observaciones listo para mostrar: conserva saltos de línea; vacío/null/solo espacios => null (no se inventa texto). */
export function observacionesVisibles(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const limpio = String(valor).replace(/\r\n?/g, "\n").trim();
  return limpio ? limpio : null;
}

/** Líneas que ocupará un texto en una celda de `ancho` caracteres: respeta los `\n` y estima el ajuste de cada tramo. */
export function lineasEstimadas(texto: string, ancho: number): number {
  const porLinea = Math.max(1, Math.floor(ancho));
  return texto.replace(/\r\n?/g, "\n").split("\n").reduce((suma, tramo) => suma + Math.max(1, Math.ceil(tramo.length / porLinea)), 0);
}

const ALTURA_LINEA_EXCEL = 15;
const ALTURA_MAXIMA_EXCEL = 409;

/**
 * Altura de fila (pt) para que una celda con `wrapText` muestre TODO el texto, o `undefined` si cabe en una línea (se deja
 * la altura por defecto). Estimación conservadora (ancho de columna en caracteres): puede sobrar un poco de espacio, nunca
 * recorta. Excel no autoajusta filas con celdas combinadas ni en todos los visores, por eso se fija explícitamente.
 */
export function alturaFilaExcel(texto: string | null | undefined, anchoColumna: number): number | undefined {
  const t = observacionesVisibles(texto);
  if (!t) return undefined;
  const lineas = lineasEstimadas(t, anchoColumna);
  return lineas > 1 ? Math.min(ALTURA_MAXIMA_EXCEL, lineas * ALTURA_LINEA_EXCEL) : undefined;
}

export type ObservacionRegistro = { etiqueta: string; texto: string };

/**
 * Observaciones de VARIOS registros (PDF de listado): un solo encabezado y, por cada registro con texto, su etiqueta y el
 * texto completo. Cada registro se pasa entero a la página siguiente si no cabe; los que no tienen texto no se listan.
 */
export function dibujarObservacionesPorRegistroPdf(
  doc: PdfDoc,
  registros: ObservacionRegistro[],
  pageWidth: number,
  marginL: number,
  pageBottom: () => number,
): void {
  const con = registros.filter((r) => observacionesVisibles(r.texto));
  if (!con.length) return;
  doc.x = marginL;
  if (doc.y + 40 > pageBottom()) doc.addPage();
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text("OBSERVACIONES:", marginL, doc.y, { width: pageWidth });
  doc.moveDown(0.2);
  for (const r of con) {
    const texto = observacionesVisibles(r.texto)!;
    doc.font("Helvetica").fontSize(9);
    const alto = doc.heightOfString(texto, { width: pageWidth }) + 14;
    if (doc.y + alto > pageBottom()) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a").text(r.etiqueta, marginL, doc.y, { width: pageWidth });
    doc.font("Helvetica").fontSize(9).fillColor("#0f172a").text(texto, marginL, doc.y, { width: pageWidth });
    doc.moveDown(0.3);
  }
}

/**
 * Bloque «OBSERVACIONES» de un PDF: texto completo (varias líneas, respeta `\n`), nunca recortado. Si el bloque no cabe
 * en lo que queda de la página se pasa íntegro a la siguiente (salto controlado) para no partirlo contra el pie; las
 * firmas, que se dibujan después, calculan su propio salto con la posición resultante. Sin texto no dibuja nada.
 */
export function dibujarObservacionesPdf(
  doc: PdfDoc,
  observaciones: string | null | undefined,
  pageWidth: number,
  marginL: number,
  pageBottom: () => number,
): void {
  const texto = observacionesVisibles(observaciones);
  if (!texto) return;
  doc.font("Helvetica").fontSize(9);
  const alto = doc.heightOfString(texto, { width: pageWidth });
  if (doc.y + 30 + alto > pageBottom()) doc.addPage();
  doc.x = marginL;
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text("OBSERVACIONES:", marginL, doc.y, { width: pageWidth });
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(9).fillColor("#0f172a").text(texto, marginL, doc.y, { width: pageWidth });
}
