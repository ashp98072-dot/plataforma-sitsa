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

/**
 * AISLAMIENTO MULTIEMPRESA (corrección post-revisión PR #204) — mismo
 * criterio que validarReferenciasGasto en gastos.ts: valida ANTES de
 * escribir que el empleado (requirente/autorizante) pertenezca a la
 * MISMA empresa, aunque el id exista en otra. La FK compuesta
 * (empresa_id, xxx_empleado_id) en la base es la garantía real; esto es
 * la primera línea de defensa, con un mensaje claro.
 */
async function validarEmpleadoDeEmpresaTx(
  conn: PoolConnection,
  empresaId: number,
  empleadoId: number | null | undefined,
  etiqueta: string,
): Promise<void> {
  if (empleadoId == null) return;
  const rows = await queryConn<RowDataPacket[]>(conn, "SELECT id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [empleadoId, empresaId]);
  if (!rows[0]) throw new Error(`El ${etiqueta} indicado no pertenece a esta empresa.`);
}

/**
 * SOLICITUD-FONDOS-REPORTE-1 — resuelve el SNAPSHOT de una línea
 * (nombre/cargo del empleado, placa del vehículo, nombre del cliente, y
 * la fecha del viaje) SIEMPRE del lado del servidor, releyendo cada
 * catálogo por (id, empresa_id) dentro de la MISMA transacción — mismo
 * criterio de seguridad que resolverSnapshotRuta en cotizaciones.ts:
 * nunca se confía en un nombre/placa/cargo que el cliente HTTP pretenda
 * haber copiado. Si algún id no pertenece a esta empresa, se rechaza —
 * nunca se acepta silenciosamente una referencia de otra empresa.
 *
 * `fechaViaje` explícita del caller SIEMPRE gana; si no vino pero sí hay
 * `planId`, se completa con la fecha real de ese plan (nunca al revés:
 * un planId no puede pisar una fecha que el usuario ya escribió a mano).
 */
async function resolverSnapshotLineaTx(
  conn: PoolConnection,
  empresaId: number,
  input: Pick<LineaFondoInput, "empleadoId" | "vehiculoId" | "clienteId" | "planId" | "fechaViaje">,
): Promise<{ empleadoNombre: string | null; cargo: string | null; placa: string | null; clienteNombre: string | null; fechaViaje: string | null }> {
  let empleadoNombre: string | null = null;
  let cargo: string | null = null;
  if (input.empleadoId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn, "SELECT nombre, puesto FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [input.empleadoId, empresaId]);
    if (!rows[0]) throw new Error("El empleado indicado no pertenece a esta empresa.");
    empleadoNombre = String(rows[0].nombre);
    cargo = rows[0].puesto != null ? String(rows[0].puesto) : null;
  }
  let placa: string | null = null;
  if (input.vehiculoId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn, "SELECT placa FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1", [input.vehiculoId, empresaId]);
    if (!rows[0]) throw new Error("El vehículo indicado no pertenece a esta empresa.");
    placa = String(rows[0].placa);
  }
  let clienteNombre: string | null = null;
  if (input.clienteId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn, "SELECT nombre FROM tms_clientes WHERE id = ? AND empresa_id = ? LIMIT 1", [input.clienteId, empresaId]);
    if (!rows[0]) throw new Error("El cliente indicado no pertenece a esta empresa.");
    clienteNombre = String(rows[0].nombre);
  }
  let fechaViaje = input.fechaViaje ?? null;
  if (input.planId != null) {
    const rows = await queryConn<RowDataPacket[]>(conn,
      "SELECT DATE_FORMAT(fecha_plan, '%Y-%m-%d') AS fecha_plan FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? LIMIT 1",
      [input.planId, empresaId],
    );
    if (!rows[0]) throw new Error("El viaje indicado no pertenece a esta empresa.");
    if (fechaViaje == null) fechaViaje = String(rows[0].fecha_plan);
  }
  return { empleadoNombre, cargo, placa, clienteNombre, fechaViaje };
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
  /**
   * SOLICITUD-FONDOS-REPORTE-1 — relación real (RRHH/Flota/Clientes/
   * viaje) cuando la línea corresponde a una persona/unidad/cliente/viaje
   * concreto, MÁS su valor SNAPSHOT (nombre/cargo/placa/nombre de
   * cliente) resuelto y congelado por el servidor al crear la línea
   * (resolverSnapshotLineaTx más abajo) — nunca un valor enviado por el
   * cliente HTTP. El reporte (reportes-gastos.ts) lee el snapshot, nunca
   * hace JOIN en vivo a los catálogos, para que un cambio posterior de
   * nombre/placa no altere una solicitud ya emitida.
   */
  fechaViaje: string | null;
  empleadoId: number | null;
  empleadoNombre: string | null;
  cargo: string | null;
  vehiculoId: number | null;
  placa: string | null;
  clienteId: number | null;
  clienteNombre: string | null;
  planId: number | null;
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
    fechaViaje: r.fecha_viaje != null ? String(r.fecha_viaje) : null,
    empleadoId: r.empleado_id != null ? Number(r.empleado_id) : null,
    empleadoNombre: r.empleado_nombre != null ? String(r.empleado_nombre) : null,
    cargo: r.cargo != null ? String(r.cargo) : null,
    vehiculoId: r.vehiculo_id != null ? Number(r.vehiculo_id) : null,
    placa: r.placa != null ? String(r.placa) : null,
    clienteId: r.cliente_id != null ? Number(r.cliente_id) : null,
    clienteNombre: r.cliente_nombre != null ? String(r.cliente_nombre) : null,
    planId: r.plan_id != null ? Number(r.plan_id) : null,
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
  LEFT JOIN empleados req ON req.id = s.requirente_empleado_id AND req.empresa_id = s.empresa_id
  LEFT JOIN empleados aut ON aut.id = s.autorizante_empleado_id AND aut.empresa_id = s.empresa_id
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
    `SELECT id, categoria, descripcion, cantidad, monto, orden,
            DATE_FORMAT(fecha_viaje, '%Y-%m-%d') AS fecha_viaje,
            empleado_id, empleado_nombre, cargo,
            vehiculo_id, placa,
            cliente_id, cliente_nombre,
            plan_id
     FROM tms_solicitud_fondo_lineas
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
  /**
   * SOLICITUD-FONDOS-REPORTE-1 — relaciones OPCIONALES cuando la línea
   * corresponde a una persona/unidad/cliente/viaje concreto (mantener
   * relaciones internas cuando existan, pedido explícito del ticket). El
   * servidor resuelve y congela el snapshot legible (nombre/cargo/placa/
   * cliente) a partir de estos ids — nunca se acepta un snapshot enviado
   * directamente por el cliente HTTP, ver resolverSnapshotLineaTx.
   */
  fechaViaje?: string | null;
  empleadoId?: number | null;
  vehiculoId?: number | null;
  clienteId?: number | null;
  planId?: number | null;
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
    await validarEmpleadoDeEmpresaTx(conn, empresaId, input.requirenteEmpleadoId, "requirente");
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
      const snapshot = await resolverSnapshotLineaTx(conn, empresaId, l);
      await executeConn(conn,
        `INSERT INTO tms_solicitud_fondo_lineas
          (empresa_id, solicitud_id, categoria, descripcion, cantidad, monto, orden,
           fecha_viaje, empleado_id, empleado_nombre, cargo, vehiculo_id, placa, cliente_id, cliente_nombre, plan_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          empresaId, solicitudId, l.categoria, l.descripcion?.trim() || null, l.cantidad ?? 1, l.monto, orden,
          snapshot.fechaViaje, l.empleadoId ?? null, snapshot.empleadoNombre, snapshot.cargo,
          l.vehiculoId ?? null, snapshot.placa, l.clienteId ?? null, snapshot.clienteNombre, l.planId ?? null,
        ],
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
      await validarEmpleadoDeEmpresaTx(conn, empresaId, opts.autorizanteEmpleadoId, "autorizante");
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
