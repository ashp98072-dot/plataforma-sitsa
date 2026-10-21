import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

/**
 * Criterio ÚNICO de "este documento es la fotografía del empleado": expediente tipo 'Foto' con extensión de imagen.
 * Lo comparten el endpoint privado de la foto (que sirve la más reciente) y el listado (que solo necesita saber si existe),
 * para que la miniatura nunca pida el endpoint cuando éste respondería 404 por falta de registro.
 */
export const FILTRO_FOTO_EMPLEADO = `tipo_documento = 'Foto' AND LOWER(ruta_archivo) REGEXP '[.](jpg|jpeg|png|webp)$'`;

/** IDs (de `ids`, dentro de `empresaId`) que tienen un registro de fotografía. Una sola consulta en lote; no expone rutas. */
export async function empleadosConFoto(empresaId: number, ids: number[]): Promise<Set<number>> {
  const conFoto = new Set<number>();
  if (ids.length === 0) return conFoto;
  const ph = ids.map(() => "?").join(",");
  const rows = await query<RowDataPacket[]>(
    `SELECT DISTINCT id_empleado FROM documentos_empleados
     WHERE empresa_id = ? AND id_empleado IN (${ph}) AND ${FILTRO_FOTO_EMPLEADO}`,
    [empresaId, ...ids],
  );
  for (const r of rows) conFoto.add(Number(r.id_empleado));
  return conFoto;
}
