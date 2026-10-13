import PDFDocument from "pdfkit";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { ETIQUETA_AREA } from "@/lib/entregas/catalogo";
import { obtenerEntrega, type Entrega } from "@/lib/entregas/entregas";
import { leerEvidenciaEntrega, type EvidenciaEntrega } from "@/lib/entregas/evidencia";
import { ETIQUETA_ESTADO_ENTREGA, ETIQUETA_MODO_ENTREGA, constanciaDisponible } from "@/lib/entregas/presentacion";
import { dibujarCodigoDocumentoPdf } from "@/lib/documentos-encabezado";
import { ahoraLocal, formatearFechaVisible, formatearTimestampVisible } from "@/lib/rrhh/dates";
import { obtenerSolicitudFondo, type SolicitudFondo } from "@/lib/tms/fondos";
import { moneda } from "@/lib/tms/fondos-solicitud-pdf";

/**
 * CONSTANCIA DE ENTREGA DE DOCUMENTO — Solicitudes de fondo (follow-up de PR #446).
 *
 * Dos representaciones, según estado y modo (nunca una «final» para algo no recibido):
 *   PRESENCIAL + EMITIDA  → PREVIA: para imprimir y firmar a mano; el bloque «Recibido por» queda en blanco (nombre, firma y
 *                           fecha/hora). NO contiene ninguna firma ni dato del receptor porque todavía no recibió.
 *   RECIBIDA (cualquier modo) → FINAL: emisor y receptor con rol y fecha/hora, códigos de firma, forma de la recepción y estado.
 *   SISTEMA + EMITIDA     → no hay constancia previa: queda pendiente en «Entregas por recibir».
 *   RECHAZADA / ANULADA   → no se genera (no es una recepción).
 *
 * Solo texto + códigos de firma verificables contra `firmas_electronicas`; no se incrustan imágenes de firma (la arquitectura
 * guarda código/hash y la imagen vive en otra fila; incrustarla ampliaría el alcance). Solo lectura, siempre acotada por la
 * empresa del guard del endpoint; se genera al vuelo (no se almacena), así que no existe un «original» que pueda pisarse.
 */

export type VarianteConstancia = "PREVIA" | "FINAL";

export const MENSAJES_CONSTANCIA = {
  noEncontrada: "Entrega no encontrada.",
  sistemaPendiente: "La constancia estará disponible cuando el receptor confirme la recepción en el sistema.",
  cerrada: "No se genera constancia para una entrega rechazada o anulada.",
} as const;

export type ResultadoConstancia =
  | { ok: true; buffer: Buffer; nombreArchivo: string; variante: VarianteConstancia }
  | { ok: false; status: 404 | 409; error: string };

/** Código visible de la entrega para trazabilidad (derivado del id persistido, con relleno estable). */
export const codigoEntrega = (id: number) => `ENT-${String(id).padStart(6, "0")}`;

export type DatosConstancia = {
  variante: VarianteConstancia;
  codigoEntrega: string;
  empresa: string;
  documento: { etiqueta: string; valor: string }[];
  recorrido: { origen: string; destino: string; modo: string; estado: string };
  emitido: { nombre: string; rol: string; fechaHora: string; codigoFirma: string | null };
  recibido: null | {
    nombre: string;
    /** Solo recepción en el sistema (el receptor presencial no tiene usuario ni rol). */
    rol: string | null;
    fechaHora: string;
    codigoFirma: string | null;
    forma: string;
    registradoPor: string | null;
  };
  observacionesEmision: string | null;
  observacionesRecepcion: string | null;
};

const TEXTO_FORMA_SISTEMA = "Confirmada en el sistema con firma digital del receptor";

function descripcionEvidencia(e: EvidenciaEntrega | null, escaneada: boolean): string {
  if (!escaneada || !e) return "Firma dibujada en el dispositivo (sin constancia escaneada adjunta)";
  const tipo = e.mime === "application/pdf" ? "PDF" : e.mime === "image/png" ? "imagen PNG" : e.mime === "image/jpeg" ? "imagen JPG" : "archivo";
  return `Constancia firmada y escaneada (${tipo}) adjunta en el sistema`;
}

