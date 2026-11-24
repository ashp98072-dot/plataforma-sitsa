import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

/**
 * Criterio único de prioridad FIFO de las capas de costo: antigüedad (creado_en), luego la
 * prioridad efectiva COALESCE(orden_fifo, id) y por último el id. Las capas redistribuidas
 * heredan la prioridad de su origen (orden_fifo), de modo que ni la precisión de segundos ni
 * los ids nuevos alteran el orden real de confirmación. Lo usan salidas y redistribuciones.
 */
export const ORDEN_FIFO = 'creado_en,COALESCE(orden_fifo,id),id';
/** Esquemas anteriores a la migración de redistribución (sin orden_fifo). */
export const ORDEN_FIFO_ANTERIOR = 'creado_en,id';
/** Expresión de prioridad efectiva (requiere la columna orden_fifo). */
export const PRIORIDAD_FIFO = 'COALESCE(orden_fifo,id)';

/**
 * Lee capas con el criterio FIFO vigente. Si la columna orden_fifo aún no existe
 * (ER_BAD_FIELD_ERROR) usa el criterio anterior: sin la migración de redistribución no
 * pueden existir capas redistribuidas, así que ambos criterios producen el mismo orden.
 * El error se produce al analizar la consulta, antes de tomar cualquier bloqueo.
 */
export async function consultarCapasFifo(conn: PoolConnection, construir: (orden: string) => string, params: unknown[]): Promise<RowDataPacket[]> {
  try {
    return (await conn.query<RowDataPacket[]>(construir(ORDEN_FIFO), params))[0];
  } catch (error) {
    if ((error as { errno?: number }).errno !== 1054) throw error;
    return (await conn.query<RowDataPacket[]>(construir(ORDEN_FIFO_ANTERIOR), params))[0];
  }
}
