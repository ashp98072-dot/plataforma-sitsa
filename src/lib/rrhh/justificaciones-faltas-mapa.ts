import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import type { JustificacionResumen } from "./justificaciones-faltas-shared";

/**
 * Justificaciones ACTIVAS de un rango, por `${empleadoId}|${fecha}` (UNA consulta, acotada por empresa). Módulo mínimo e
 * independiente para que `reportes.ts` pueda consumirlo sin dependencia circular. Sin tabla aún (migración no aplicada) ⇒ mapa
 * vacío: el reporte se comporta exactamente como antes.
 */
export async function mapaJustificacionesActivas(empresaId: number, desde: string, hasta: string): Promise<Map<string, JustificacionResumen>> {
  const mapa = new Map<string, JustificacionResumen>();
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, empleado_id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, tipo, observacion, version, creado_por,
              DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en
         FROM rrhh_asistencia_justificaciones
        WHERE empresa_id = ? AND estado = 'ACTIVA' AND fecha BETWEEN ? AND ?`,
      [empresaId, desde, hasta],
    );
    for (const r of rows ?? []) {
      mapa.set(`${Number(r.empleado_id)}|${String(r.fecha)}`, {
        id: Number(r.id),
        tipo: String(r.tipo),
        observacion: r.observacion == null ? null : String(r.observacion),
        version: Number(r.version),
        creadoPor: String(r.creado_por),
        creadoEn: String(r.creado_en),
      });
    }
  } catch (e) {
    if ((e as { errno?: number }).errno !== 1146) throw e; // ER_NO_SUCH_TABLE: migración aún no aplicada
  }
  return mapa;
}
