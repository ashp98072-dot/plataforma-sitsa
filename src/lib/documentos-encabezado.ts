import type PDFDocument from "pdfkit";

/**
 * Número/código del documento en la esquina SUPERIOR DERECHA del encabezado de un PDF individual (Solicitud de Fondo,
 * Requerimiento de compra). Se dibuja en la primera página, dentro del margen derecho, sin mover el cursor: el título centrado y
 * el resto del documento quedan exactamente donde estaban. El código es el valor PERSISTIDO (nunca se reconstruye desde el id).
 */
export function dibujarCodigoDocumentoPdf(
  doc: InstanceType<typeof PDFDocument>,
  codigo: string,
  area: { x: number; width: number; y: number },
): void {
  if (!codigo?.trim()) return; // sin código persistido no se dibuja nada (nunca se inventa)
  const x0 = doc.x;
  const y0 = doc.y;
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a")
    .text(codigo.normalize("NFC"), area.x, area.y, { width: area.width, align: "right", lineBreak: false });
  doc.x = x0;
  doc.y = y0;
}
