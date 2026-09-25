import PDFDocument from "pdfkit";
import ExcelJS, { type PaperSize } from "exceljs";
import { decodificarPng, reforzarFirmaParaPdf } from "@/lib/firmas/reforzar-firma-pdf";
import { dibujarTablaEnDoc } from "@/lib/rrhh/export-files";
import { dibujarCodigoDocumentoPdf } from "@/lib/documentos-encabezado";
import { formatearFechaVisible, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { moneda } from "@/lib/tms/fondos-solicitud-pdf";
import type { DetalleCompra } from "./requerimiento-schema";
import type { FirmaCompraReporte, FirmasCompraReporte } from "./requerimiento-firma-reporte";

const visible = (s: string | null | undefined) => (s?.trim() || "Sin dato histórico").normalize("NFC");
// Transcripción del formato físico: el punto 2 termina en "sacar" en la referencia.
// No completar ni reinterpretar ese texto desde el generador.
export const RECORDATORIOS_COMPRA = [
  "1. RECORDAR QUE LAS FACTURAS DEBEN SALIR A NOMBRE Y NIT DE LA EMPRESA REQUIRENTE",
  "2. Este formulario impreso, también debe ser enviado en Excel a Tesorería y a Contabilidad quien llevara un acumulado de requerimientos durante el mes para poder sacar",
  "3. Realizada la compra, presentar la factura sellada con una fotocopia de este requerimiento al frente para saber a que requerimiento corresponden y evitar cruces.",
  "4. Si al realizar la compra hubiere algún sobrante de efectivo, depositar o transferir a la cuenta de la empresa requirente el sobrante y con eso se liquidara el anticipo realizado.",
  "5. Se recomienda el requerimiento de la semana siguiente, los Jueves o Viernes por la mañana, para dejar programados los pagos y transferir a primera hora.",
] as const;
export const FRASE_INSTITUCIONAL_COMPRA = "EL ORDEN Y LA DISCIPLINA SON LA BASE PARA UN SERVICIO DE CALIDAD, EFICIENCIA Y SATISFACCIÓN A NUESTRO CLIENTE";
export const COLUMNAS_EXCEL_COMPRA = [
  "No.", "Unidad / placa", "Fecha", "Serie / factura", "Proveedor", "Repuesto a comprar",
  "Método de pago", "Condición", "Total",
] as const;
const ANCHO_COLUMNAS_EXCEL_COMPRA = [6, 20, 12, 16, 26, 42, 18, 12, 14];
const COLUMNAS_TABLA_COMPRA = COLUMNAS_EXCEL_COMPRA.length;
const bordeFino = { style: "thin", color: { argb: "FF94A3B8" } } as const;
const bordeCelda = { top: bordeFino, bottom: bordeFino, left: bordeFino, right: bordeFino };

/** Solo datos persistidos: no JOIN de nombres, no recálculo del total. */
export function requerimientoCompraPdf(d: DetalleCompra, empresaNombre: string, firmas: FirmasCompraReporte | FirmaCompraReporte | null): Promise<Buffer> {
  const historicas = firmas && "autorizante" in firmas ? firmas : { requirente: null, encargado: null, autorizante: firmas };
  const firma = historicas.autorizante;
  const imagenes = [historicas.requirente?.imagen, historicas.encargado?.imagen, d.estado === "Autorizada" ? firma?.imagen : null];
  // Se conserva el contrato del caller/Excel; el título del PDF nunca usa el tenant.
  void empresaNombre;
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
    // Número del requerimiento (d.codigo, el persistido) arriba a la derecha, en la línea del título; la línea "Código: …" se conserva.
    dibujarCodigoDocumentoPdf(doc, d.codigo, { x, width, y: doc.y });
    doc.fontSize(12).text("REQUERIMIENTO DE REPUESTOS", { width, align: "center" });
    doc.moveDown(0.4);
    texto(`Código: ${d.codigo} · Fecha: ${formatearFechaVisible(d.fecha_requerimiento)} · Estado: ${d.estado}`);
    texto(`Persona que requiere: ${visible(d.requirente_nombre)} · Encargado de compras: ${visible(d.encargado_compras_nombre)}`);
    doc.moveDown(0.5);

    // Una tabla continua, con encabezados repetidos por el helper existente.
    dibujarTablaEnDoc(doc, {
      headers: ["No.", "Unidad / placa", "Fecha", "Serie / factura", "Proveedor", "Repuesto a comprar", "Método de pago", "Condición", "Total"],
      rows: d.lineas.map((l, i) => [String(i + 1), visible(l.unidad_descripcion), formatearFechaVisible(l.fecha), `${l.serie_factura || "—"} / ${l.numero_factura || "—"}`, visible(l.proveedor_nombre_snapshot), visible(l.repuesto_descripcion), visible(l.metodo_pago), l.condicion_pago, moneda(Number(l.total))]),
      weight: { 0: 24, 1: 80, 2: 60, 3: 85, 4: 110, 5: 160, 6: 85, 7: 58, 8: 66 }, align: { 8: "right" }, maxLines: 100,
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
    // Validar que la imagen histórica es dibujable antes del helper compartido,
    // que tolera imágenes inválidas en otros documentos.
    for (const imagen of imagenes) if (imagen) decodificarPng(imagen.buffer);
    const nombres = [visible(d.requirente_nombre), visible(d.encargado_compras_nombre), d.estado === "Autorizada" ? visible(d.autorizante_nombre || firma?.nombre) : d.estado === "Pendiente" ? "PENDIENTE DE AUTORIZACIÓN" : "RECHAZADA"];
    const etiquetas = ["FIRMA DE LA PERSONA QUE REQUIERE", "FIRMA DEL ENCARGADO DE COMPRAS", "FIRMA DEL AUTORIZANTE"];
    const anchoFirma = width / 3 - 16;
    doc.font("Helvetica-Bold").fontSize(8);
    const altoEtiqueta = Math.max(...etiquetas.map(s => doc.heightOfString(s, { width: anchoFirma })));
    doc.font("Helvetica").fontSize(8);
    const altoNombre = Math.max(...nombres.map(s => doc.heightOfString(s, { width: anchoFirma })));
    const altoFirmas = 55 + altoEtiqueta + altoNombre + 12;
    doc.font("Helvetica").fontSize(7);
    const altosRecordatorios = RECORDATORIOS_COMPRA.map(s => doc.heightOfString(s, { width: width - 12 }) + 8);
    doc.font("Helvetica-Bold").fontSize(7.5);
    const altoFrase = doc.heightOfString(FRASE_INSTITUCIONAL_COMPRA, { width, align: "center" });
    const altoBloqueInferior = 8 + altosRecordatorios.reduce((sum, h) => sum + h, 0) + 8 + altoFrase;
    // Reserva medida, no 285 puntos fijos; tres bloques horizontales al final.
    espacio(altoFirmas + altoBloqueInferior);
    const inicioFirma = doc.y;
    etiquetas.forEach((etiqueta, i) => {
      const columnaX = x + i * width / 3 + 8;
      const imagen = imagenes[i];
      if (imagen) doc.image(reforzarFirmaParaPdf(imagen.buffer), columnaX + (anchoFirma - 140) / 2, inicioFirma + 8, { fit: [140, 35] });
      doc.moveTo(columnaX, inicioFirma + 50).lineTo(columnaX + anchoFirma, inicioFirma + 50).strokeColor("#94a3b8").lineWidth(0.6).stroke();
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(8).text(etiqueta, columnaX, inicioFirma + 55, { width: anchoFirma, align: "center" });
      doc.font("Helvetica").text(nombres[i], columnaX, inicioFirma + 55 + altoEtiqueta, { width: anchoFirma, align: "center" });
    });
    doc.x = x; doc.y = inicioFirma + altoFirmas;
    const inicioRecordatorios = doc.y + 8;
    const altoRecordatorios = altosRecordatorios.reduce((sum, h) => sum + h, 0);
    doc.rect(x, inicioRecordatorios, width, altoRecordatorios).lineWidth(0.5).strokeColor("#64748b").stroke();
    let filaY = inicioRecordatorios;
    RECORDATORIOS_COMPRA.forEach((recordatorio, i) => {
      if (i) doc.moveTo(x, filaY).lineTo(x + width, filaY).stroke();
      doc.font("Helvetica").fontSize(7).fillColor("#0f172a").text(recordatorio, x + 6, filaY + 4, { width: width - 12 });
      filaY += altosRecordatorios[i];
    });
    doc.font("Helvetica-Bold").fontSize(7.5).text(FRASE_INSTITUCIONAL_COMPRA, x, filaY + 8, { width, align: "center" });
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
// ExcelJS: `row.border = x` fija el border como estilo POR DEFECTO de la
// fila (this.style.border), no solo de las celdas ya creadas — Excel lo
// renderiza como una cuadrícula que se extiende mucho más allá de las 9
// columnas reales de la tabla (columnas J en adelante, vacías, con borde).
// Por eso el borde SIEMPRE se aplica celda por celda, nunca vía row.border.
function bordeFila(row: ExcelJS.Row, columnas: number) {
  for (let c = 1; c <= columnas; c++) row.getCell(c).border = bordeCelda;
}

/**
 * Excel administrativo: mismo formato visual/estructural que el PDF
 * vigente (mismo encabezado, mismos datos generales, misma tabla,
 * mismos recordatorios y frase institucional) — pero SIN firmas. Nunca
 * consulta firmasHistoricasCompraReporte(): el endpoint ya solo la
 * carga cuando formato === "pdf" (ver requerimiento-exportaciones-api.ts),
 * esta función ni siquiera recibe ese dato. Solo datos persistidos: no
 * JOIN de nombres, no recálculo del total.
 */
export async function requerimientoCompraExcel(d: DetalleCompra, empresaNombre: string): Promise<Buffer> {
  // Mismo criterio que el PDF: el título SIEMPRE es la empresa
  // requirente del propio requerimiento (d.entidad_requirente_nombre),
  // nunca el tenant/guard — ambos pueden diferir legítimamente
  // (multiempresa). empresaNombre se conserva en la firma por
  // compatibilidad con el caller, pero no se usa como título visible.
  void empresaNombre;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Plataforma corporativa";
  // Excel limita nombres de hoja a 31 caracteres; códigos largos se conservan completos en cabecera.
  const ws = wb.addWorksheet(`Requerimiento ${d.codigo}`.replace(/[\\/*?:\[\]]/g, "-").slice(0, 31));
  ws.columns = ANCHO_COLUMNAS_EXCEL_COMPRA.map(width => ({ width }));

  const centrada = (valor: string, size: number) => {
    const row = ws.addRow([valor.normalize("NFC")]);
    ws.mergeCells(row.number, 1, row.number, COLUMNAS_TABLA_COMPRA);
    row.font = { name: "Arial", bold: true, size };
    row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    row.height = Math.max(22, size * 1.6);
    return row;
  };
  const texto = (valor: string, opts: { bold?: boolean } = {}) => {
    const row = ws.addRow([valor]);
    ws.mergeCells(row.number, 1, row.number, COLUMNAS_TABLA_COMPRA);
    row.font = { name: "Arial", size: 10, bold: Boolean(opts.bold) };
    row.alignment = { horizontal: "left", vertical: "top", wrapText: true };
    row.height = Math.max(18, Math.ceil(valor.length / 140) * 14);
    return row;
  };

  centrada(d.entidad_requirente_nombre?.trim() || "EMPRESA REQUIRENTE NO REGISTRADA", 16);
  // Título centrado y, en las últimas columnas de la MISMA fila, el número del requerimiento (d.codigo, el persistido).
  const filaTitulo = ws.addRow(["REQUERIMIENTO DE REPUESTOS".normalize("NFC")]);
  filaTitulo.getCell(COLUMNAS_TABLA_COMPRA - 2).value = d.codigo.normalize("NFC");
  ws.mergeCells(filaTitulo.number, 1, filaTitulo.number, COLUMNAS_TABLA_COMPRA - 3);
  ws.mergeCells(filaTitulo.number, COLUMNAS_TABLA_COMPRA - 2, filaTitulo.number, COLUMNAS_TABLA_COMPRA);
  filaTitulo.font = { name: "Arial", bold: true, size: 13 };
  filaTitulo.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  filaTitulo.getCell(COLUMNAS_TABLA_COMPRA - 2).font = { name: "Arial", bold: true, size: 12 };
  filaTitulo.getCell(COLUMNAS_TABLA_COMPRA - 2).alignment = { horizontal: "right", vertical: "middle" };
  filaTitulo.height = Math.max(22, 13 * 1.6);
  texto(`Código: ${d.codigo} · Fecha: ${formatearFechaVisible(d.fecha_requerimiento)} · Estado: ${d.estado}`);
  texto(`Persona que requiere: ${visible(d.requirente_nombre)} · Encargado de compras: ${visible(d.encargado_compras_nombre)}`);
  ws.addRow([]);

  // Tabla principal — mismas 9 columnas que el PDF (sección 15 del
  // ticket). Datos repetitivos por línea (empresa/requirente/
  // solicitante/encargado/fecha del requerimiento) quedan solo en el
  // encabezado, no en la tabla.
  const filaEncabezadoTabla = ws.rowCount + 1;
  const header = ws.getRow(filaEncabezadoTabla);
  header.values = [...COLUMNAS_EXCEL_COMPRA];
  header.height = 26;
  header.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  bordeFila(header, COLUMNAS_TABLA_COMPRA);

  d.lineas.forEach((l, i) => {
    const row = ws.addRow([
      i + 1,
      visible(l.unidad_descripcion),
      fechaExcel(l.fecha),
      `${l.serie_factura || "—"} / ${l.numero_factura || "—"}`,
      visible(l.proveedor_nombre_snapshot),
      visible(l.repuesto_descripcion),
      visible(l.metodo_pago),
      l.condicion_pago,
      Number(l.total),
    ]);
    row.font = { name: "Arial", size: 10 };
    row.alignment = { vertical: "top", wrapText: true };
    row.height = Math.max(20, Math.ceil(l.repuesto_descripcion.length / 30) * 13);
    bordeFila(row, COLUMNAS_TABLA_COMPRA);
    row.getCell(1).alignment = { horizontal: "center", vertical: "top" };
  });
  ws.getColumn(3).numFmt = "dd/mm/yyyy";
  ws.getColumn(9).numFmt = '"Q "#,##0.00';
  ws.getColumn(9).alignment = { horizontal: "right", vertical: "top" };
  ws.views = [{ state: "frozen", ySplit: filaEncabezadoTabla, showGridLines: false }];

  ws.addRow([]);
  // TOTAL: mismo dato persistido que el PDF (d.total), nunca recalculado
  // sumando líneas.
  const total = ws.addRow([]);
  ws.mergeCells(total.number, 1, total.number, COLUMNAS_TABLA_COMPRA - 1);
  total.getCell(1).value = "TOTAL:";
  total.getCell(1).alignment = { horizontal: "right" };
  total.getCell(COLUMNAS_TABLA_COMPRA).value = Number(d.total);
  total.getCell(COLUMNAS_TABLA_COMPRA).numFmt = '"Q "#,##0.00';
  total.getCell(COLUMNAS_TABLA_COMPRA).alignment = { horizontal: "right" };
  total.font = { name: "Arial", bold: true, size: 11 };
  total.height = 22;

  d.lineas.forEach((l, i) => { if (l.observaciones) texto(`Observaciones de línea ${i + 1}: ${l.observaciones}`); });
  if (d.observaciones) texto(`Observaciones del requerimiento: ${d.observaciones}`);

  // Mismo criterio que el PDF: Autorizada NO agrega ninguna fila aquí
  // (nunca metadata técnica de firma en este bloque).
  if (d.estado === "Rechazada") {
    texto("RECHAZADA", { bold: true });
    texto(`Fecha de rechazo: ${formatearTimestampVisible(d.rechazado_en)}`);
    texto(`Motivo: ${visible(d.motivo_rechazo)}`);
  } else if (d.estado === "Pendiente") {
    texto("PENDIENTE DE AUTORIZACIÓN", { bold: true });
  }

  ws.addRow([]);
  RECORDATORIOS_COMPRA.forEach((recordatorio) => {
    const row = ws.addRow([recordatorio]);
    ws.mergeCells(row.number, 1, row.number, COLUMNAS_TABLA_COMPRA);
    row.font = { name: "Arial", size: 8 };
    row.alignment = { horizontal: "left", vertical: "top", wrapText: true };
    row.height = Math.max(16, Math.ceil(recordatorio.length / 160) * 12);
    bordeFila(row, COLUMNAS_TABLA_COMPRA);
  });
  centrada(FRASE_INSTITUCIONAL_COMPRA, 10);

  ws.pageSetup = {
    orientation: "landscape",
    paperSize: 1 as PaperSize, // 1 = Letter (código OOXML estándar; no listado en el const enum de exceljs)
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    printTitlesRow: `${filaEncabezadoTabla}:${filaEncabezadoTabla}`,
  };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
