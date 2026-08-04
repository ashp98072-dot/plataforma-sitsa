import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
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

  const totalRows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM empleados
     WHERE empresa_id = ? AND estado = 'Activo'`,
    [empresaId],
  );
  const totalEmpleados = Number(totalRows[0]?.total ?? 0);

  const presentesRows = await query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT id_empleado) AS total
     FROM sesiones_trabajo
     WHERE empresa_id = ? AND fecha_jornada = ?
       AND (estado = 'ABIERTA' OR estado = 'En curso')`,
    [empresaId, fechaHoy],
  );
  const presentesHoy = Number(presentesRows[0]?.total ?? 0);

  const asistieronRows = await query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT id_empleado) AS total
     FROM sesiones_trabajo
     WHERE empresa_id = ? AND fecha_jornada = ?`,
    [empresaId, fechaHoy],
  );
  const asistieronHoy = Number(asistieronRows[0]?.total ?? 0);

  let enVacaciones = 0;
  try {
    const vac = await query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT id_empleado) AS total FROM incidencias
       WHERE empresa_id = ? AND tipo LIKE '%Vacaciones%'
         AND ? BETWEEN fecha_inicio AND fecha_fin`,
      [empresaId, fechaHoy],
    );
    enVacaciones = Number(vac[0]?.total ?? 0);
  } catch {
    enVacaciones = 0;
  }

  return {
    totalEmpleados,
    presentesHoy,
    ausentesHoy: Math.max(totalEmpleados - asistieronHoy, 0),
    enVacaciones,
  };
}
