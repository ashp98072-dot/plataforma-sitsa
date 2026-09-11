import { existsSync, readFileSync } from "fs";
import PDFDocument from "pdfkit";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { absPathFromRelative } from "@/lib/uploads";
import { ahoraLocal, formatearFechaVisible, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { dibujarTablaEnDoc } from "@/lib/rrhh/export-files";
import { dibujarFirmas, moneda } from "@/lib/tms/fondos-solicitud-pdf";
import { HEADERS_PDF_GASTOS, WEIGHT_PDF_GASTOS } from "@/lib/tms/gastos-solicitud-pdf";
import { obtenerGasto, type GastoOperativo } from "@/lib/tms/gastos";

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 5) — PDF individual de UN gasto operativo
 * ya AUTORIZADO, con el mismo criterio visual/administrativo que
 * SOLICITUD DE FONDO (ver fondos-solicitud-pdf.ts): encabezado (Empresa
 * requirente / Persona que requiere / Solicitante), una tabla de UNA sola
 * fila (el gasto), total, y 3 firmas.
 *
 * Reutiliza TAL CUAL (nunca duplicado):
 * - obtenerGasto() — misma fuente que el resto de Gastos, nunca una
 *   segunda consulta paralela.
 * - dibujarFirmas()/moneda() (fondos-solicitud-pdf.ts) — 100% genéricas,
 *   sin acoplamiento a Fondos; el único código propio de este archivo es
 *   firmaHistoricaGasto(), que apunta a modulo='GASTOS'/
 *   entidad_tipo='GASTO_OPERATIVO' en vez de FONDOS/SOLICITUD_FONDO.
 * - HEADERS_PDF_GASTOS/WEIGHT_PDF_GASTOS (gastos-solicitud-pdf.ts) — las
 *   MISMAS 10 columnas que ya usa el PDF tabular de Gastos, para una sola
 *   fila; ese archivo no se modifica.
 * - dibujarTablaEnDoc() (export-files.ts) — mismo dibujado de tabla que
 *   el resto de PDFs administrativos del TMS.
 *
 * Distinto del PDF tabular/multi-registro (gastos-solicitud-pdf.ts, que
 * permanece intacto y SIN firmas): este PDF es de UN solo gasto, solo
 * disponible cuando `estado === "Autorizada"` (Gastos no tiene
 * "Liquidada", a diferencia de Fondos).
 *
 * §11 Seguridad: `empresaId` viene SIEMPRE del guard del endpoint (nunca
 * del cliente); obtenerGasto ya filtra por empresa_id. Esta función es de
 * SOLO LECTURA — nunca escribe ni modifica el gasto al generar el PDF.
 */

