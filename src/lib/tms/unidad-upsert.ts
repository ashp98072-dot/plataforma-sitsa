/**
 * URGENTE — «ER_NO_REFERENCED_ROW_2 … fk_tmsplan_uni» al crear/copiar viajes.
 *
 * `INSERT INTO tms_unidades … ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)` se usaba para obtener el id de la unidad
 * (existente o nueva) a partir de `insertId`. Con las guardas de fusión de flota instaladas en `tms_unidades`
 * (triggers BEFORE UPDATE `ffu_*`), una unidad YA existente cuyo `flota_vehiculo_id` no cambia devuelve `insertId = 0`
 * (reproducido en MariaDB: ver planes-codigo-unico.db.test.ts). El viaje se insertaba con `unidad_id = 0`, que no existe
 * en `tms_unidades`, y la FK fallaba tanto en el alta individual como en la copia masiva.
 *
 * Módulo PURO (sin acceso a base de datos): el llamador aporta la búsqueda con SU PROPIO ejecutor (misma conexión/transacción).
 */
export async function idUnidadTrasUpsert(insertId: unknown, buscarPorPlaca: () => Promise<number | null>): Promise<number> {
  const n = Number(insertId);
  if (Number.isInteger(n) && n > 0) return n;
  const id = await buscarPorPlaca();
  if (!id || !Number.isInteger(id) || id <= 0) throw new Error("No se pudo resolver la unidad de la placa indicada.");
  return id;
}
