import { randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { CODIGOS_ENTIDAD_REQUIRIENTE, resolverEntidadRequirenteTx, resolverSolicitanteOperacionesTx } from "@/lib/tms/identidad-administrativa";

/**
 * FONDOS DIARIOS (Fase 2) — integración entre Programación y Solicitudes de fondo.
 *
 * Cada viaje PROPIO puede tener una EMPRESA REQUIRENTE (cont_entidades KT / MONACO, de la misma empresa). Los viáticos reales del viaje (tms_viaticos: monto asignado
 * y persona; nada se inventa) se consolidan en UNA solicitud PRINCIPAL por (empresa, fecha del viaje, empresa requirente). El servidor, nunca el cliente, decide el origen
 * de cada línea (`origen = 'AUTO_VIATICO'`, `viatico_id`), y la edición manual de esas líneas queda limitada por fondo-lineas-protegidas.ts (solo método de pago y cuenta).
 *
 * Reglas:
 *  · La sincronización es POR VIAJE (los viajes que acaba de guardar la transacción del llamador) y DIFERENCIAL: se conservan los ids de las líneas y los campos editables
 *    (método de pago y cuenta); se agregan los viáticos nuevos y se retiran los que ya no existen. Nunca se recalcula el grupo completo desde una instantánea vieja.
 *  · Principal PENDIENTE → se sincroniza. Principal AUTORIZADA/LIQUIDADA → no se toca: los viáticos nuevos van a una solicitud COMPLEMENTARIA Pendiente (excepcional,
 *    ligada a la principal, sin duplicar líneas). Principal RECHAZADA → su clave diaria queda libre y se crea una nueva principal.
 *  · Un viático ya cubierto por una línea en una solicitud no pendiente (ni rechazada) NO vuelve a agregarse (aunque el viaje cambie de grupo): no se duplica dinero ya autorizado.
 *  · Idempotencia y concurrencia: UNIQUE (empresa, clave_diaria) para la principal vigente (alta con INSERT … ON DUPLICATE KEY, luego bloqueo de la fila con FOR UPDATE), UNIQUE
 *    (empresa, solicitud, viático) en las líneas, y complementarias creadas bajo el bloqueo de su principal.
 *  · Se ejecuta DESPUÉS de que Programación confirma el viaje y sus viáticos, en una transacción PROPIA (atómica) con reintentos ante colisiones (MariaDB 11.8 usa aislamiento por
 *    instantánea: 1020/1213/1205). Si falla, no deja nada a medias y se devuelve una advertencia: el viaje ya está guardado y se repara al guardarlo de nuevo o con «Resincronizar».
 *    Copiar programación NO llama a este servicio.
 *  · Sin la migración (sql/migrate-2026-11-fondos-diarios.sql) la función está apagada: la detección es por sonda de columnas.
 */

export type ActorFondosDiarios = { usuarioId: number; nombre: string; username: string };
export type ResultadoSincronizacionFondos = { cambios: number; solicitudes: number[]; advertencia?: string };

export const MENSAJE_ADVERTENCIA_FONDOS =
  "El viaje se guardó, pero no se pudieron actualizar las solicitudes de fondos de ese día. Se corregirá al volver a guardar el viaje o con «Resincronizar» en Solicitudes de fondo.";

// ------------------------------------------------------------------------------------------------------------------ detección de esquema
const SONDAS = [
  "SELECT entidad_requirente_id FROM tms_planes_viaje LIMIT 0",
  "SELECT origen, tipo, solicitud_principal_id, clave_diaria FROM tms_solicitudes_fondo LIMIT 0",
  "SELECT origen, viatico_id FROM tms_solicitud_fondo_lineas LIMIT 0",
] as const;
let cache: { valor: boolean; hasta: number } | null = null;
export function reiniciarDeteccionFondosDiarios() { cache = null; }

/** ¿Se aplicó la migración de fondos diarios? Sonda real de las columnas nuevas (no depende de la visibilidad de information_schema). Positivo 5 min, negativo 30 s. */
export async function fondosDiariosInstalado(): Promise<boolean> {
  const ahora = Date.now();
  if (cache && cache.hasta > ahora) return cache.valor;
  let valor = true;
  for (const sql of SONDAS) {
    try { await query(sql); } catch { valor = false; break; }
  }
  cache = { valor, hasta: ahora + (valor ? 300_000 : 30_000) };
  return valor;
}

// ------------------------------------------------------------------------------------------------------------------ catálogo y viajes
export type EntidadRequirente = { id: number; codigo: string; nombre: string };

/** Empresas requirentes disponibles (activas, KT/MONACO, de ESTA empresa). */
export async function entidadesRequirentesDisponibles(empresaId: number): Promise<EntidadRequirente[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre FROM cont_entidades WHERE empresa_id = ? AND activa = 1 AND codigo IN (?, ?) ORDER BY nombre`,
    [empresaId, ...CODIGOS_ENTIDAD_REQUIRIENTE],
  );
  return rows.map((r) => ({ id: Number(r.id), codigo: String(r.codigo), nombre: String(r.nombre) }));
}

/** Empresa requirente de cada viaje (para enriquecer el listado de Programación). */
export async function entidadesDePlanes(empresaId: number, planIds: number[]): Promise<Map<number, { id: number; nombre: string }>> {
  const mapa = new Map<number, { id: number; nombre: string }>();
  if (!planIds.length) return mapa;
  const rows = await query<RowDataPacket[]>(
    `SELECT p.id, p.entidad_requirente_id, e.nombre FROM tms_planes_viaje p
     LEFT JOIN cont_entidades e ON e.id = p.entidad_requirente_id AND e.empresa_id = p.empresa_id
     WHERE p.empresa_id = ? AND p.entidad_requirente_id IS NOT NULL AND p.id IN (${planIds.map(() => "?").join(",")})`,
    [empresaId, ...planIds],
  );
  for (const r of rows) mapa.set(Number(r.id), { id: Number(r.entidad_requirente_id), nombre: String(r.nombre ?? "") });
  return mapa;
}

/** Asigna (o quita con null) la empresa requirente de un viaje. Se valida contra ESTA empresa (activa, KT/MONACO) dentro de la transacción. */
export async function asignarEntidadRequirentePlanTx(conn: PoolConnection, empresaId: number, planId: number, entidadId: number | null): Promise<void> {
  if (entidadId != null) await resolverEntidadRequirenteTx(conn, empresaId, entidadId);
  await conn.execute("UPDATE tms_planes_viaje SET entidad_requirente_id = ? WHERE id = ? AND empresa_id = ?", [entidadId, planId, empresaId]);
}

// ------------------------------------------------------------------------------------------------------------------ sincronización
type DeseadaLinea = {
  viaticoId: number; planId: number; monto: number; descripcion: string; fecha: string; empleadoId: number | null; empleadoNombre: string | null; cargo: string | null; cuenta: string | null;
  vehiculoId: number | null; placa: string | null; clienteId: number | null; clienteNombre: string | null;
};
type LineaExistente = RowDataPacket & { id: number; solicitud_id: number; viatico_id: number; sol_estado: string; sol_origen: string; sol_fecha: string; sol_entidad: number | null };

const igual = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
const cortar = (v: unknown, max: number) => (v == null ? null : String(v).slice(0, max));
const claveDiaria = (fecha: string, entidadId: number) => `${fecha}|${entidadId}`;   // idéntica a la columna generada clave_diaria

async function viaticosDelPlan(conn: PoolConnection, empresaId: number, planId: number, fecha: string): Promise<DeseadaLinea[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT v.id AS viatico_id, v.rol, v.monto_asignado, p.codigo, p.cliente_id, c.nombre AS cliente_nombre, u.placa AS unidad_placa, u.flota_vehiculo_id,
            tp.nombre AS personal_nombre, e.id AS empleado_id, e.nombre AS empleado_nombre, e.puesto, e.cuenta_bancaria
     FROM tms_viaticos v
     JOIN tms_planes_viaje p ON p.id = v.plan_id AND p.empresa_id = v.empresa_id
     JOIN tms_personal tp ON tp.id = v.personal_id AND tp.empresa_id = v.empresa_id
     LEFT JOIN empleados e ON e.id = tp.id_empleado AND e.empresa_id = tp.empresa_id
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id AND u.empresa_id = p.empresa_id
     LEFT JOIN tms_clientes c ON c.id = p.cliente_id AND c.empresa_id = p.empresa_id
     WHERE v.empresa_id = ? AND v.plan_id = ? AND v.estado <> 'RECHAZADO' AND v.monto_asignado > 0
     ORDER BY v.id`,
    [empresaId, planId],
  );
  return rows.map((r) => ({
    viaticoId: Number(r.viatico_id), planId, monto: Number(r.monto_asignado), descripcion: `Viático ${String(r.rol ?? "")} · ${String(r.codigo ?? "")}`.slice(0, 300), fecha,
    empleadoId: r.empleado_id != null ? Number(r.empleado_id) : null, empleadoNombre: cortar(r.empleado_nombre ?? r.personal_nombre, 200), cargo: cortar(r.puesto ?? r.rol, 100),
    cuenta: cortar(r.cuenta_bancaria, 30), vehiculoId: r.flota_vehiculo_id != null ? Number(r.flota_vehiculo_id) : null, placa: cortar(r.unidad_placa, 20),
    clienteId: r.cliente_id != null ? Number(r.cliente_id) : null, clienteNombre: cortar(r.cliente_nombre, 200),
  }));
}