/** Arma el contenido (puro, sin pdfkit ni base de datos). `codigosFirma`: id de firma → código. */
export function armarDatosConstancia(
  entrega: Entrega,
  solicitud: Pick<SolicitudFondo, "codigo" | "total" | "fechaRequerimiento" | "requirenteNombre" | "solicitanteNombre" | "entidadRequirenteNombre">,
  codigosFirma: Map<number, string>,
  evidencia: EvidenciaEntrega | null,
  empresaNombre: string,
): DatosConstancia | null {
  const variante = constanciaDisponible(entrega);
  if (!variante) return null;
  const documento: { etiqueta: string; valor: string }[] = [
    { etiqueta: "Módulo", valor: "Solicitud de fondo" },
    { etiqueta: "Código del fondo", valor: solicitud.codigo },
    { etiqueta: "Empresa requirente", valor: solicitud.entidadRequirenteNombre ?? empresaNombre },
    { etiqueta: "Persona que requiere", valor: solicitud.requirenteNombre ?? "—" },
    { etiqueta: "Solicitante", valor: solicitud.solicitanteNombre ?? "—" },
    { etiqueta: "Fecha del documento", valor: formatearFechaVisible(solicitud.fechaRequerimiento) },
    { etiqueta: "Monto", valor: moneda(solicitud.total) },
  ];
  const presencial = entrega.modo === "PRESENCIAL";
  const recibido = variante === "FINAL"
    ? {
        nombre: entrega.recibidoPorNombre ?? "—",
        rol: presencial ? null : entrega.recibidoPorRol,
        fechaHora: formatearTimestampVisible(entrega.recibidoEn),
        codigoFirma: entrega.firmaRecepcionId != null ? (codigosFirma.get(entrega.firmaRecepcionId) ?? null) : null,
        forma: presencial ? descripcionEvidencia(evidencia, evidencia !== null) : TEXTO_FORMA_SISTEMA,
        registradoPor: presencial ? entrega.recepcionOperadaPorNombre : null,
      }
    : null;
  return {
    variante,
    codigoEntrega: codigoEntrega(entrega.id),
    empresa: empresaNombre,
    documento,
    recorrido: {
      origen: ETIQUETA_AREA[entrega.etapaOrigen],
      destino: ETIQUETA_AREA[entrega.etapaDestino],
      modo: ETIQUETA_MODO_ENTREGA[entrega.modo],
      estado: variante === "PREVIA" ? "Pendiente de recepción presencial" : ETIQUETA_ESTADO_ENTREGA.RECIBIDA.toUpperCase(),
    },
    emitido: {
      nombre: entrega.emitidoPorNombre,
      rol: entrega.emitidoPorRol,
      fechaHora: formatearTimestampVisible(entrega.emitidoEn),
      codigoFirma: codigosFirma.get(entrega.firmaEmisionId) ?? null,
    },
    recibido,
    observacionesEmision: entrega.observacionesEmision?.trim() || null,
    observacionesRecepcion: entrega.observacionesRecepcion?.trim() || null,
  };
}

async function codigosDeFirma(empresaId: number, ids: number[]): Promise<Map<number, string>> {
  const unicos = [...new Set(ids)];
  const mapa = new Map<number, string>();
  if (!unicos.length) return mapa;
  const filas = await query<RowDataPacket[]>(
    `SELECT id, codigo_firma FROM firmas_electronicas WHERE empresa_id = ? AND id IN (${unicos.map(() => "?").join(", ")})`,
    [empresaId, ...unicos],
  );
  for (const f of filas ?? []) mapa.set(Number(f.id), String(f.codigo_firma));
  return mapa;
}

export async function generarPdfConstanciaEntrega(empresaId: number, entregaId: number, empresaNombre: string): Promise<ResultadoConstancia> {
  const entrega = await obtenerEntrega(empresaId, entregaId);
  if (!entrega || entrega.modulo !== "FONDOS") return { ok: false, status: 404, error: MENSAJES_CONSTANCIA.noEncontrada };
  if (constanciaDisponible(entrega) === null) {
    return { ok: false, status: 409, error: entrega.estado === "EMITIDA" ? MENSAJES_CONSTANCIA.sistemaPendiente : MENSAJES_CONSTANCIA.cerrada };
  }
  const solicitud = await obtenerSolicitudFondo(empresaId, entrega.entidadId);
  if (!solicitud) return { ok: false, status: 404, error: MENSAJES_CONSTANCIA.noEncontrada };

  const [codigos, evidencia] = await Promise.all([
    codigosDeFirma(empresaId, [entrega.firmaEmisionId, ...(entrega.firmaRecepcionId != null ? [entrega.firmaRecepcionId] : [])]),
    entrega.estado === "RECIBIDA" && entrega.modo === "PRESENCIAL" ? leerEvidenciaEntrega(empresaId, entrega.id) : Promise.resolve(null),
  ]);
  const datos = armarDatosConstancia(entrega, solicitud, codigos, evidencia, empresaNombre)!;
  const buffer = await dibujarConstancia(datos);
  const seguro = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-");
  return {
    ok: true,
    buffer,
    variante: datos.variante,
    nombreArchivo: `constancia-entrega-${seguro(solicitud.codigo)}-${datos.codigoEntrega}${datos.variante === "PREVIA" ? "-para-firma" : ""}.pdf`,
  };
}

