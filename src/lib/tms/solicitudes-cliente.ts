import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { hoyLocal, normalizarHora, toIsoDate } from "@/lib/rrhh/dates";

/**
 * CLIENTE-PORTAL-2 — dominio de tms_solicitudes_cliente/tms_solicitud_paradas
 * (modelo ya aplicado y endurecido en producción, ver
 * sql/migrate-2026-09-tms-portal-clientes-base.sql /
 * -hardening.sql — este módulo NO crea ni altera esquema). Toda función
 * pública exige `empresaId` + `clienteId` explícitos (nunca solo
 * `solicitudId`) — mismo criterio anti-IDOR que el resto del proyecto.
 */

export const TIPOS_SOLICITUD_PARADA = ["Carga", "Entrega", "Descarga"] as const;
export type TipoSolicitudParada = (typeof TIPOS_SOLICITUD_PARADA)[number];

export function esTipoSolicitudParadaValido(
  tipo: string,
): tipo is TipoSolicitudParada {
  return (TIPOS_SOLICITUD_PARADA as readonly string[]).includes(tipo);
}

export const ESTADOS_SOLICITUD_CLIENTE = [
  "SOLICITADA",
  "EN_REVISION",
  "PROGRAMADA",
  "RECHAZADA",
  "CANCELADA",
] as const;
export type EstadoSolicitudCliente = (typeof ESTADOS_SOLICITUD_CLIENTE)[number];

export type SolicitudParadaInput = {
  orden: number;
  tipo: string;
  lugarNombre: string;
  clienteUbicacionId?: number | null;
  referencia?: string | null;
};

export type ResultadoValidacionParadas =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Reglas estructurales de un conjunto de paradas ya construido (con
 * `orden` ya asignado por el servidor, nunca por el navegador — ver
 * crearSolicitudCliente): exactamente 1 `Carga`, MÍNIMO 1 `Entrega`
 * (CLIENTE-PORTAL-2: el requerimiento funcional real es que el cliente
 * siempre solicita al menos una entrega — el diseño previo de
 * CLIENTE-PORTAL-1 permitía 0..N; se ajusta aquí explícitamente),
 * exactamente 1 `Descarga`, ningún tipo fuera de la lista cerrada, y sin
 * dos paradas con el mismo `orden`. Puramente sincrónica y sin acceso a
 * base de datos.
 */
export function validarParadasSolicitud(
  paradas: SolicitudParadaInput[],
): ResultadoValidacionParadas {
  if (!paradas.length) {
    return { ok: false, error: "La solicitud debe incluir al menos origen y destino." };
  }

  for (const p of paradas) {
    if (!esTipoSolicitudParadaValido(p.tipo)) {
      return { ok: false, error: `Tipo de parada no permitido: "${p.tipo}".` };
    }
    if (!p.lugarNombre?.trim()) {
      return { ok: false, error: "Cada parada necesita un lugar." };
    }
  }

  const ordenes = paradas.map((p) => p.orden);
  if (new Set(ordenes).size !== ordenes.length) {
    return { ok: false, error: "No puede haber dos paradas con el mismo orden." };
  }

  const cargas = paradas.filter((p) => p.tipo === "Carga").length;
  const entregas = paradas.filter((p) => p.tipo === "Entrega").length;
  const descargas = paradas.filter((p) => p.tipo === "Descarga").length;
  if (cargas !== 1) {
    return {
      ok: false,
      error: cargas === 0
        ? "La solicitud debe incluir exactamente un origen (Carga)."
        : "La solicitud no puede tener más de un origen (Carga).",
    };
  }
  if (entregas < 1) {
    return { ok: false, error: "La solicitud debe incluir al menos una entrega." };
  }
  if (descargas !== 1) {
    return {
      ok: false,
      error: descargas === 0
        ? "La solicitud debe incluir exactamente un destino final (Descarga)."
        : "La solicitud no puede tener más de un destino final (Descarga).",
    };
  }
  if (paradas[0]?.tipo !== "Carga") {
    return { ok: false, error: "El origen (Carga) debe ser la primera parada." };
  }
  if (paradas[paradas.length - 1]?.tipo !== "Descarga") {
    return { ok: false, error: "El destino final (Descarga) debe ser la última parada." };
  }

  return { ok: true };
}

