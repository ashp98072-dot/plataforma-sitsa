import type { RowDataPacket } from "mysql2";
import { query, type SqlParams } from "@/lib/db";
import { hoyLocal } from "./dates";

export type DashboardStats = {
  totalEmpleados: number;
  presentesHoy: number;
  ausentesHoy: number;
  enVacaciones: number;
};

export async function obtenerEstadisticasDashboard(
  empresaId: number,
): Promise<DashboardStats> {
  const fechaHoy = hoyLocal();

  const consultaSegura = (
    nombre: string,
    sql: string,
    params: SqlParams,
  ): Promise<RowDataPacket[]> =>
    query<RowDataPacket[]>(sql, params).catch((error) => {
      console.error(`[dashboard-rrhh] Falló consulta "${nombre}":`, error);
      return [] as RowDataPacket[];
    });

  const [totalRows, presentesRows, asistieronRows, vacRows] = await Promise.all([
    consultaSegura(
      "totalEmpleados",
      `SELECT COUNT(*) AS total FROM empleados
       WHERE empresa_id = ? AND estado = 'Activo'`,
      [empresaId],
    ),
    consultaSegura(
      "presentesHoy",
      `SELECT COUNT(DISTINCT id_empleado) AS total
       FROM sesiones_trabajo
       WHERE empresa_id = ? AND fecha_jornada = ?
         AND estado IN ('ABIERTA', 'En curso')`,
      [empresaId, fechaHoy],
    ),
    consultaSegura(
      "asistieronHoy",
      `SELECT COUNT(DISTINCT id_empleado) AS total
       FROM sesiones_trabajo
       WHERE empresa_id = ? AND fecha_jornada = ?`,
      [empresaId, fechaHoy],
    ),
    consultaSegura(
      "enVacaciones",
      `SELECT COUNT(DISTINCT id_empleado) AS total FROM incidencias
       WHERE empresa_id = ? AND tipo LIKE '%Vacaciones%'
         AND ? BETWEEN fecha_inicio AND fecha_fin`,
      [empresaId, fechaHoy],
    ),
  ]);

  const totalEmpleados = Number(totalRows[0]?.total ?? 0);
  const presentesHoy = Number(presentesRows[0]?.total ?? 0);
  const asistieronHoy = Number(asistieronRows[0]?.total ?? 0);
  const enVacaciones = Number(vacRows[0]?.total ?? 0);

  // Un empleado en vacaciones no genera sesión de trabajo, así que sin este
  // ajuste contaría como "ausente" y "en vacaciones" al mismo tiempo.
  const ausentesHoy = Math.max(totalEmpleados - asistieronHoy - enVacaciones, 0);

  return {
    totalEmpleados,
    presentesHoy,
    ausentesHoy,
    enVacaciones,
  };
}
