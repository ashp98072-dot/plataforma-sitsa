import PDFDocument from "pdfkit";
import ExcelJS, { type PaperSize } from "exceljs";
import { dibujarTablaEnDoc } from "@/lib/rrhh/export-files";
import { dibujarCodigoDocumentoPdf } from "@/lib/documentos-encabezado";
import { formatearFechaVisible, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { moneda } from "@/lib/tms/fondos-solicitud-pdf";
import type { DetalleRequerimientoRrhh } from "./requerimiento-schema";

/**
 * RRHH-REQUERIMIENTOS-PROVEEDORES-1 — PDF/Excel formales del requerimiento de RRHH. Mismo patrón visual/estructural
 * que src/lib/compras/requerimiento-exportaciones.ts (reutiliza dibujarTablaEnDoc/dibujarCodigoDocumentoPdf/moneda,
 * genéricos), pero SIN firma manuscrita (imagen): esta primera fase no implementó captura de "Mi firma" para RRHH
 * (ver requerimientos.ts) — el bloque de firmas muestra el nombre de cada rol sobre una línea, igual que cualquier
 * documento administrativo cuando ese rol no tiene firma capturada. Solo datos PERSISTIDOS: nunca JOIN en vivo al
 * proveedor (siempre los snapshots de la línea) ni recálculo del total.
 */
const visible = (s: string | null | undefined) => (s?.trim() || "Sin dato histórico").normalize("NFC");
export const COLUMNAS_EXCEL_RRHH_REQ = [
  "No.", "Proveedor", "NIT", "Descripción / concepto", "Cantidad", "Precio unitario", "Método de pago", "Condición",
  "Banco", "Número de cuenta", "Tipo de cuenta", "Total", "Observaciones",
] as const;
const ANCHO_COLUMNAS_EXCEL_RRHH_REQ = [6, 24, 14, 34, 10, 14, 16, 12, 18, 16, 14, 14, 26];
const COLUMNAS_TABLA_RRHH_REQ = COLUMNAS_EXCEL_RRHH_REQ.length;
const bordeFino = { style: "thin", color: { argb: "FF94A3B8" } } as const;
const bordeCelda = { top: bordeFino, bottom: bordeFino, left: bordeFino, right: bordeFino };

function datosBancarios(l: DetalleRequerimientoRrhh["lineas"][number]): string {
  if (l.metodo_pago !== "Transferencia") return "—";
  return `${visible(l.banco_snapshot)} · Cta. ${visible(l.numero_cuenta_snapshot)}${l.tipo_cuenta_snapshot ? ` (${l.tipo_cuenta_snapshot})` : ""}`;
}

export function requerimientoRrhhPdf(d: DetalleRequerimientoRrhh): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margins: { top: 28, bottom: 38, left: 32, right: 32 }, bufferPages: true });
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
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#0f172a").text((d.entidad_requirente_nombre?.trim() || "EMPRESA REQUIRENTE NO REGISTRADA").normalize("NFC"), { width, align: "center" });
    doc.moveDown(0.2);
    dibujarCodigoDocumentoPdf(doc, d.codigo, { x, width, y: doc.y });
    doc.fontSize(12).text("REQUERIMIENTO DE RRHH", { width, align: "center" });
    doc.moveDown(0.4);
    texto(`Código: ${d.codigo} · Fecha de requerimiento: ${formatearFechaVisible(d.fecha_requerimiento)} · Estado: ${d.estado}`);
    texto(`Persona que requiere: ${visible(d.requirente_nombre)} · Solicitante: ${visible(d.solicitante_nombre)}`);
    doc.moveDown(0.5);

    dibujarTablaEnDoc(doc, {
      headers: ["No.", "Proveedor", "Descripción / concepto", "Cantidad", "P. unitario", "Método", "Datos de pago (Transferencia)", "Total"],
      rows: d.lineas.map((l, i) => [String(i + 1), visible(l.proveedor_nombre_snapshot), visible(l.descripcion), String(Number(l.cantidad)),
        moneda(Number(l.precio_unitario)), `${l.metodo_pago} · ${l.condicion_pago}`, datosBancarios(l), moneda(Number(l.total))]),
      weight: { 0: 20, 1: 100, 2: 170, 3: 45, 4: 60, 5: 80, 6: 150, 7: 66 }, align: { 3: "right", 4: "right", 7: "right" }, maxLines: 100,
    });
    doc.y += 6;
    espacio(28);
    doc.font("Helvetica-Bold").fontSize(11).text(`TOTAL: ${moneda(Number(d.total))}`, x, doc.y, { width, align: "right" });
    d.lineas.forEach((l, i) => { if (l.observaciones) { doc.moveDown(0.2); texto(`Observaciones de línea ${i + 1}: ${l.observaciones}`); } });
    if (d.observaciones) { doc.moveDown(0.4); texto(`Observaciones del requerimiento: ${d.observaciones}`); }
    doc.moveDown(0.5);
    espacio(50);
    if (d.estado === "Rechazada") {
      texto("RECHAZADA");
      texto(`Fecha de rechazo: ${formatearTimestampVisible(d.rechazado_en)}`);
      texto(`Motivo: ${visible(d.motivo_rechazo)}`);
    } else if (d.estado === "Pendiente") texto("PENDIENTE DE AUTORIZACIÓN");

    // Firmas: sin imagen (esta fase no captura "Mi firma" para RRHH) — nombre del rol sobre una línea, igual que
    // cualquier documento administrativo cuando ese rol no tiene firma capturada.
    const nombres = [visible(d.requirente_nombre), visible(d.solicitante_nombre),
      d.estado === "Autorizada" ? visible(d.autorizante_nombre) : d.estado === "Pendiente" ? "PENDIENTE DE AUTORIZACIÓN" : "RECHAZADA"];
    const etiquetas = ["FIRMA DEL REQUIRIENTE", "FIRMA DEL SOLICITANTE", "FIRMA DEL AUTORIZANTE"];
    const anchoFirma = width / 3 - 16;
    doc.font("Helvetica-Bold").fontSize(8);
    const altoEtiqueta = Math.max(...etiquetas.map(s => doc.heightOfString(s, { width: anchoFirma })));
    doc.font("Helvetica").fontSize(8);
    const altoNombre = Math.max(...nombres.map(s => doc.heightOfString(s, { width: anchoFirma })));
    const altoFirmas = 55 + altoEtiqueta + altoNombre + 12;
    espacio(altoFirmas);
    const inicioFirma = doc.y;
    etiquetas.forEach((etiqueta, i) => {
      const columnaX = x + i * width / 3 + 8;
      doc.moveTo(columnaX, inicioFirma + 50).lineTo(columnaX + anchoFirma, inicioFirma + 50).strokeColor("#94a3b8").lineWidth(0.6).stroke();
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(8).text(etiqueta, columnaX, inicioFirma + 55, { width: anchoFirma, align: "center" });
      doc.font("Helvetica").text(nombres[i], columnaX, inicioFirma + 55 + altoEtiqueta, { width: anchoFirma, align: "center" });
    });
    doc.x = x; doc.y = inicioFirma + altoFirmas;

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
function bordeFila(row: ExcelJS.Row, columnas: number) {
  for (let c = 1; c <= columnas; c++) row.getCell(c).border = bordeCelda;
}

