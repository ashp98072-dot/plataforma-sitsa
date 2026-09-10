import PDFDocument from "pdfkit";
import { dibujarTablaEnDoc } from "@/lib/rrhh/export-files";
import type { FiltrosReporteViajes, KpiReporteViajes, PlanReporte } from "@/lib/tms/reportes-viajes";

export const REPORTE_VIAJES_PDF_CONFIG = {
  size: "LEGAL" as const,
  layout: "landscape" as const,
  margins: { top: 32, bottom: 38, left: 24, right: 24 },
};

export const HEADERS_OPERATIVOS = [
  "Fecha", "Código", "Cliente", "Ruta", "Unidad / placa", "Piloto", "Auxiliares",
  "H. salida", "H. llegada", "Km salida", "Km llegada", "Km recorridos",
  "Evidencias", "Tarifa usada", "Tarifa", "Estado",
];

export const HEADERS_FACTURACION = [
  "Código", "Estado factura", "No. factura", "Monto facturado", "Estado cobro",
  "Total factura", "Cobrado factura", "Saldo factura",
];

function moneda(valor: number | null): string {
  return valor == null
    ? "—"
    : `Q${valor.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fechaHora(valor: string | null): string {
  return valor ? valor.replace("T", " ") : "—";
}

export function filaOperativa(p: PlanReporte): string[] {
  return [
    p.fechaPlan,
    p.codigo,
    p.cliente ?? "—",
    p.rutaCodigo ?? p.lugarDescargaHistorico ?? "—",
    [p.unidadTipo, p.placa].filter(Boolean).join(" / ") || "—",
    p.piloto ?? "—",
    p.auxiliares.join(", ") || "—",
    fechaHora(p.horaSalida),
    fechaHora(p.horaLlegada),
    p.kmSalida != null ? String(p.kmSalida) : "—",
    p.kmLlegada != null ? String(p.kmLlegada) : "—",
    p.kmRecorridos != null ? String(p.kmRecorridos) : "—",
    String(p.evidencias),
    p.tarifaNombre ?? "—",
    moneda(p.tarifaComercial),
    p.estado,
  ];
}

export function filaFacturacion(p: PlanReporte): string[] {
  return [
    p.codigo,
    p.estadoFacturacion,
    p.numeroFactura ?? "—",
    moneda(p.montoFacturadoViaje ?? p.montoBorradorViaje),
    p.estadoFinancieroFactura ?? "—",
    moneda(p.totalFactura),
    moneda(p.totalPagadoFactura),
    moneda(p.saldoFactura),
  ];
}

export function describirFiltros(f: FiltrosReporteViajes): string {
  const activos = [
    f.estado && `Estado: ${f.estado}`,
    f.clienteId && `Cliente ID: ${f.clienteId}`,
    f.pilotoId && `Piloto ID: ${f.pilotoId}`,
    f.unidadId && `Unidad ID: ${f.unidadId}`,
    f.ruta && `Ruta: ${f.ruta}`,
    f.estadoFacturacion && `Facturación: ${f.estadoFacturacion}`,
    f.estadoCobro && `Cobro: ${f.estadoCobro}`,
    f.soloPendientesCierre && "Solo pendientes de cierre",
    f.soloCerrados && "Solo cerrados",
    f.soloSinCerrar && "Solo sin cerrar",
  ].filter(Boolean);
  return activos.length ? activos.join(" · ") : "Sin filtros adicionales";
}

type PdfDoc = InstanceType<typeof PDFDocument>;

function titulo(doc: PdfDoc, texto: string): void {
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text(texto);
  doc.moveDown(0.35);
}

function piePaginas(doc: PdfDoc, total: number): void {
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i += 1) {
    doc.switchToPage(rango.start + i);
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(
      `Página ${i + 1} de ${rango.count} · ${total} viaje(s) · SITSA`,
      doc.page.margins.left,
      doc.page.height - doc.page.margins.bottom - 10,
      { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: "center", lineBreak: false },
    );
  }
}

export async function reporteViajesHistorialPdf(opts: {
  empresaNombre: string;
  generadoEn: string;
  filtros: FiltrosReporteViajes;
  kpis: KpiReporteViajes;
  planes: PlanReporte[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...REPORTE_VIAJES_PDF_CONFIG, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a").text("Reporte de viajes", { width: ancho });
    doc.font("Helvetica").fontSize(8.5).fillColor("#475569")
      .text(`Empresa: ${opts.empresaNombre}`)
      .text(`Rango: ${opts.filtros.fechaDesde ?? "Inicio"} a ${opts.filtros.fechaHasta ?? "Hoy"}`)
      .text(`Generado: ${opts.generadoEn} (Guatemala)`)
      .text(`Filtros aplicados: ${describirFiltros(opts.filtros)}`, { width: ancho });
    doc.moveDown(0.45);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a").text(
      `Viajes: ${opts.kpis.totalViajes}   Cerrados: ${opts.kpis.cerrados}   Pendientes de cierre: ${opts.kpis.pendientesCierre}   Cancelados: ${opts.kpis.cancelados}`,
      { width: ancho },
    );
    doc.text(
      `Valor programado: ${moneda(opts.kpis.valorProgramado)}   Valor cerrado: ${moneda(opts.kpis.valorCerrado)}   Valor facturado: ${moneda(opts.kpis.valorFacturado)}   Cobrado: ${moneda(opts.kpis.cobrado)}`,
      { width: ancho },
    );
    doc.moveDown(0.7);

    titulo(doc, "1. Detalle operativo");
    dibujarTablaEnDoc(doc, {
      headers: HEADERS_OPERATIVOS,
      rows: opts.planes.map(filaOperativa),
      weight: { 0: 7, 1: 9, 2: 12, 3: 12, 4: 9, 5: 11, 6: 14, 7: 7, 8: 7, 9: 6, 10: 6, 11: 7, 12: 6, 13: 9, 14: 8, 15: 8 },
      preserveSingleLine: [0, 1, 7, 8, 9, 10, 11, 12, 14, 15],
      maxLines: 4,
      align: { 7: "center", 8: "center", 9: "right", 10: "right", 11: "right", 12: "center", 14: "right" },
    });

    doc.addPage();
    titulo(doc, "2. Facturación / cobro");
    dibujarTablaEnDoc(doc, {
      headers: HEADERS_FACTURACION,
      rows: opts.planes.map(filaFacturacion),
      weight: { 0: 12, 1: 13, 2: 12, 3: 12, 4: 12, 5: 11, 6: 11, 7: 11 },
      preserveSingleLine: [0, 1, 2, 3, 4, 5, 6, 7],
      align: { 3: "right", 5: "right", 6: "right", 7: "right" },
    });

    piePaginas(doc, opts.planes.length);
    doc.end();
  });
}