/**
 * `cantidad_entregas` nunca se guarda como columna (ver discovery §8) —
 * siempre se deriva contando `tipo === "Entrega"`.
 */
export function contarEntregas(paradas: { tipo: string }[]): number {
  return paradas.filter((p) => p.tipo === "Entrega").length;
}

// ============================================================
// Alta de solicitud
// ============================================================

export type ParadaSolicitudEntrada = {
  lugarNombre: string;
  clienteUbicacionId?: number | null;
  referencia?: string | null;
};

export type CrearSolicitudClienteInput = {
  fechaSolicitada: string;
  horaSolicitada?: string | null;
  referenciaCliente?: string | null;
  observaciones?: string | null;
  origen: ParadaSolicitudEntrada;
  entregas: ParadaSolicitudEntrada[];
  destino: ParadaSolicitudEntrada;
};

export type ResultadoCrearSolicitud =
  | { ok: true; solicitud: SolicitudClienteDetalle }
  | { ok: false; mensaje: string };

const REFERENCIA_MAX = 120;
const OBSERVACIONES_MAX = 500;

function limpiarParada(p: ParadaSolicitudEntrada): { lugarNombre: string; clienteUbicacionId: number | null; referencia: string | null } | null {
  const lugarNombre = p.lugarNombre?.trim();
  if (!lugarNombre) return null;
  return {
    lugarNombre,
    clienteUbicacionId: p.clienteUbicacionId ?? null,
    referencia: p.referencia?.trim() || null,
  };
}

/**
 * Crea una solicitud + sus paradas en UNA transacción (rollback total si
 * cualquier parte falla). `scope` sale SIEMPRE de la sesión ya validada
 * del portal (requireClienteSession()) — nunca de datos que el
 * navegador pueda enviar; el propio tipo de `input` no tiene
 * `empresaId`/`clienteId`/`usuarioClienteId`/`estado`/`planId`/`version`,
 * así que no hay forma de que esos campos lleguen desde el cliente ni
 * por accidente.
 *
 * Reconstrucción de `orden` (CLIENTE-PORTAL-2, sección 4 del ticket): el
 * servidor SIEMPRE arma el arreglo final de paradas él mismo — Carga=1,
 * Entregas=2..N+1 en el orden en que llegaron, Descarga=último — nunca
 * confía en un `orden` enviado por el navegador (el input ni siquiera
 * acepta uno).
 */
