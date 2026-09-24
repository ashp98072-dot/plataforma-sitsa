import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { getUploadsRoot, validarRutaArchivoEmpresa } from "@/lib/uploads";
import { esPngValido, MAX_FIRMA_IMAGEN_BYTES } from "@/lib/firmas/imagen-firma";
import { ACCION_FIRMA_AUTORIZANTE, ACCION_FIRMA_REQUIRENTE, type RequerimientoViatico } from "./viaticos-requerimientos-schema";
import { etiquetaPeriodoRequerimiento, fechaDMA } from "./viaticos-requerimientos-periodo";

/**
 * REQUERIMIENTO DE VIÁTICOS (formato administrativo) — PDF y Excel salen SOLO del requerimiento persistido
 * (cabecera + líneas con sus snapshots: periodo, cuenta, banco, empleado, cargo, placa, cliente, destino, monto).
 * Nunca se consulta el catálogo vivo ni se recalcula el periodo desde filtros de pantalla.
 */
const txt = (v: unknown) => String(v ?? "—").normalize("NFC");
const vacio = (v: unknown) => (v == null || String(v).trim() === "" ? "—" : txt(v));
const money = (v: unknown) => `Q ${Number(v || 0).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Fecha y hora (DD/MM/YYYY HH:mm) del instante de autorización; sin dato → "—". */
export function fechaHoraDMA(v: unknown): string {
  if (v == null || v === "") return "—";
  if (v instanceof Date) {
    const p = new Intl.DateTimeFormat("es-GT", { timeZone: "America/Guatemala", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(v);
    const g = (t: string) => p.find(x => x.type === t)?.value ?? "";
    return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
  }
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : s;
}

/** Encabezados del formato de referencia (PDF). Excel agrega "Banco". */
export const ENCABEZADOS_REQUERIMIENTO_PDF = ["No.", "Fecha solicitud", "Fecha viaje", "Nombre", "No. cuenta", "Cargo", "Placa", "Cliente", "Cantidad", "Lugar de descarga / destino", "Total"] as const;
export const ENCABEZADOS_REQUERIMIENTO_EXCEL = ["No.", "Fecha solicitud", "Fecha viaje", "Nombre", "No. cuenta", "Banco", "Cargo", "Placa", "Cliente", "Cantidad", "Lugar de descarga / destino", "Total"] as const;

/** Contenido lógico ÚNICO de una línea (lo consumen PDF y Excel; nada se recalcula). */
export function filasRequerimiento(d: RequerimientoViatico) {
  return (d.lineas || []).map((l, i) => ({
    no: i + 1,
    fechaSolicitud: fechaDMA(l.fecha_solicitud),
    fechaViaje: fechaDMA(l.fecha_viaje),
    nombre: vacio(l.personal_nombre_snapshot),
    cuenta: vacio(l.cuenta_snapshot),
    banco: vacio(l.banco_snapshot),
    cargo: vacio(l.cargo_snapshot),
    placa: vacio(l.placa_snapshot),
    cliente: vacio(l.cliente_nombre_snapshot),
    cantidad: Number(l.cantidad),
    destino: vacio(l.destino),
    total: Number(l.total),
  }));
}

/** Datos de cabecera (mismo texto en PDF y Excel). */
export function cabeceraRequerimiento(d: RequerimientoViatico) {
  return {
    titulo: "REQUERIMIENTO DE VIÁTICOS",
    codigo: txt(d.codigo),
    fecha: fechaDMA(d.fecha_requerimiento),
    empresa: vacio(d.empresa_requirente_nombre),
    requirente: vacio(d.requirente_nombre_snapshot),
    solicitante: vacio(d.solicitante_nombre_snapshot),
    periodo: etiquetaPeriodoRequerimiento(d.periodo_tipo, d.periodo_desde, d.periodo_hasta),
    estado: vacio(d.estado),
  };
}

async function firmaHistorica(empresaId: number, id: number, accion: string): Promise<Buffer | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT imagen_ruta FROM firmas_electronicas WHERE empresa_id=? AND modulo='TMS' AND entidad_tipo='REQUERIMIENTO_VIATICO' AND entidad_id=? AND accion=? ORDER BY id DESC LIMIT 1`,
    [empresaId, id, accion],
  );
  try {
    const abs = validarRutaArchivoEmpresa(empresaId, rows[0]?.imagen_ruta);
    if (!abs) return null;
    const [root, file] = await Promise.all([realpath(resolve(getUploadsRoot(), "empresas", String(empresaId))), realpath(abs)]);
    if (!file.startsWith(root + sep)) return null;
    const b = await readFile(file);
    return b.length <= MAX_FIRMA_IMAGEN_BYTES && esPngValido(b) ? b : null;
  } catch {
    return null;
  }
}
/** Firma (imagen) de quien AUTORIZÓ el requerimiento — snapshot inmutable en firmas_electronicas. */
export const firmaHistoricaRequerimientoViatico = (empresaId: number, id: number) => firmaHistorica(empresaId, id, ACCION_FIRMA_AUTORIZANTE);
/** Firma (imagen) del REQUIRENTE — solo existe si el requirente era el usuario de sesión al emitir. */
export const firmaRequirenteRequerimientoViatico = (empresaId: number, id: number) => firmaHistorica(empresaId, id, ACCION_FIRMA_REQUIRENTE);

