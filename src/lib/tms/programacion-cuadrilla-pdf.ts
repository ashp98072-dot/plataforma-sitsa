import PDFDocument from "pdfkit";
import { envolverTexto } from "./programacion-imagen";

/** Solo Cuadrilla: segmenta palabras demasiado anchas antes del helper PDF
 * compartido (que las abrevia). Misma Helvetica 7.5, columna 90 y padding 4.
 * No modifica snapshots ni el formato de las demás columnas.
 */
export function textoCuadrillaPdf(nombre: string): string {
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.font("Helvetica").fontSize(7.5);
  const texto = envolverTexto(nombre, 82, (parte) => doc.widthOfString(parte), true).join(" ");
  doc.end();
  return texto;
}
