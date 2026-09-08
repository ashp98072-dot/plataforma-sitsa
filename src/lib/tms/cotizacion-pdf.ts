import PDFDocument from "pdfkit";
import { ahoraLocal, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { calcularIva, type Cotizacion } from "@/lib/tms/cotizaciones";

/**
 * COTIZADOR-TMS-1 — PDF comercial de una cotización, para enviar al
 * cliente. Reutiliza la MISMA identidad visual que el resto de PDFs de
 * TMS (reporteViajePdf/comprobanteAutorizacionesPdf): Helvetica,
 * paleta #0f172a/#475569/#334155/#94a3b8, mismo patrón sección/campo que
 * reporte-viaje-pdf.ts — nunca se copia el diseño exacto de un
 * PowerPoint externo, solo la identidad ya establecida del sistema.
 */

function moneda(v: number | null): string {
  if (v == null) return "—";
  return `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fechaLarga(fechaIso: string | null): string {
  if (!fechaIso) return "—";
  const [anio, mes, dia] = fechaIso.split("-").map(Number);
  if (!anio || !mes || !dia) return fechaIso;
  return new Intl.DateTimeFormat("es-GT", { day: "numeric", month: "long", year: "numeric" }).format(new Date(anio, mes - 1, dia));
}

export async function cotizacionPdf(empresaNombre: string, c: Cotizacion): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "portrait",
      margins: { top: 44, bottom: 44, left: 46, right: 46 },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (ch) => chunks.push(ch as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const marginL = doc.page.margins.left;
    const pageWidth = doc.page.width - marginL - doc.page.margins.right;

    // Encabezado — empresa + título del documento.
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a").text(empresaNombre, { width: pageWidth });
    doc.font("Helvetica").fontSize(9).fillColor("#475569").text("Cotización de servicio de transporte / logística", { width: pageWidth });
    doc.moveDown(0.6);
    doc.moveTo(marginL, doc.y).lineTo(marginL + pageWidth, doc.y).strokeColor("#cbd5e1").lineWidth(1).stroke();
    doc.moveDown(0.6);

    // No. de cotización + fecha, uno a cada lado.
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f172a").text(c.codigo, marginL, doc.y, { continued: false });
    doc.font("Helvetica").fontSize(9.5).fillColor("#475569")
      .text(`Fecha de emisión: ${fechaLarga(c.fechaEmision)}`, marginL, doc.y);
    doc.moveDown(0.5);

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
    const check = (etiqueta: string, incluido: boolean) => {
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(incluido ? "#0f172a" : "#94a3b8")
        .text(`${incluido ? "✓" : "—"} ${etiqueta}`, { width: pageWidth });
      doc.moveDown(0.15);
    };

    // A. Cliente
    seccion("Cliente");
    campo("Nombre", c.clienteNombre);

    // B. Ruta / servicio
    seccion("Ruta / servicio");
    campo("Origen", c.origenTexto ?? "—");
    campo("Destino", c.destinoTexto ?? "—");
    if (c.rutaCodigoHistorico) campo("Ruta de referencia", c.rutaCodigoHistorico);

    // C. Propuesta económica — tarifa + IVA claramente indicado.
    seccion("Propuesta económica");
    const desglose = calcularIva(c.tarifaCotizada, c.incluyeIva);
    campo("Moneda", c.moneda);
    campo("Subtotal", moneda(desglose.subtotal));
    campo("IVA (12%)", moneda(desglose.iva));
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a")
      .text(`Total cotizado: ${moneda(desglose.total)}${c.incluyeIva ? " (IVA incluido)" : " + IVA"}`, { width: pageWidth });
    doc.moveDown(0.4);

    // D. Condiciones del servicio.
    seccion("Condiciones del servicio");
    check("Piloto incluido", c.pilotoIncluido);
    check("GPS", c.gpsIncluido);
    check("Seguro de mercadería", c.seguroMercaderiaIncluido);
    check("Seguro contra terceros", c.seguroTercerosIncluido);
    doc.moveDown(0.15);
    if (c.kmIncluidos != null) campo("Kilómetros incluidos", `${c.kmIncluidos} km`);
    if (c.tarifaKmAdicional != null) campo("Tarifa por km adicional", moneda(c.tarifaKmAdicional));
    if (c.condicionesAdicionales) {
      doc.font("Helvetica").fontSize(9).fillColor("#334155").text(c.condicionesAdicionales, { width: pageWidth });
      doc.moveDown(0.3);
    }

    // E. Observaciones.
    if (c.observaciones) {
      seccion("Observaciones");
      doc.font("Helvetica").fontSize(9).fillColor("#334155").text(c.observaciones, { width: pageWidth });
    }

    // F. Vigencia — siempre visible, aunque no haya fecha capturada.
    seccion("Vigencia");
    campo("Válida hasta", c.fechaVencimiento ? fechaLarga(c.fechaVencimiento) : "No especificada");
    campo("Estado de la cotización", c.estado);

    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8")
      .text(`Documento generado el ${formatearTimestampVisible(ahoraLocal())} (Guatemala)`, marginL, doc.page.height - doc.page.margins.bottom + 6, {
        width: pageWidth,
        align: "center",
        lineBreak: false,
      });

    doc.end();
  });
}
