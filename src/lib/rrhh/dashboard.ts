import type { RowDataPacket } from "mysql2";
import { query, type SqlParams } from "@/lib/db";
import { hoyLocal } from "./dates";

export type DashboardStats = {
  totalEmpleados: number;
  presentesHoy: number;
  ausentesHoy: number;
  enVacaciones: number;
  otrasIncidenciasHoy: number;
};

export type SituacionEmpleadoHoy = {
  idEmpleado: number;
  codigo: string;
  nombre: string;
  situacion: "Sin marcaje" | "Vacaciones" | "Otra incidencia";
  detalle: string;
};

export type ResumenMensual = {
  /** "YYYY-MM" */
  mes: string;
  altas: number | null;
  bajas: number | null;
  /** Alias histórico del neto; se conserva para consumidores existentes. */
  costoNomina: number;
  netoNomina: number | null;
  costoRegistrado: number | null;
  amonestaciones: number | null;
  suspensiones: number | null;
  despidos: number | null;
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
      console.error("[dashboard-rrhh] Consulta no disponible", { nombre, code: (error as { code?: string })?.code });
      throw new Error("Estadísticas de hoy no disponibles.");
    });

  const [totalRows, presentesRows, ausentesRows, vacRows, otrasRows] = await Promise.all([
    consultaSegura(
      "totalEmpleados",
      `SELECT COUNT(*) AS total FROM empleados
       WHERE empresa_id = ? AND estado = 'Activo'`,
      [empresaId],
    ),
    consultaSegura(
      "presentesHoy",
      `SELECT COUNT(DISTINCT s.id_empleado) AS total
       FROM sesiones_trabajo s
       INNER JOIN empleados e
         ON e.id = s.id_empleado AND e.empresa_id = s.empresa_id
       WHERE s.empresa_id = ? AND s.fecha_jornada = ?
         AND e.estado = 'Activo' AND s.estado IN ('ABIERTA', 'En curso')`,
      [empresaId, fechaHoy],
    ),
    consultaSegura(
      "sinMarcajeHoy",
      `SELECT COUNT(*) AS total
       FROM empleados e
       WHERE e.empresa_id = ? AND e.estado = 'Activo'
         AND NOT EXISTS (
           SELECT 1 FROM sesiones_trabajo s
           WHERE s.empresa_id = e.empresa_id AND s.id_empleado = e.id
             AND s.fecha_jornada = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM incidencias i
           WHERE i.empresa_id = e.empresa_id AND i.id_empleado = e.id
             AND ? BETWEEN i.fecha_inicio AND i.fecha_fin
         )`,
      [empresaId, fechaHoy, fechaHoy],
    ),
    consultaSegura(
      "enVacaciones",
      `SELECT COUNT(DISTINCT i.id_empleado) AS total FROM incidencias i
       INNER JOIN empleados e
         ON e.id = i.id_empleado AND e.empresa_id = i.empresa_id
       WHERE i.empresa_id = ? AND e.estado = 'Activo'
         AND i.tipo LIKE '%Vacaciones%'
         AND ? BETWEEN i.fecha_inicio AND i.fecha_fin`,
      [empresaId, fechaHoy],
    ),
    consultaSegura(
      "otrasIncidenciasHoy",
      `SELECT COUNT(DISTINCT i.id_empleado) AS total FROM incidencias i
       INNER JOIN empleados e
         ON e.id = i.id_empleado AND e.empresa_id = i.empresa_id
       WHERE i.empresa_id = ? AND e.estado = 'Activo'
         AND i.tipo NOT LIKE '%Vacaciones%'
         AND ? BETWEEN i.fecha_inicio AND i.fecha_fin
         AND NOT EXISTS (
           SELECT 1 FROM incidencias v
           WHERE v.empresa_id = i.empresa_id AND v.id_empleado = i.id_empleado
             AND v.tipo LIKE '%Vacaciones%'
             AND ? BETWEEN v.fecha_inicio AND v.fecha_fin
         )`,
      [empresaId, fechaHoy, fechaHoy],
    ),
  ]);

  const totalEmpleados = Number(totalRows[0]?.total ?? 0);
  const presentesHoy = Number(presentesRows[0]?.total ?? 0);
  const ausentesHoy = Number(ausentesRows[0]?.total ?? 0);
  const enVacaciones = Number(vacRows[0]?.total ?? 0);
  const otrasIncidenciasHoy = Number(otrasRows[0]?.total ?? 0);

  return {
    totalEmpleados,
    presentesHoy,
    ausentesHoy,
    enVacaciones,
    otrasIncidenciasHoy,
  };
}

/**
 * Bandeja operativa del día. Clasifica a cada empleado activo sin duplicarlo:
 * una incidencia vigente tiene prioridad y, si no existe, se reporta la falta
 * de marcaje. Es una consulta de solo lectura y siempre queda aislada por empresa.
 */
