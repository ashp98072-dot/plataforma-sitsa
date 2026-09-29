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
  /** ATRACCION-TALENTO-2 — filtro por entrevistador principal (usuario). Coexiste con el histórico entrevistadorEmpleadoId. */
  entrevistadorUsuarioId?: number;
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
  /**
   * ATRACCION-TALENTO-2 (sección 10) — clave conceptual para evitar
   * colisión entre un usuario.id y un empleado.id que compartan el mismo
   * número: "u:15" (usuario), "e:37" (empleado histórico) o "sin".
   */
  clave: string;
  entrevistadorUsuarioId: number | null;
  entrevistadorEmpleadoId: number | null;
  /** "Sin entrevistador asignado" cuando no hay ninguno de los dos. */
  entrevistadorNombre: string;
  /** true cuando el nombre viene del empleado histórico (entrevistadorEmpleadoId), no de un usuario. */
  historico: boolean;
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
  /** true cuando entrevistadorNombre viene del empleado histórico, no de un usuario. */
  entrevistadorHistorico: boolean;
  /** ATRACCION-TALENTO-2 (sección 11) — auxiliar de entrevista (usuario), null si no se asignó. */
  auxiliarNombre: string | null;
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
  if (f.entrevistadorUsuarioId != null) {
    cond.push("ent.entrevistador_usuario_id = ?");
    params.push(f.entrevistadorUsuarioId);
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

/**
 * ATRACCION-TALENTO-2 (sección 10) — agrupa por una CLAVE conceptual
 * ("u:<id>" / "e:<id>" / "sin"), nunca por el id numérico desnudo: un
 * usuario.id y un empleado.id pueden coincidir en valor sin ser la misma
 * persona, y agrupar solo por el número los fusionaría incorrectamente.
 * `entrevistador_usuario_id` tiene precedencia sobre el empleado histórico
 * (mismo criterio que resolverEntrevistadorMostrado en entrevistas.ts).
 */
export async function obtenerReportePorEntrevistador(
  empresaId: number,
  filtros: FiltrosReporteEntrevistas,
): Promise<ReportePorEntrevistador[]> {
  const { where, params } = construirFiltros(empresaId, filtros);
  const rows = await query<RowDataPacket[]>(
    `SELECT
       CASE
         WHEN ent.entrevistador_usuario_id IS NOT NULL THEN CONCAT('u:', ent.entrevistador_usuario_id)
         WHEN ent.entrevistador_empleado_id IS NOT NULL THEN CONCAT('e:', ent.entrevistador_empleado_id)
         ELSE 'sin'
       END AS clave,
       ent.entrevistador_usuario_id, ent.entrevistador_empleado_id,
       COALESCE(NULLIF(TRIM(ue.nombre), ''), ue.username) AS usuario_nombre,
       e.nombre AS empleado_nombre,
       COUNT(*) AS asignadas,
       COALESCE(SUM(CASE WHEN ent.estado = 'Realizada' THEN 1 ELSE 0 END), 0) AS realizadas,
       COALESCE(SUM(CASE WHEN ent.resultado = 'Aprobado' THEN 1 ELSE 0 END), 0) AS aprobados,
       COALESCE(SUM(CASE WHEN ent.resultado = 'Rechazado' THEN 1 ELSE 0 END), 0) AS rechazados,
       COALESCE(SUM(CASE WHEN ent.resultado = 'Pendiente' THEN 1 ELSE 0 END), 0) AS pendientes
     FROM entrevistas ent
     LEFT JOIN empleados e ON e.id = ent.entrevistador_empleado_id AND e.empresa_id = ent.empresa_id
     LEFT JOIN usuarios ue ON ue.id = ent.entrevistador_usuario_id
     WHERE ${where}
     GROUP BY clave, ent.entrevistador_usuario_id, ent.entrevistador_empleado_id, usuario_nombre, empleado_nombre
     ORDER BY asignadas DESC`,
    params,
  );
  return rows.map((r) => {
    const clave = String(r.clave);
    const esUsuario = clave.startsWith("u:");
    const esHistorico = clave.startsWith("e:");
    const entrevistadorNombre = esUsuario
      ? String(r.usuario_nombre ?? "")
      : esHistorico
        ? String(r.empleado_nombre ?? "")
        : "Sin entrevistador asignado";
    return {
      clave,
      entrevistadorUsuarioId: r.entrevistador_usuario_id != null ? Number(r.entrevistador_usuario_id) : null,
      entrevistadorEmpleadoId: r.entrevistador_empleado_id != null ? Number(r.entrevistador_empleado_id) : null,
      entrevistadorNombre: entrevistadorNombre || "Sin entrevistador asignado",
      historico: esHistorico,
      asignadas: Number(r.asignadas ?? 0),
      realizadas: Number(r.realizadas ?? 0),
      aprobados: Number(r.aprobados ?? 0),
      rechazados: Number(r.rechazados ?? 0),
      pendientes: Number(r.pendientes ?? 0),
    };
  });
}

/** Listado detallado filtrado, más reciente primero. Tope defensivo (evita payloads sin límite, mismo criterio que el resto del proyecto). */
export async function obtenerDetalleEntrevistas(
  empresaId: number,
  filtros: FiltrosReporteEntrevistas,
): Promise<DetalleEntrevistaReporte[]> {
  const { where, params } = construirFiltros(empresaId, filtros);
  const rows = await query<RowDataPacket[]>(
    `SELECT ent.id, DATE_FORMAT(ent.fecha_hora, '%Y-%m-%dT%H:%i:%s') AS fecha_hora_iso,
            ent.candidato_nombre, ent.puesto,
            COALESCE(NULLIF(TRIM(ue.nombre), ''), ue.username) AS entrevistador_usuario_nombre,
            e.nombre AS entrevistador_empleado_nombre,
            COALESCE(NULLIF(TRIM(ua.nombre), ''), ua.username) AS auxiliar_nombre,
            ent.modalidad, ent.estado, ent.resultado
     FROM entrevistas ent
     LEFT JOIN empleados e ON e.id = ent.entrevistador_empleado_id AND e.empresa_id = ent.empresa_id
     LEFT JOIN usuarios ue ON ue.id = ent.entrevistador_usuario_id
     LEFT JOIN usuarios ua ON ua.id = ent.auxiliar_usuario_id
     WHERE ${where}
     ORDER BY ent.fecha_hora DESC
     LIMIT 500`,
    params,
  );
  return rows.map((r) => {
    const entrevistadorHistorico = !r.entrevistador_usuario_nombre && !!r.entrevistador_empleado_nombre;
    const entrevistadorNombre = r.entrevistador_usuario_nombre
      ? String(r.entrevistador_usuario_nombre)
      : r.entrevistador_empleado_nombre
        ? String(r.entrevistador_empleado_nombre)
        : null;
    return {
      id: Number(r.id),
      fechaHora: String(r.fecha_hora_iso),
      candidatoNombre: String(r.candidato_nombre),
      puesto: String(r.puesto),
      entrevistadorNombre,
      entrevistadorHistorico,
      auxiliarNombre: r.auxiliar_nombre ? String(r.auxiliar_nombre) : null,
      modalidad: String(r.modalidad),
      estado: String(r.estado),
      resultado: String(r.resultado),
    };
  });
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
