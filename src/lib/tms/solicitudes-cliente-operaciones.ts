import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoria, registrarAuditoriaTx } from "@/lib/auditoria";
import { guardarParadasPlan, type ParadaInput } from "@/lib/tms/paradas";
import { asegurarCodigoPlanUnico } from "@/lib/tms/codigo-plan";
import { toIsoDate } from "@/lib/rrhh/dates";
import {
  contarEntregas,
  ESTADOS_SOLICITUD_CLIENTE,
  type EstadoSolicitudCliente,
  type ParadaSolicitudDetalle,
  type TipoSolicitudParada,
} from "@/lib/tms/solicitudes-cliente";

/**
 * CLIENTE-PORTAL-3 — lado de Operaciones/staff de
 * tms_solicitudes_cliente/tms_solicitud_paradas. A diferencia de
 * src/lib/tms/solicitudes-cliente.ts (portal del cliente, SIEMPRE
 * scoped por empresaId+clienteId), este módulo es scoped SOLO por
 * empresaId — el staff de una empresa puede ver/administrar las
 * solicitudes de TODOS sus clientes, nunca las de otra empresa (mismo
 * criterio anti-IDOR, un nivel más ancho).
 *
 * NO crea ni altera esquema — reutiliza exactamente
 * tms_solicitudes_cliente/tms_solicitud_paradas (ya aplicadas y
 * endurecidas en producción) y tms_planes_viaje/tms_plan_paradas (ya
 * existentes). Investigado antes de escribir: el creador real de planes
 * (POST /api/empresas/[slug]/tms/planes) es un handler HTTP monolítico
 * con lógica de piloto/unidad/traslapes/viáticos que NO aplica aquí (el
 * cliente nunca asigna piloto/unidad — ver alcance 10 del ticket) — se
 * reutilizan sus 2 piezas genuinamente reutilizables
 * (asegurarCodigoPlanUnico, guardarParadasPlan) en vez de reimplementar
 * generación de código o guardado de paradas, sin arrastrar la parte de
 * disponibilidad/traslapes que no aplica a una conversión sin
 * piloto/unidad.
 */

/**
 * AJUSTE PRE-MERGE PR #173 (punto 1) — el `catch` del reintento de
 * código de plan (ver programarSolicitud más abajo) solo debe capturar
 * la violación real del UNIQUE KEY (empresa_id, codigo), NUNCA
 * cualquier error (FK, dato inválido, timeout, error de esquema…). Un
 * error genérico capturado ahí como si fuera "código duplicado"
 * generaría otro código y reintentaría indefinidamente en vez de
 * abortar con rollback — escondiendo el error real. Mismo patrón ya
 * usado en el proyecto (ver src/lib/facturacion/facturas.ts,
 * esDuplicadoNumeroFactura).
 */
function esDuplicadoCodigoPlan(e: unknown): boolean {
  const err = e as { code?: string; errno?: number };
  return err?.code === "ER_DUP_ENTRY" || err?.errno === 1062;
}

export type SolicitudClienteInternaFila = {
  id: number;
  clienteId: number;
  clienteNombre: string;
  estado: EstadoSolicitudCliente;
  fechaSolicitada: string;
  horaSolicitada: string | null;
  referenciaCliente: string | null;
  cantidadEntregas: number;
  planId: number | null;
  creadoEn: string;
};

function mapFilaInterna(r: RowDataPacket): SolicitudClienteInternaFila {
  return {
    id: Number(r.id),
    clienteId: Number(r.cliente_id),
    clienteNombre: String(r.cliente_nombre),
    estado: String(r.estado) as EstadoSolicitudCliente,
    fechaSolicitada: toIsoDate(r.fecha_solicitada as string | Date | null) ?? "",
    horaSolicitada: r.hora_solicitada != null ? String(r.hora_solicitada) : null,
    referenciaCliente: r.referencia_cliente != null ? String(r.referencia_cliente) : null,
    cantidadEntregas: Number(r.cantidad_entregas ?? 0),
    planId: r.plan_id != null ? Number(r.plan_id) : null,
    creadoEn: String(r.creado_en),
  };
}