export async function obtenerSituacionEmpleadosHoy(
  empresaId: number,
): Promise<SituacionEmpleadoHoy[]> {
  const fechaHoy = hoyLocal();
  const rows = await query<RowDataPacket[]>(
    `SELECT e.id, e.codigo, e.nombre,
            MAX(CASE WHEN i.tipo LIKE '%Vacaciones%' THEN 1 ELSE 0 END) AS en_vacaciones,
            GROUP_CONCAT(DISTINCT CASE
              WHEN i.tipo NOT LIKE '%Vacaciones%' THEN i.tipo
              ELSE NULL
            END ORDER BY i.tipo SEPARATOR ', ') AS otras_incidencias,
            COUNT(DISTINCT s.id) AS total_sesiones
     FROM empleados e
     LEFT JOIN sesiones_trabajo s
       ON s.empresa_id = e.empresa_id
      AND s.id_empleado = e.id
      AND s.fecha_jornada = ?
     LEFT JOIN incidencias i
       ON i.empresa_id = e.empresa_id
      AND i.id_empleado = e.id
      AND ? BETWEEN i.fecha_inicio AND i.fecha_fin
     WHERE e.empresa_id = ? AND e.estado = 'Activo'
     GROUP BY e.id, e.codigo, e.nombre
     HAVING total_sesiones = 0 OR en_vacaciones = 1 OR otras_incidencias IS NOT NULL
     ORDER BY en_vacaciones DESC, otras_incidencias IS NOT NULL DESC, e.nombre`,
    [fechaHoy, fechaHoy, empresaId],
  );

  return rows.map((row) => {
    const vacaciones = Number(row.en_vacaciones ?? 0) === 1;
    const otras = row.otras_incidencias ? String(row.otras_incidencias) : "";
    return {
      idEmpleado: Number(row.id),
      codigo: String(row.codigo ?? ""),
      nombre: String(row.nombre ?? ""),
      situacion: vacaciones
        ? "Vacaciones"
        : otras
          ? "Otra incidencia"
          : "Sin marcaje",
      detalle: vacaciones ? "Vacaciones vigentes" : otras || "No registra jornada hoy",
    };
  });
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
  const [anioActual, mesActual] = hoyLocal().split("-").map(Number);
  const rangos: { mes: string; desde: string; hasta: string }[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(anioActual, mesActual - 1 - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth(); // 0-based
    const desde = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const ultimoDia = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const hasta = `${y}-${String(m + 1).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
    rangos.push({ mes: `${y}-${String(m + 1).padStart(2, "0")}`, desde, hasta });
  }

  const consultaSegura = (
    nombre: string,
    sql: string,
    params: SqlParams,
  ): Promise<RowDataPacket[] | null> =>
    query<RowDataPacket[]>(sql, params).catch((error) => {
      console.error("[dashboard-gerencial] Consulta no disponible", { nombre, code: (error as { code?: string })?.code });
      return null;
    });

  const resultados = await Promise.all(
    rangos.map(async ({ mes, desde, hasta }) => {
      const [altasRows, bajasRows, costoRows, bitacoraRows] = await Promise.all([
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
          `SELECT COALESCE(SUM(l.neto), 0) AS total,
                  COALESCE(SUM(COALESCE(l.sueldo_base, 0) + COALESCE(l.bono_incentivo, 0)
                    + COALESCE(l.bono_herramientas, 0) + COALESCE(l.otros_ingresos, 0)
                    + COALESCE(l.igss_patronal, 0)), 0) AS costo_registrado
           FROM rrhh_planilla_lineas l
           INNER JOIN rrhh_planilla_periodos p ON p.id = l.periodo_id
           WHERE l.empresa_id = ? AND p.empresa_id = ?
             AND p.estado IN ('Cerrada', 'Pagada')
             AND p.fecha_inicio BETWEEN ? AND ?`,
          [empresaId, empresaId, desde, hasta],
        ),
        consultaSegura(
          "bitacoraLegal",
          `SELECT tipo, COUNT(*) AS total FROM rrhh_bitacora_legal
           WHERE empresa_id = ? AND fecha BETWEEN ? AND ?
             AND tipo IN ('Amonestacion', 'Suspension', 'Despido')
           GROUP BY tipo`,
          [empresaId, desde, hasta],
        ),
      ]);
      const bitacoraPorTipo = new Map<string, number>(
        (bitacoraRows ?? []).map((r) => [String(r.tipo), Number(r.total ?? 0)]),
      );
      return {
        mes,
        altas: altasRows ? Number(altasRows[0]?.total ?? 0) : null,
        bajas: bajasRows ? Number(bajasRows[0]?.total ?? 0) : null,
        costoNomina: Number(costoRows?.[0]?.total ?? 0),
        netoNomina: costoRows?.length ? Number(costoRows[0].total) : null,
        costoRegistrado: costoRows?.length ? Number(costoRows[0].costo_registrado) : null,
        amonestaciones: bitacoraRows ? bitacoraPorTipo.get("Amonestacion") ?? 0 : null,
        suspensiones: bitacoraRows ? bitacoraPorTipo.get("Suspension") ?? 0 : null,
        despidos: bitacoraRows ? bitacoraPorTipo.get("Despido") ?? 0 : null,
      };
    }),
  );

  return resultados;
}
