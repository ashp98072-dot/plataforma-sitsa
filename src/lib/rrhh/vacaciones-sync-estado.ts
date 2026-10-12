import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { hoyLocal, toIsoDate } from "./dates";
import { obtenerPoliticaConConsulta, obtenerPoliticaVacaciones } from "./vacaciones-modo-db";
import type { PoliticaVacaciones } from "./vacaciones-politica";

/** Índice de frescura, nunca autoridad de saldos. Incrementar v1 si cambia el motor. */
export function fingerprintVacaciones(p: PoliticaVacaciones): string {
  return `v1:${p.modo}:${p.maxPeriodosVigentes ?? "sin-limite"}:${Number(p.aplicarTope)}`;
}

export const SQL_DIRTY = `INSERT INTO rrhh_vacaciones_sync_estado (empresa_id, id_empleado, dirty, generacion)
  SELECT empresa_id, id, 1, 1 FROM empleados WHERE empresa_id = ? AND id = ?
  ON DUPLICATE KEY UPDATE dirty = 1, generacion = generacion + 1, actualizado_en = CURRENT_TIMESTAMP`;

/** Misma conexión/transacción de la mutación; no captura errores ni confirma. */
export async function marcarVacacionesDirty(conn: PoolConnection, empresaId: number, empleadoId: number): Promise<void> {
  await conn.execute(SQL_DIRTY, [empresaId, empleadoId]);
}

/** Solo limpieza administrativa: todos los estados que quedan pertenecen a esta empresa. */
export async function invalidarVacacionesEmpresaEnConexion(conn: PoolConnection, empresaId: number): Promise<void> {
  await conn.execute(`UPDATE rrhh_vacaciones_sync_estado
    SET dirty = 1, generacion = generacion + 1, actualizado_en = CURRENT_TIMESTAMP WHERE empresa_id = ?`, [empresaId]);
}

export const SQL_CANDIDATOS = `SELECT e.id FROM empleados e
  LEFT JOIN rrhh_vacaciones_sync_estado s ON s.empresa_id = e.empresa_id AND s.id_empleado = e.id
  WHERE e.empresa_id = ? AND e.estado = 'Activo' AND e.fecha_alta IS NOT NULL
    AND (s.id_empleado IS NULL OR s.dirty = 1 OR s.ultima_sync_fecha IS NULL
      OR s.ultima_sync_fecha < ? OR s.politica_fingerprint IS NULL OR s.politica_fingerprint <> ?
      OR NOT (s.fecha_alta_sync <=> e.fecha_alta)) ORDER BY e.id`;

export async function candidatosVacaciones(empresaId: number): Promise<number[]> {
  const fingerprint = fingerprintVacaciones(await obtenerPoliticaVacaciones(empresaId));
  return (await query<RowDataPacket[]>(SQL_CANDIDATOS, [empresaId, hoyLocal(), fingerprint])).map((e) => Number(e.id));
}

export type EstadoSync = {
  dirty: number; generacion: string; ultima_sync_fecha: string | Date | null;
  politica_fingerprint: string | null; fecha_alta_sync: string | Date | null;
};
export function necesitaSync(s: EstadoSync, fecha: string, fingerprint: string, alta: string): boolean {
  const ultima = toIsoDate(s.ultima_sync_fecha);
  return s.dirty === 1 || !ultima || ultima < fecha || s.politica_fingerprint !== fingerprint || toIsoDate(s.fecha_alta_sync) !== alta;
}

export const SQL_LIMPIAR = `UPDATE rrhh_vacaciones_sync_estado
  SET ultima_sync_fecha = ?, dirty = 0, politica_fingerprint = ?, fecha_alta_sync = ?, actualizado_en = CURRENT_TIMESTAMP
  WHERE empresa_id = ? AND id_empleado = ? AND generacion = ?`;

/** GET_LOCK solo entre workers; cada empleado conserva SU transacción y el motor original.
 * La generación se lee sin bloquear antes del motor. El CAS final usa la versión actual de InnoDB:
 * si una mutación confirmó un dirty nuevo, no se borra; si espera, lo escribirá después del CAS.
 */
export async function sincronizarCandidatoVacaciones(
  empresaId: number, empleadoId: number,
  motor: (conn: PoolConnection, empresaId: number, empleadoId: number) => Promise<unknown>,
): Promise<boolean> {
  const conn = await getPool().getConnection();
  const key = `rrhh-vac-sync:${empresaId}:${empleadoId}`;
  let lock = false;
  let destruida = false;
  try {
    const [locks] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS adquirido", [key]);
    if (locks[0]?.adquirido != null && Number(locks[0].adquirido) === 0) return false; // otro worker, próximo polling reintenta
    if (Number(locks[0]?.adquirido) !== 1) throw new Error("No se pudo reclamar sincronización de vacaciones.");
    lock = true;
    // Inicialización autocommit. Si el proceso muere queda dirty; no hay lease que pueda caducar durante el motor.
    await conn.execute(`INSERT IGNORE INTO rrhh_vacaciones_sync_estado (empresa_id, id_empleado)
      SELECT empresa_id, id FROM empleados WHERE empresa_id = ? AND id = ?`, [empresaId, empleadoId]);
    await conn.beginTransaction();
    const fingerprint = fingerprintVacaciones(await obtenerPoliticaConConsulta(async (sql, p) => (await conn.query<RowDataPacket[]>(sql, p))[0], empresaId));
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT s.*, CAST(s.generacion AS CHAR) AS generacion, e.fecha_alta FROM rrhh_vacaciones_sync_estado s
      INNER JOIN empleados e ON e.empresa_id = s.empresa_id AND e.id = s.id_empleado
      WHERE s.empresa_id = ? AND s.id_empleado = ? AND e.estado = 'Activo' AND e.fecha_alta IS NOT NULL`, [empresaId, empleadoId]);
    const s = rows[0];
    const fecha = hoyLocal();
    const alta = s ? toIsoDate(s.fecha_alta) : null;
    if (!s || !alta || !necesitaSync({ ...s, dirty: Number(s.dirty) } as EstadoSync, fecha, fingerprint, alta)) {
      await conn.rollback();
      return false;
    }
    const generacion = String(s.generacion); // BIGINT nunca se convierte a number para comparar versiones
    await motor(conn, empresaId, empleadoId);
    await conn.execute(SQL_LIMPIAR, [fecha, fingerprint, alta, empresaId, empleadoId, generacion]);
    await conn.commit();
    return true;
  } catch (error) {
    try { await conn.rollback(); } catch { /* error original conserva prioridad */ }
    throw error;
  } finally {
    if (lock) {
      try { await conn.query("SELECT RELEASE_LOCK(?)", [key]); }
      catch { conn.destroy(); destruida = true; } // nunca devolver al pool una conexión con lock potencialmente vivo
    }
    if (!destruida) conn.release();
  }
}