export async function crearSolicitudCliente(
  scope: { empresaId: number; clienteId: number; usuarioClienteId: number },
  input: CrearSolicitudClienteInput,
): Promise<ResultadoCrearSolicitud> {
  const fecha = input.fechaSolicitada?.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "")) {
    return { ok: false, mensaje: "La fecha solicitada es obligatoria (formato AAAA-MM-DD)." };
  }
  if (fecha < hoyLocal()) {
    return { ok: false, mensaje: "La fecha solicitada no puede ser anterior a hoy." };
  }

  let horaSolicitada: string | null = null;
  if (input.horaSolicitada?.trim()) {
    horaSolicitada = normalizarHora(input.horaSolicitada);
    if (!horaSolicitada) {
      return { ok: false, mensaje: "La hora solicitada no es válida." };
    }
  }

  const referenciaCliente = input.referenciaCliente?.trim() || null;
  if (referenciaCliente && referenciaCliente.length > REFERENCIA_MAX) {
    return {
      ok: false,
      mensaje: `La referencia no puede superar ${REFERENCIA_MAX} caracteres.`,
    };
  }
  const observaciones = input.observaciones?.trim() || null;
  if (observaciones && observaciones.length > OBSERVACIONES_MAX) {
    return {
      ok: false,
      mensaje: `Las observaciones no pueden superar ${OBSERVACIONES_MAX} caracteres.`,
    };
  }

  const origen = limpiarParada(input.origen);
  if (!origen) return { ok: false, mensaje: "Indica el lugar de carga (origen)." };
  const destino = limpiarParada(input.destino);
  if (!destino) return { ok: false, mensaje: "Indica el lugar de descarga (destino final)." };
  if (!input.entregas?.length) {
    return { ok: false, mensaje: "Agrega al menos una entrega." };
  }
  const entregas: { lugarNombre: string; clienteUbicacionId: number | null; referencia: string | null }[] = [];
  for (const e of input.entregas) {
    const limpia = limpiarParada(e);
    if (!limpia) return { ok: false, mensaje: "Cada entrega necesita un lugar." };
    entregas.push(limpia);
  }

  // Reconstrucción server-side del orden final — ver comentario de la función.
  const paradas: (SolicitudParadaInput & { clienteUbicacionId: number | null; referencia: string | null })[] = [
    { orden: 1, tipo: "Carga", ...origen },
    ...entregas.map((e, i) => ({ orden: i + 2, tipo: "Entrega" as const, ...e })),
    { orden: entregas.length + 2, tipo: "Descarga", ...destino },
  ];
  const validacion = validarParadasSolicitud(paradas);
  if (!validacion.ok) return { ok: false, mensaje: validacion.error };

  // cliente_ubicacion_id es informativo (sin FK, ver migración) pero
  // igual se valida que, si se manda uno, pertenezca al MISMO
  // empresaId+clienteId de la sesión — nunca se acepta a ciegas una
  // ubicación de otro cliente (CLIENTE-PORTAL-2, sección 5/14).
  const ubicacionIds = [...new Set(paradas.map((p) => p.clienteUbicacionId).filter((id): id is number => id != null))];
  if (ubicacionIds.length) {
    const rows = await query<RowDataPacket[]>(
      `SELECT id FROM tms_cliente_ubicaciones
       WHERE empresa_id = ? AND cliente_id = ? AND id IN (${ubicacionIds.map(() => "?").join(",")})`,
      [scope.empresaId, scope.clienteId, ...ubicacionIds],
    );
    if (rows.length !== ubicacionIds.length) {
      return { ok: false, mensaje: "Una de las ubicaciones seleccionadas no pertenece a este cliente." };
    }
  }

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.execute<ResultSetHeader>(
      `INSERT INTO tms_solicitudes_cliente
        (empresa_id, cliente_id, creado_por_usuario_cliente_id, estado,
         fecha_solicitada, hora_solicitada, referencia_cliente, observaciones, version)
       VALUES (?, ?, ?, 'SOLICITADA', ?, ?, ?, ?, 1)`,
      [
        scope.empresaId,
        scope.clienteId,
        scope.usuarioClienteId,
        fecha,
        horaSolicitada,
        referenciaCliente,
        observaciones,
      ],
    );
    const solicitudId = Number(ins.insertId);
    for (const p of paradas) {
      await conn.execute(
        `INSERT INTO tms_solicitud_paradas
          (empresa_id, solicitud_id, orden, tipo, lugar_nombre, cliente_ubicacion_id, referencia)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [scope.empresaId, solicitudId, p.orden, p.tipo, p.lugarNombre, p.clienteUbicacionId, p.referencia],
      );
    }
    await registrarAuditoriaTx(conn, {
      empresaId: scope.empresaId,
      usuario: `cliente-portal:${scope.usuarioClienteId}`,
      accion: "crear_solicitud_cliente",
      modulo: "tms",
      detalle: `Solicitud #${solicitudId} creada por cliente #${scope.clienteId} · fecha solicitada ${fecha} · ${entregas.length} entrega(s).`,
    });
    await conn.commit();

    const solicitud = await obtenerSolicitudCliente(scope.empresaId, scope.clienteId, solicitudId);
    if (!solicitud) throw new Error("La solicitud se creó pero no se pudo releer.");
    return { ok: true, solicitud };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ============================================================
// Lectura
// ============================================================

export type SolicitudClienteResumenFila = {
  id: number;
  estado: EstadoSolicitudCliente;
  fechaSolicitada: string;
  horaSolicitada: string | null;
  referenciaCliente: string | null;
  cantidadEntregas: number;
  planId: number | null;
  creadoEn: string;
};