/** Principal diaria vigente de (fecha, entidad): la crea si no existe (solo se invoca cuando hay líneas por agregar) y la devuelve BLOQUEADA. */
async function principalDiariaTx(conn: PoolConnection, empresaId: number, fecha: string, entidadId: number, actor: ActorFondosDiarios): Promise<{ id: number; codigo: string; estado: string; requirenteUsuarioId: number | null; requirenteNombre: string | null }> {
  const clave = claveDiaria(fecha, entidadId);
  const seleccionar = async () => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, codigo, estado, requirente_usuario_id, requirente_nombre FROM tms_solicitudes_fondo WHERE empresa_id = ? AND clave_diaria = ? LIMIT 1 FOR UPDATE", [empresaId, clave]);
    return rows[0];
  };
  // Existencia SIN bloqueo: un SELECT … FOR UPDATE sobre una clave inexistente toma un bloqueo de hueco y dos altas simultáneas se bloquearían mutuamente (deadlock).
  const [previa] = await conn.query<RowDataPacket[]>("SELECT id FROM tms_solicitudes_fondo WHERE empresa_id = ? AND clave_diaria = ? LIMIT 1", [empresaId, clave]);
  let fila = previa[0] ? await seleccionar() : undefined;
  if (!fila) {
    const entidad = await resolverEntidadRequirenteTx(conn, empresaId, entidadId);
    const operador = await resolverSolicitanteOperacionesTx(conn, empresaId, actor.usuarioId);   // solo si el programador es un usuario válido de Operaciones
    const marcador = `TMP-${randomBytes(12).toString("hex")}`;
    // Alta idempotente: si otra transacción creó la misma principal, ON DUPLICATE KEY no falla; luego se relee y se bloquea la fila vigente.
    await conn.execute<ResultSetHeader>(
      `INSERT INTO tms_solicitudes_fondo (empresa_id, codigo, entidad_requirente_id, entidad_requirente_nombre, requirente_usuario_id, requirente_nombre, fecha_requerimiento, total,
         observaciones, creado_por, solicitante_usuario_id, solicitante_nombre, origen, tipo)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'DIARIA', 'PRINCIPAL')
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [empresaId, marcador, entidad.id, entidad.nombre, operador ? actor.usuarioId : null, operador ? operador.nombre : null, fecha, "Solicitud diaria generada desde Programación.", actor.username,
        operador ? actor.usuarioId : null, operador ? operador.nombre : null],
    );
    fila = await seleccionar();
    if (!fila) throw new Error("No se pudo obtener la solicitud diaria recién creada.");
    if (String(fila.codigo) === marcador) {
      const codigo = `FONDO-${String(fila.id).padStart(6, "0")}`;
      await conn.execute("UPDATE tms_solicitudes_fondo SET codigo = ? WHERE id = ? AND empresa_id = ?", [codigo, fila.id, empresaId]);
      fila.codigo = codigo;
    }
  }
  return { id: Number(fila.id), codigo: String(fila.codigo), estado: String(fila.estado), requirenteUsuarioId: fila.requirente_usuario_id != null ? Number(fila.requirente_usuario_id) : null, requirenteNombre: fila.requirente_nombre != null ? String(fila.requirente_nombre) : null };
}

/** Complementaria Pendiente de una principal ya no pendiente (la reutiliza o la crea, bajo el bloqueo de la principal). */
async function complementariaTx(conn: PoolConnection, empresaId: number, principal: Awaited<ReturnType<typeof principalDiariaTx>>, fecha: string, entidadId: number, actor: ActorFondosDiarios): Promise<number> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT id FROM tms_solicitudes_fondo WHERE empresa_id = ? AND solicitud_principal_id = ? AND tipo = 'COMPLEMENTARIA' AND estado = 'Pendiente' ORDER BY id LIMIT 1 FOR UPDATE", [empresaId, principal.id]);
  if (rows[0]) return Number(rows[0].id);
  const entidad = await resolverEntidadRequirenteTx(conn, empresaId, entidadId);
  const operador = await resolverSolicitanteOperacionesTx(conn, empresaId, actor.usuarioId);
  const marcador = `TMP-${randomBytes(12).toString("hex")}`;
  const [r] = await conn.execute<ResultSetHeader>(
    `INSERT INTO tms_solicitudes_fondo (empresa_id, codigo, entidad_requirente_id, entidad_requirente_nombre, requirente_usuario_id, requirente_nombre, fecha_requerimiento, total, observaciones,
       creado_por, solicitante_usuario_id, solicitante_nombre, origen, tipo, solicitud_principal_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'DIARIA', 'COMPLEMENTARIA', ?)`,
    [empresaId, marcador, entidad.id, entidad.nombre, principal.requirenteUsuarioId, principal.requirenteNombre, fecha,
      `Complementaria de ${principal.codigo}: viajes agregados después de su autorización.`.slice(0, 300), actor.username, operador ? actor.usuarioId : null, operador ? operador.nombre : null, principal.id],
  );
  const id = Number(r.insertId);
  await conn.execute("UPDATE tms_solicitudes_fondo SET codigo = ? WHERE id = ? AND empresa_id = ?", [`FONDO-${String(id).padStart(6, "0")}`, id, empresaId]);
  return id;
}

const COLUMNAS_LINEA = "categoria, descripcion, cantidad, monto, orden, fecha_viaje, empleado_id, empleado_nombre, cargo, cuenta, metodo_pago, vehiculo_id, placa, cliente_id, cliente_nombre, plan_id, origen, viatico_id";

async function sincronizarPlanTx(conn: PoolConnection, empresaId: number, planId: number, actor: ActorFondosDiarios, tocadas: Set<number>): Promise<number> {
  let cambios = 0;
  const [planes] = await conn.query<RowDataPacket[]>(
    "SELECT id, estado, tipo_viaje, DATE_FORMAT(fecha_plan, '%Y-%m-%d') AS fecha, entidad_requirente_id FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? LIMIT 1", [planId, empresaId]);
  const plan = planes[0];
  if (!plan) return 0;
  const elegible = String(plan.estado) !== "Cancelado" && String(plan.tipo_viaje ?? "Propio") === "Propio" && plan.entidad_requirente_id != null;
  const fecha = String(plan.fecha), entidadId = plan.entidad_requirente_id != null ? Number(plan.entidad_requirente_id) : 0;
  const deseadas = new Map<number, DeseadaLinea>();
  if (elegible) for (const d of await viaticosDelPlan(conn, empresaId, planId, fecha)) deseadas.set(d.viaticoId, d);

  const [existentes] = await conn.query<LineaExistente[]>(
    `SELECT l.*, s.estado AS sol_estado, s.origen AS sol_origen, DATE_FORMAT(s.fecha_requerimiento, '%Y-%m-%d') AS sol_fecha, s.entidad_requirente_id AS sol_entidad
     FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.empresa_id = l.empresa_id AND s.id = l.solicitud_id
     WHERE l.empresa_id = ? AND l.plan_id = ? AND l.origen = 'AUTO_VIATICO' ORDER BY l.solicitud_id, l.id FOR UPDATE`,
    [empresaId, planId],
  );

  const cubiertos = new Set<number>();
  for (const e of existentes) {
    const estado = String(e.sol_estado);
    if (estado === "Rechazada") continue;   // historia de una solicitud rechazada: no cubre ni se toca
    const d = deseadas.get(Number(e.viatico_id));
    const enGrupo = elegible && String(e.sol_origen) === "DIARIA" && String(e.sol_fecha) === fecha && Number(e.sol_entidad) === entidadId;
    if (estado !== "Pendiente") { cubiertos.add(Number(e.viatico_id)); continue; }   // autorizada/liquidada: inmutable; el dinero ya está cubierto
    if (!d || !enGrupo) {
      await conn.execute("DELETE FROM tms_solicitud_fondo_lineas WHERE id = ? AND empresa_id = ? AND solicitud_id = ? AND origen = 'AUTO_VIATICO'", [e.id, empresaId, e.solicitud_id]);
      tocadas.add(Number(e.solicitud_id)); cambios++;
      continue;
    }
    cubiertos.add(Number(e.viatico_id));
    // Pendiente y en su grupo: los datos de ORIGEN se actualizan; método de pago y cuenta (lo editable) se conservan, salvo que el beneficiario cambie.
    const cambiaBeneficiario = !igual(e.empleado_id, d.empleadoId) || !igual(e.empleado_nombre, d.empleadoNombre);
    const diferente = Number(e.monto).toFixed(2) !== d.monto.toFixed(2) || !igual(e.descripcion, d.descripcion) || cambiaBeneficiario || !igual(e.cargo, d.cargo) || !igual(e.vehiculo_id, d.vehiculoId)
      || !igual(e.placa, d.placa) || !igual(e.cliente_id, d.clienteId) || !igual(e.cliente_nombre, d.clienteNombre) || Number(e.cantidad) !== 1 || String(e.categoria) !== "Viáticos";
    if (diferente) {
      await conn.execute(
        `UPDATE tms_solicitud_fondo_lineas SET categoria = 'Viáticos', descripcion = ?, cantidad = 1, monto = ?, empleado_id = ?, empleado_nombre = ?, cargo = ?, vehiculo_id = ?, placa = ?, cliente_id = ?, cliente_nombre = ?,
           cuenta = ${cambiaBeneficiario ? "?" : "cuenta"}, metodo_pago = ${cambiaBeneficiario ? "NULL" : "metodo_pago"}
         WHERE id = ? AND empresa_id = ? AND solicitud_id = ?`,
        [d.descripcion, d.monto, d.empleadoId, d.empleadoNombre, d.cargo, d.vehiculoId, d.placa, d.clienteId, d.clienteNombre, ...(cambiaBeneficiario ? [d.cuenta] : []), e.id, empresaId, e.solicitud_id],
      );
      tocadas.add(Number(e.solicitud_id)); cambios++;
    }
  }

  const nuevas = [...deseadas.values()].filter((d) => !cubiertos.has(d.viaticoId));
  if (elegible && nuevas.length) {
    const principal = await principalDiariaTx(conn, empresaId, fecha, entidadId, actor);
    const destino = principal.estado === "Pendiente" ? principal.id : await complementariaTx(conn, empresaId, principal, fecha, entidadId, actor);
    const [mx] = await conn.query<RowDataPacket[]>("SELECT COALESCE(MAX(orden) + 1, 0) AS siguiente FROM tms_solicitud_fondo_lineas WHERE empresa_id = ? AND solicitud_id = ?", [empresaId, destino]);
    let orden = Number(mx[0]?.siguiente ?? 0);
    for (const d of nuevas) {
      await conn.execute(
        `INSERT INTO tms_solicitud_fondo_lineas (empresa_id, solicitud_id, ${COLUMNAS_LINEA})
         VALUES (?, ?, 'Viáticos', ?, 1, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'AUTO_VIATICO', ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [empresaId, destino, d.descripcion, d.monto, orden++, d.fecha, d.empleadoId, d.empleadoNombre, d.cargo, d.cuenta, d.vehiculoId, d.placa, d.clienteId, d.clienteNombre, d.planId, d.viaticoId],
      );
      cambios++;
    }
    tocadas.add(destino);
  }
  return cambios;
}