const SELECT_INTERNO = `
  SELECT s.id, s.cliente_id, c.nombre AS cliente_nombre, s.estado,
         s.fecha_solicitada, s.hora_solicitada, s.referencia_cliente,
         s.plan_id, s.creado_en,
         (SELECT COUNT(*) FROM tms_solicitud_paradas p
          WHERE p.solicitud_id = s.id AND p.tipo = 'Entrega') AS cantidad_entregas
  FROM tms_solicitudes_cliente s
  JOIN tms_clientes c ON c.id = s.cliente_id AND c.empresa_id = s.empresa_id`;

/**
 * Bandeja interna — SOLO scoped por empresaId (el staff ve las
 * solicitudes de todos sus clientes, nunca solo las de uno). Filtros
 * todos opcionales.
 */
export async function listarSolicitudesClienteInterno(
  empresaId: number,
  filtros?: { estado?: string; clienteId?: number; fechaDesde?: string; fechaHasta?: string },
): Promise<SolicitudClienteInternaFila[]> {
  const params: (string | number)[] = [empresaId];
  let sql = `${SELECT_INTERNO} WHERE s.empresa_id = ?`;
  if (filtros?.estado && (ESTADOS_SOLICITUD_CLIENTE as readonly string[]).includes(filtros.estado)) {
    sql += " AND s.estado = ?";
    params.push(filtros.estado);
  }
  if (filtros?.clienteId) {
    sql += " AND s.cliente_id = ?";
    params.push(filtros.clienteId);
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
  const rows = await query<RowDataPacket[]>(sql, params);
  return rows.map(mapFilaInterna);
}

export type SolicitudClienteInternaDetalle = SolicitudClienteInternaFila & {
  observaciones: string | null;
  motivoRechazo: string | null;
  version: number;
  creadoPorUsuarioClienteId: number;
  creadoPorNombre: string | null;
  actualizadoEn: string;
  planCodigo: string | null;
  paradas: ParadaSolicitudDetalle[];
};

/**
 * Detalle interno — solo por id + empresaId (NO por clienteId: el staff
 * puede abrir la solicitud de cualquier cliente de su empresa). `null`
 * si no existe o pertenece a otra empresa.
 */
export async function obtenerSolicitudClienteInterno(
  empresaId: number,
  solicitudId: number,
): Promise<SolicitudClienteInternaDetalle | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT s.id, s.cliente_id, c.nombre AS cliente_nombre, s.estado,
            s.fecha_solicitada, s.hora_solicitada, s.referencia_cliente,
            s.observaciones, s.motivo_rechazo, s.plan_id, s.version,
            s.creado_por_usuario_cliente_id, s.creado_en, s.actualizado_en,
            u.nombre AS creado_por_nombre, p.codigo AS plan_codigo
     FROM tms_solicitudes_cliente s
     JOIN tms_clientes c ON c.id = s.cliente_id AND c.empresa_id = s.empresa_id
     LEFT JOIN tms_cliente_usuarios u
       ON u.id = s.creado_por_usuario_cliente_id AND u.empresa_id = s.empresa_id
     LEFT JOIN tms_planes_viaje p ON p.id = s.plan_id AND p.empresa_id = s.empresa_id
     WHERE s.id = ? AND s.empresa_id = ? LIMIT 1`,
    [solicitudId, empresaId],
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
    clienteId: Number(r.cliente_id),
    clienteNombre: String(r.cliente_nombre),
    estado: String(r.estado) as EstadoSolicitudCliente,
    fechaSolicitada: toIsoDate(r.fecha_solicitada as string | Date | null) ?? "",
    horaSolicitada: r.hora_solicitada != null ? String(r.hora_solicitada) : null,
    referenciaCliente: r.referencia_cliente != null ? String(r.referencia_cliente) : null,
    observaciones: r.observaciones != null ? String(r.observaciones) : null,
    motivoRechazo: r.motivo_rechazo != null ? String(r.motivo_rechazo) : null,
    planId: r.plan_id != null ? Number(r.plan_id) : null,
    planCodigo: r.plan_codigo != null ? String(r.plan_codigo) : null,
    version: Number(r.version ?? 1),
    creadoPorUsuarioClienteId: Number(r.creado_por_usuario_cliente_id),
    creadoPorNombre: r.creado_por_nombre != null ? String(r.creado_por_nombre) : null,
    creadoEn: String(r.creado_en),
    actualizadoEn: String(r.actualizado_en),
    cantidadEntregas: contarEntregas(paradas),
    paradas,
  };
}

export type ResultadoTransicion =
  | { ok: true }
  | { ok: false; status: 404; mensaje: string }
  | { ok: false; status: 409; mensaje: string };

/**
 * Helper compartido por tomarEnRevisionSolicitud/rechazarSolicitud:
 * intenta el UPDATE condicional (compare-and-swap por estado+version,
 * SIN lock explícito — optimista, suficiente para una transición de un
 * solo campo sobre una sola fila). Si `affectedRows` da 0, distingue
 * "no existe para esta empresa" (404 — nunca revela si el id existe en
 * otra empresa) de "existe pero el estado/version ya cambiaron" (409 —
 * conflicto real de concurrencia, ej. doble clic o dos operadores a la
 * vez).
 */
async function transicionCondicional(
  empresaId: number,
  solicitudId: number,
  sql: string,
  params: (string | number)[],
): Promise<ResultadoTransicion> {
  const result = await execute(sql, params);
  if (result.affectedRows > 0) return { ok: true };

  const existe = await query<RowDataPacket[]>(
    `SELECT id FROM tms_solicitudes_cliente WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [solicitudId, empresaId],
  );
  if (!existe[0]) {
    return { ok: false, status: 404, mensaje: "Solicitud no encontrada." };
  }
  return {
    ok: false,
    status: 409,
    mensaje: "La solicitud fue modificada por otra persona. Actualiza la página e inténtalo de nuevo.",
  };
}