// ----------------------------------------------------------------------------------------------- PDF
const LEFT = 32;
const WIDTHS = [24, 48, 48, 92, 70, 52, 46, 70, 36, 187, 55]; // suma 728 = ancho útil Letter horizontal
const ROW_H = 26;
const HEADER_H = 22;
const BOTTOM = 44; // margen inferior para filas (el folio va debajo)
const FOOTER_H = 150; // total + observaciones + firmas: se reserva SOLO para la última línea → nunca una página solo de firmas

export function requerimientoViaticoPdf(d: RequerimientoViatico, firmaAutorizante: Buffer | null = null, firmaRequirente: Buffer | null = null): Promise<Buffer> {
  return new Promise((resolvePdf, reject) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margins: { top: 30, bottom: 35, left: LEFT, right: 32 }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(c as Buffer));
    doc.on("end", () => resolvePdf(Buffer.concat(chunks)));
    doc.on("error", reject);
    const width = doc.page.width - 64;
    const cab = cabeceraRequerimiento(d);
    const filas = filasRequerimiento(d);

    doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(cab.titulo, { align: "center", width });
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(9);
    const campo = (rot: string, val: string, x: number, y: number, w: number) => {
      doc.font("Helvetica-Bold").text(`${rot}: `, x, y, { continued: true, width: w, lineBreak: false });
      doc.font("Helvetica").text(val, { width: w, lineBreak: false });
    };
    const y0 = doc.y;
    campo("Fecha del requerimiento", cab.fecha, LEFT, y0, 230);
    campo("Empresa requirente", cab.empresa, LEFT + 240, y0, 250);
    campo("Estado", cab.estado, LEFT + 500, y0, 228);
    campo("Persona que requiere", cab.requirente, LEFT, y0 + 13, 230);
    campo("Solicitante", cab.solicitante, LEFT + 240, y0 + 13, 250);
    campo("Código", cab.codigo, LEFT + 500, y0 + 13, 228);
    campo("Periodo", cab.periodo, LEFT, y0 + 26, 728);
    let y = y0 + 44;

    const encabezado = () => {
      let x = LEFT;
      doc.font("Helvetica-Bold").fontSize(7);
      for (let i = 0; i < ENCABEZADOS_REQUERIMIENTO_PDF.length; i++) {
        doc.rect(x, y, WIDTHS[i], HEADER_H).fillAndStroke("#1f4e78", "#64748b");
        doc.fillColor("white").text(ENCABEZADOS_REQUERIMIENTO_PDF[i], x + 3, y + 4, { width: WIDTHS[i] - 6, align: i === 8 || i === 10 ? "right" : "left" });
        x += WIDTHS[i];
      }
      y += HEADER_H;
    };
    encabezado();

    filas.forEach((f, idx) => {
      const ultima = idx === filas.length - 1;
      const limite = doc.page.height - BOTTOM - (ultima ? FOOTER_H : 0);
      if (y + ROW_H > limite) {
        doc.addPage();
        y = 32;
        encabezado(); // los encabezados de la tabla se repiten en cada página
      }
      const vals = [f.no, f.fechaSolicitud, f.fechaViaje, f.nombre, f.cuenta, f.cargo, f.placa, f.cliente, f.cantidad, f.destino, money(f.total)];
      let x = LEFT;
      doc.font("Helvetica").fontSize(7).fillColor("#0f172a");
      for (let j = 0; j < vals.length; j++) {
        doc.rect(x, y, WIDTHS[j], ROW_H).stroke("#94a3b8");
        doc.text(txt(vals[j]), x + 3, y + 5, { width: WIDTHS[j] - 6, height: 18, ellipsis: true, align: j === 8 || j === 10 ? "right" : "left" });
        x += WIDTHS[j];
      }
      y += ROW_H;
    });

    // Total general, observaciones y firmas: SOLO al final (última página).
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text(`TOTAL: ${money(d.total)}`, LEFT, y + 8, { width, align: "right" });
    if (d.observaciones) doc.font("Helvetica").fontSize(8).text(`Observaciones: ${txt(d.observaciones)}`, LEFT, doc.y + 2, { width, height: 24, ellipsis: true });
    const fy = doc.page.height - 90;
    const fw = 230;
    const bloques: [string, string, Buffer | null, string | null][] = [
      ["FIRMA DE LA PERSONA QUE REQUIERE", cab.requirente, firmaRequirente, null], // sin imagen: espacio en blanco para firma física
      ["AUTORIZADO POR", vacio(d.autorizado_por_nombre), firmaAutorizante, d.autorizado_en ? `Fecha y hora: ${fechaHoraDMA(d.autorizado_en)}` : null],
    ];
    bloques.forEach(([rotulo, nombre, imagen, extra], i) => {
      const x = 90 + i * 400;
      if (imagen) doc.image(imagen, x + 45, fy - 42, { fit: [140, 38] });
      doc.moveTo(x, fy).lineTo(x + fw, fy).stroke();
      doc.font("Helvetica-Bold").fontSize(8).text(rotulo, x, fy + 6, { width: fw, align: "center", lineBreak: false });
      doc.font("Helvetica").text(nombre, x, fy + 18, { width: fw, align: "center", lineBreak: false });
      if (extra) doc.text(extra, x, fy + 29, { width: fw, align: "center", lineBreak: false });
    });

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(`Página ${i + 1} de ${range.count} · ${txt(d.codigo)}`, LEFT, doc.page.height - 24, { width, align: "center", lineBreak: false });
    }
    doc.end();
  });
}