async function sincronizarInterno(conn: PoolConnection, empresaId: number, planIds: number[], actor: ActorFondosDiarios): Promise<ResultadoSincronizacionFondos> {
  const tocadas = new Set<number>();
  let cambios = 0;
  for (const id of [...new Set(planIds)].sort((a, b) => a - b)) cambios += await sincronizarPlanTx(conn, empresaId, id, actor, tocadas);
  const solicitudes = [...tocadas].sort((a, b) => a - b);
  for (const id of solicitudes) {
    const [n] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM tms_solicitud_fondo_lineas WHERE empresa_id = ? AND solicitud_id = ?", [empresaId, id]);
    if (Number(n[0]?.n ?? 0) === 0) {
      // Una solicitud diaria PENDIENTE que se quedó sin líneas (el viaje se movió, canceló o perdió su viático) se retira; las manuales o con líneas se conservan.
      await conn.execute("DELETE FROM tms_solicitudes_fondo WHERE id = ? AND empresa_id = ? AND estado = 'Pendiente' AND origen = 'DIARIA'", [id, empresaId]);
    } else {
      await conn.execute(
        `UPDATE tms_solicitudes_fondo SET total = (SELECT COALESCE(SUM(cantidad * monto), 0) FROM tms_solicitud_fondo_lineas WHERE empresa_id = ? AND solicitud_id = ?)
         WHERE id = ? AND empresa_id = ? AND estado = 'Pendiente'`,
        [empresaId, id, id, empresaId],
      );
    }
  }
  if (cambios) {
    await registrarAuditoriaTx(conn, { empresaId, usuario: actor.username, accion: "sincronizar_fondos_diarios", modulo: "tms_fondos",
      detalle: `Viajes ${[...new Set(planIds)].join(", ")}: ${cambios} cambio(s) en solicitudes ${solicitudes.join(", ") || "—"}.`.slice(0, 2000) });
  }
  return { cambios, solicitudes };
}

