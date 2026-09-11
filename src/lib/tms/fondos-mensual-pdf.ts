import PDFDocument from "pdfkit";
import { ahoraLocal, formatearFechaVisible, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { dibujarTablaEnDoc } from "@/lib/rrhh/export-files";
import { tituloEmpresa } from "@/lib/tms/viaticos-comprobante-pdf";
import { dibujarFirmas, firmaHistorica, moneda, type FirmaSnapshot, type PdfDoc } from "@/lib/tms/fondos-solicitud-pdf";
import { etiquetaMes } from "@/lib/tms/reportes-mes";
import type { ResumenMensualFondos, SolicitudFondoAgrupada } from "@/lib/tms/reportes-gastos";

/**
 * REPORTES-MENSUALES-CONSOLIDADOS-1 — PDF MENSUAL CONSOLIDADO de
 * Solicitudes de fondo. NO reemplaza el PDF individual
 * (fondos-solicitud-pdf.ts, sin cambios de comportamiento): este documento
 * junta TODAS las solicitudes del período filtrado, cada una como un
 * BLOQUE INDEPENDIENTE:
 *
 *   SOLICITUD <código>
 *   Fecha / Empresa requirente / Persona que requiere / Estado
 *   Tabla de líneas de ESA solicitud
 *   TOTAL SOLICITUD: Q x
 *   FIRMA DEL REQUIRIENTE / SOLICITANTE / AUTORIZANTE
 *
 * y al final un RESUMEN DEL MES.
 *
 * Reutiliza tal cual:
 *  - `firmaHistorica` (fondos-solicitud-pdf.ts) — MISMO criterio de firmas
 *    que el PDF individual: solo snapshots inmutables de
 *    firmas_electronicas (SOLICITAR_FONDO / REQUERIR_FONDO /
 *    AUTORIZAR_FONDO). NUNCA se consulta usuario_firmas. Si falta el
 *    snapshot: se muestra el nombre y el espacio de firma queda vacío.
 *  - `dibujarFirmas` (fondos-solicitud-pdf.ts) — el mismo bloque de 3
 *    firmas.
 *  - `dibujarTablaEnDoc` (export-files.ts) — la misma tabla (repite
 *    encabezado por página, nunca deja páginas vacías).
 *
 * Cada solicitud arranca en página nueva: así queda visualmente separada
 * de la siguiente y sus firmas no se parten entre páginas.
 */

// Mismas 10 columnas / anchos / reglas que el PDF individual
// (FONDOS-PDF-LANDSCAPE-ANCHOS-1). FONDOS-GASTOS-METODO-PAGO-1 —
// "Cuenta / Número" fijo, mismo criterio que fondos-solicitud-pdf.ts:
// cada bloque de solicitud puede tener líneas con distintos métodos.
const HEADERS_LINEAS = ["Fecha de solicitud", "Fecha de viaje", "Nombre", "Cuenta / Número", "Cargo", "Placa", "Cliente", "Cantidad", "Descripción", "Valor"];
const WEIGHTS_LINEAS = { 0: 76, 1: 62, 2: 95, 3: 80, 4: 78, 5: 48, 6: 92, 7: 44, 8: 92, 9: 61 };

type FirmasSolicitud = {
  requirente: FirmaSnapshot | null;
  solicitante: FirmaSnapshot | null;
  autorizante: FirmaSnapshot | null;
};

async function firmasDeSolicitud(empresaId: number, solicitudId: number): Promise<FirmasSolicitud> {
  const [requirente, solicitante, autorizante] = await Promise.all([
    firmaHistorica(empresaId, solicitudId, "REQUERIR_FONDO"),
    firmaHistorica(empresaId, solicitudId, "SOLICITAR_FONDO"),
    firmaHistorica(empresaId, solicitudId, "AUTORIZAR_FONDO"),
  ]);
  return { requirente, solicitante, autorizante };
}

function dibujarBloqueSolicitud(
  doc: PdfDoc,
  g: SolicitudFondoAgrupada,
  empresaNombre: string,
  firmas: FirmasSolicitud,
  pageWidth: number,
  marginL: number,
  pageBottom: () => number,
): void {
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a")
    .text(`SOLICITUD ${g.solicitudCodigo}`, { width: pageWidth });
  doc.moveDown(0.35);
  doc.font("Helvetica").fontSize(9.5).fillColor("#0f172a");
  doc.text(`Fecha: ${formatearFechaVisible(g.fechaSolicitud)}`, { width: pageWidth });
  doc.text(`Empresa requirente: ${tituloEmpresa(empresaNombre).toUpperCase()}`, { width: pageWidth });
  doc.text(`Persona que requiere: ${(g.requirenteNombre ?? "—").toUpperCase()}`, { width: pageWidth });
  doc.text(`Estado: ${g.estadoFondo}`, { width: pageWidth });
  doc.moveDown(0.55);

  const fechaSolicitudVisible = formatearFechaVisible(g.fechaSolicitud);
  const rows = g.lineas.map((l) => [
    fechaSolicitudVisible,
    l.fechaViaje ? formatearFechaVisible(l.fechaViaje) : "—",
    l.empleadoNombre ?? "—",
    l.cuenta ?? "—",
    l.cargo ?? "—",
    l.placa ?? "—",
    l.clienteNombre ?? "—",
    String(l.cantidad),
    l.descripcion ?? "—",
    moneda(l.cantidad * l.monto),
  ]);
  dibujarTablaEnDoc(doc, {
    headers: HEADERS_LINEAS,
    rows,
    align: { 7: "center", 9: "right" },
    weight: WEIGHTS_LINEAS,
    preserveSingleLine: [0, 1, 5, 7, 9],
    maxLines: 8,
  });

  if (doc.y + 22 > pageBottom()) doc.addPage();
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a")
    .text(`TOTAL SOLICITUD: ${moneda(g.totalSolicitud)}`, { width: pageWidth, align: "right" });

  // FONDOS-AUTORIZAR-PERMISO-1 — el bloque FIRMA DEL AUTORIZANTE SOLO usa
  // al usuario que realizó una autorización VÁLIDA: si la solicitud no
  // está Autorizada/Liquidada, no hay autorizante (nombre ni firma).
  // autorizante_nombre / firmas_electronicas(AUTORIZAR_FONDO) ya solo se
  // escriben al autorizar; este gate es una segunda defensa explícita.
  const autorizada = g.estadoFondo === "Autorizada" || g.estadoFondo === "Liquidada";
  dibujarFirmas(doc, pageWidth, marginL, pageBottom, {
    requirente: firmas.requirente?.nombre ?? g.requirenteNombre ?? null,
    solicitante: firmas.solicitante?.nombre ?? g.solicitanteNombre ?? null,
    autorizante: autorizada ? (firmas.autorizante?.nombre ?? g.autorizanteNombre ?? null) : null,
    imagenRequirente: firmas.requirente?.imagen ?? null,
    imagenSolicitante: firmas.solicitante?.imagen ?? null,
    imagenAutorizante: autorizada ? (firmas.autorizante?.imagen ?? null) : null,
  });
}

function dibujarResumenMes(
  doc: PdfDoc,
  resumen: ResumenMensualFondos,
  pageWidth: number,
): void {
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text("RESUMEN DEL MES", { width: pageWidth });
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
  const filas: [string, string][] = [
    ["Total solicitudes", String(resumen.totalSolicitudes)],
    ["Total autorizadas", String(resumen.autorizadas)],
    ["Total liquidadas", String(resumen.liquidadas)],
    ["Total rechazadas", String(resumen.rechazadas)],
    ["Total pendientes", String(resumen.pendientes)],
  ];
  for (const [k, v] of filas) doc.text(`${k}: ${v}`, { width: pageWidth });
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(12)
    .text(`TOTAL GENERAL DEL MES: ${moneda(resumen.totalGeneral)}`, { width: pageWidth });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(8).fillColor("#334155")
    .text("Estados sumados en el TOTAL GENERAL: Autorizada + Liquidada. Se excluyen Rechazada y Pendiente. Cada solicitud se cuenta una sola vez.", { width: pageWidth });
}

export async function generarPdfMensualSolicitudesFondo(
  empresaId: number,
  empresaNombre: string,
  grupos: SolicitudFondoAgrupada[],
  resumen: ResumenMensualFondos,
  periodo: { anio: number; mes: number },
): Promise<Buffer> {
  const firmasPorSolicitud = new Map<number, FirmasSolicitud>();
  await Promise.all(
    grupos.map(async (g) => {
      firmasPorSolicitud.set(g.solicitudId, await firmasDeSolicitud(empresaId, g.solicitudId));
    }),
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "landscape",
      margins: { top: 40, bottom: 44, left: 32, right: 32 },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const marginL = doc.page.margins.left;
    const pageWidth = doc.page.width - marginL - doc.page.margins.right;
    const pageBottom = () => doc.page.height - doc.page.margins.bottom - 12;
    const etiqueta = etiquetaMes(periodo.anio, periodo.mes);

    doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a")
      .text("SOLICITUDES DE FONDO — REPORTE MENSUAL CONSOLIDADO", { width: pageWidth, align: "center" });
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a")
      .text(`${tituloEmpresa(empresaNombre).toUpperCase()} · Período: ${etiqueta}`, { width: pageWidth, align: "center" });
    doc.moveDown(0.7);

    grupos.forEach((g, i) => {
      if (i > 0) doc.addPage();
      dibujarBloqueSolicitud(doc, g, empresaNombre, firmasPorSolicitud.get(g.solicitudId) ?? { requirente: null, solicitante: null, autorizante: null }, pageWidth, marginL, pageBottom);
    });

    if (grupos.length > 0) doc.addPage();
    dibujarResumenMes(doc, resumen, pageWidth);

    // Pie: Página X de Y + período del reporte.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8").text(
        `Página ${i + 1} de ${range.count} · Período: ${etiqueta} · Generado el ${formatearTimestampVisible(ahoraLocal())} (Guatemala)`,
        marginL, doc.page.height - doc.page.margins.bottom - 12,
        { width: pageWidth, align: "center", lineBreak: false },
      );
    }

    doc.end();
  });
}
