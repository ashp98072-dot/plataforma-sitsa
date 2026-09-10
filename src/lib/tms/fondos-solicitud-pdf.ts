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
 * real". FALLBACK únicamente para solicitudes ANTERIORES a esta
 * corrección (sin fila en firmas_electronicas ni columna
 * solicitante_nombre/autorizante_usuario_id poblada): interpreta el
 * valor guardado como un posible username y lo resuelve contra
 * `usuarios.nombre` si calza; si no, lo deja tal cual (ya era un nombre
 * real). Nunca se usa para solicitudes creadas/autorizadas DESPUÉS de
 * este ticket — esas ya tienen su nombre real congelado en columna o en
 * el snapshot de firmas_electronicas (ver firmaHistorica más abajo).
 */
async function resolverNombreVisibleLegado(valorGuardado: string | null): Promise<string | null> {
  if (!valorGuardado?.trim()) return null;
  const rows = await query<RowDataPacket[]>("SELECT nombre FROM usuarios WHERE username = ? LIMIT 1", [valorGuardado.trim()]);
  const nombreReal = rows[0]?.nombre;
  if (nombreReal != null && String(nombreReal).trim()) return String(nombreReal);
  return valorGuardado;
}

type FirmaSnapshot = { nombre: string | null; imagen: { buffer: Buffer; mime: string } | null };

/**
 * §4 del ticket — snapshot HISTÓRICO e INMUTABLE de una de las 3 firmas
 * de Fondos, leído de `firmas_electronicas` (MISMA infraestructura que
 * Viáticos, ver firmas-internas.ts/firmas-lectura.ts), acotado a
 * modulo='FONDOS' + entidad_tipo='SOLICITUD_FONDO' + accion. Nunca
 * vuelve a resolver "la firma actual" del usuario en `usuario_firmas`
 * ("Mi firma") — esa fila, una vez insertada al solicitar/asociar
 * requirente/autorizar (ver fondos.ts), no se modifica jamás; leerla
 * aquí, cualquier cantidad de veces y en cualquier momento, es leer
 * exactamente lo que existía en ese instante — cambiar o borrar la
 * plantilla personal después nunca la altera (§6 del ticket:
 * "Liquidada conserva exactamente las mismas firmas históricas").
 *
 * `accion`: 'SOLICITAR_FONDO' | 'REQUERIR_FONDO' | 'AUTORIZAR_FONDO'.
 */