/**
 * SOLICITADA -> EN_REVISION. Actualización protegida por estado+version
 * (compare-and-swap) — nunca confía en que el frontend mande el estado
 * correcto; si `version` está desactualizada o el estado ya cambió, 409.
 */
export async function tomarEnRevisionSolicitud(
  empresaId: number,
  solicitudId: number,
  version: number,
  usuarioInterno: string,
): Promise<ResultadoTransicion> {
  const r = await transicionCondicional(
    empresaId,
    solicitudId,
    `UPDATE tms_solicitudes_cliente
     SET estado = 'EN_REVISION', version = version + 1
     WHERE id = ? AND empresa_id = ? AND estado = 'SOLICITADA' AND version = ?`,
    [solicitudId, empresaId, version],
  );
  if (r.ok) {
    await registrarAuditoria({
      empresaId,
      usuario: usuarioInterno,
      accion: "tomar_en_revision_solicitud_cliente",
      modulo: "tms",
      detalle: `Solicitud #${solicitudId} pasó a EN_REVISION.`,
    });
  }
  return r;
}

const MOTIVO_RECHAZO_MAX = 500;

/**
 * SOLICITADA|EN_REVISION -> RECHAZADA. Exige motivo_rechazo (mínimo
 * razonable, máximo 500 — mismo límite de la columna).
 */
export async function rechazarSolicitud(
  empresaId: number,
  solicitudId: number,
  version: number,
  motivo: string,
  usuarioInterno: string,
): Promise<ResultadoTransicion | { ok: false; status: 400; mensaje: string }> {
  const motivoLimpio = motivo?.trim() ?? "";
  if (motivoLimpio.length < 5) {
    return { ok: false, status: 400, mensaje: "Indica un motivo de rechazo (mínimo 5 caracteres)." };
  }
  if (motivoLimpio.length > MOTIVO_RECHAZO_MAX) {
    return {
      ok: false,
      status: 400,
      mensaje: `El motivo no puede superar ${MOTIVO_RECHAZO_MAX} caracteres.`,
    };
  }
  const r = await transicionCondicional(
    empresaId,
    solicitudId,
    `UPDATE tms_solicitudes_cliente
     SET estado = 'RECHAZADA', motivo_rechazo = ?, version = version + 1
     WHERE id = ? AND empresa_id = ? AND estado IN ('SOLICITADA', 'EN_REVISION') AND version = ?`,
    [motivoLimpio, solicitudId, empresaId, version],
  );
  if (r.ok) {
    await registrarAuditoria({
      empresaId,
      usuario: usuarioInterno,
      accion: "rechazar_solicitud_cliente",
      modulo: "tms",
      detalle: `Solicitud #${solicitudId} rechazada.`,
    });
  }
  return r;
}

