import type { RowDataPacket } from "mysql2";
import { query, type SqlParams } from "@/lib/db";
import type { EstadoEntrevista, ResultadoEntrevista } from "./entrevistas";

/**
 * ATRACCION-TALENTO-1 (sección 9-17 del ticket) — reportes de Atracción de
 * Talento Humano: resumen, agrupación por puesto/entrevistador y listado
 * detallado, todos sobre la tabla `entrevistas` YA existente (SQL
 * REQUERIDO: NO — ya almacena fecha/hora, puesto, entrevistador, modalidad,
 * estado, resultado, candidato). Deliberadamente separado de
 * entrevistas.ts (que es CRUD del calendario) para no mezclar responsabilidades.
 *
 * Performance (sección 17): 4 queries FIJAS (resumen, por puesto, por
 * entrevistador, detalle) sin importar cuántas entrevistas haya — nunca una
 * consulta por fila. Los filtros de fecha son sargables
 * (`fecha_hora >= ?` / `fecha_hora < ?`, nunca `DATE(fecha_hora)` sobre la
 * columna) — el límite superior se calcula con `DATE_ADD(?, INTERVAL 1 DAY)`
 * sobre el PARÁMETRO, no sobre la columna.
 */

export type FiltrosReporteEntrevistas = {
  fechaDesde?: string;
  fechaHasta?: string;
  puesto?: string;
  estado?: EstadoEntrevista;
  resultado?: ResultadoEntrevista;
  entrevistadorEmpleadoId?: number;
  candidato?: string;
};

export type ResumenEntrevistas = {
  total: number;
  programadas: number;
  realizadas: number;
  canceladas: number;
  noAsistio: number;
  aprobados: number;
  rechazados: number;
  pendientes: number;
  /** aprobados / (aprobados + rechazados). `null` si el denominador es 0 (nunca cuenta Pendiente). */
  tasaAprobacion: number | null;
};

export type ReportePorPuesto = {
  puesto: string;
  entrevistas: number;
  realizadas: number;
  aprobados: number;
  rechazados: number;
  pendientes: number;
  tasaAprobacion: number | null;
};

export type ReportePorEntrevistador = {
  entrevistadorEmpleadoId: number | null;
  /** "Sin entrevistador asignado" cuando entrevistadorEmpleadoId es null. */
  entrevistadorNombre: string;
  asignadas: number;
  realizadas: number;
  aprobados: number;
  rechazados: number;
  pendientes: number;
};

export type DetalleEntrevistaReporte = {
  id: number;
  fechaHora: string;
  candidatoNombre: string;
  puesto: string;
  entrevistadorNombre: string | null;
  modalidad: string;
  estado: string;
  resultado: string;
};

