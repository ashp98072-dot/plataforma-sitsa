import type { RowDataPacket } from "mysql2";
import { estadoEsquemaFisico } from "./identidad-fisica-schema";
import { query, type SqlValue } from "@/lib/db";

/** Read aliases independently of the flag that authorizes NEW merges. Historical IDs remain untouched. */
export async function catalogoSinAlias<T extends { id: number; descripcion?: unknown; empresa_id?: unknown }>(vehiculos: T[], empresaId?: number, consultar: (sql:string,args?:SqlValue[])=>Promise<RowDataPacket[]> = (sql,args)=>query<RowDataPacket[]>(sql,args)) {
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
  const miembros=await consultar(`SELECT m.vehiculo_id,m.identidad_id FROM flota_identidad_miembros m JOIN flota_identidades_fisicas f ON f.id=m.identidad_id AND f.estado='APROBADA' WHERE m.vehiculo_id IN (${marks})`,ids);
  const fisicas=new Map(miembros.map(m=>[Number(m.vehiculo_id),Number(m.identidad_id)])), elegidos=new Map<number,T>();
  for(const v of disponibles){const id=fisicas.get(v.id);if(!id)continue;const anterior=elegidos.get(id);if(!anterior||(Number(v.empresa_id)===empresaId&&Number(anterior.empresa_id)!==empresaId)||((Number(v.empresa_id)===empresaId)===(Number(anterior.empresa_id)===empresaId)&&v.id<anterior.id))elegidos.set(id,v);}
  return disponibles.filter(v=>!fisicas.has(v.id)||elegidos.get(fisicas.get(v.id)!)?.id===v.id).map(v=>fisicas.has(v.id)?{...v,identidadFisicaId:fisicas.get(v.id),descripcion:`${v.descripcion??""} - Unidad fisica #${fisicas.get(v.id)} - registro #${v.id}`} : v);
}