function dibujarConstancia(d: DatosConstancia): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 48, bottom: 48, left: 54, right: 54 }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const x = doc.page.margins.left;
    const ancho = doc.page.width - x - doc.page.margins.right;
    const fondo = "#0f172a";

    const campo = (etiqueta: string, valor: string) => {
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(fondo).text(`${etiqueta}: `, x, doc.y, { width: ancho, continued: true });
      doc.font("Helvetica").text(valor, { width: ancho });
    };
    const seccion = (titulo: string) => {
      doc.moveDown(0.8);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(fondo).text(titulo.toUpperCase(), x, doc.y, { width: ancho });
      const y = doc.y + 1;
      doc.moveTo(x, y).lineTo(x + ancho, y).strokeColor("#94a3b8").lineWidth(0.6).stroke();
      doc.moveDown(0.35);
    };
    const lineaEnBlanco = (etiqueta: string, alto = 26) => {
      doc.font("Helvetica").fontSize(9.5).fillColor(fondo).text(`${etiqueta}:`, x, doc.y, { width: ancho });
      const y = doc.y + alto - 10;
      doc.moveTo(x + 150, y).lineTo(x + ancho, y).strokeColor("#475569").lineWidth(0.7).stroke();
      doc.y = y + 6;
    };

    // Encabezado
    dibujarCodigoDocumentoPdf(doc, d.codigoEntrega, { x, width: ancho, y: doc.y + 2 });
    doc.font("Helvetica-Bold").fontSize(15).fillColor(fondo).text("CONSTANCIA DE ENTREGA DE DOCUMENTO", x, doc.y, { width: ancho, align: "center" });
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(9.5).text(d.empresa.toUpperCase(), x, doc.y, { width: ancho, align: "center" });

    seccion("Documento");
    for (const f of d.documento) campo(f.etiqueta, f.valor);

    seccion("Entrega");
    campo("Origen", d.recorrido.origen);
    campo("Destino", d.recorrido.destino);
    campo("Modo", d.recorrido.modo);
    campo("Estado", d.recorrido.estado);

    seccion("Emitido por");
    campo("Nombre", d.emitido.nombre);
    campo("Rol", d.emitido.rol);
    campo("Fecha y hora", d.emitido.fechaHora);
    if (d.emitido.codigoFirma) campo("Código de firma", d.emitido.codigoFirma);

    seccion("Recibido por");
    if (d.recibido === null) {
      // PREVIA: espacios para completar a mano. Nada del receptor está registrado todavía.
      lineaEnBlanco("Nombre de quien recibe");
      lineaEnBlanco("Firma", 54);
      lineaEnBlanco("Fecha y hora de recepción");
    } else {
      campo("Nombre", d.recibido.nombre);
      if (d.recibido.rol) campo("Rol", d.recibido.rol);
      campo("Fecha y hora", d.recibido.fechaHora);
      if (d.recibido.codigoFirma) campo("Código de firma", d.recibido.codigoFirma);
      campo("Forma de recepción", d.recibido.forma);
      if (d.recibido.registradoPor) campo("Registrada en el sistema por", d.recibido.registradoPor);
    }

    if (d.observacionesEmision || d.observacionesRecepcion) {
      seccion("Observaciones");
      if (d.observacionesEmision) campo("Al entregar", d.observacionesEmision);
      if (d.observacionesRecepcion) campo("Al recibir", d.observacionesRecepcion);
    }

    doc.moveDown(1);
    if (d.variante === "PREVIA") {
      doc.font("Helvetica-Oblique").fontSize(8).fillColor("#475569").text(
        "Este documento NO acredita la recepción hasta que sea firmado por quien recibe y se registre la recepción presencial en el sistema, adjuntando esta constancia firmada.",
        x, doc.y, { width: ancho },
      );
    }

    // Pie con trazabilidad
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8").text(
        `Código de entrega: ${d.codigoEntrega} · Generado el ${formatearTimestampVisible(ahoraLocal())} (Guatemala)`,
        x, doc.page.height - doc.page.margins.bottom - 4, { width: ancho, align: "center", lineBreak: false },
      );
    }
    doc.end();
  });
}
