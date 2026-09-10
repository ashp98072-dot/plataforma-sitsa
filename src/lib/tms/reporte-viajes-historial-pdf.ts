import PDFDocument from "pdfkit";
import type { FiltrosReporteViajes, KpiReporteViajes, PlanReporte } from "@/lib/tms/reportes-viajes";

export const REPORTE_VIAJES_PDF_CONFIG = { size: "LEGAL" as const, layout: "landscape" as const, margins: { top: 32, bottom: 38, left: 28, right: 28 } };
export const HEADERS_OPERATIVOS = ["Fecha", "Código", "Cliente", "Ruta", "Unidad / placa", "Piloto", "Auxiliares", "H. salida", "H. llegada", "Km salida", "Km llegada", "Km recorridos", "Evidencias", "Tarifa usada", "Tarifa", "Estado"];
export const HEADERS_FACTURACION = ["Estado facturación", "No. factura", "Monto fact.", "Estado cobro", "Total factura", "Cobrado factura", "Saldo factura"];

function moneda(valor: number | null): string {
  return valor == null ? "—" : `Q${valor.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fechaHora(valor: string | null): string { return valor ? valor.replace("T", " ") : "—"; }

export function filaOperativa(p: PlanReporte): string[] {
  return [p.fechaPlan, p.codigo, p.cliente ?? "—", p.rutaCodigo ?? p.lugarDescargaHistorico ?? "—", [p.unidadTipo, p.placa].filter(Boolean).join(" / ") || "—", p.piloto ?? "—", p.auxiliares.join(", ") || "—", fechaHora(p.horaSalida), fechaHora(p.horaLlegada), p.kmSalida != null ? String(p.kmSalida) : "—", p.kmLlegada != null ? String(p.kmLlegada) : "—", p.kmRecorridos != null ? String(p.kmRecorridos) : "—", String(p.evidencias), p.tarifaNombre ?? "—", moneda(p.tarifaComercial), p.estado];
}
export function filaFacturacion(p: PlanReporte): string[] {
  return [p.estadoFacturacion, p.numeroFactura ?? "—", moneda(p.montoFacturadoViaje ?? p.montoBorradorViaje), p.estadoFinancieroFactura ?? "—", moneda(p.totalFactura), moneda(p.totalPagadoFactura), moneda(p.saldoFactura)];
}

export function describirFiltros(f: FiltrosReporteViajes): string {
  const activos = [f.estado && `Estado: ${f.estado}`, f.clienteId && `Cliente ID: ${f.clienteId}`, f.pilotoId && `Piloto ID: ${f.pilotoId}`, f.unidadId && `Unidad ID: ${f.unidadId}`, f.ruta && `Ruta: ${f.ruta}`, f.estadoFacturacion && `Facturación: ${f.estadoFacturacion}`, f.estadoCobro && `Cobro: ${f.estadoCobro}`, f.soloPendientesCierre && "Solo pendientes de cierre", f.soloCerrados && "Solo cerrados", f.soloSinCerrar && "Solo sin cerrar"].filter(Boolean);
  return activos.length ? activos.join(" · ") : "Sin filtros adicionales";
}

type PdfDoc = InstanceType<typeof PDFDocument>;
type Campo = { label: string; valor: string; peso: number };

function altoFila(doc: PdfDoc, campos: Campo[], ancho: number): number {
  const total = campos.reduce((sum, c) => sum + c.peso, 0);
  return Math.max(34, ...campos.map((c) => {
    doc.font("Helvetica").fontSize(8.5);
    return 17 + doc.heightOfString(c.valor || "—", { width: (ancho * c.peso) / total - 12, lineGap: 1 });
  }));
}
function altoGrupo(doc: PdfDoc, filas: Campo[][], ancho: number): number {
  return 19 + filas.reduce((sum, fila) => sum + altoFila(doc, fila, ancho), 0);
}
function dibujarGrupo(doc: PdfDoc, titulo: string, filas: Campo[][], x: number, y: number, ancho: number): number {
  doc.save().rect(x, y, ancho, 19).fill("#1e3a5f").restore();
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff").text(titulo, x + 7, y + 5, { width: ancho - 14, lineBreak: false });
  y += 19;
  filas.forEach((campos, filaIndex) => {
    const alto = altoFila(doc, campos, ancho);
    if (filaIndex % 2 === 1) doc.save().rect(x, y, ancho, alto).fill("#f8fafc").restore();
    const total = campos.reduce((sum, c) => sum + c.peso, 0);
    let cx = x;
    campos.forEach((campo) => {
      const w = (ancho * campo.peso) / total;
      doc.font("Helvetica-Bold").fontSize(6.8).fillColor("#64748b").text(campo.label.toUpperCase(), cx + 6, y + 5, { width: w - 12, lineBreak: false });
      doc.font("Helvetica").fontSize(8.5).fillColor("#0f172a").text(campo.valor || "—", cx + 6, y + 16, { width: w - 12, lineGap: 1 });
      cx += w;
      doc.strokeColor("#cbd5e1").lineWidth(0.35).moveTo(cx, y).lineTo(cx, y + alto).stroke();
    });
    doc.strokeColor("#94a3b8").lineWidth(0.4).rect(x, y, ancho, alto).stroke();
    y += alto;
  });
  return y;
}

function filasOperativas(p: PlanReporte): Campo[][] {
  const v = filaOperativa(p);
  return [
    [{ label: HEADERS_OPERATIVOS[0], valor: v[0], peso: 12 }, { label: HEADERS_OPERATIVOS[1], valor: v[1], peso: 18 }, { label: HEADERS_OPERATIVOS[2], valor: v[2], peso: 30 }, { label: HEADERS_OPERATIVOS[3], valor: v[3], peso: 40 }],
    [{ label: HEADERS_OPERATIVOS[4], valor: v[4], peso: 20 }, { label: HEADERS_OPERATIVOS[5], valor: v[5], peso: 30 }, { label: HEADERS_OPERATIVOS[6], valor: v[6], peso: 50 }],
    [{ label: HEADERS_OPERATIVOS[7], valor: v[7], peso: 12 }, { label: HEADERS_OPERATIVOS[8], valor: v[8], peso: 12 }, { label: HEADERS_OPERATIVOS[9], valor: v[9], peso: 8 }, { label: HEADERS_OPERATIVOS[10], valor: v[10], peso: 8 }, { label: HEADERS_OPERATIVOS[11], valor: v[11], peso: 9 }, { label: HEADERS_OPERATIVOS[12], valor: v[12], peso: 8 }, { label: HEADERS_OPERATIVOS[13], valor: v[13], peso: 18 }, { label: HEADERS_OPERATIVOS[14], valor: v[14], peso: 13 }, { label: HEADERS_OPERATIVOS[15], valor: v[15], peso: 12 }],
  ];
}
function filasFinancieras(p: PlanReporte): Campo[][] {
  const v = filaFacturacion(p);
  return [[{ label: HEADERS_FACTURACION[0], valor: v[0], peso: 18 }, { label: HEADERS_FACTURACION[1], valor: v[1], peso: 14 }, { label: HEADERS_FACTURACION[2], valor: v[2], peso: 14 }, { label: HEADERS_FACTURACION[3], valor: v[3], peso: 15 }, { label: HEADERS_FACTURACION[4], valor: v[4], peso: 13 }, { label: HEADERS_FACTURACION[5], valor: v[5], peso: 13 }, { label: HEADERS_FACTURACION[6], valor: v[6], peso: 13 }]];
}

function piePaginas(doc: PdfDoc, total: number): void {
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i += 1) {
    doc.switchToPage(rango.start + i);
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(`Página ${i + 1} de ${rango.count} · ${total} viaje(s) · SITSA`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 10, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: "center", lineBreak: false });
  }
}

export async function reporteViajesHistorialPdf(opts: { empresaNombre: string; generadoEn: string; filtros: FiltrosReporteViajes; kpis: KpiReporteViajes; planes: PlanReporte[] }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...REPORTE_VIAJES_PDF_CONFIG, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const x = doc.page.margins.left;
    const ancho = doc.page.width - x - doc.page.margins.right;
    const limite = () => doc.page.height - doc.page.margins.bottom - 14;
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a").text("Reporte de viajes", { width: ancho });
    doc.font("Helvetica").fontSize(8.5).fillColor("#475569").text(`Empresa: ${opts.empresaNombre}`).text(`Rango: ${opts.filtros.fechaDesde ?? "Inicio"} a ${opts.filtros.fechaHasta ?? "Hoy"}`).text(`Generado: ${opts.generadoEn} (Guatemala)`).text(`Filtros aplicados: ${describirFiltros(opts.filtros)}`, { width: ancho });
    doc.moveDown(0.45);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a").text(`Viajes: ${opts.kpis.totalViajes}   Cerrados: ${opts.kpis.cerrados}   Pendientes de cierre: ${opts.kpis.pendientesCierre}   Cancelados: ${opts.kpis.cancelados}`, { width: ancho }).text(`Valor programado: ${moneda(opts.kpis.valorProgramado)}   Valor cerrado: ${moneda(opts.kpis.valorCerrado)}   Valor facturado: ${moneda(opts.kpis.valorFacturado)}   Cobrado: ${moneda(opts.kpis.cobrado)}`, { width: ancho });
    doc.moveDown(0.7);
    let y = doc.y;
    opts.planes.forEach((plan, index) => {
      const op = filasOperativas(plan);
      const fin = filasFinancieras(plan);
      const alto = 24 + altoGrupo(doc, op, ancho - 12) + 6 + altoGrupo(doc, fin, ancho - 12) + 14;
      if (y + alto > limite()) { doc.addPage(); y = doc.page.margins.top; }
      doc.strokeColor("#94a3b8").lineWidth(0.8).roundedRect(x, y, ancho, alto - 8, 4).stroke();
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text(`Viaje ${index + 1} de ${opts.planes.length} · ${plan.codigo}`, x + 8, y + 7, { width: ancho - 16 });
      y += 24;
      y = dibujarGrupo(doc, "Datos operativos", op, x + 6, y, ancho - 12) + 6;
      y = dibujarGrupo(doc, "Facturación / cobro", fin, x + 6, y, ancho - 12) + 14;
    });
    if (!opts.planes.length) doc.font("Helvetica").fontSize(10).fillColor("#64748b").text("Sin viajes para los filtros seleccionados.");
    piePaginas(doc, opts.planes.length);
    doc.end();
  });
}
