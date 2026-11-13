import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

/** Read aliases independently of the flag that authorizes NEW merges. Historical IDs remain untouched. */
export async function catalogoSinAlias<T extends { id: number; descripcion?: unknown }>(vehiculos: T[]) {
  if (!vehiculos.length) return vehiculos;
  const exists = await query<RowDataPacket[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_vehiculos_fusiones'");
  if (!exists.length) return vehiculos;
  const ids = vehiculos.map(v => v.id), marks = ids.map(() => "?").join(",");
  const aliases = await query<RowDataPacket[]>(`SELECT origen_id,destino_id FROM flota_vehiculos_fusiones WHERE origen_id IN (${marks}) OR destino_id IN (${marks})`, [...ids, ...ids]);
  const origenes = new Set(aliases.map(a => Number(a.origen_id))), principales = new Set(aliases.map(a => Number(a.destino_id)));
  return vehiculos.filter(v => !origenes.has(v.id)).map(v => principales.has(v.id)
    ? { ...v, principalFusion: true, descripcion: `${v.descripcion ?? ""} · Principal #${v.id}`.trim() }
    : v);
}