function construirFiltros(empresaId: number, f: FiltrosReporteEntrevistas): { where: string; params: SqlParams } {
  const cond: string[] = ["ent.empresa_id = ?"];
  const params: SqlParams = [empresaId];
  if (f.fechaDesde) {
    cond.push("ent.fecha_hora >= ?");
    params.push(`${f.fechaDesde} 00:00:00`);
  }
  if (f.fechaHasta) {
    // Sargable: el límite se calcula sobre el PARÁMETRO (DATE_ADD(?, INTERVAL 1 DAY)), nunca envolviendo la columna
    // en DATE(...) — evita forzar un escaneo completo de la tabla al filtrar por fecha.
    cond.push("ent.fecha_hora < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(f.fechaHasta);
  }
  if (f.puesto?.trim()) {
    cond.push("ent.puesto = ?");
    params.push(f.puesto.trim());
  }
  if (f.estado) {
    cond.push("ent.estado = ?");
    params.push(f.estado);
  }
  if (f.resultado) {
    cond.push("ent.resultado = ?");
    params.push(f.resultado);
  }
  if (f.entrevistadorEmpleadoId != null) {
    cond.push("ent.entrevistador_empleado_id = ?");
    params.push(f.entrevistadorEmpleadoId);
  }
  if (f.candidato?.trim()) {
    cond.push("ent.candidato_nombre LIKE ?");
    params.push(`%${f.candidato.trim()}%`);
  }
  return { where: cond.join(" AND "), params };
}

function tasaAprobacion(aprobados: number, rechazados: number): number | null {
  const denom = aprobados + rechazados;
  if (denom === 0) return null;
  return Math.round((aprobados / denom) * 1000) / 10; // 1 decimal, ej. 66.7
}

export async function obtenerResumenEntrevistas(
  empresaId: number,
  filtros: FiltrosReporteEntrevistas,
): Promise<ResumenEntrevistas> {
  const { where, params } = construirFiltros(empresaId, filtros);
  const [row] = await query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN ent.estado = 'Programada' THEN 1 ELSE 0 END), 0) AS programadas,
       COALESCE(SUM(CASE WHEN ent.estado = 'Realizada' THEN 1 ELSE 0 END), 0) AS realizadas,
       COALESCE(SUM(CASE WHEN ent.estado = 'Cancelada' THEN 1 ELSE 0 END), 0) AS canceladas,
       COALESCE(SUM(CASE WHEN ent.estado = 'No asistió' THEN 1 ELSE 0 END), 0) AS no_asistio,
       COALESCE(SUM(CASE WHEN ent.resultado = 'Aprobado' THEN 1 ELSE 0 END), 0) AS aprobados,
       COALESCE(SUM(CASE WHEN ent.resultado = 'Rechazado' THEN 1 ELSE 0 END), 0) AS rechazados,
       COALESCE(SUM(CASE WHEN ent.resultado = 'Pendiente' THEN 1 ELSE 0 END), 0) AS pendientes
     FROM entrevistas ent
     WHERE ${where}`,
    params,
  );
  const aprobados = Number(row?.aprobados ?? 0);
  const rechazados = Number(row?.rechazados ?? 0);
  return {
    total: Number(row?.total ?? 0),
    programadas: Number(row?.programadas ?? 0),
    realizadas: Number(row?.realizadas ?? 0),
    canceladas: Number(row?.canceladas ?? 0),
    noAsistio: Number(row?.no_asistio ?? 0),
    aprobados,
    rechazados,
    pendientes: Number(row?.pendientes ?? 0),
    tasaAprobacion: tasaAprobacion(aprobados, rechazados),
  };
}

export async function obtenerReportePorPuesto(
  empresaId: number,
  filtros: FiltrosReporteEntrevistas,
): Promise<ReportePorPuesto[]> {
  const { where, params } = construirFiltros(empresaId, filtros);
  const rows = await query<RowDataPacket[]>(
    `SELECT
       ent.puesto,
       COUNT(*) AS entrevistas,
       COALESCE(SUM(CASE WHEN ent.estado = 'Realizada' THEN 1 ELSE 0 END), 0) AS realizadas,
       COALESCE(SUM(CASE WHEN ent.resultado = 'Aprobado' THEN 1 ELSE 0 END), 0) AS aprobados,
       COALESCE(SUM(CASE WHEN ent.resultado = 'Rechazado' THEN 1 ELSE 0 END), 0) AS rechazados,
       COALESCE(SUM(CASE WHEN ent.resultado = 'Pendiente' THEN 1 ELSE 0 END), 0) AS pendientes
     FROM entrevistas ent
     WHERE ${where}
     GROUP BY ent.puesto
     ORDER BY entrevistas DESC, ent.puesto`,
    params,
  );
  return rows.map((r) => {
    const aprobados = Number(r.aprobados ?? 0);
    const rechazados = Number(r.rechazados ?? 0);
    return {
      puesto: String(r.puesto),
      entrevistas: Number(r.entrevistas ?? 0),
      realizadas: Number(r.realizadas ?? 0),
      aprobados,
      rechazados,
      pendientes: Number(r.pendientes ?? 0),
      tasaAprobacion: tasaAprobacion(aprobados, rechazados),
    };
  });
}

export async function obtenerReportePorEntrevistador(
  empresaId: number,
  filtros: FiltrosReporteEntrevistas,
): Promise<ReportePorEntrevistador[]> {
  const { where, params } = construirFiltros(empresaId, filtros);
  const rows = await query<RowDataPacket[]>(
    `SELECT
       ent.entrevistador_empleado_id,
       e.nombre AS entrevistador_nombre,
       COUNT(*) AS asignadas,
       COALESCE(SUM(CASE WHEN ent.estado = 'Realizada' THEN 1 ELSE 0 END), 0) AS realizadas,
       COALESCE(SUM(CASE WHEN ent.resultado = 'Aprobado' THEN 1 ELSE 0 END), 0) AS aprobados,
       COALESCE(SUM(CASE WHEN ent.resultado = 'Rechazado' THEN 1 ELSE 0 END), 0) AS rechazados,
       COALESCE(SUM(CASE WHEN ent.resultado = 'Pendiente' THEN 1 ELSE 0 END), 0) AS pendientes
     FROM entrevistas ent
     LEFT JOIN empleados e ON e.id = ent.entrevistador_empleado_id AND e.empresa_id = ent.empresa_id
     WHERE ${where}
     GROUP BY ent.entrevistador_empleado_id, e.nombre
     ORDER BY asignadas DESC`,
    params,
  );
  return rows.map((r) => ({
    entrevistadorEmpleadoId: r.entrevistador_empleado_id != null ? Number(r.entrevistador_empleado_id) : null,
    entrevistadorNombre: r.entrevistador_nombre ? String(r.entrevistador_nombre) : "Sin entrevistador asignado",
    asignadas: Number(r.asignadas ?? 0),
    realizadas: Number(r.realizadas ?? 0),
    aprobados: Number(r.aprobados ?? 0),
    rechazados: Number(r.rechazados ?? 0),
    pendientes: Number(r.pendientes ?? 0),
  }));
}

/** Listado detallado filtrado, más reciente primero. Tope defensivo (evita payloads sin límite, mismo criterio que el resto del proyecto). */
export async function obtenerDetalleEntrevistas(
  empresaId: number,
  filtros: FiltrosReporteEntrevistas,
): Promise<DetalleEntrevistaReporte[]> {
  const { where, params } = construirFiltros(empresaId, filtros);
  const rows = await query<RowDataPacket[]>(
    `SELECT ent.id, DATE_FORMAT(ent.fecha_hora, '%Y-%m-%dT%H:%i:%s') AS fecha_hora_iso,
            ent.candidato_nombre, ent.puesto, e.nombre AS entrevistador_nombre,
            ent.modalidad, ent.estado, ent.resultado
     FROM entrevistas ent
     LEFT JOIN empleados e ON e.id = ent.entrevistador_empleado_id AND e.empresa_id = ent.empresa_id
     WHERE ${where}
     ORDER BY ent.fecha_hora DESC
     LIMIT 500`,
    params,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    fechaHora: String(r.fecha_hora_iso),
    candidatoNombre: String(r.candidato_nombre),
    puesto: String(r.puesto),
    entrevistadorNombre: r.entrevistador_nombre ? String(r.entrevistador_nombre) : null,
    modalidad: String(r.modalidad),
    estado: String(r.estado),
    resultado: String(r.resultado),
  }));
}

export type ReporteEntrevistas = {
  resumen: ResumenEntrevistas;
  porPuesto: ReportePorPuesto[];
  porEntrevistador: ReportePorEntrevistador[];
  detalle: DetalleEntrevistaReporte[];
};

/** Agrega las 4 consultas en una sola llamada conveniente para el endpoint. */
export async function obtenerReporteEntrevistas(
  empresaId: number,
  filtros: FiltrosReporteEntrevistas,
): Promise<ReporteEntrevistas> {
  const [resumen, porPuesto, porEntrevistador, detalle] = await Promise.all([
    obtenerResumenEntrevistas(empresaId, filtros),
    obtenerReportePorPuesto(empresaId, filtros),
    obtenerReportePorEntrevistador(empresaId, filtros),
    obtenerDetalleEntrevistas(empresaId, filtros),
  ]);
  return { resumen, porPuesto, porEntrevistador, detalle };
}
