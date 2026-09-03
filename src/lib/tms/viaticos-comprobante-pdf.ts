import { existsSync, readFileSync } from "fs";
import PDFDocument from "pdfkit";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { absPathFromRelative } from "@/lib/uploads";
import { ahoraLocal, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { listarViaticosControl } from "@/lib/tms/viaticos";
import { listarFirmasViatico } from "@/lib/firmas/firmas-lectura";

/**
 * VIATICOS-COMPROBANTE-PDF — comprobante en PDF, en lote, de todos los
 * viáticos actualmente AUTORIZADOS de una empresa: uno por cada
 * autorización, con los datos del viaje/empleado/monto y la firma
 * electrónica interna de quien autorizó (nombre/rol al momento de
 * firmar, código de firma, hash verificable, e imagen manuscrita si
 * existe). Mismo estilo/paleta que reporte-viaje-pdf.ts (Helvetica,
 * #0f172a/#475569/#cbd5e1) — no se inventa una paleta nueva.
 *
 * Reutiliza TAL CUAL:
 * - listarViaticosControl() — misma consulta que ya usa el Control de
 *   Viáticos (VIAT-3), filtrada a estado AUTORIZADO — no es una segunda
 *   fuente de verdad del listado.
 * - listarFirmasViatico() — mismo historial de firmas que ya expone el
 *   modal "Ver firmas" (VIATICOS-HISTORIAL-FIRMA-1).
 *
 * Lo único nuevo aquí es la lectura del BINARIO de la imagen de firma
 * (listarFirmasViatico() deliberadamente nunca expone imagen_ruta — ver
 * su JSDoc) — se resuelve con una consulta propia, acotada a
 * `modulo='VIATICOS' AND entidad_tipo='VIATICO'` y a la MISMA empresa,
 * igual criterio de aislamiento que ya usa
 * .../viaticos/firmas/[firmaId]/imagen/route.ts (no se reutiliza ese
 * archivo directamente porque sirve una respuesta HTTP, no un buffer).
 */

function moneda(v: number): string {
  return `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function imagenFirma(
  empresaId: number,
  firmaId: number,
): Promise<{ buffer: Buffer; mime: string } | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT imagen_ruta, imagen_mime FROM firmas_electronicas
     WHERE id = ? AND empresa_id = ? AND modulo = 'VIATICOS' AND entidad_tipo = 'VIATICO'
     LIMIT 1`,
    [firmaId, empresaId],
  );
  const row = rows[0];
  if (!row || !row.imagen_ruta) return null;
  try {
    const abs = absPathFromRelative(String(row.imagen_ruta));
    if (!existsSync(abs)) return null;
    return {
      buffer: readFileSync(abs),
      mime: row.imagen_mime ? String(row.imagen_mime) : "image/png",
    };
  } catch {
    // Ruta inválida o archivo ilegible: el comprobante sigue generándose
    // sin la imagen (nunca se rompe el PDF completo por una firma).
    return null;
  }
}

/**
 * `null` cuando no hay ningún viático AUTORIZADO — el caller (route.ts)
 * decide el mensaje/estado HTTP; esta función nunca genera un PDF vacío.
 */
export async function comprobanteAutorizacionesPdf(
  empresaId: number,
  empresaNombre: string,
): Promise<Buffer | null> {
  const { items } = await listarViaticosControl(empresaId, { estado: "AUTORIZADO" });
  if (!items.length) return null;

  // Firma de autorización de cada viático (y su imagen, si tiene) — antes
  // de abrir el documento, para no dejar streams de pdfkit a medio
  // escribir si algo falla resolviendo datos.
  const porViatico = await Promise.all(
    items.map(async (v) => {
      const firmas = await listarFirmasViatico(empresaId, v.id);
      const firma = firmas.find((f) => f.accion === "AUTORIZAR_VIATICO") ?? null;
      const imagen = firma?.tieneImagen ? await imagenFirma(empresaId, firma.id) : null;
      return { viatico: v, firma, imagen };
    }),
  );

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

    const encabezado = () => {
      doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a").text(empresaNombre, { width: pageWidth });
      doc.font("Helvetica").fontSize(9).fillColor("#475569")
        .text("Comprobante de autorización de viáticos — TMS / Logística", { width: pageWidth });
      doc.moveDown(0.6);
      doc.moveTo(marginL, doc.y).lineTo(marginL + pageWidth, doc.y).strokeColor("#cbd5e1").lineWidth(1).stroke();
      doc.moveDown(0.6);
    };

    const campo = (label: string, valor: string) => {
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#334155").text(`${label}: `, { continued: true, width: pageWidth });
      doc.font("Helvetica").fillColor("#0f172a").text(valor || "—");
      doc.moveDown(0.28);
    };

    encabezado();

    porViatico.forEach(({ viatico: v, firma, imagen }, i) => {
      if (i > 0) {
        doc.addPage();
        encabezado();
      }

      doc.font("Helvetica-Bold").fontSize(14).fillColor("#0f172a")
        .text(`${v.planCodigo} — ${v.rol}: ${v.personalNombre}`, { width: pageWidth });
      doc.moveDown(0.4);

      doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text("Datos del viaje", { width: pageWidth });
      doc.moveDown(0.2);
      campo("Fecha del viaje", v.fechaPlan);
      campo("Cliente", v.cliente ?? "—");
      campo("Unidad", v.unidadPlaca ?? "—");
      campo("Empleado", v.personalNombre);
      campo("Rol", v.rol);
      campo("Monto asignado", moneda(v.montoAsignado));

      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text("Firma de autorización", { width: pageWidth });
      doc.moveDown(0.2);
      if (firma) {
        campo("Firmado por", firma.nombreFirmante ?? "No disponible");
        campo("Rol del firmante", firma.rolFirmante ?? "No disponible");
        campo("Fecha", firma.fechaHoraServidor.replace("T", " "));
        campo("Código de firma", firma.codigoFirma);
        campo("Hash verificable", firma.hashPayload);
        if (imagen) {
          doc.moveDown(0.2);
          try {
            doc.image(imagen.buffer, { fit: [220, 90] });
            doc.moveDown(0.3);
          } catch {
            // Imagen corrupta/formato no soportado por pdfkit: el
            // comprobante sigue siendo válido sin la imagen — los datos
            // de texto de la firma (código/hash) ya quedaron arriba.
            doc.font("Helvetica-Oblique").fontSize(8).fillColor("#94a3b8")
              .text("(No fue posible incrustar la imagen de la firma.)");
            doc.moveDown(0.2);
          }
        }
      } else {
        doc.font("Helvetica-Oblique").fontSize(9.5).fillColor("#94a3b8")
          .text("Sin firma de autorización registrada.");
        doc.moveDown(0.2);
      }

      doc.moveDown(0.4);
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor("#94a3b8")
        .text(`Documento generado el ${formatearTimestampVisible(ahoraLocal())} (Guatemala)`, marginL, doc.page.height - doc.page.margins.bottom + 6, {
          width: pageWidth,
          align: "center",
          lineBreak: false,
        });
    });

    doc.end();
  });
}
