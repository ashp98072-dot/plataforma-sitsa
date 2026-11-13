import { estadoEsquemaFisico, consultaFisicaTx } from "./identidad-fisica-schema";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ErrorCB2, hash } from "./cb2/model";
import { rows, insert } from "./cb2/repository";
import { predicadoVehiculoAccesible } from "./acceso";
import { placaComparable } from "./combustible-coincidencias";
import { referencias } from "./vehiculos-duplicados";
export type ContextoFisico = {empresaId:number;usuarioId:number;usuario:string;autorizar:()=>Promise<void>};
const serial = (v:unknown)=>String(v??"").trim().toUpperCase().replace(/\s/g,"");
const firma = (v:unknown)=>hash(JSON.stringify(v));
async function actor(c:PoolConnection,ctx:ContextoFisico) {
  await ctx.autorizar();
  const [a]=await rows(c,"SELECT id FROM usuarios WHERE id=? AND activo=1 AND rol_global='Admin' LOCK IN SHARE MODE",[ctx.usuarioId]);
  const [e]=await rows(c,"SELECT id FROM empresas WHERE id=? AND activa=1 LOCK IN SHARE MODE",[ctx.empresaId]);
  if(!a||!e)throw new ErrorCB2("Requiere administrador activo y empresa vigente.",403);
}
async function esquema(c:PoolConnection) {
  if(await estadoEsquemaFisico(consultaFisicaTx(c))!=="COMPLETO")throw new ErrorCB2("Migracion fisica ausente o parcial; verificar postcheck y privilegios.",503);
}
async function transaccion<T>(ctx:ContextoFisico,accion:(c:PoolConnection)=>Promise<T>) {
  const c=await getPool().getConnection();let limpia=false,intentado=false;
  try{await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");await c.beginTransaction();await esquema(c);await actor(c,ctx);const r=await accion(c);intentado=true;await c.commit();limpia=true;return r;}
  catch(e){try{await c.rollback();limpia=!intentado;}catch{limpia=false;}if(intentado)throw new ErrorCB2("Resultado incierto: consulta la propuesta antes de reintentar.",503,true);throw e;}
  finally{if(limpia)c.release();else c.destroy();}
}
function verificarIdentidad(vs:RowDataPacket[]) {
  const primero=vs[0], placa=primero&&placaComparable(String(primero.placa)),chasis=primero&&serial(primero.chasis);
  if(vs.length<2||!placa||!chasis||!/^[A-Z0-9]{6,32}$/.test(chasis)||/^(.)\1+$/.test(chasis)||["DESCONOCIDO","PENDIENTE","SINDATO","NOAPLICA"].includes(chasis)||vs.some(v=>placaComparable(String(v.placa))!==placa||serial(v.chasis)!==chasis||v.tipo_unidad!==primero.tipo_unidad||Number(v.activo)!==1||v.estado!=="Activo"||Number(v.en_taller??0)!==0))throw new ErrorCB2("No acredita la misma unidad física activa: placa, tipo, serie real y situación operativa deben coincidir.");
  return {placa,chasis,tipo:String(primero.tipo_unidad)};
}
async function sinOperacionesAbiertas(c:PoolConnection,ids:number[]) {
  const tablas=await rows(c,"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_viajes','tms_planes_viaje')");
  for(const t of tablas){const marks=ids.map(()=>"?").join(",");const sql=t.TABLE_NAME==='flota_viajes'?`SELECT id FROM flota_viajes WHERE vehiculo_id IN (${marks}) AND (estado<>'cerrado' OR hora_llegada IS NULL) FOR UPDATE`:`SELECT id FROM tms_planes_viaje WHERE tc_vehiculo_id IN (${marks}) AND (estado NOT IN ('Cerrado','Cancelado') OR fecha_plan>=CURRENT_DATE) FOR UPDATE`;if((await rows(c,sql,ids)).length)throw new ErrorCB2("Hay viajes, reservas o diferencias operativas pendientes; resolver antes de consolidar.");}
}
export async function inspeccionarIdentidadFisica(ctx:ContextoFisico,ids:number[]) {
  const c=await getPool().getConnection();
  try{await esquema(c);await actor(c,ctx);const vs=await rows(c,`SELECT v.* FROM flota_vehiculos v WHERE v.id IN (${ids.map(()=>"?").join(",")}) AND ${predicadoVehiculoAccesible('v','?')} ORDER BY v.id`,[...ids,ctx.empresaId,ctx.empresaId]);if(vs.length!==ids.length)throw new ErrorCB2("Solo se inspeccionan registros propios o compartidos vigentes.",403);
    const vehiculos=[];for(const v of vs)vehiculos.push({id:Number(v.id),empresaId:Number(v.empresa_id),placa:String(v.placa),tipo:String(v.tipo_unidad),chasis:String(v.chasis??""),marca:String(v.marca??""),modelo:String(v.modelo??""),tipoPropiedad:String(v.tipo_propiedad??""),empresaPropietariaId:v.empresa_propietaria_id==null?null:Number(v.empresa_propietaria_id),revision:firma(v),referencias:await referencias(c,ctx.empresaId,Number(v.id),false)});
    let compatible=true,motivo="";try{verificarIdentidad(vs);}catch(e){compatible=false;motivo=(e as Error).message;}
    return {vehiculos,compatible,motivo};
  }finally{c.release();}
}
export async function proponerIdentidadFisica(ctx:ContextoFisico,op:{ids:number[];revisiones:Record<string,string>;motivo:string}) {
 return transaccion(ctx,async c=>{
  const ids=[...op.ids].sort((a,b)=>a-b);
  const vs=await rows(c,`SELECT v.* FROM flota_vehiculos v WHERE v.id IN (${ids.map(()=>"?").join(",")}) AND ${predicadoVehiculoAccesible('v','?')} ORDER BY v.id FOR UPDATE`,[...ids,ctx.empresaId,ctx.empresaId]);
  await actor(c,ctx);
  if(vs.length!==ids.length)throw new ErrorCB2("No hay acceso vigente a todos los registros.",403);
  if(vs.some(v=>firma(v)!==op.revisiones[String(v.id)]))throw new ErrorCB2("Los registros cambiaron; inspecciona nuevamente.");
  const fisica=verificarIdentidad(vs);await sinOperacionesAbiertas(c,ids);
  const id=await insert(c,"flota_identidades_fisicas",{placa_comparable:fisica.placa,chasis_comparable:fisica.chasis,tipo_unidad:fisica.tipo,creado_por:ctx.usuarioId,motivo:op.motivo});
  for(const v of vs)await insert(c,"flota_identidad_miembros",{vehiculo_id:Number(v.id),empresa_id:Number(v.empresa_id),identidad_id:id,snapshot:JSON.stringify(v)});
  await registrarAuditoriaTx(c,{empresaId:ctx.empresaId,usuario:ctx.usuario,modulo:"flota",accion:"proponer_identidad_fisica",detalle:JSON.stringify({id,ids,motivo:op.motivo})});
  return {id,estado:"PROPUESTA",mensaje:"Cada empresa administradora y propietaria debe revisar y aprobar. No se transfirieron registros ni accesos."};
 });
}
async function vista(c:PoolConnection,ctx:ContextoFisico,id:number,lock=false) {
 const [requerida]=await rows(c,"SELECT empresa_id FROM flota_identidad_empresas WHERE identidad_id=? AND empresa_id=?",[id,ctx.empresaId]);if(!requerida)throw new ErrorCB2("Propuesta no disponible para esta empresa.",404);
 const [cabecera]=await rows(c,`SELECT * FROM flota_identidades_fisicas WHERE id=?${lock?' FOR UPDATE':''}`,[id]);
 const miembros=await rows(c,"SELECT v.* FROM flota_identidad_miembros m JOIN flota_vehiculos v ON v.id=m.vehiculo_id WHERE m.identidad_id=? AND m.empresa_id=? ORDER BY v.id",[id,ctx.empresaId]);
 const empresas=await rows(c,"SELECT e.empresa_id,a.administrador_id,a.creado_en FROM flota_identidad_empresas e LEFT JOIN flota_identidad_aprobaciones a ON a.identidad_id=e.identidad_id AND a.empresa_id=e.empresa_id WHERE e.identidad_id=? ORDER BY e.empresa_id",[id]);
 const fuentes=[];for(const v of miembros)fuentes.push({id:Number(v.id),fuentes:await referencias(c,ctx.empresaId,Number(v.id),false)});
 return {cabecera,miembros,empresas,referencias:fuentes,revision:firma({cabecera,miembros,empresas,fuentes})};
}
export async function consultarIdentidadFisica(ctx:ContextoFisico,id?:number) {
 const c=await getPool().getConnection();try{await esquema(c);await actor(c,ctx);if(id)return await vista(c,ctx,id);
 return rows(c,"SELECT f.id,f.placa_comparable,f.estado FROM flota_identidades_fisicas f JOIN flota_identidad_empresas e ON e.identidad_id=f.id WHERE e.empresa_id=? ORDER BY f.id DESC LIMIT 100",[ctx.empresaId]);}finally{c.release();}
}
export async function aprobarIdentidadFisica(ctx:ContextoFisico,op:{id:number;revision:string;evidencia:string}) {
 return transaccion(ctx,async c=>{
  const v=await vista(c,ctx,op.id,true);await actor(c,ctx);
  if(v.cabecera.estado!=="PROPUESTA"||v.revision!==op.revision)throw new ErrorCB2("La propuesta cambió o ya está aprobada. Revisa nuevamente.");
  if(v.empresas.some(e=>Number(e.empresa_id)===ctx.empresaId&&e.administrador_id!=null))throw new ErrorCB2("Esta empresa ya aprobó; no se duplica la operación.");
  await insert(c,"flota_identidad_aprobaciones",{identidad_id:op.id,empresa_id:ctx.empresaId,administrador_id:ctx.usuarioId,evidencia:op.evidencia});
  const pendientes=await rows(c,"SELECT e.empresa_id FROM flota_identidad_empresas e LEFT JOIN flota_identidad_aprobaciones a ON a.identidad_id=e.identidad_id AND a.empresa_id=e.empresa_id WHERE e.identidad_id=? AND a.identidad_id IS NULL",[op.id]);
  if(!pendientes.length){
   const vigentes=await rows(c,"SELECT a.empresa_id FROM flota_identidad_aprobaciones a JOIN usuarios u ON u.id=a.administrador_id AND u.activo=1 AND u.rol_global='Admin' JOIN empresas e ON e.id=a.empresa_id AND e.activa=1 WHERE a.identidad_id=? ORDER BY u.id LOCK IN SHARE MODE",[op.id]);
   if(vigentes.length!==v.empresas.length)throw new ErrorCB2("Una aprobación dejó de tener administrador o empresa vigente.",403);
   const vs=await rows(c,"SELECT v.* FROM flota_identidad_miembros m JOIN flota_vehiculos v ON v.id=m.vehiculo_id WHERE m.identidad_id=? ORDER BY v.id FOR UPDATE",[op.id]);verificarIdentidad(vs);await sinOperacionesAbiertas(c,vs.map(v=>Number(v.id)));await c.execute("UPDATE flota_identidades_fisicas SET estado='APROBADA' WHERE id=?",[op.id]);}
  await registrarAuditoriaTx(c,{empresaId:ctx.empresaId,usuario:ctx.usuario,modulo:"flota",accion:"aprobar_identidad_fisica",detalle:JSON.stringify({id:op.id,empresa:ctx.empresaId,evidencia:op.evidencia,pendientes:pendientes.length})});
  return {id:op.id,estado:pendientes.length?"PROPUESTA":"APROBADA",historicosReasignados:0};
 });
}