const ERRNO_REINTENTABLES = new Set([1020, 1205, 1213]);   // 1020 «el registro cambió desde la última lectura» (innodb_snapshot_isolation de MariaDB 11.8), 1205 espera de bloqueo, 1213 deadlock
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ejecuta `fn` en SU PROPIA transacción y la reintenta con una instantánea nueva si choca con otra (1020/1205/1213). Cada intento es atómico: o se confirma completo o no queda nada. */
async function enTransaccionConReintentos<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento++) {
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const r = await fn(conn);
      await conn.commit();
      return r;
    } catch (e) {
      try { await conn.rollback(); } catch { /* la conexión pudo perderse */ }
      const errno = (e as { errno?: number } | null)?.errno;
      if (intento >= 8 || errno == null || !ERRNO_REINTENTABLES.has(errno)) throw e;
    } finally {
      conn.release();
    }
    await pausa(15 * intento + Math.floor(Math.random() * 25));
  }
}

/**
 * Sincroniza las solicitudes de fondos diarias para los viajes dados. Se invoca DESPUÉS de que Programación confirmó el viaje y sus viáticos (los lee ya confirmados), en una
 * transacción propia, atómica e idempotente, con reintentos ante colisiones con otras transacciones. NUNCA lanza por errores propios: si no puede completarse, no deja nada
 * a medias (revierte su transacción) y devuelve una advertencia; el viaje ya está guardado y los fondos se corrigen al volver a guardarlo o con «Resincronizar».
 */
