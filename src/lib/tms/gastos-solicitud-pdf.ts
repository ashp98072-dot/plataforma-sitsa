import PDFDocument from "pdfkit";
import { ahoraLocal, formatearFechaVisible, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { dibujarTablaEnDoc } from "@/lib/rrhh/export-files";
import { codigoGasto } from "@/lib/tms/gastos";
import { dibujarObservacionesPorRegistroPdf, observacionesVisibles, type ObservacionRegistro } from "@/lib/tms/observaciones-export";
import type { FilaGastoDetalle } from "@/lib/tms/reportes-gastos";

export const HEADERS_PDF_GASTOS = [
  "Fecha de solicitud", "Fecha de viaje", "Nombre", "Cuenta / Número", "Cargo",
  "Placa", "Cliente", "Cantidad", "Descripción", "Valor",
];

export const WEIGHT_PDF_GASTOS = { 0: 76, 1: 62, 2: 95, 3: 80, 4: 78, 5: 48, 6: 92, 7: 44, 8: 92, 9: 61 };

function moneda(valor: number): string {
  return `Q ${valor.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function filaPdf(fila: FilaGastoDetalle): string[] {
  return [
    formatearFechaVisible(fila.fechaSolicitud) || "—",
    fila.fechaViaje ? formatearFechaVisible(fila.fechaViaje) : "—",
    fila.empleadoNombre ?? "—",
    fila.numeroCuentaPago ?? "—",
    fila.cargo ?? "—",
    fila.placa ?? "—",
    fila.clienteNombre ?? "—",
    String(fila.cantidad),
    fila.descripcion ?? "—",
    moneda(fila.total),
  ];
}

/**
 * Una entrada por GASTO con observaciones (un gasto con varias líneas repite el mismo texto en cada fila: se lista una vez).
 * El código sale del id con la misma regla que el código persistido (GASTO-######).
 */
function observacionesDeGastos(filas: FilaGastoDetalle[]): ObservacionRegistro[] {
  const vistos = new Set<number>();
  const registros: ObservacionRegistro[] = [];
  for (const fila of filas) {
    if (vistos.has(fila.id)) continue;
    vistos.add(fila.id);
    const texto = observacionesVisibles(fila.observaciones);
    if (!texto) continue;
    registros.push({
      etiqueta: `${codigoGasto(fila.id)} · ${formatearFechaVisible(fila.fechaSolicitud) || "—"} · ${fila.empleadoNombre ?? "—"}`,
      texto,
    });
  }
  return registros;
}

export function generarPdfSolicitudGastos(opts: {
  empresaNombre: string;
  fechaDesde?: string;
  fechaHasta?: string;
  filas: FilaGastoDetalle[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "landscape",
      margins: { top: 40, bottom: 44, left: 32, right: 32 },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const marginL = doc.page.margins.left;
    const pageWidth = doc.page.width - marginL - doc.page.margins.right;
    const periodo = `${opts.fechaDesde ? formatearFechaVisible(opts.fechaDesde) : "Inicio"} a ${opts.fechaHasta ? formatearFechaVisible(opts.fechaHasta) : "Hoy"}`;

    doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a")
      .text("SOLICITUD DE GASTOS", { width: pageWidth, align: "center" });
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(9.5).fillColor("#0f172a");
    doc.text(`PERÍODO: ${periodo}`, { width: pageWidth });
    doc.text(`EMPRESA REQUIRIENTE: ${opts.empresaNombre.toUpperCase()}`, { width: pageWidth });
    doc.text(`FECHA DE GENERACIÓN: ${formatearTimestampVisible(ahoraLocal())} (Guatemala)`, { width: pageWidth });
    doc.text(`REGISTROS: ${opts.filas.length}`, { width: pageWidth });
    doc.moveDown(0.6);

    dibujarTablaEnDoc(doc, {
      headers: HEADERS_PDF_GASTOS,
      rows: opts.filas.map(filaPdf),
      align: { 7: "center", 9: "right" },
      weight: WEIGHT_PDF_GASTOS,
      preserveSingleLine: [0, 1, 5, 7, 9],
      maxLines: 8,
    });

    const total = opts.filas.reduce((suma, fila) => suma + fila.total, 0);
    const pageBottom = () => doc.page.height - doc.page.margins.bottom - 12;
    if (doc.y + 22 > pageBottom()) doc.addPage();
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a")
      .text(`TOTAL: ${moneda(total)}`, { width: pageWidth, align: "right" });

    // Observaciones por gasto (el mismo campo de BD que ya exporta el Excel); sin texto, no se dibuja nada.
    dibujarObservacionesPorRegistroPdf(doc, observacionesDeGastos(opts.filas), pageWidth, marginL, pageBottom);

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8").text(
        `Página ${i + 1} de ${range.count} · Documento generado el ${formatearTimestampVisible(ahoraLocal())} (Guatemala)`,
        marginL,
        doc.page.height - doc.page.margins.bottom - 12,
        { width: pageWidth, align: "center", lineBreak: false },
      );
    }

    doc.end();
  });
}
