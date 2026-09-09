import { existsSync, readFileSync } from "fs";
import PDFDocument from "pdfkit";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { absPathFromRelative } from "@/lib/uploads";
import { ahoraLocal, formatearFechaVisible, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { dibujarTablaEnDoc } from "@/lib/rrhh/export-files";
import { tituloEmpresa } from "@/lib/tms/viaticos-comprobante-pdf";
import { obtenerSolicitudFondo, type SolicitudFondo } from "@/lib/tms/fondos";

/**
 * SOLICITUD-FONDOS-PDF-AUTORIZADO-1 — PDF formal de UNA solicitud de
 * fondo ya AUTORIZADA (o LIQUIDADA, que conserva acceso al MISMO
 * documento histórico), con el formato administrativo real de
 * Operaciones: encabezado, tabla de detalle (10 columnas, incluida
 * "Cuenta"), total recalculado server-side, 3 firmas y notas de pie.
 *
 * Reutiliza TAL CUAL:
 * - obtenerSolicitudFondo() — misma fuente que el resto de Fondos, nunca
 *   una segunda consulta paralela de la solicitud/líneas.
 * - dibujarTablaEnDoc() (src/lib/rrhh/export-files.ts) — mismo dibujado
 *   de tabla que reportes de RRHH y el comprobante de viáticos: repite
 *   encabezado en cada página nueva y nunca deja páginas vacías (§8 del
 *   ticket ya resuelto por esa función, sin tocarla).
 * - tituloEmpresa() (viaticos-comprobante-pdf.ts) — misma reducción de
 *   nombre de empresa compuesto ya usada en el comprobante de viáticos.
 *
 * §11 Seguridad: `empresaId` viene SIEMPRE del guard del endpoint (nunca
 * del cliente); obtenerSolicitudFondo ya filtra por empresa_id, así que
 * una solicitud de otra empresa nunca llega aquí. Esta función es de
 * SOLO LECTURA — nunca escribe ni modifica la solicitud al generar el PDF.
 */

type PdfDoc = InstanceType<typeof PDFDocument>;

function moneda(v: number): string {
  return `Q ${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const NOTAS_PIE = [
  "1. Recordar que las facturas deben salir a nombre y NIT de la empresa requirente.",
  "2. Este formulario debe enviarse a Tesorería y Contabilidad para control del acumulado de requerimientos.",
  "3. Después de realizada la compra, presentar las facturas a Contabilidad con copia del requerimiento.",
  "4. Si existe sobrante de efectivo, debe depositarse o transferirse a la cuenta de la empresa requirente y liquidar el anticipo.",
  "5. Se recomienda enviar los requerimientos con anticipación para programar los pagos.",
];

const LEMA_PIE =
  "EL ORDEN Y LA DISCIPLINA SON LA BASE PARA UN SERVICIO DE CALIDAD, EFICIENCIA Y SATISFACCIÓN A NUESTRO CLIENTE";

/**
 * §5 del ticket: "no mostrar username, rol ni '(admin)', solo nombre
 * real". `tms_solicitudes_fondo.creado_por` SIEMPRE guarda el username
 * de acceso (ver crearSolicitudFondo/POST .../tms/fondos), nunca un
 * nombre real — así que "Solicitante" se resuelve aquí contra
 * `usuarios.nombre` (mismo campo que ya usa la sesión para
 * nombreFirmante en autorizar viáticos, ver auth.ts:UsuarioRow).
 *
 * También se usa defensivamente sobre `autorizanteNombre`: antes de esta
 * corrección, el endpoint PATCH de Fondos guardaba el USERNAME ahí si el
 * caller no mandaba un nombre explícito (bug corregido en
 * .../tms/fondos/[id]/route.ts). Las solicitudes YA autorizadas antes de
 * esa corrección quedaron con un username guardado en esa columna — este
 * resolver, al no encontrar cambios de esquema disponibles (no se
 * ejecuta SQL, no hay columna de snapshot para esto), intenta primero
 * interpretar el valor guardado como username y solo si no calza con
 * ningún usuario lo trata como el nombre real que ya era.
 *
 * LIMITACIÓN CONOCIDA (documentada, no inventada): esto resuelve
 * `usuarios.nombre` EN VIVO al generar el PDF, no es un snapshot
 * congelado como empleado/placa/cliente/cuenta — si esa persona cambia
 * su nombre en el sistema después, un PDF regenerado más tarde
 * mostraría el nombre nuevo. No se agregó columna de snapshot para esto
 * porque el ticket no la pidió explícitamente para Solicitante/
 * Autorizante y `usuarios` no tiene hoy un mecanismo de historial en el
 * proyecto.
 */
async function resolverNombreVisible(valorGuardado: string | null): Promise<string | null> {
  if (!valorGuardado?.trim()) return null;
  const rows = await query<RowDataPacket[]>("SELECT nombre FROM usuarios WHERE username = ? LIMIT 1", [valorGuardado.trim()]);
  const nombreReal = rows[0]?.nombre;
  if (nombreReal != null && String(nombreReal).trim()) return String(nombreReal);
  return valorGuardado;
}

type FirmaAutorizante = { nombre: string | null; imagen: { buffer: Buffer; mime: string } | null };

/**
 * Firma histórica de AUTORIZACIÓN de esta solicitud, si existe — MISMA
 * infraestructura de `firmas_electronicas` ya usada por viáticos (ver
 * firmas-internas.ts/firmas-lectura.ts), acotada a
 * modulo='FONDOS' + entidad_tipo='SOLICITUD_FONDO' + accion='AUTORIZAR_FONDO'.
 *
 * HOY esto SIEMPRE devuelve null: a diferencia de autorizarViatico(),
 * cambiarEstadoSolicitudFondo() (fondos.ts) todavía NO captura firma
 * manuscrita al autorizar una Solicitud de Fondo — no existe ese flujo
 * (no hay canvas de firma en fondos/page.tsx, ni multipart/imagen en su
 * PATCH). Implementar ese flujo es una ampliación de alcance que este
 * ticket no pidió construir (§5: "si todavía no existe flujo de firma
 * para alguno, NO inventar una firma: mostrar el espacio y nombre
 * correspondiente y documentar qué falta" — esto ES ese caso). Se deja
 * esta lectura ya conectada, EXACTO mismo patrón que imagenFirma() en
 * viaticos-comprobante-pdf.ts, para que el día que se agregue ese flujo
 * a Fondos, este PDF empiece a mostrar la firma real sin ningún cambio
 * adicional aquí.
 */
async function firmaAutorizanteHistorica(empresaId: number, solicitudId: number): Promise<FirmaAutorizante | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT payload_canonico, imagen_ruta, imagen_mime
     FROM firmas_electronicas
     WHERE empresa_id = ? AND modulo = 'FONDOS' AND entidad_tipo = 'SOLICITUD_FONDO' AND entidad_id = ? AND accion = 'AUTORIZAR_FONDO'
     ORDER BY fecha_hora_servidor DESC, id DESC LIMIT 1`,
    [empresaId, solicitudId],
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

export type ResultadoPdfSolicitudFondo =
  | { ok: true; buffer: Buffer; nombreArchivo: string }
  | { ok: false; status: 404 | 400; error: string };

/**
 * §6 del ticket — el PDF formal (con firmas) solo tiene sentido para una
 * solicitud que YA fue autorizada: Pendiente (el contenido todavía puede
 * cambiar o rechazarse) y Rechazada (nunca se autorizó) quedan
 * explícitamente fuera. Liquidada conserva acceso al MISMO documento
 * (es una Autorizada que además ya se liquidó).
 */
export async function generarPdfSolicitudFondoAutorizada(
  empresaId: number,
  id: number,
  empresaNombre: string,
): Promise<ResultadoPdfSolicitudFondo> {
  const solicitud = await obtenerSolicitudFondo(empresaId, id);
  if (!solicitud) return { ok: false, status: 404, error: "Solicitud no encontrada." };
  if (solicitud.estado !== "Autorizada" && solicitud.estado !== "Liquidada") {
    return {
      ok: false,
      status: 400,
      error: `El PDF oficial solo está disponible para solicitudes Autorizadas o Liquidadas (estado actual: "${solicitud.estado}").`,
    };
  }

  // §3 del ticket: "no confiar en un total enviado por frontend, calcular/
  // validar server-side" — se recalcula aquí de las líneas realmente
  // guardadas, nunca se confía ciegamente en tms_solicitudes_fondo.total
  // (que ya es server-side, ver calcularTotal en fondos.ts, pero esta
  // recomputación es la garantía final de que el PDF SIEMPRE es la suma
  // real de sus líneas, aunque ese valor llegara a desalinearse).
  const total = solicitud.lineas.reduce((acc, l) => acc + l.cantidad * l.monto, 0);

  const [nombreSolicitante, nombreAutorizanteGuardado, firmaAutorizante] = await Promise.all([
    resolverNombreVisible(solicitud.creadoPor),
    resolverNombreVisible(solicitud.autorizanteNombre),
    firmaAutorizanteHistorica(empresaId, solicitud.id),
  ]);
  // "usar la firma/snapshot almacenada al autorizar" (§5): si existe una
  // firma histórica de autorización, SU nombre (snapshot congelado en
  // payload_canonico al momento exacto de firmar) manda sobre
  // autorizanteNombre — hoy nunca ocurre (ver firmaAutorizanteHistorica),
  // pero deja el orden de precedencia correcto para cuando exista.
  const nombreAutorizante = firmaAutorizante?.nombre ?? nombreAutorizanteGuardado;

  const buffer = await construirPdf(solicitud, empresaNombre, total, nombreSolicitante, nombreAutorizante, firmaAutorizante);
  return { ok: true, buffer, nombreArchivo: `solicitud-fondo-${solicitud.codigo}.pdf` };
}

function construirPdf(
  solicitud: SolicitudFondo,
  empresaNombre: string,
  total: number,
  nombreSolicitante: string | null,
  nombreAutorizante: string | null,
  firmaAutorizante: FirmaAutorizante | null,
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

    // §1 Encabezado
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a")
      .text("SOLICITUD DE FONDO", { width: pageWidth, align: "center" });
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(9.5).fillColor("#0f172a");
    doc.text(`FECHA DEL REQUERIMIENTO: ${formatearFechaVisible(solicitud.fechaRequerimiento)}`, { width: pageWidth });
    doc.text(`EMPRESA REQUIRIENTE: ${tituloEmpresa(empresaNombre).toUpperCase()}`, { width: pageWidth });
    doc.text(`PERSONA QUE REQUIERE: ${(solicitud.requirenteNombre ?? "—").toUpperCase()}`, { width: pageWidth });
    doc.moveDown(0.6);

    // §2 Tabla de detalle — EXACTAMENTE estas 10 columnas, en este orden.
    const headers = ["Fecha de solicitud", "Fecha de viaje", "Nombre", "Cuenta", "Cargo", "Placa", "Cliente", "Cantidad", "Descripción", "Valor"];
    const fechaSolicitudVisible = formatearFechaVisible(solicitud.fechaRequerimiento);
    const rows = solicitud.lineas.map((l) => [
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
      headers,
      rows,
      align: { 7: "center", 9: "right" },
      minWeight: { 3: 10, 9: 12 },
    });

    // §3 Total — pegado a la tabla, nunca a mitad de las líneas.
    if (doc.y + 22 > pageBottom()) doc.addPage();
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a")
      .text(`TOTAL: ${moneda(total)}`, { width: pageWidth, align: "right" });

    // §4/§5 Firmas — SIEMPRE al final del documento completo (nunca entre líneas).
    dibujarFirmas(doc, pageWidth, marginL, pageBottom, {
      requirente: solicitud.requirenteNombre,
      solicitante: nombreSolicitante,
      autorizante: nombreAutorizante,
      imagenAutorizante: firmaAutorizante?.imagen ?? null,
    });

    // §7 Notas al pie
    dibujarNotas(doc, pageWidth, pageBottom);

    // §8 Paginación — "Página X de Y", nunca en medio del contenido.
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

/**
 * §4 Firmas — tres bloques (Requiriente/Solicitante/Autorizante) en una
 * fila de 3 columnas iguales. Solo el bloque de Autorizante puede traer
 * imagen (firmaAutorizanteHistorica, ver arriba) — Requiriente y
 * Solicitante siempre muestran el espacio en blanco + su nombre real: no
 * existe hoy un flujo de firma manuscrita para esos dos roles en Fondos
 * (§5 del ticket, documentado también en firmaAutorizanteHistorica()).
 */
function dibujarFirmas(
  doc: PdfDoc,
  pageWidth: number,
  marginL: number,
  pageBottom: () => number,
  datos: { requirente: string | null; solicitante: string | null; autorizante: string | null; imagenAutorizante: { buffer: Buffer; mime: string } | null },
): void {
  const alturaEstimada = 95 + (datos.imagenAutorizante ? 50 : 0);
  if (doc.y + alturaEstimada > pageBottom()) doc.addPage();
  doc.moveDown(1.2);

  const colW = pageWidth / 3;
  const yInicio = doc.y;
  const bloques: { titulo: string; nombre: string | null; imagen: { buffer: Buffer; mime: string } | null }[] = [
    { titulo: "FIRMA DEL REQUIRIENTE", nombre: datos.requirente, imagen: null },
    { titulo: "FIRMA DEL SOLICITANTE", nombre: datos.solicitante, imagen: null },
    { titulo: "FIRMA DEL AUTORIZANTE", nombre: datos.autorizante, imagen: datos.imagenAutorizante },
  ];

  bloques.forEach((b, i) => {
    const x = marginL + i * colW;
    const yLinea = yInicio + 54;
    if (b.imagen) {
      try {
        doc.image(b.imagen.buffer, x + colW / 2 - 60, yInicio, { fit: [120, 50] });
      } catch {
        // Imagen corrupta/formato no soportado: el documento sigue siendo
        // válido, solo sin imagen — nombre y espacio de firma quedan igual.
      }
    }
    doc.moveTo(x + 10, yLinea).lineTo(x + colW - 10, yLinea).strokeColor("#94a3b8").lineWidth(0.6).stroke();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a")
      .text(b.titulo, x, yLinea + 4, { width: colW, align: "center" });
    doc.font("Helvetica").fontSize(8.5).fillColor("#0f172a")
      .text(b.nombre ?? "—", x, yLinea + 16, { width: colW, align: "center" });
  });

  doc.x = marginL;
  doc.y = yInicio + 95;
}

function dibujarNotas(doc: PdfDoc, pageWidth: number, pageBottom: () => number): void {
  const alturaEstimada = 22 + NOTAS_PIE.length * 11 + 26;
  if (doc.y + alturaEstimada > pageBottom()) doc.addPage();
  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text("Notas:", { width: pageWidth });
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(8).fillColor("#334155");
  for (const nota of NOTAS_PIE) {
    doc.text(nota, { width: pageWidth });
  }
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a")
    .text(LEMA_PIE, { width: pageWidth, align: "center" });
}