function mapResumenRow(r: RowDataPacket): SolicitudClienteResumenFila {
  return {
    id: Number(r.id),
    estado: String(r.estado) as EstadoSolicitudCliente,
    fechaSolicitada: toIsoDate(r.fecha_solicitada as string | Date | null) ?? "",
    horaSolicitada: r.hora_solicitada != null ? String(r.hora_solicitada) : null,
    referenciaCliente: r.referencia_cliente != null ? String(r.referencia_cliente) : null,
    cantidadEntregas: Number(r.cantidad_entregas ?? 0),
    planId: r.plan_id != null ? Number(r.plan_id) : null,
    creadoEn: String(r.creado_en),
  };
}

const SELECT_RESUMEN = `
  SELECT s.id, s.estado, s.fecha_solicitada, s.hora_solicitada, s.referencia_cliente,
         s.plan_id, s.creado_en,
         (SELECT COUNT(*) FROM tms_solicitud_paradas p
          WHERE p.solicitud_id = s.id AND p.tipo = 'Entrega') AS cantidad_entregas
  FROM tms_solicitudes_cliente s`;

/**
 * Solicitudes del cliente autenticado — SIEMPRE filtradas por
 * empresaId+clienteId (nunca solo por clienteId). Orden: más reciente
 * primero.
 */
export async function listarSolicitudesCliente(
  empresaId: number,
  clienteId: number,
  filtros?: { estado?: string; fechaDesde?: string; fechaHasta?: string; limite?: number },
): Promise<SolicitudClienteResumenFila[]> {
  const params: (string | number)[] = [empresaId, clienteId];
  let sql = `${SELECT_RESUMEN} WHERE s.empresa_id = ? AND s.cliente_id = ?`;
  if (filtros?.estado && (ESTADOS_SOLICITUD_CLIENTE as readonly string[]).includes(filtros.estado)) {
    sql += " AND s.estado = ?";
    params.push(filtros.estado);
  }
  if (filtros?.fechaDesde) {
    sql += " AND s.fecha_solicitada >= ?";
    params.push(filtros.fechaDesde);
  }
  if (filtros?.fechaHasta) {
    sql += " AND s.fecha_solicitada <= ?";
    params.push(filtros.fechaHasta);
  }
  sql += " ORDER BY s.creado_en DESC";
  if (filtros?.limite) {
    sql += " LIMIT ?";
    params.push(Math.max(1, Math.min(100, filtros.limite)));
  }
  const rows = await query<RowDataPacket[]>(sql, params);
  return rows.map(mapResumenRow);
}

export type ParadaSolicitudDetalle = {
  id: number;
  orden: number;
  tipo: TipoSolicitudParada;
  lugarNombre: string;
  clienteUbicacionId: number | null;
  referencia: string | null;
};

export type SolicitudClienteDetalle = {
  id: number;
  empresaId: number;
  clienteId: number;
  creadoPorUsuarioClienteId: number;
  creadoPorNombre: string | null;
  estado: EstadoSolicitudCliente;
  fechaSolicitada: string;
  horaSolicitada: string | null;
  referenciaCliente: string | null;
  observaciones: string | null;
  motivoRechazo: string | null;
  planId: number | null;
  version: number;
  creadoEn: string;
  actualizadoEn: string;
  paradas: ParadaSolicitudDetalle[];
  cantidadEntregas: number;
};

/**
 * Detalle de UNA solicitud — filtrado por id + empresaId + clienteId a
 * la vez (nunca solo por id). Devuelve `null` si no existe O si
 * pertenece a otro cliente/empresa — el caller (API) debe responder 404
 * en ambos casos, nunca 403 (eso confirmaría que el id existe).
 */
