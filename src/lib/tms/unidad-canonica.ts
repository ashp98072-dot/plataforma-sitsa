import type { PoolConnection,RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { placaComparable } from "@/lib/flota/combustible-coincidencias";
import { resolverUnidadCanonica } from "@/lib/flota/unidad-canonica";
import { ErrorCB2 } from "@/lib/flota/cb2/model";
/** Usa la conexión del plan/copia. Nunca modifica una unidad TMS usada por históricos. */
export async function resolverUnidadTmsTx(c:PoolConnection,empresa:number,placa:string,flotaId:number|null,tipo="Camion") {
 const key=placaComparable(placa);if(!key)throw new ErrorCB2("Placa no verificable.",400);
 const [empresaVigente]=await c.query<RowDataPacket[]>("SELECT id FROM empresas WHERE id=? AND activa=1 FOR UPDATE",[empresa]);if(!empresaVigente.length)throw new ErrorCB2("Empresa no vigente.",403);
 let canon=flotaId,canonPlaca=key;
 if(canon===null){const [flota]=await c.query<RowDataPacket[]>("SELECT v.id,v.empresa_id,v.placa,v.activo,v.estado FROM flota_vehiculos v WHERE (v.empresa_id=? OR EXISTS(SELECT 1 FROM flota_vehiculo_acceso a WHERE a.vehiculo_id=v.id AND a.empresa_id=?)) AND v.activo=1 ORDER BY v.id",[empresa,empresa]);const coincidencias=flota.filter(v=>placaComparable(String(v.placa))===key);if(coincidencias.length){const u=await resolverUnidadCanonica(c,empresa,Number(coincidencias[0].id),true);if(coincidencias.some(v=>!u.idsHistoricos.includes(Number(v.id))))throw new ErrorCB2("Placa ambigua: revisar identidad física antes de crear unidad TMS.");canon=u.vehiculoCanonicoId;canonPlaca=u.placa;}}

 if(canon){const u=await resolverUnidadCanonica(c,empresa,canon,true);canon=u.vehiculoCanonicoId;canonPlaca=u.placa;}
 const [unidades]=await c.query<RowDataPacket[]>("SELECT id,placa,flota_vehiculo_id FROM tms_unidades WHERE empresa_id=? ORDER BY id FOR UPDATE",[empresa]);
 const porIdentidad=canon?unidades.filter(u=>Number(u.flota_vehiculo_id)===canon):[];
 const porPlaca=unidades.filter(u=>placaComparable(String(u.placa))===placaComparable(canonPlaca));
 if(porIdentidad.length)return Number(porIdentidad[0].id);
 if(porPlaca.length){
  // Completar un vínculo NULL también reinterpretaría los planes que ya usaron ese ID.
  if(porPlaca.length!==1 || (canon!==null && Number(porPlaca[0].flota_vehiculo_id)!==canon) || (canon===null&&porPlaca[0].flota_vehiculo_id!==null))throw new ErrorCB2("Conflicto de identidad TMS: revisar los vínculos existentes; no se reescriben planes históricos.");
  return Number(porPlaca[0].id);
 }
 await c.execute("INSERT INTO tms_unidades(empresa_id,placa,tipo,flota_vehiculo_id) VALUES(?,?,?,?)",[empresa,canonPlaca,tipo,canon]);
 // SELECT empresarial, en la misma conexión, incluso cuando insertId sea cero.
 const [creada]=await c.query<RowDataPacket[]>("SELECT id FROM tms_unidades WHERE empresa_id=? AND placa=? AND flota_vehiculo_id <=> ?",[empresa,canonPlaca,canon]);
 const id=Number(creada[0]?.id);if(creada.length!==1||!Number.isInteger(id)||id<=0)throw new ErrorCB2("No se pudo resolver una unidad TMS única.");return id;
}
export async function resolverUnidadTms(empresa:number,placa:string,flotaId:number|null,tipo="Camion") {
 const c=await getPool().getConnection();let commit=false,limpia=false;
 try{await c.beginTransaction();const id=await resolverUnidadTmsTx(c,empresa,placa,flotaId,tipo);commit=true;await c.commit();limpia=true;return id;}
 catch(e){try{await c.rollback();limpia=!commit;}catch{}if(commit)throw new ErrorCB2("Resultado incierto al resolver unidad; consulta antes de reintentar.",503,true);throw e;}
 finally{if(limpia)c.release();else c.destroy();}
}
