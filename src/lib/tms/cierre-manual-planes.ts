import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

/**
 * Planes Cerrado que se cerraron MANUALMENTE (cierre_manual = 1, ver
 * cierre-viaje.ts). Solo sirve para rotular "Cierre manual / sin llegada
 * física registrada" en pantalla y reportes; NUNCA cambia ninguna fecha.
 *
 * Lectura tolerante: si la columna no existe en este entorno, o la consulta
 * falla, simplemente no se marca ninguno (la pantalla sigue mostrando "Regreso
 * real: No registrado" y el cierre administrativo). Acotada por empresa_id;
 * el llamador pasa solo ids de planes ya leídos de esa empresa (y Cerrado).
 */
export async function planesConCierreManual(empresaId: number, planIds: number[]): Promise<Set<number>> {
  const ids = [...new Set(planIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return new Set();
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, cierre_manual FROM tms_planes_viaje
       WHERE empresa_id = ? AND cierre_manual = 1 AND id IN (${ids.map(() => "?").join(",")})`,
      [empresaId, ...ids],
    );
    return new Set(rows.filter((r) => Number(r.cierre_manual) === 1).map((r) => Number(r.id)));
  } catch {
    return new Set();
  }
}
