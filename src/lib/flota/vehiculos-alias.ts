import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { ErrorCB2 } from "./cb2/model";
import { estadoEsquemaFisico } from "./identidad-fisica-schema";
import { query, type SqlValue } from "@/lib/db";

/**
 * ID canónico de un vehículo absorbido por una fusión (alias). Un ID sin alias —o sin la tabla de fusiones instalada— se devuelve
 * tal cual. Sirve para que las operaciones NUEVAS se asocien a la identidad canónica sin tocar nunca la historia existente.
 * Las fusiones no admiten cadenas (trigger), así que basta un salto.
 */
export async function canonizarVehiculoTx(c: PoolConnection, empresaId: number, id: number | null | undefined): Promise<number | null> {
  if (id == null) return null;
  const [tabla] = await c.query<RowDataPacket[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_vehiculos_fusiones'");
  if (!tabla.length) return id;
  const [alias] = await c.query<RowDataPacket[]>("SELECT destino_id FROM flota_vehiculos_fusiones WHERE origen_id=? AND empresa_id=? LIMIT 1", [id, empresaId]);
  return alias[0] ? Number(alias[0].destino_id) : id;
}

/** Para listas de solo lectura (catálogos): ID absorbido -> canónico y su placa; los IDs sin alias no aparecen en el mapa. */
export async function canonicosDeAlias(ids: number[], empresaId: number, consultar: (sql: string, args?: SqlValue[]) => Promise<RowDataPacket[]> = (sql, args) => query<RowDataPacket[]>(sql, args)): Promise<Map<number, { id: number; placa: string | null }>> {
  const unicos = [...new Set(ids.filter((v) => Number.isInteger(v) && v > 0))];
  const mapa = new Map<number, { id: number; placa: string | null }>();
  if (!unicos.length) return mapa;
  const tabla = (await consultar("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_vehiculos_fusiones'")) ?? [];
  if (!tabla.length) return mapa;
  const marks = unicos.map(() => "?").join(",");
  const filas = await consultar(`SELECT f.origen_id, f.destino_id, v.placa FROM flota_vehiculos_fusiones f JOIN flota_vehiculos v ON v.id=f.destino_id WHERE f.empresa_id=? AND f.origen_id IN (${marks})`, [empresaId, ...unicos]);
  for (const f of filas ?? []) mapa.set(Number(f.origen_id), { id: Number(f.destino_id), placa: f.placa != null ? String(f.placa) : null });
  return mapa;
}

/**
 * Todos los IDs de una misma unidad (canónico, absorbidos por alias e identidad física aprobada) para leer su historia completa en
 * reportes. Si la unidad no existe en la empresa se devuelve solo el ID pedido (el reporte queda vacío, como antes).
 */
export async function idsHistoricosVehiculo(empresaId: number, vehiculoId: number): Promise<number[]> {
  const { getPool } = await import("@/lib/db");
  const { resolverUnidadCanonica } = await import("./unidad-canonica");
  const c = await getPool().getConnection();
  try {
    return (await resolverUnidadCanonica(c, empresaId, vehiculoId)).idsHistoricos;
  } catch (e) {
    if (e instanceof ErrorCB2 && e.status === 404) return [vehiculoId];
    throw e;
  } finally {
    c.release();
  }
}

/** Read aliases independently of the flag that authorizes NEW merges. Historical IDs remain untouched. */
export async function catalogoSinAlias<T extends { id: number; descripcion?: unknown; empresa_id?: unknown }>(vehiculos: T[], empresaId?: number, consultar: (sql:string,args?:SqlValue[])=>Promise<RowDataPacket[]> = (sql,args)=>query<RowDataPacket[]>(sql,args)):Promise<(T & {identidadFisicaId?:number;identidadCanonica?:string;vehiculoCanonicoId?:number;equivalenciasHistoricas?:number[]})[]> {
  if (!vehiculos.length) return vehiculos;
  const exists = await consultar("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_vehiculos_fusiones'");

  const ids = vehiculos.map(v => v.id), marks = ids.map(() => "?").join(",");
  const aliases = exists.length ? await consultar(`SELECT origen_id,destino_id FROM flota_vehiculos_fusiones WHERE origen_id IN (${marks}) OR destino_id IN (${marks})`, [...ids, ...ids]) : [];
  const origenes = new Set(aliases.map(a => Number(a.origen_id))), principales = new Set(aliases.map(a => Number(a.destino_id)));
  const disponibles = vehiculos.filter(v => !origenes.has(v.id)).map(v => principales.has(v.id)
    ? { ...v, principalFusion: true, descripcion: `${v.descripcion ?? ""} · Principal #${v.id}`.trim() }
    : v);
  const estado=await estadoEsquemaFisico((sql,args)=>consultar(sql,args));
  if(estado==="AUSENTE")return disponibles;
  if(estado!=="COMPLETO")throw Error("Esquema de identidad fisica parcial; catalogo bloqueado.");
  const miembros=await consultar(`SELECT m.vehiculo_id,m.identidad_id FROM flota_identidad_miembros m JOIN flota_identidades_fisicas f ON f.id=m.identidad_id AND f.estado='APROBADA' WHERE m.identidad_id IN (SELECT x.identidad_id FROM flota_identidad_miembros x WHERE x.vehiculo_id IN (${marks}))`,ids);
  const fisicas=new Map(miembros.map(m=>[Number(m.vehiculo_id),Number(m.identidad_id)])), elegidos=new Map<number,T>();
  for(const v of disponibles){const id=fisicas.get(v.id);if(!id)continue;const anterior=elegidos.get(id);if(!anterior||(Number(v.empresa_id)===empresaId&&Number(anterior.empresa_id)!==empresaId)||((Number(v.empresa_id)===empresaId)===(Number(anterior.empresa_id)===empresaId)&&v.id<anterior.id))elegidos.set(id,v);}
  return disponibles.filter(v=>!fisicas.has(v.id)||elegidos.get(fisicas.get(v.id)!)?.id===v.id).map(v=>fisicas.has(v.id)?{...v,identidadFisicaId:fisicas.get(v.id),identidadCanonica:`FISICA:${fisicas.get(v.id)}`,vehiculoCanonicoId:v.id,equivalenciasHistoricas:miembros.filter(m=>Number(m.identidad_id)===fisicas.get(v.id)).map(m=>Number(m.vehiculo_id)),descripcion:`${v.descripcion??""} - Unidad fisica #${fisicas.get(v.id)} - registro #${v.id}`} : v);
}
