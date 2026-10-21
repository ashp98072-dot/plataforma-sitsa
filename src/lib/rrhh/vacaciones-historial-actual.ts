import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { toIsoDate } from "./dates";
import {
  armarHistorialExportable,
  filasComoArchivo,
  type EmpleadoExport,
  type IncidenciaActual,
  type ResultadoExport,
  type VacacionActual,
} from "./vacaciones-historial-export";
import { previsualizarHistorial, type ResultadoPreview } from "./vacaciones-historial-preview";

/**
 * Historial ACTUAL de vacaciones (fuente: las tablas de producción) para exportarlo y previsualizarlo con el MISMO motor del importador.
 *
 * SOLO LECTURA: únicamente SELECT (vía `query`); no importa `execute`/`getPool`, no abre transacciones y no escribe en ninguna tabla.
 * Toda consulta va acotada por `empresa_id` (la empresa sale de la sesión, nunca del cliente).
 */

export async function cargarHistorialActual(empresaId: number): Promise<ResultadoExport> {
  const vac = await query<RowDataPacket[]>(
    "SELECT id, id_empleado, fecha_inicio, fecha_fin, dias_habiles, observaciones, estado FROM vacaciones WHERE empresa_id = ? ORDER BY id",
    [empresaId],
  );
  const inc = await query<RowDataPacket[]>(
    "SELECT id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles FROM incidencias WHERE empresa_id = ? AND tipo IN ('Vacaciones', 'A cuenta de Vacaciones') ORDER BY id",
    [empresaId],
  );
  const emp = await query<RowDataPacket[]>("SELECT id, codigo, nombre FROM empleados WHERE empresa_id = ?", [empresaId]);
  let dpis = new Map<number, string>();
  try {
    const d = await query<RowDataPacket[]>("SELECT id, dpi FROM empleados WHERE empresa_id = ?", [empresaId]);
    dpis = new Map(d.filter((r) => r.dpi).map((r) => [Number(r.id), String(r.dpi)]));
  } catch {
    /* la columna dpi aún no existe en esta base: el archivo se identifica por código y nombre */
  }

  const vacaciones: VacacionActual[] = vac.map((r) => ({
    id: Number(r.id), idEmpleado: Number(r.id_empleado), inicio: toIsoDate(r.fecha_inicio as string | Date) ?? "", fin: toIsoDate(r.fecha_fin as string | Date) ?? "",
    dias: Number(r.dias_habiles), observaciones: r.observaciones == null ? null : String(r.observaciones), estado: String(r.estado ?? ""),
  }));
  const incidencias: IncidenciaActual[] = inc.map((r) => ({
    id: Number(r.id), idEmpleado: Number(r.id_empleado), tipo: String(r.tipo), inicio: toIsoDate(r.fecha_inicio as string | Date) ?? "",
    fin: toIsoDate(r.fecha_fin as string | Date) ?? "", dias: Number(r.dias_habiles),
  }));
  const empleados: EmpleadoExport[] = emp.map((r) => ({ id: Number(r.id), codigo: String(r.codigo ?? ""), nombre: String(r.nombre ?? ""), dpi: dpis.get(Number(r.id)) ?? null }));
  return armarHistorialExportable(vacaciones, incidencias, empleados);
}

export type ResultadoPreviewActual = {
  /** Resumen y problemas administrativos del emparejamiento vacaciones ↔ incidencias (sin las filas). */
  exportacion: Pick<ResultadoExport, "problemas" | "resumen">;
  /** El resultado del MISMO motor de la vista previa del importador (#418) sobre las filas exportables. */
  preview: ResultadoPreview;
};

/** «Previsualizar historial actual»: transforma las vacaciones actuales al formato del importador y ejecuta el motor de vista previa. */
export async function previsualizarHistorialActual(empresaId: number, hoy: Date = new Date()): Promise<ResultadoPreviewActual> {
  const exportacion = await cargarHistorialActual(empresaId);
  const preview = await previsualizarHistorial(empresaId, filasComoArchivo(exportacion.filas), hoy);
  return { exportacion: { problemas: exportacion.problemas, resumen: exportacion.resumen }, preview };
}
