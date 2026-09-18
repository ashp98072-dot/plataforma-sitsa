import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { decodificarPng } from "@/lib/firmas/reforzar-firma-pdf";
import { dibujarTablaEnDoc } from "@/lib/rrhh/export-files";
import { formatearFechaVisible, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { dibujarFirmas, moneda } from "@/lib/tms/fondos-solicitud-pdf";
import type { DetalleCompra } from "./requerimiento-schema";
import type { FirmaCompraReporte } from "./requerimiento-firma-reporte";

const visible = (s: string | null | undefined) => (s?.trim() || "Sin dato histórico").normalize("NFC");
export const COLUMNAS_EXCEL_COMPRA = [
  "Fecha requerimiento", "Empresa requirente", "Persona que requiere", "Solicitante", "Encargado compras",
  "Unidad / placa", "Fecha línea", "Serie factura", "Número factura", "Proveedor", "Repuesto",
  "Método de pago", "Condición de pago", "Total", "Observaciones",
] as const;

/** Solo datos persistidos: no JOIN de nombres, no recálculo del total. */
export function requerimientoCompraPdf(d: DetalleCompra, empresaNombre: string, firma: FirmaCompraReporte | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margins: { top: 40, bottom: 56, left: 32, right: 32 }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const x = 32, width = doc.page.width - 64;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 12;
    const espacio = (h: number) => { if (doc.y + h > bottom()) doc.addPage(); };
    const texto = (s: string) => {
      doc.x = x;
      doc.font("Helvetica").fontSize(9.5).fillColor("#0f172a").text(s.normalize("NFC"), { width });
    };
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a").text(empresaNombre.normalize("NFC"), { width, align: "center" });
    doc.moveDown(0.3).text("REQUERIMIENTO DE COMPRA", { width, align: "center" });
    doc.moveDown(0.4);
    texto(`Código: ${d.codigo}`);
    texto(`Fecha de requerimiento: ${formatearFechaVisible(d.fecha_requerimiento)} · Estado: ${d.estado}`);
    texto(`Empresa requirente: ${visible(d.entidad_requirente_nombre)}`);
    texto(`Persona que requiere: ${visible(d.requirente_nombre)}`);
    texto(`Solicitante: ${visible(d.solicitante_nombre)}`);
    texto(`Encargado de compras: ${visible(d.encargado_compras_nombre)}`);
    doc.moveDown(0.5);

    // Bloques por línea: tabla compartida para datos cortos; textos largos fluyen completos
    // entre páginas, sin maxLines/ellipsis que pudiera ocultar repuestos u observaciones.
    d.lineas.forEach((l, i) => {
      espacio(150);
      doc.font("Helvetica-Bold").fontSize(10).text(`Detalle de compra - Línea ${i + 1}`, x, doc.y, { width });
      doc.moveDown(0.3);
      dibujarTablaEnDoc(doc, {
        headers: ["Unidad / placa", "Fecha", "Proveedor", "Total"],
        rows: [[visible(l.unidad_descripcion), formatearFechaVisible(l.fecha), visible(l.proveedor_nombre_snapshot), moneda(Number(l.total))]],
        weight: { 0: 210, 1: 90, 2: 310, 3: 118 }, align: { 3: "right" }, maxLines: 100,
      });
      doc.moveDown(0.3);
      texto(`Serie factura: ${visible(l.serie_factura)} · Número factura: ${visible(l.numero_factura)}`);
      texto(`Método de pago: ${visible(l.metodo_pago)} · Condición de pago: ${l.condicion_pago}`);
      texto(`Repuesto / descripción: ${visible(l.repuesto_descripcion)}`);
      if (l.observaciones) texto(`Observaciones de línea ${i + 1}: ${l.observaciones}`);
      doc.moveDown(0.6);
    });
    espacio(28);
    doc.font("Helvetica-Bold").fontSize(11).text(`TOTAL: ${moneda(Number(d.total))}`, x, doc.y, { width, align: "right" });
    if (d.observaciones) { doc.moveDown(0.4); texto(`Observaciones del requerimiento: ${d.observaciones}`); }
    doc.moveDown(0.5);
    espacio(50);
    if (d.estado === "Rechazada") {
      texto("RECHAZADA");
      texto(`Fecha de rechazo: ${formatearTimestampVisible(d.rechazado_en)}`);
      texto(`Motivo: ${visible(d.motivo_rechazo)}`);
    } else if (d.estado === "Pendiente") texto("PENDIENTE DE AUTORIZACIÓN");
    espacio(d.estado === "Autorizada" ? 285 : 205);
    // Validar que la imagen histórica es dibujable antes del helper compartido,
    // que tolera imágenes inválidas en otros documentos.
    if (d.estado === "Autorizada" && firma?.imagen) decodificarPng(firma.imagen.buffer);
    dibujarFirmas(doc, width, x, bottom, {
      solicitante: d.solicitante_nombre, requirente: d.requirente_nombre,
      autorizante: d.estado === "Autorizada" ? d.autorizante_nombre || firma?.nombre || null : null,
      imagenSolicitante: null, imagenRequirente: null,
      imagenAutorizante: d.estado === "Autorizada" ? firma?.imagen ?? null : null,
    });
    espacio(65);
    doc.moveDown(0.2);
    doc.moveTo(x, doc.y + 16).lineTo(x + 220, doc.y + 16).strokeColor("#94a3b8").lineWidth(0.6).stroke();
    doc.y += 20;
    texto(`ENCARGADO DE COMPRAS: ${visible(d.encargado_compras_nombre)}`);
    if (d.estado === "Autorizada" && firma) {
      texto(`Autorizado por: ${visible(d.autorizante_nombre || firma.nombre)}`);
      if (firma.rol) texto(`Rol al firmar: ${firma.rol}`);
      texto(`Fecha/hora de firma: ${formatearTimestampVisible(firma.fecha)} (Guatemala)`);
      texto(`Código de firma: ${firma.codigo}`);
    }
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const margen = doc.page.margins.bottom;
      doc.page.margins.bottom = 16;
      doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8").text(`Página ${i + 1} de ${range.count} · ${d.codigo}`, x, doc.page.height - 32, { width, align: "center", lineBreak: false });
      doc.page.margins.bottom = margen;
    }
    doc.end();
  });
}

