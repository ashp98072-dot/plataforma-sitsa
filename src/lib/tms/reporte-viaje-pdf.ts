import PDFDocument from "pdfkit";
import type { PlanReporte } from "@/lib/tms/reportes-viajes";
import { ahoraLocal, formatearTimestampVisible } from "@/lib/rrhh/dates";

function moneda(v: number | null): string {
  if (v == null) return "Pendiente";
  return `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fechaHora(v: string | null): string {
  return v ? v.replace("T", " ") : "—";
}

/**
 * TMS-REPORTES-1 (Fase K) — expediente individual del viaje en PDF.
 * Reutiliza el mismo estilo/paleta que boletaVacacionesPdf
 * (src/lib/rrhh/export-files.ts) — Helvetica, #0f172a/#475569/#cbd5e1 —
 * en vez de inventar una paleta nueva. NO incrusta fotos de evidencias
 * (harían el PDF pesado sin infraestructura de imágenes por lote) — solo
 * referencias (tipo, parada, fecha/hora), consistente con la instrucción
 * del ticket de preferir listado/referencias.
 */
export async function reporteViajePdf(
  empresaNombre: string,
  p: PlanReporte,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "portrait",
      margins: { top: 44, bottom: 44, left: 46, right: 46 },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const marginL = doc.page.margins.left;
    const pageWidth = doc.page.width - marginL - doc.page.margins.right;

    doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a").text(empresaNombre, { width: pageWidth });
    doc.font("Helvetica").fontSize(9).fillColor("#475569").text("Expediente de viaje — TMS / Logística", { width: pageWidth });
    doc.moveDown(0.6);
    doc.moveTo(marginL, doc.y).lineTo(marginL + pageWidth, doc.y).strokeColor("#cbd5e1").lineWidth(1).stroke();
    doc.moveDown(0.6);

    doc.font("Helvetica-Bold").fontSize(17).fillColor("#0f172a").text(p.codigo, { width: pageWidth });
    doc.moveDown(0.4);

    const seccion = (titulo: string) => {
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text(titulo, { width: pageWidth });
      doc.moveDown(0.2);
    };
    const campo = (label: string, valor: string) => {
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#334155").text(`${label}: `, { continued: true, width: pageWidth });
      doc.font("Helvetica").fillColor("#0f172a").text(valor || "—");
      doc.moveDown(0.28);
    };

    // A. Datos generales
    seccion("A. Datos generales");
    campo("Fecha", p.fechaPlan);
    campo("Cliente", p.cliente ?? "—");
    campo("Ruta", p.rutaCodigo ?? "—");
    campo("Referencia cliente", p.referenciaCliente ?? "—");
    campo("Tipo de traslado", p.tipoTraslado ?? "—");
    campo("Tarifa comercial (Ingreso estimado)", moneda(p.tarifaComercial));
    campo("Estado", p.estado);

    // B. Personal / unidad
    seccion("B. Personal / unidad");
    campo("Piloto", p.piloto ?? "—");
    campo("Auxiliares", p.auxiliares.length ? p.auxiliares.join(", ") : "—");
    campo("Unidad", p.placa ?? "—");
    campo("Equipo asignado", p.unidadTipo ? `${p.unidadTipo}${p.unidadCapacidad ? ` · ${p.unidadCapacidad}` : ""}` : "—");

    // C. Operación
    seccion("C. Operación");
    campo("Hora programada", p.horaCarga ?? "—");
    campo("Hora salida real", fechaHora(p.horaSalida));
    campo("Hora llegada real", fechaHora(p.horaLlegada));
    campo("Km salida", p.kmSalida != null ? String(p.kmSalida) : "—");
    campo("Km llegada", p.kmLlegada != null ? String(p.kmLlegada) : "—");
    campo("Km recorridos", p.kmRecorridos != null ? String(p.kmRecorridos) : "—");
    campo("Días de ruta", p.diasRuta != null ? String(p.diasRuta) : "—");
    campo("Regreso estimado", fechaHora(p.regresoEstimado));

    // D. Paradas
    seccion("D. Paradas");
    if (p.paradas.length) {
      for (const parada of p.paradas) {
        campo(
          `${parada.orden}. ${parada.lugar_nombre} (${parada.tipo})`,
          parada.requiere_evidencia
            ? `${parada.evidencias} evidencia(s) — evidencia es respaldo, no bloquea el cierre`
            : "No requiere evidencia",
        );
      }
    } else {
      doc.font("Helvetica").fontSize(9.5).fillColor("#64748b").text("Sin paradas registradas.");
      doc.moveDown(0.3);
    }

    // E. Evidencias (referencia — sin incrustar fotos)
    seccion("E. Evidencias");
    campo("Total registrado", `${p.evidencias} evidencia(s) — las evidencias son respaldo y no determinan el cierre.`);

    // F. Cierre
    seccion("F. Cierre");
    campo("Pendiente de cierre", p.pendienteCierre ? "Sí" : "No");
    campo("Cerrado por", p.cerradoPor ?? "—");
    campo("Cerrado en", fechaHora(p.cerradoEn));

    doc.moveDown(0.6);
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#94a3b8")
      // CORRECCIÓN PR #112 (HALLAZGO 2): hora de Guatemala explícita —
      // nunca el timezone implícito del proceso del servidor.
      .text(`Documento generado el ${formatearTimestampVisible(ahoraLocal())} (Guatemala)`, marginL, doc.page.height - doc.page.margins.bottom + 6, {
        width: pageWidth,
        align: "center",
        lineBreak: false,
      });

    doc.end();
  });
}