export type ResultadoProgramar =
  | { ok: true; planId: number; planCodigo: string }
  | { ok: false; status: 404; mensaje: string }
  | { ok: false; status: 409; mensaje: string };

/**
 * Conversión solicitud -> plan. La pieza crítica del ticket.
 *
 * TODO dentro de UNA transacción:
 *  1. SELECT ... FOR UPDATE de la solicitud (bloquea contra dos
 *     conversiones concurrentes de la misma fila — doble clic, dos
 *     operadores).
 *  2. Si no existe para esta empresa -> 404 (rollback).
 *  3. Si ya tiene plan_id (ya programada) -> 409 "La solicitud ya fue
 *     programada." SIN crear un segundo plan (idempotencia/doble clic).
 *  4. Si estado != EN_REVISION -> 409 (no es válido programar desde
 *     SOLICITADA directamente en este ticket — ver alcance 2).
 *  5. Si version no coincide -> 409 (conflicto de concurrencia).
 *  6. Verificar que el cliente TMS (solicitud.cliente_id) sigue
 *     existiendo en esta empresa.
 *  7. Generar código único (asegurarCodigoPlanUnico, reutilizado) e
 *     INSERT en tms_planes_viaje con
 *     empresa_id/cliente_id = LOS DE LA SOLICITUD (nunca de otra
 *     fuente) — la igualdad empresa+cliente entre solicitud y plan
 *     queda garantizada por construcción, no solo por la FK.
 *     piloto_id/unidad_id/auxiliar_id quedan NULL a propósito (alcance
 *     10: Operaciones los asigna después, en Programación — no se
 *     duplica esa pantalla aquí).
 *  8. Copiar las paradas de tms_solicitud_paradas a tms_plan_paradas
 *     reutilizando guardarParadasPlan (mismo orden, mismo tipo, mismo
 *     lugar_nombre, mismo cliente_ubicacion_id — ver nota sobre
 *     `referencia` más abajo).
 *  9. UPDATE de la solicitud: estado=PROGRAMADA, plan_id=nuevo,
 *     version+1, motivo_rechazo=NULL.
 *  10. Auditoría.
 *  11. commit.
 * Cualquier fallo en cualquier paso -> rollback total (nunca queda un
 * plan creado con la solicitud todavía en EN_REVISION).
 */