const fechaExcel = (s: string) => new Date(`${s}T00:00:00Z`);
export async function requerimientoCompraExcel(d: DetalleCompra, empresaNombre: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Plataforma corporativa";
  // Excel limita nombres de hoja a 31 caracteres; códigos largos se conservan completos en cabecera.
  const ws = wb.addWorksheet(`Requerimiento ${d.codigo}`.replace(/[\\/*?:\[\]]/g, "-").slice(0, 31), { views: [{ state: "frozen", ySplit: 7, showGridLines: false }] });
  ws.columns = [19, 30, 28, 28, 28, 28, 16, 22, 24, 32, 48, 24, 20, 20, 55].map(width => ({ width }));
  for (const [i, valor] of [empresaNombre, "REQUERIMIENTO DE COMPRA", `Código: ${d.codigo}`, `Fecha: ${formatearFechaVisible(d.fecha_requerimiento)} · Estado: ${d.estado}`].entries()) {
    ws.mergeCells(i + 1, 1, i + 1, 15);
    const row = ws.getRow(i + 1);
    row.getCell(1).value = valor;
    row.font = { name: "Arial", bold: true, size: i === 0 ? 16 : 12 };
    row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    row.height = 30;
  }
  ws.mergeCells("A5:O5"); ws.getCell("A5").value = `Observaciones del requerimiento: ${d.observaciones || "—"}`;
  ws.getCell("A5").alignment = { wrapText: true, vertical: "top" };
  ws.getRow(5).height = Math.max(24, Math.ceil((d.observaciones?.length ?? 0) / 250) * 15);
  const header = ws.getRow(7); header.values = [...COLUMNAS_EXCEL_COMPRA]; header.height = 32;
  header.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  for (const l of d.lineas) {
    const row = ws.addRow([fechaExcel(d.fecha_requerimiento), visible(d.entidad_requirente_nombre), visible(d.requirente_nombre), visible(d.solicitante_nombre), visible(d.encargado_compras_nombre), visible(l.unidad_descripcion), fechaExcel(l.fecha), l.serie_factura || "", l.numero_factura || "", visible(l.proveedor_nombre_snapshot), l.repuesto_descripcion, l.metodo_pago, l.condicion_pago, Number(l.total), l.observaciones || ""]);
    row.font = { name: "Arial", size: 10 }; row.alignment = { vertical: "top", wrapText: true };
    row.height = Math.max(30, Math.ceil(l.repuesto_descripcion.length / 45) * 14, Math.ceil((l.observaciones?.length ?? 0) / 50) * 14);
  }
  ws.getColumn(1).numFmt = "dd/mm/yyyy"; ws.getColumn(7).numFmt = "dd/mm/yyyy";
  ws.getColumn(14).numFmt = '"Q "#,##0.00';
  ws.autoFilter = { from: "A7", to: `O${7 + d.lineas.length}` };
  ws.addRow([]);
  const total = ws.addRow(Array.from({ length: 14 }, (_, i) => i === 12 ? "TOTAL" : i === 13 ? Number(d.total) : null));
  total.font = { bold: true }; total.getCell(14).numFmt = '"Q "#,##0.00';
  if (d.estado === "Rechazada") {
    ws.addRow(["Fecha de rechazo", formatearTimestampVisible(d.rechazado_en)]);
    const row = ws.addRow(["Motivo", d.motivo_rechazo || "Sin dato histórico"]);
    ws.mergeCells(row.number, 2, row.number, 15); row.alignment = { wrapText: true }; row.height = Math.max(30, Math.ceil((d.motivo_rechazo?.length ?? 0) / 200) * 15);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