export type FirmaSnapshotGasto = { nombre: string | null; imagen: { buffer: Buffer; mime: string } | null };

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 5) — snapshot HISTÓRICO e INMUTABLE de una
 * de las 3 firmas de Gastos, leído de `firmas_electronicas` (misma
 * infraestructura que Fondos/Viáticos, ver firmas-internas.ts), acotado a
 * modulo='GASTOS' + entidad_tipo='GASTO_OPERATIVO' + accion. Nunca vuelve
 * a resolver "la firma actual" del usuario en `usuario_firmas` ("Mi
 * firma") — esa fila, una vez insertada al crear/asociar
 * requirente-o-solicitante/autorizar (ver gastos.ts), no se modifica
 * jamás.
 *
 * `accion`: 'SOLICITAR_GASTO' | 'REQUERIR_GASTO' | 'AUTORIZAR_GASTO'.
 */
export async function firmaHistoricaGasto(empresaId: number, gastoId: number, accion: string): Promise<FirmaSnapshotGasto | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT payload_canonico, imagen_ruta, imagen_mime
     FROM firmas_electronicas
     WHERE empresa_id = ? AND modulo = 'GASTOS' AND entidad_tipo = 'GASTO_OPERATIVO' AND entidad_id = ? AND accion = ?
     ORDER BY fecha_hora_servidor DESC, id DESC LIMIT 1`,
    [empresaId, gastoId, accion],
  );
  const row = rows[0];
  if (!row) return null;
  let nombre: string | null = null;
  try {
    const payload = JSON.parse(String(row.payload_canonico ?? "{}")) as Record<string, unknown>;
    nombre = typeof payload.nombreFirmante === "string" ? payload.nombreFirmante : null;
  } catch {
    nombre = null;
  }
  let imagen: { buffer: Buffer; mime: string } | null = null;
  if (row.imagen_ruta) {
    try {
      const abs = absPathFromRelative(String(row.imagen_ruta));
      if (existsSync(abs)) {
        imagen = { buffer: readFileSync(abs), mime: row.imagen_mime ? String(row.imagen_mime) : "image/png" };
      }
    } catch {
      imagen = null;
    }
  }
  return { nombre, imagen };
}

export type ResultadoPdfGasto =
  | { ok: true; buffer: Buffer; nombreArchivo: string }
  | { ok: false; status: 404 | 400; error: string };

/**
 * §PDF individual — solo tiene sentido para un gasto YA autorizado:
 * Pendiente (el contenido todavía puede cambiar o rechazarse), Rechazada
 * y los históricos (`estado IS NULL`) quedan explícitamente fuera.
 */
export async function generarPdfGastoAutorizado(
  empresaId: number,
  id: number,
  empresaNombre: string,
): Promise<ResultadoPdfGasto> {
  const gasto = await obtenerGasto(empresaId, id);
  if (!gasto) return { ok: false, status: 404, error: "Gasto no encontrado." };
  if (gasto.estado !== "Autorizada") {
    return {
      ok: false,
      status: 400,
      error: `El PDF individual solo está disponible para gastos Autorizados (estado actual: "${gasto.estado ?? "histórico"}").`,
    };
  }

  const total = gasto.cantidad * gasto.monto;

  const [firmaSolicitante, firmaRequirente, firmaAutorizante] = await Promise.all([
    firmaHistoricaGasto(empresaId, gasto.id, "SOLICITAR_GASTO"),
    firmaHistoricaGasto(empresaId, gasto.id, "REQUERIR_GASTO"),
    firmaHistoricaGasto(empresaId, gasto.id, "AUTORIZAR_GASTO"),
  ]);

  // El snapshot INMUTABLE de firmas_electronicas manda sobre cualquier
  // otra fuente cuando existe; si no existe (requirente/solicitante sin
  // "Mi firma" registrada, best-effort), se cae a la columna ya guardada
  // — nunca se inventa una firma ni se resuelve la "actual" del usuario.
  const nombreSolicitante = firmaSolicitante?.nombre ?? gasto.solicitanteNombre;
  const nombreRequirente = firmaRequirente?.nombre ?? gasto.requirenteNombre;
  const nombreAutorizante = firmaAutorizante?.nombre ?? gasto.autorizanteNombre;

  const buffer = await construirPdf(gasto, empresaNombre, total, {
    nombreSolicitante, nombreRequirente, nombreAutorizante,
    imagenSolicitante: firmaSolicitante?.imagen ?? null,
    imagenRequirente: firmaRequirente?.imagen ?? null,
    imagenAutorizante: firmaAutorizante?.imagen ?? null,
  });
  return { ok: true, buffer, nombreArchivo: `gasto-${gasto.id}.pdf` };
}

type DatosFirmasPdfGasto = {
  nombreSolicitante: string | null;
  nombreRequirente: string | null;
  nombreAutorizante: string | null;
  imagenSolicitante: { buffer: Buffer; mime: string } | null;
  imagenRequirente: { buffer: Buffer; mime: string } | null;
  imagenAutorizante: { buffer: Buffer; mime: string } | null;
};

function construirPdf(
  gasto: GastoOperativo,
  empresaNombre: string,
  total: number,
  firmas: DatosFirmasPdfGasto,
): Promise<Buffer> {
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

    // Encabezado — mismo criterio que SOLICITUD DE FONDO.
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a")
      .text("SOLICITUD DE GASTOS", { width: pageWidth, align: "center" });
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(9.5).fillColor("#0f172a");
    doc.text(`FECHA DE SOLICITUD: ${formatearFechaVisible(gasto.fechaSolicitud)}`, { width: pageWidth });
    doc.text(`EMPRESA REQUIRIENTE: ${(gasto.entidadRequirenteNombre ?? empresaNombre).toUpperCase()}`, { width: pageWidth });
    doc.text(`PERSONA QUE REQUIERE: ${(gasto.requirenteNombre ?? "—").toUpperCase()}`, { width: pageWidth });
    doc.text(`SOLICITANTE: ${(gasto.solicitanteNombre ?? "—").toUpperCase()}`, { width: pageWidth });
    doc.moveDown(0.6);

    // Tabla — MISMAS 10 columnas que el PDF tabular de Gastos, una sola fila.
    const fila = [
      formatearFechaVisible(gasto.fechaSolicitud) || "—",
      gasto.fechaViaje ? formatearFechaVisible(gasto.fechaViaje) : "—",
      gasto.empleadoNombre ?? "—",
      gasto.numeroCuentaPago ?? "—",
      gasto.empleadoCargo ?? "—",
      gasto.vehiculoPlaca ?? "—",
      gasto.clienteNombre ?? "—",
      String(gasto.cantidad),
      gasto.descripcion ?? "—",
      moneda(total),
    ];
    dibujarTablaEnDoc(doc, {
      headers: HEADERS_PDF_GASTOS,
      rows: [fila],
      align: { 7: "center", 9: "right" },
      weight: WEIGHT_PDF_GASTOS,
      preserveSingleLine: [0, 1, 5, 7, 9],
      maxLines: 8,
    });

    // Total — pegado a la tabla.
    if (doc.y + 22 > pageBottom()) doc.addPage();
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a")
      .text(`TOTAL: ${moneda(total)}`, { width: pageWidth, align: "right" });

    // Firmas — SIEMPRE al final, reutilizando dibujarFirmas() de Fondos tal cual.
    dibujarFirmas(doc, pageWidth, marginL, pageBottom, {
      requirente: firmas.nombreRequirente,
      solicitante: firmas.nombreSolicitante,
      autorizante: firmas.nombreAutorizante,
      imagenRequirente: firmas.imagenRequirente,
      imagenSolicitante: firmas.imagenSolicitante,
      imagenAutorizante: firmas.imagenAutorizante,
    });

    // Paginación.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8").text(
        `Página ${i + 1} de ${range.count} · Documento generado el ${formatearTimestampVisible(ahoraLocal())} (Guatemala)`,
        marginL, doc.page.height - doc.page.margins.bottom - 12,
        { width: pageWidth, align: "center", lineBreak: false },
      );
    }

    doc.end();
  });
}
