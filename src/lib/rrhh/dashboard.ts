import type { RowDataPacket } from "mysql2";
import { query, type SqlParams } from "@/lib/db";
import { hoyLocal, toIsoDate } from "./dates";

export type MovimientoMensual = {
  id: number; codigo: string; nombre: string; puesto: string;
  fechaAlta: string | null; fechaEgreso: string | null; esBaja: boolean;
};
export type DetalleMovimientosMensual = { mes: string; altas: MovimientoMensual[]; bajas: MovimientoMensual[] };

export async function obtenerDetalleMovimientosMensual(empresaId: number, mes: string): Promise<DetalleMovimientosMensual> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) || Number(mes.slice(0, 4)) < 1000) throw new Error("Mes inválido.");
  const [anio, numeroMes] = mes.split("-").map(Number);
  const desde = `${mes}-01`;
  const hasta = `${mes}-${new Date(Date.UTC(anio, numeroMes, 0)).getUTCDate()}`;
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, puesto, fecha_alta, fecha_egreso, estado,
       (fecha_alta BETWEEN ? AND ?) AS es_alta,
       (estado = 'Baja' AND fecha_egreso BETWEEN ? AND ?) AS es_baja_mes
     FROM empleados WHERE empresa_id = ?
       AND (fecha_alta BETWEEN ? AND ? OR (estado = 'Baja' AND fecha_egreso BETWEEN ? AND ?))
     ORDER BY nombre, id`,
    [desde, hasta, desde, hasta, empresaId, desde, hasta, desde, hasta],
  );
  const persona = (r: RowDataPacket): MovimientoMensual => ({
    id: Number(r.id), codigo: String(r.codigo), nombre: String(r.nombre), puesto: String(r.puesto ?? ""),
    fechaAlta: toIsoDate(r.fecha_alta), fechaEgreso: toIsoDate(r.fecha_egreso), esBaja: r.estado === "Baja",
  });
  return { mes, altas: rows.filter((r) => Number(r.es_alta) === 1).map(persona),
    bajas: rows.filter((r) => Number(r.es_baja_mes) === 1).map(persona) };
}

export type DashboardStats = {
  /** Empleados ACTUALMENTE Activos (estado = 'Activo'). */
  totalEmpleados: number;
  /**
   * RRHH-DASHBOARD-BAJAS-FOTO-1 — empleados ACTUALMENTE de Baja (estado =
   * 'Baja'). Es un total del estado actual, NO las "Bajas del mes" del
   * resumen mensual (que se cuentan por fecha_egreso del mes).
   */
  totalBajas: number;
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

  const [totalRows, bajasRows, presentesRows, ausentesRows, vacRows, otrasRows] = await Promise.all([
    consultaSegura(
      "totalEmpleados",
      `SELECT COUNT(*) AS total FROM empleados
       WHERE empresa_id = ? AND estado = 'Activo'`,
      [empresaId],
    ),
    consultaSegura(
      "totalBajas",
      `SELECT COUNT(*) AS total FROM empleados
       WHERE empresa_id = ? AND estado = 'Baja'`,
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
  const totalBajas = Number(bajasRows[0]?.total ?? 0);
  const presentesHoy = Number(presentesRows[0]?.total ?? 0);
  const ausentesHoy = Number(ausentesRows[0]?.total ?? 0);
  const enVacaciones = Number(vacRows[0]?.total ?? 0);
  const otrasIncidenciasHoy = Number(otrasRows[0]?.total ?? 0);

  return {
    totalEmpleados,
    totalBajas,
    presentesHoy,
    ausentesHoy,
    enVacaciones,
    otrasIncidenciasHoy,
  };
}

/**
 * Bandeja operativa del día. Clasifica a cada empleado activo sin duplicarlo,
 * con prioridad Vacaciones > Otra incidencia > Sin marcaje; quien tiene jornada
 * hoy y ninguna incidencia vigente no aparece.
 *
 * RRHH-DASHBOARD-SITUACION-1 — antes era UNA consulta agregada (LEFT JOIN doble
 * + GROUP_CONCAT(DISTINCT CASE ... ORDER BY otra_columna) + MAX(CASE) +
 * COUNT(DISTINCT) + HAVING/ORDER BY sobre alias) que en producción fallaba y
 * dejaba "Situación del personal: no disponible". Ahora son TRES lecturas
 * planas (empleados activos, jornadas de hoy, incidencias vigentes hoy), con
 * los mismos predicados que ya usan los indicadores del mismo dashboard, y la
 * clasificación se hace en TypeScript. Solo lectura y SIEMPRE acotada por
 * empresa_id (la empresa de la sesión); las incidencias solo se cruzan con los
 * empleados activos de esa misma empresa.
 */
export async function obtenerSituacionEmpleadosHoy(
  empresaId: number,
): Promise<SituacionEmpleadoHoy[]> {
  const fechaHoy = hoyLocal();
  const [empleados, sesiones, incidencias] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT id, codigo, nombre FROM empleados
       WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre`,
      [empresaId],
    ),
    query<RowDataPacket[]>(
      `SELECT DISTINCT id_empleado FROM sesiones_trabajo
       WHERE empresa_id = ? AND fecha_jornada = ?`,
      [empresaId, fechaHoy],
    ),
    query<RowDataPacket[]>(
      `SELECT id_empleado, tipo FROM incidencias
       WHERE empresa_id = ? AND ? BETWEEN fecha_inicio AND fecha_fin`,
      [empresaId, fechaHoy],
    ),
  ]);

  const conSesion = new Set(sesiones.map((r) => Number(r.id_empleado)));
  const tiposPorEmpleado = new Map<number, string[]>();
  for (const r of incidencias) {
    const tipo = r.tipo == null ? "" : String(r.tipo).trim();
    if (!tipo) continue;
    const id = Number(r.id_empleado);
    const lista = tiposPorEmpleado.get(id);
    if (lista) lista.push(tipo); else tiposPorEmpleado.set(id, [tipo]);
  }

  const RANGO = { Vacaciones: 0, "Otra incidencia": 1, "Sin marcaje": 2 } as const;
  const resultado: SituacionEmpleadoHoy[] = [];
  const vistos = new Set<number>();
  for (const e of empleados) {
    const id = Number(e.id);
    if (vistos.has(id)) continue; // nunca duplicar un empleado
    vistos.add(id);
    const tipos = tiposPorEmpleado.get(id) ?? [];
    const vacaciones = tipos.some((t) => /vacaciones/i.test(t));
    const otras = [...new Set(tipos.filter((t) => !/vacaciones/i.test(t)))].sort((a, b) => a.localeCompare(b, "es"));
    let situacion: SituacionEmpleadoHoy["situacion"];
    let detalle: string;
    if (vacaciones) { situacion = "Vacaciones"; detalle = "Vacaciones vigentes"; }
    else if (otras.length) { situacion = "Otra incidencia"; detalle = otras.join(", "); }
    else if (!conSesion.has(id)) { situacion = "Sin marcaje"; detalle = "No registra jornada hoy"; }
    else continue; // con jornada hoy y sin incidencia: no aparece en la bandeja
    resultado.push({ idEmpleado: id, codigo: String(e.codigo ?? ""), nombre: String(e.nombre ?? ""), situacion, detalle });
  }
  // Vacaciones, luego otras incidencias, luego sin marcaje; dentro de cada grupo se conserva el orden por nombre (sort estable).
  return resultado.sort((a, b) => RANGO[a.situacion] - RANGO[b.situacion]);
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