async function firmaHistorica(empresaId: number, solicitudId: number, accion: string): Promise<FirmaSnapshot | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT payload_canonico, imagen_ruta, imagen_mime
     FROM firmas_electronicas
     WHERE empresa_id = ? AND modulo = 'FONDOS' AND entidad_tipo = 'SOLICITUD_FONDO' AND entidad_id = ? AND accion = ?
     ORDER BY fecha_hora_servidor DESC, id DESC LIMIT 1`,
    [empresaId, solicitudId, accion],
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

  const [firmaSolicitante, firmaRequirente, firmaAutorizante] = await Promise.all([
    firmaHistorica(empresaId, solicitud.id, "SOLICITAR_FONDO"),
    firmaHistorica(empresaId, solicitud.id, "REQUERIR_FONDO"),
    firmaHistorica(empresaId, solicitud.id, "AUTORIZAR_FONDO"),
  ]);

  // §1/§2/§3/§4 del ticket — el snapshot INMUTABLE de firmas_electronicas
  // manda sobre cualquier otra fuente cuando existe (es la firma REAL
  // usada en ese momento); si no existe (solicitud creada/autorizada
  // antes de esta corrección, o requirente sin usuario asociado), se cae
  // a la columna ya guardada — y para Solicitante/Autorizante, con el
  // mismo resuelve-si-es-username defensivo de antes, solo para datos
  // legados (nunca para lo que se cree/autorice de aquí en adelante,
  // donde solicitante_nombre/autorizante_usuario_id ya quedan bien
  // guardados desde el origen).
  const nombreSolicitante = firmaSolicitante?.nombre
    ?? solicitud.solicitanteNombre
    ?? (await resolverNombreVisibleLegado(solicitud.creadoPor));
  const nombreRequirente = firmaRequirente?.nombre ?? solicitud.requirenteNombre;
  const nombreAutorizante = firmaAutorizante?.nombre
    ?? (await resolverNombreVisibleLegado(solicitud.autorizanteNombre));

  const buffer = await construirPdf(solicitud, empresaNombre, total, {
    nombreSolicitante, nombreRequirente, nombreAutorizante,
    imagenSolicitante: firmaSolicitante?.imagen ?? null,
    imagenRequirente: firmaRequirente?.imagen ?? null,
    imagenAutorizante: firmaAutorizante?.imagen ?? null,
  });
  return { ok: true, buffer, nombreArchivo: `solicitud-fondo-${solicitud.codigo}.pdf` };
}

type DatosFirmasPdf = {
  nombreSolicitante: string | null;
  nombreRequirente: string | null;
  nombreAutorizante: string | null;
  imagenSolicitante: { buffer: Buffer; mime: string } | null;
  imagenRequirente: { buffer: Buffer; mime: string } | null;
  imagenAutorizante: { buffer: Buffer; mime: string } | null;
};

function construirPdf(
  solicitud: SolicitudFondo,
  empresaNombre: string,
  total: number,
  firmas: DatosFirmasPdf,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // FONDOS-PDF-LANDSCAPE-ANCHOS-1 — SIEMPRE horizontal (landscape): la
    // tabla de detalle tiene 10 columnas y en vertical los datos largos
    // (nombre, cuenta, cargo, cliente, descripción) quedaban comprimidos o
    // partidos. LETTER landscape = 792 × 612 pt (~728 pt útiles de ancho).
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
    // FONDOS-PDF-LANDSCAPE-ANCHOS-1 — anchos EXPLÍCITOS por columna (en
    // "peso" ≈ puntos; suman ~728 = ancho útil de LETTER landscape):
    //   - MENOS espacio para datos cortos: Fecha de solicitud (0),
    //     Fecha de viaje (1), Placa (5), Cantidad (7), Valor (9).
    //   - MÁS espacio para texto largo que debe verse completo:
    //     Nombre (2), Cuenta (3), Cargo (4), Cliente (6), Descripción (8).
    // `weight` reemplaza el cálculo automático por longitud de encabezado:
    // sin él, "Fecha de solicitud" (18 caracteres) inflaría su columna
    // aunque el dato sea "04/09/2026". Los pesos de 0/1/5/7/9 son los
    // mínimos que dejan su encabezado/dato en UNA sola línea.
    dibujarTablaEnDoc(doc, {
      headers,
      rows,
      align: { 7: "center", 9: "right" },
      weight: { 0: 76, 1: 62, 2: 95, 3: 80, 4: 78, 5: 48, 6: 92, 7: 44, 8: 92, 9: 61 },
      // Encabezados/datos cortos que NUNCA deben partirse en dos líneas
      // ("Cantid" + "ad", "C-087CB" + "N"): las dos fechas, Placa, Cantidad
      // y Valor. Cuenta NO va aquí: un número de cuenta largo debe poder
      // envolver y ocupar el ancho ampliado, nunca recortarse con "…".
      preserveSingleLine: [0, 1, 5, 7, 9],
      maxLines: 8,
    });

    // §3 Total — pegado a la tabla, nunca a mitad de las líneas.
    if (doc.y + 22 > pageBottom()) doc.addPage();
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a")
      .text(`TOTAL: ${moneda(total)}`, { width: pageWidth, align: "right" });

    // §4/§5 Firmas — SIEMPRE al final del documento completo (nunca entre líneas).
    dibujarFirmas(doc, pageWidth, marginL, pageBottom, {
      requirente: firmas.nombreRequirente,
      solicitante: firmas.nombreSolicitante,
      autorizante: firmas.nombreAutorizante,
      imagenRequirente: firmas.imagenRequirente,
      imagenSolicitante: firmas.imagenSolicitante,
      imagenAutorizante: firmas.imagenAutorizante,
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
 * §4/§5 Firmas — tres bloques (Requiriente/Solicitante/Autorizante) en
 * una fila de 3 columnas iguales, cada uno con su imagen (proporcionada
 * y centrada, `fit` preserva el aspect ratio) cuando existe un snapshot
 * real en firmas_electronicas (ver firmaHistorica) — si no existe para
 * alguno (§3/§5 del ticket: "si todavía no existe flujo de firma para
 * alguno, no inventar una firma"), ese bloque muestra únicamente el
 * espacio en blanco + el nombre real, nunca una imagen inventada.
 */
function dibujarFirmas(
  doc: PdfDoc,
  pageWidth: number,
  marginL: number,
  pageBottom: () => number,
  datos: {
    requirente: string | null; solicitante: string | null; autorizante: string | null;
    imagenRequirente: { buffer: Buffer; mime: string } | null;
    imagenSolicitante: { buffer: Buffer; mime: string } | null;
    imagenAutorizante: { buffer: Buffer; mime: string } | null;
  },
): void {
  const hayImagen = datos.imagenRequirente || datos.imagenSolicitante || datos.imagenAutorizante;
  const alturaEstimada = 95 + (hayImagen ? 50 : 0);
  if (doc.y + alturaEstimada > pageBottom()) doc.addPage();
  doc.moveDown(1.2);

  const colW = pageWidth / 3;
  const yInicio = doc.y;
  const bloques: { titulo: string; nombre: string | null; imagen: { buffer: Buffer; mime: string } | null }[] = [
    { titulo: "FIRMA DEL REQUIRIENTE", nombre: datos.requirente, imagen: datos.imagenRequirente },
    { titulo: "FIRMA DEL SOLICITANTE", nombre: datos.solicitante, imagen: datos.imagenSolicitante },
    { titulo: "FIRMA DEL AUTORIZANTE", nombre: datos.autorizante, imagen: datos.imagenAutorizante },
  ];

  bloques.forEach((b, i) => {
    const x = marginL + i * colW;
    const yLinea = yInicio + 54;
    if (b.imagen) {
      try {
        // Centrada: el punto de anclaje es colW/2 menos la mitad del
        // ancho máximo (120) de la caja `fit` — proporcionada: `fit`
        // conserva el aspect ratio real de la imagen, nunca la deforma.
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