// --------------------------------------------------------------------------------------------- Excel
const FORMATO_GTQ = '"Q "#,##0.00';
export async function requerimientoViaticoExcel(d: RequerimientoViatico): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Requerimiento de viáticos");
  const NCOL = ENCABEZADOS_REQUERIMIENTO_EXCEL.length; // 12
  ws.columns = [6, 14, 14, 26, 20, 18, 16, 12, 24, 10, 36, 14].map(width => ({ width }));
  const cab = cabeceraRequerimiento(d);

  const titulo = ws.addRow([cab.titulo]);
  ws.mergeCells(titulo.number, 1, titulo.number, NCOL);
  titulo.font = { bold: true, size: 14 };
  titulo.alignment = { horizontal: "center" };
  const meta: [string, string][] = [
    ["Fecha del requerimiento", cab.fecha],
    ["Empresa requirente", cab.empresa],
    ["Persona que requiere", cab.requirente],
    ["Solicitante", cab.solicitante],
    ["Periodo", cab.periodo],
    ["Estado", cab.estado],
  ];
  for (const [rot, val] of meta) {
    const r = ws.addRow([rot, null, null, val]);
    ws.mergeCells(r.number, 1, r.number, 3);
    ws.mergeCells(r.number, 4, r.number, 8);
    r.getCell(1).font = { bold: true };
  }
  ws.addRow([]);

  const h = ws.addRow([...ENCABEZADOS_REQUERIMIENTO_EXCEL]);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  h.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  for (const f of filasRequerimiento(d)) {
    const r = ws.addRow([f.no, f.fechaSolicitud, f.fechaViaje, f.nombre, f.cuenta, f.banco, f.cargo, f.placa, f.cliente, f.cantidad, f.destino, f.total]);
    r.getCell(5).numFmt = "@"; // el No. de cuenta es texto: no se convierte a número ni se pierden ceros
  }
  ws.getColumn(12).numFmt = FORMATO_GTQ;
  const total = ws.addRow([null, null, null, null, null, null, null, null, null, null, "TOTAL GENERAL", Number(d.total)]);
  total.font = { bold: true };
  total.getCell(11).alignment = { horizontal: "right" };
  total.getCell(12).numFmt = FORMATO_GTQ;
  ws.autoFilter = { from: { row: h.number, column: 1 }, to: { row: h.number, column: NCOL } };
  ws.views = [{ state: "frozen", ySplit: h.number }];
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