export async function requerimientoRrhhExcel(d: DetalleRequerimientoRrhh): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Plataforma corporativa";
  const ws = wb.addWorksheet(`Requerimiento ${d.codigo}`.replace(/[\\/*?:[\]]/g, "-").slice(0, 31));
  ws.columns = ANCHO_COLUMNAS_EXCEL_RRHH_REQ.map(width => ({ width }));

  const centrada = (valor: string, size: number) => {
    const row = ws.addRow([valor.normalize("NFC")]);
    ws.mergeCells(row.number, 1, row.number, COLUMNAS_TABLA_RRHH_REQ);
    row.font = { name: "Arial", bold: true, size };
    row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    row.height = Math.max(22, size * 1.6);
    return row;
  };
  const texto = (valor: string, opts: { bold?: boolean } = {}) => {
    const row = ws.addRow([valor]);
    ws.mergeCells(row.number, 1, row.number, COLUMNAS_TABLA_RRHH_REQ);
    row.font = { name: "Arial", size: 10, bold: Boolean(opts.bold) };
    row.alignment = { horizontal: "left", vertical: "top", wrapText: true };
    row.height = Math.max(18, Math.ceil(valor.length / 140) * 14);
    return row;
  };

  centrada(d.entidad_requirente_nombre?.trim() || "EMPRESA REQUIRENTE NO REGISTRADA", 16);
  // Título centrado y, en las últimas columnas de la MISMA fila, el código del requerimiento (persistido, nunca reconstruido).
  const filaTitulo = ws.addRow(["REQUERIMIENTO DE RRHH".normalize("NFC")]);
  filaTitulo.getCell(COLUMNAS_TABLA_RRHH_REQ - 2).value = d.codigo.normalize("NFC");
  ws.mergeCells(filaTitulo.number, 1, filaTitulo.number, COLUMNAS_TABLA_RRHH_REQ - 3);
  ws.mergeCells(filaTitulo.number, COLUMNAS_TABLA_RRHH_REQ - 2, filaTitulo.number, COLUMNAS_TABLA_RRHH_REQ);
  filaTitulo.font = { name: "Arial", bold: true, size: 13 };
  filaTitulo.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  filaTitulo.getCell(COLUMNAS_TABLA_RRHH_REQ - 2).font = { name: "Arial", bold: true, size: 12 };
  filaTitulo.getCell(COLUMNAS_TABLA_RRHH_REQ - 2).alignment = { horizontal: "right", vertical: "middle" };
  filaTitulo.height = Math.max(22, 13 * 1.6);
  texto(`Código: ${d.codigo} · Fecha: ${formatearFechaVisible(d.fecha_requerimiento)} · Estado: ${d.estado}`);
  texto(`Persona que requiere: ${visible(d.requirente_nombre)} · Solicitante: ${visible(d.solicitante_nombre)}`);
  ws.addRow([]);

  const filaEncabezadoTabla = ws.rowCount + 1;
  const header = ws.getRow(filaEncabezadoTabla);
  header.values = [...COLUMNAS_EXCEL_RRHH_REQ];
  header.height = 26;
  header.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  bordeFila(header, COLUMNAS_TABLA_RRHH_REQ);

  d.lineas.forEach((l, i) => {
    const row = ws.addRow([
      i + 1, visible(l.proveedor_nombre_snapshot), visible(l.proveedor_nit_snapshot), visible(l.descripcion),
      Number(l.cantidad), Number(l.precio_unitario), l.metodo_pago, l.condicion_pago,
      l.metodo_pago === "Transferencia" ? visible(l.banco_snapshot) : "—",
      l.metodo_pago === "Transferencia" ? visible(l.numero_cuenta_snapshot) : "—",
      l.metodo_pago === "Transferencia" ? visible(l.tipo_cuenta_snapshot) : "—",
      Number(l.total), l.observaciones ?? "",
    ]);
    row.font = { name: "Arial", size: 10 };
    row.alignment = { vertical: "top", wrapText: true };
    row.height = Math.max(20, Math.ceil(l.descripcion.length / 30) * 13);
    bordeFila(row, COLUMNAS_TABLA_RRHH_REQ);
    row.getCell(1).alignment = { horizontal: "center", vertical: "top" };
  });
  ws.getColumn(5).numFmt = "#,##0.00";
  ws.getColumn(6).numFmt = '"Q "#,##0.00';
  ws.getColumn(12).numFmt = '"Q "#,##0.00';
  for (const c of [5, 6, 12]) { ws.getColumn(c).alignment = { horizontal: "right", vertical: "top" }; }
  ws.views = [{ state: "frozen", ySplit: filaEncabezadoTabla, showGridLines: false }];

  ws.addRow([]);
  const total = ws.addRow([]);
  ws.mergeCells(total.number, 1, total.number, COLUMNAS_TABLA_RRHH_REQ - 2);
  total.getCell(1).value = "TOTAL:";
  total.getCell(1).alignment = { horizontal: "right" };
  total.getCell(COLUMNAS_TABLA_RRHH_REQ - 1).value = Number(d.total);
  total.getCell(COLUMNAS_TABLA_RRHH_REQ - 1).numFmt = '"Q "#,##0.00';
  total.getCell(COLUMNAS_TABLA_RRHH_REQ - 1).alignment = { horizontal: "right" };
  total.font = { name: "Arial", bold: true, size: 11 };
  total.height = 22;

  if (d.observaciones) texto(`Observaciones del requerimiento: ${d.observaciones}`);
  if (d.estado === "Rechazada") {
    texto("RECHAZADA", { bold: true });
    texto(`Fecha de rechazo: ${formatearTimestampVisible(d.rechazado_en)}`);
    texto(`Motivo: ${visible(d.motivo_rechazo)}`);
  } else if (d.estado === "Pendiente") {
    texto("PENDIENTE DE AUTORIZACIÓN", { bold: true });
  }

  ws.pageSetup = {
    orientation: "landscape",
    paperSize: 1 as PaperSize,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    printTitlesRow: `${filaEncabezadoTabla}:${filaEncabezadoTabla}`,
  };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// fechaExcel se conserva por paridad con Compras aunque esta primera versión formatea la fecha como texto en cabecera;
// se exporta por si un futuro ajuste agrega una columna de fecha por línea.
export { fechaExcel };