export async function obtenerSolicitudCliente(
  empresaId: number,
  clienteId: number,
  solicitudId: number,
): Promise<SolicitudClienteDetalle | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT s.id, s.empresa_id, s.cliente_id, s.creado_por_usuario_cliente_id, s.estado,
            s.fecha_solicitada, s.hora_solicitada, s.referencia_cliente, s.observaciones,
            s.motivo_rechazo, s.plan_id, s.version, s.creado_en, s.actualizado_en,
            u.nombre AS creado_por_nombre
     FROM tms_solicitudes_cliente s
     LEFT JOIN tms_cliente_usuarios u
       ON u.id = s.creado_por_usuario_cliente_id AND u.empresa_id = s.empresa_id
     WHERE s.id = ? AND s.empresa_id = ? AND s.cliente_id = ? LIMIT 1`,
    [solicitudId, empresaId, clienteId],
  );
  const r = rows[0];
  if (!r) return null;

  const paradasRows = await query<RowDataPacket[]>(
    `SELECT id, orden, tipo, lugar_nombre, cliente_ubicacion_id, referencia
     FROM tms_solicitud_paradas
     WHERE solicitud_id = ? AND empresa_id = ?
     ORDER BY orden`,
    [solicitudId, empresaId],
  );
  const paradas: ParadaSolicitudDetalle[] = paradasRows.map((p) => ({
    id: Number(p.id),
    orden: Number(p.orden),
    tipo: String(p.tipo) as TipoSolicitudParada,
    lugarNombre: String(p.lugar_nombre),
    clienteUbicacionId: p.cliente_ubicacion_id != null ? Number(p.cliente_ubicacion_id) : null,
    referencia: p.referencia != null ? String(p.referencia) : null,
  }));

  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    clienteId: Number(r.cliente_id),
    creadoPorUsuarioClienteId: Number(r.creado_por_usuario_cliente_id),
    creadoPorNombre: r.creado_por_nombre != null ? String(r.creado_por_nombre) : null,
    estado: String(r.estado) as EstadoSolicitudCliente,
    fechaSolicitada: toIsoDate(r.fecha_solicitada as string | Date | null) ?? "",
    horaSolicitada: r.hora_solicitada != null ? String(r.hora_solicitada) : null,
    referenciaCliente: r.referencia_cliente != null ? String(r.referencia_cliente) : null,
    observaciones: r.observaciones != null ? String(r.observaciones) : null,
    motivoRechazo: r.motivo_rechazo != null ? String(r.motivo_rechazo) : null,
    planId: r.plan_id != null ? Number(r.plan_id) : null,
    version: Number(r.version ?? 1),
    creadoEn: String(r.creado_en),
    actualizadoEn: String(r.actualizado_en),
    paradas,
    cantidadEntregas: contarEntregas(paradas),
  };
}

export type ResumenSolicitudesCliente = {
  pendientes: number;
  programadas: number;
  rechazadasCanceladas: number;
  total: number;
  recientes: SolicitudClienteResumenFila[];
};

/**
 * Números del dashboard — derivados en vivo de tms_solicitudes_cliente,
 * nunca inventados/hardcodeados. `pendientes` = SOLICITADA + EN_REVISION
 * (todavía a la espera de Operaciones); `programadas` = PROGRAMADA;
 * `rechazadasCanceladas` = RECHAZADA + CANCELADA; `total` = todas las
 * solicitudes del cliente (sin ventana de tiempo — no se inventa un
 * corte de "recientes" que el ticket no especifica).
 */
export async function resumenSolicitudesCliente(
  empresaId: number,
  clienteId: number,
): Promise<ResumenSolicitudesCliente> {
  const rows = await query<RowDataPacket[]>(
    `SELECT estado, COUNT(*) AS n FROM tms_solicitudes_cliente
     WHERE empresa_id = ? AND cliente_id = ? GROUP BY estado`,
    [empresaId, clienteId],
  );
  const porEstado = new Map<string, number>();
  for (const r of rows) porEstado.set(String(r.estado), Number(r.n));

  const pendientes = (porEstado.get("SOLICITADA") ?? 0) + (porEstado.get("EN_REVISION") ?? 0);
  const programadas = porEstado.get("PROGRAMADA") ?? 0;
  const rechazadasCanceladas = (porEstado.get("RECHAZADA") ?? 0) + (porEstado.get("CANCELADA") ?? 0);
  const total = [...porEstado.values()].reduce((a, b) => a + b, 0);

  const recientes = await listarSolicitudesCliente(empresaId, clienteId, { limite: 5 });

  return { pendientes, programadas, rechazadasCanceladas, total, recientes };
}
