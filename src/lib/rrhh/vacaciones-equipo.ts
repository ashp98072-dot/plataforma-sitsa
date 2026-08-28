import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { query } from "@/lib/db";

const equipoSql = `SELECT DISTINCT e.id, e.codigo, e.nombre
  FROM empleados e
  INNER JOIN empleado_supervisores es ON es.empleado_id = e.id AND es.empresa_id = e.empresa_id
  INNER JOIN empleados s ON s.id = es.supervisor_id AND s.empresa_id = es.empresa_id
  WHERE e.empresa_id = ? AND es.supervisor_id = ?
    AND e.estado = 'Activo' AND s.estado = 'Activo' AND e.id <> s.id`;

/** No reutilizar el selector de horas extra: vacaciones no depende de esa habilitación. */
export async function listarEquipoVacaciones(empresaId: number, supervisorId: number) {
  const rows = await query<RowDataPacket[]>(`${equipoSql} ORDER BY e.nombre`, [empresaId, supervisorId]);
  return rows.map((r) => ({ id: Number(r.id), codigo: String(r.codigo), nombre: String(r.nombre) }));
}

/** Revalidación vigente bajo lock antes de insertar; la UI nunca concede permisos. */
export async function puedeSolicitarPorEmpleado(empresaId: number, supervisorId: number, empleadoId: number, conn?: PoolConnection) {
  const sql = `${equipoSql} AND e.id = ?${conn ? " FOR UPDATE" : ""}`;
  const params = [empresaId, supervisorId, empleadoId];
  const rows = conn ? (await conn.query<RowDataPacket[]>(sql, params))[0] : await query<RowDataPacket[]>(sql, params);
  return rows.length > 0;
}