export async function programarSolicitud(
  empresaId: number,
  solicitudId: number,
  version: number,
  usuarioInterno: string,
): Promise<ResultadoProgramar> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, empresa_id, cliente_id, estado, plan_id, version,
              fecha_solicitada, hora_solicitada, referencia_cliente, observaciones
       FROM tms_solicitudes_cliente
       WHERE id = ? AND empresa_id = ?
       FOR UPDATE`,
      [solicitudId, empresaId],
    );
    const solicitud = rows[0];
    if (!solicitud) {
      await conn.rollback();
      return { ok: false, status: 404, mensaje: "Solicitud no encontrada." };
    }
    if (solicitud.plan_id != null) {
      await conn.rollback();
      return { ok: false, status: 409, mensaje: "La solicitud ya fue programada." };
    }
    if (String(solicitud.estado) !== "EN_REVISION") {
      await conn.rollback();
      return {
        ok: false,
        status: 409,
        mensaje: "La solicitud debe estar en revisión antes de programarse.",
      };
    }
    if (Number(solicitud.version) !== version) {
      await conn.rollback();
      return {
        ok: false,
        status: 409,
        mensaje: "La solicitud fue modificada por otra persona. Actualiza la página e inténtalo de nuevo.",
      };
    }

    const clienteId = Number(solicitud.cliente_id);
    const [clienteRows] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM tms_clientes WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [clienteId, empresaId],
    );
    if (!clienteRows[0]) {
      await conn.rollback();
      return { ok: false, status: 409, mensaje: "El cliente de esta solicitud ya no existe." };
    }

    const paradasRows = await conn.query<RowDataPacket[]>(
      `SELECT orden, tipo, lugar_nombre, cliente_ubicacion_id, referencia
       FROM tms_solicitud_paradas
       WHERE solicitud_id = ? AND empresa_id = ?
       ORDER BY orden`,
      [solicitudId, empresaId],
    ).then(([r]) => r);

    const fechaPlan = toIsoDate(solicitud.fecha_solicitada as string | Date | null) ?? "";
    let codigoFinal = await asegurarCodigoPlanUnico(empresaId, fechaPlan, null);
    let planId = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [insertResult] = await conn.execute<ResultSetHeader>(
          `INSERT INTO tms_planes_viaje
             (empresa_id, codigo, cliente_id, fecha_plan, hora_carga,
              referencia_cliente, notas, estado)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'Programado')`,
          [
            empresaId,
            codigoFinal,
            clienteId,
            fechaPlan,
            solicitud.hora_solicitada != null ? String(solicitud.hora_solicitada) : null,
            solicitud.referencia_cliente != null ? String(solicitud.referencia_cliente) : null,
            solicitud.observaciones != null ? String(solicitud.observaciones) : null,
          ],
        );
        planId = Number(insertResult.insertId);
        break;
      } catch (err) {
        // AJUSTE PRE-MERGE PR #173 (punto 1): SOLO un choque real del
        // UNIQUE KEY (empresa_id, codigo) reintenta con otro código. Un
        // error de cualquier otro tipo (FK, dato inválido, timeout,
        // esquema…) se propaga tal cual — el catch exterior de la
        // función hace el rollback real y devuelve el error verdadero,
        // en vez de esconderlo detrás de un falso "código duplicado".
        if (!esDuplicadoCodigoPlan(err)) throw err;
        codigoFinal = await asegurarCodigoPlanUnico(empresaId, fechaPlan, null);
      }
    }
    if (!planId) {
      await conn.rollback();
      return {
        ok: false,
        status: 409,
        mensaje: "No se pudo generar un código de plan único. Intenta de nuevo.",
      };
    }

    // AJUSTE PRE-MERGE PR #173 (punto 2): copia EXACTA — lugar_nombre,
    // tipo y cliente_ubicacion_id se copian sin modificar, en el MISMO
    // orden (ya vienen ORDER BY orden). Ya NO se concatena `referencia`
    // a `lugar_nombre`: eso alteraba el dato histórico exacto que el
    // cliente solicitó, podía truncar cualquiera de los dos campos, y
    // tms_plan_paradas no tiene (ni este ticket crea) una columna
    // `referencia` propia. La referencia completa de cada parada sigue
    // disponible tal cual en tms_solicitud_paradas — la solicitud nunca
    // se borra ni se modifica al programar, y queda enlazada al plan
    // via tms_solicitudes_cliente.plan_id, así que el dato fuente no se
    // pierde, solo no se duplica en el modelo del plan.
    //
    // RIESGO PENDIENTE documentado explícitamente: si en una fase
    // posterior el piloto necesita ver la referencia de una parada
    // (dirección/nota) directamente en el Portal del Piloto sin tener
    // que consultar la solicitud original, hace falta un ticket
    // explícito de modelo (agregar una columna `referencia` a
    // tms_plan_paradas, o algún mecanismo de propagación) — no se
    // resuelve aquí, a propósito, para no inventar SQL fuera de
    // alcance.
    const paradasPlan: ParadaInput[] = paradasRows.map((p) => ({
      lugarNombre: String(p.lugar_nombre),
      tipo: String(p.tipo) as TipoSolicitudParada,
      clienteUbicacionId: p.cliente_ubicacion_id != null ? Number(p.cliente_ubicacion_id) : null,
    }));
    const rParadas = await guardarParadasPlan(empresaId, planId, paradasPlan, conn);
    if (!rParadas.ok) {
      await conn.rollback();
      return { ok: false, status: 409, mensaje: rParadas.error };
    }

    await conn.execute(
      `UPDATE tms_solicitudes_cliente
       SET estado = 'PROGRAMADA', plan_id = ?, version = version + 1, motivo_rechazo = NULL
       WHERE id = ? AND empresa_id = ?`,
      [planId, solicitudId, empresaId],
    );

    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario: usuarioInterno,
      accion: "programar_solicitud_cliente",
      modulo: "tms",
      detalle: `Solicitud #${solicitudId} (cliente #${clienteId}) programada como plan #${planId} (${codigoFinal}).`,
    });

    await conn.commit();
    return { ok: true, planId, planCodigo: codigoFinal };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