export async function sincronizarFondosDePlanes(empresaId: number, planIds: number[], actor: ActorFondosDiarios): Promise<ResultadoSincronizacionFondos> {
  if (!planIds.length) return { cambios: 0, solicitudes: [] };
  try {
    return await enTransaccionConReintentos((conn) => sincronizarInterno(conn, empresaId, planIds, actor));
  } catch (e) {
    console.error("sincronizarFondosDePlanes", e);
    return { cambios: 0, solicitudes: [], advertencia: MENSAJE_ADVERTENCIA_FONDOS };
  }
}

/** Resincroniza un día completo (fecha, empresa requirente); los errores SÍ se propagan (es una acción explícita del usuario). */
export async function resincronizarGrupoDiario(empresaId: number, fecha: string, entidadId: number, actor: ActorFondosDiarios): Promise<ResultadoSincronizacionFondos> {
  return enTransaccionConReintentos(async (conn) => {
    await resolverEntidadRequirenteTx(conn, empresaId, entidadId);
    const [planes] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM tms_planes_viaje WHERE empresa_id = ? AND fecha_plan = ? AND entidad_requirente_id = ?
       UNION SELECT l.plan_id FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.empresa_id = l.empresa_id AND s.id = l.solicitud_id
         WHERE l.empresa_id = ? AND l.origen = 'AUTO_VIATICO' AND l.plan_id IS NOT NULL AND s.origen = 'DIARIA' AND s.fecha_requerimiento = ? AND s.entidad_requirente_id = ? AND s.estado = 'Pendiente'`,
      [empresaId, fecha, entidadId, empresaId, fecha, entidadId],
    );
    return sincronizarInterno(conn, empresaId, planes.map((p) => Number(p.id)), actor);
  });
}
