import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query, type SqlParams } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";

/**
 * TMS-GASTOS-REPORTES-1 (fase 1) — solicitudes de fondo (anticipo/caja
 * chica para un viaje u operación), con sus líneas de gasto ESTIMADO.
 * Es un objeto DISTINTO de tms_gastos_operativos (el gasto ya incurrido):
 * una solicitud de fondo es la petición previa de dinero, sus líneas no
 * se copian automáticamente a gastos operativos en esta fase 1.
 *
 * Reutiliza empleados (requirente/autorizante) — no duplica el maestro de
 * personal. Auditoría vía src/lib/auditoria.ts (registrarAuditoriaTx),
 * NO se crea una bitácora paralela.
 *
 * Esquema: NO se crea/altera desde este módulo — asume que
 * sql/migrate-2026-09-tms-gastos-reportes.sql ya se aplicó manualmente.
 */

async function queryConn<T extends RowDataPacket[]>(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<T> {
  const [rows] = await conn.query<T>(sql, params);
  return rows;
}
async function executeConn(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<ResultSetHeader> {
  const [result] = await conn.execute<ResultSetHeader>(sql, params);
  return result;
}

export const ESTADOS_FONDO = ["Pendiente", "Autorizada", "Rechazada", "Liquidada"] as const;
export type EstadoFondo = (typeof ESTADOS_FONDO)[number];

/** Pendiente -> Autorizada -> Liquidada, o Rechazada en cualquier punto antes de Liquidada. Nunca hacia atrás. */
const TRANSICIONES_FONDO: Record<EstadoFondo, EstadoFondo[]> = {
  Pendiente: ["Autorizada", "Rechazada"],
  Autorizada: ["Liquidada", "Rechazada"],
  Rechazada: [],
  Liquidada: [],
};

export type LineaFondo = {
  id: number;
  categoria: string;
  descripcion: string | null;
  cantidad: number;
  monto: number;
  orden: number;
};

export type SolicitudFondo = {
  id: number;
  empresaId: number;
  codigo: string;
  requirenteEmpleadoId: number | null;
  requirenteNombre: string | null;
  fechaRequerimiento: string;
  total: number;
  autorizanteEmpleadoId: number | null;
  autorizanteNombre: string | null;
  estado: EstadoFondo;
  autorizadoEn: string | null;
  rechazadoEn: string | null;
  motivoRechazo: string | null;
  liquidadoEn: string | null;
  observaciones: string | null;
  creadoPor: string | null;
  creadoEn: string | null;
  lineas: LineaFondo[];
};

function mapLinea(r: RowDataPacket): LineaFondo {
  return {
    id: Number(r.id),
    categoria: String(r.categoria),
    descripcion: r.descripcion != null ? String(r.descripcion) : null,
    cantidad: Number(r.cantidad ?? 1),
    monto: Number(r.monto ?? 0),
    orden: Number(r.orden ?? 0),
  };
}

function mapSolicitud(r: RowDataPacket): Omit<SolicitudFondo, "lineas"> {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    codigo: String(r.codigo),
    requirenteEmpleadoId: r.requirente_empleado_id != null ? Number(r.requirente_empleado_id) : null,
    requirenteNombre: r.requirente_nombre != null ? String(r.requirente_nombre) : null,
    fechaRequerimiento: String(r.fecha_requerimiento),
    total: Number(r.total ?? 0),
    autorizanteEmpleadoId: r.autorizante_empleado_id != null ? Number(r.autorizante_empleado_id) : null,
    autorizanteNombre: r.autorizante_nombre != null ? String(r.autorizante_nombre) : null,
    estado: String(r.estado) as EstadoFondo,
    autorizadoEn: r.autorizado_en != null ? String(r.autorizado_en) : null,
    rechazadoEn: r.rechazado_en != null ? String(r.rechazado_en) : null,
    motivoRechazo: r.motivo_rechazo != null ? String(r.motivo_rechazo) : null,
    liquidadoEn: r.liquidado_en != null ? String(r.liquidado_en) : null,
    observaciones: r.observaciones != null ? String(r.observaciones) : null,
    creadoPor: r.creado_por != null ? String(r.creado_por) : null,
    creadoEn: r.creado_en != null ? String(r.creado_en) : null,
  };
}

const SELECT_SOLICITUD = `
  SELECT s.id, s.empresa_id, s.codigo, s.requirente_empleado_id,
         COALESCE(s.requirente_nombre, req.nombre) AS requirente_nombre,
         DATE_FORMAT(s.fecha_requerimiento, '%Y-%m-%d') AS fecha_requerimiento,
         s.total, s.autorizante_empleado_id,
         COALESCE(s.autorizante_nombre, aut.nombre) AS autorizante_nombre,
         s.estado, s.autorizado_en, s.rechazado_en, s.motivo_rechazo, s.liquidado_en,
         s.observaciones, s.creado_por, s.creado_en
  FROM tms_solicitudes_fondo s
  LEFT JOIN empleados req ON req.id = s.requirente_empleado_id
  LEFT JOIN empleados aut ON aut.id = s.autorizante_empleado_id
`;

export type FiltrosFondos = {
  estado?: EstadoFondo;
  fechaDesde?: string;
  fechaHasta?: string;
};

export async function listarSolicitudesFondo(
  empresaId: number,
  filtros: FiltrosFondos = {},
): Promise<SolicitudFondo[]> {
  const condiciones = ["s.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (filtros.estado) { condiciones.push("s.estado = ?"); params.push(filtros.estado); }
  if (filtros.fechaDesde) { condiciones.push("s.fecha_requerimiento >= ?"); params.push(filtros.fechaDesde); }
  if (filtros.fechaHasta) { condiciones.push("s.fecha_requerimiento <= ?"); params.push(filtros.fechaHasta); }
  const rows = await query<RowDataPacket[]>(
    `${SELECT_SOLICITUD} WHERE ${condiciones.join(" AND ")} ORDER BY s.fecha_requerimiento DESC, s.id DESC`,
    params,
  );
  return rows.map((r) => ({ ...mapSolicitud(r), lineas: [] }));
}

export async function obtenerSolicitudFondo(empresaId: number, id: number): Promise<SolicitudFondo | null> {
  const rows = await query<RowDataPacket[]>(`${SELECT_SOLICITUD} WHERE s.id = ? AND s.empresa_id = ? LIMIT 1`, [id, empresaId]);
  if (!rows[0]) return null;
  const lineas = await query<RowDataPacket[]>(
    `SELECT id, categoria, descripcion, cantidad, monto, orden FROM tms_solicitud_fondo_lineas
     WHERE empresa_id = ? AND solicitud_id = ? ORDER BY orden, id`,
    [empresaId, id],
  );
  return { ...mapSolicitud(rows[0]), lineas: lineas.map(mapLinea) };
}

export type LineaFondoInput = {
  categoria: string;
  descripcion?: string | null;
  cantidad?: number;
  monto: number;
};

export type SolicitudFondoInput = {
  requirenteEmpleadoId?: number | null;
  requirenteNombre?: string | null;
  fechaRequerimiento: string;
  observaciones?: string | null;
  lineas: LineaFondoInput[];
};

function calcularTotal(lineas: LineaFondoInput[]): number {
  return lineas.reduce((s, l) => s + (l.cantidad ?? 1) * l.monto, 0);
}

export async function crearSolicitudFondo(
  empresaId: number,
  input: SolicitudFondoInput,
  creadoPor?: string | null,
): Promise<SolicitudFondo> {
  if (!input.fechaRequerimiento) throw new Error("Fecha de requerimiento requerida.");
  if (!input.requirenteEmpleadoId && !input.requirenteNombre?.trim()) {
    throw new Error("Requirente requerido (empleado o nombre).");
  }
  if (!input.lineas.length) throw new Error("La solicitud necesita al menos una línea de gasto.");
  for (const l of input.lineas) {
    if (!l.categoria) throw new Error("Cada línea necesita una categoría.");
    if (!(l.monto > 0)) throw new Error("Cada línea necesita un monto mayor a cero.");
  }
  const total = calcularTotal(input.lineas);

  const conn = await getPool().getConnection();
  let solicitudId = 0;
  try {
    await conn.beginTransaction();
    const r = await executeConn(conn,
      `INSERT INTO tms_solicitudes_fondo
        (empresa_id, codigo, requirente_empleado_id, requirente_nombre, fecha_requerimiento, total, observaciones, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        "", // se completa abajo con un código estable derivado del id, mismo criterio que clientes.codigo
        input.requirenteEmpleadoId ?? null,
        input.requirenteNombre?.trim() || null,
        input.fechaRequerimiento,
        total,
        input.observaciones?.trim() || null,
        creadoPor ?? null,
      ],
    );
    solicitudId = Number(r.insertId);
    const codigo = `FONDO-${String(solicitudId).padStart(6, "0")}`;
    await executeConn(conn, `UPDATE tms_solicitudes_fondo SET codigo = ? WHERE id = ? AND empresa_id = ?`, [codigo, solicitudId, empresaId]);
    let orden = 0;
    for (const l of input.lineas) {
      await executeConn(conn,
        `INSERT INTO tms_solicitud_fondo_lineas (empresa_id, solicitud_id, categoria, descripcion, cantidad, monto, orden)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, solicitudId, l.categoria, l.descripcion?.trim() || null, l.cantidad ?? 1, l.monto, orden],
      );
      orden += 1;
    }
    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario: creadoPor ?? null,
      accion: "crear",
      modulo: "tms_fondos",
      detalle: `Solicitud de fondo #${solicitudId} ${codigo} creada por Q${total.toFixed(2)}.`,
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  const creada = await obtenerSolicitudFondo(empresaId, solicitudId);
  if (!creada) throw new Error("No se pudo crear la solicitud de fondo.");
  return creada;
}

export type AccionFondo = "autorizar" | "rechazar" | "liquidar";

const ACCION_A_ESTADO: Record<AccionFondo, EstadoFondo> = {
  autorizar: "Autorizada",
  rechazar: "Rechazada",
  liquidar: "Liquidada",
};

/**
 * Transición de estado — SIEMPRE valida contra TRANSICIONES_FONDO (nunca
 * salta de Pendiente a Liquidada, nunca reabre una Rechazada/Liquidada).
 * Deja rastro en `auditoria` (mismo mecanismo que el resto de la app).
 */
export async function cambiarEstadoSolicitudFondo(
  empresaId: number,
  id: number,
  accion: AccionFondo,
  opts: { usuario?: string | null; autorizanteEmpleadoId?: number | null; autorizanteNombre?: string | null; motivoRechazo?: string | null } = {},
): Promise<SolicitudFondo | null> {
  if (accion === "rechazar" && !opts.motivoRechazo?.trim()) {
    throw new Error("El rechazo requiere un motivo.");
  }
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const rows = await queryConn<RowDataPacket[]>(conn,
      `SELECT id, estado FROM tms_solicitudes_fondo WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [id, empresaId],
    );
    if (!rows[0]) { await conn.rollback(); return null; }
    const estadoActual = String(rows[0].estado) as EstadoFondo;
    const destino = ACCION_A_ESTADO[accion];
    if (!TRANSICIONES_FONDO[estadoActual].includes(destino)) {
      throw new Error(`No se puede pasar de "${estadoActual}" a "${destino}".`);
    }
    if (destino === "Autorizada") {
      await executeConn(conn,
        `UPDATE tms_solicitudes_fondo SET estado = ?, autorizante_empleado_id = ?, autorizante_nombre = ?, autorizado_en = NOW()
         WHERE id = ? AND empresa_id = ?`,
        [destino, opts.autorizanteEmpleadoId ?? null, opts.autorizanteNombre?.trim() || null, id, empresaId],
      );
    } else if (destino === "Rechazada") {
      await executeConn(conn,
        `UPDATE tms_solicitudes_fondo SET estado = ?, rechazado_en = NOW(), motivo_rechazo = ? WHERE id = ? AND empresa_id = ?`,
        [destino, opts.motivoRechazo!.trim(), id, empresaId],
      );
    } else {
      await executeConn(conn,
        `UPDATE tms_solicitudes_fondo SET estado = ?, liquidado_en = NOW() WHERE id = ? AND empresa_id = ?`,
        [destino, id, empresaId],
      );
    }
    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario: opts.usuario ?? null,
      accion,
      modulo: "tms_fondos",
      detalle: `Solicitud de fondo #${id}: ${estadoActual} -> ${destino}.${opts.motivoRechazo ? ` Motivo: ${opts.motivoRechazo}` : ""}`,
    });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return obtenerSolicitudFondo(empresaId, id);
}
