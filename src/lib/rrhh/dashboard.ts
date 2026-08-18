import type { RowDataPacket } from "mysql2";
import { query, type SqlParams } from "@/lib/db";
import { hoyLocal } from "./dates";

export type DashboardStats = {
  totalEmpleados: number;
  presentesHoy: number;
  ausentesHoy: number;
  enVacaciones: number;
};

export type ResumenMensual = {
  /** "YYYY-MM" */
  mes: string;
  altas: number;
  bajas: number;
  /** Suma de neto de todas las líneas de planilla cuyo periodo inicia en ese mes. */
  costoNomina: number;
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

/**
 * Resumen gerencial mensual (altas, bajas y costo de nómina) de los
 * últimos `meses` calendario, incluyendo el mes actual (parcial si aún
 * no termina). No toca obtenerEstadisticasDashboard (ese sigue siendo
 * el snapshot "de hoy").
 */
export async function obtenerResumenGerencial(
  empresaId: number,
  meses = 6,
): Promise<ResumenMensual[]> {
  const hoy = new Date();
  const rangos: { mes: string; desde: string; hasta: string }[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth(); // 0-based
    const desde = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const ultimoDia = new Date(y, m + 1, 0).getDate();
    const hasta = `${y}-${String(m + 1).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
    rangos.push({ mes: `${y}-${String(m + 1).padStart(2, "0")}`, desde, hasta });
  }

  const consultaSegura = (
    nombre: string,
    sql: string,
    params: SqlParams,
  ): Promise<RowDataPacket[]> =>
    query<RowDataPacket[]>(sql, params).catch((error) => {
      console.error(`[dashboard-gerencial] Falló consulta "${nombre}":`, error);
      return [] as RowDataPacket[];
    });

  const resultados = await Promise.all(
    rangos.map(async ({ mes, desde, hasta }) => {
      const [altasRows, bajasRows, costoRows] = await Promise.all([
        consultaSegura(
          "altas",
          `SELECT COUNT(*) AS total FROM empleados
           WHERE empresa_id = ? AND fecha_alta BETWEEN ? AND ?`,
          [empresaId, desde, hasta],
        ),
        consultaSegura(
          "bajas",
          `SELECT COUNT(*) AS total FROM empleados
           WHERE empresa_id = ? AND estado = 'Baja'
             AND fecha_egreso BETWEEN ? AND ?`,
          [empresaId, desde, hasta],
        ),
        consultaSegura(
          "costoNomina",
          `SELECT COALESCE(SUM(l.neto), 0) AS total
           FROM rrhh_planilla_lineas l
           INNER JOIN rrhh_planilla_periodos p ON p.id = l.periodo_id
           WHERE l.empresa_id = ? AND p.empresa_id = ?
             AND p.fecha_inicio BETWEEN ? AND ?`,
          [empresaId, empresaId, desde, hasta],
        ),
      ]);
      return {
        mes,
        altas: Number(altasRows[0]?.total ?? 0),
        bajas: Number(bajasRows[0]?.total ?? 0),
        costoNomina: Number(costoRows[0]?.total ?? 0),
      };
    }),
  );

  return resultados;
}