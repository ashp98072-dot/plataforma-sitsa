import type { PoolConnection } from "mysql2/promise";
import { ErrorCB2 } from "./cb2/model";
import { rows } from "./cb2/repository";

/** Contract from schema.sql and the private restored schema, not from consumption fixtures.
 * Both TMS references identify flota IDs; unidad_id itself is a tms_unidades ID.
 * Scan all companies without exposing their operational data or moving references. */
export async function sinOperacionesAbiertas(c: PoolConnection, ids: number[]) {
  if (!ids.length) throw new ErrorCB2("Faltan unidades para revisar operaciones.", 400);
  const requeridas: Record<string, string[]> = {
    flota_viajes: ["id", "vehiculo_id", "estado", "hora_llegada"],
    tms_planes_viaje: ["id", "tc_vehiculo_id", "unidad_id", "estado"],
    tms_unidades: ["id", "flota_vehiculo_id"],
  };
  const columnas = await rows(c, "SELECT c.TABLE_NAME,c.COLUMN_NAME,t.ENGINE FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME WHERE c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME IN ('flota_viajes','tms_planes_viaje','tms_unidades')");
  const faltantes = Object.entries(requeridas).flatMap(([tabla, campos]) => campos.filter(campo => !columnas.some(c => c.TABLE_NAME === tabla && c.COLUMN_NAME === campo && c.ENGINE === "InnoDB")).map(campo => `${tabla}.${campo}`));
  if (faltantes.length) throw new ErrorCB2(`Esquema de operaciones incompatible: comprobar preflight (${faltantes.join(", ")}).`, 503);
  const marks = ids.map(() => "?").join(",");
  // A closed Flota trip requires physical arrival; date does not reopen historical trips.
  const viajes = await rows(c, `SELECT id FROM flota_viajes WHERE vehiculo_id IN (${marks}) AND (estado IS NULL OR estado<>'cerrado' OR hora_llegada IS NULL) FOR UPDATE`, ids);
  // Descargado is still pending administrative closure. Unknown states block conservatively.
  // Terminal plans never reserve the unit just because fecha_plan is today/future.
  const planes = await rows(c, `SELECT p.id FROM tms_planes_viaje p LEFT JOIN tms_unidades u ON u.id=p.unidad_id WHERE (p.tc_vehiculo_id IN (${marks}) OR u.flota_vehiculo_id IN (${marks})) AND (p.estado IS NULL OR p.estado NOT IN ('Cerrado','Cancelado')) ORDER BY p.id FOR UPDATE`, [...ids, ...ids]);
  if (viajes.length || planes.length) throw new ErrorCB2("Hay viajes, reservas o diferencias operativas pendientes; resolver antes de consolidar.");
}
