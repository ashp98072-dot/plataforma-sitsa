import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { validarLineaFondoCombustibleTx } from "../combustible-fondos";
import { ErrorCB2, id } from "./model";
import { insert, rows, tx, type Contexto } from "./repository";
import { contrastarFondo } from "./fondos-model";
export const vincularFondoSchema=z.object({proveedorId:id,consumoId:id,lineaId:id,revision:z.number().int().nonnegative(),motivo:z.string().trim().min(10).max(1000),confirmado:z.literal(true)}).strict();
async function disponible(c:Parameters<typeof rows>[0]) {
 if (!(await rows(c,"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_fondos_vinculos' AND ENGINE='InnoDB'")).length) throw new ErrorCB2("Conciliación opcional no instalada: requiere auditar la propuesta SQL de vínculos a fondos. La importación no depende de ella.",503);
}
export async function consultarFondoCB2(empresa:number,proveedor:number,consumo:number,buscar:string) {
 const c=await getPool().getConnection();
 try {
  const [r]=await rows(c,"SELECT id,revision_asignacion FROM flota_cb2_consumos WHERE empresa_id=? AND proveedor_id=? AND id=?",[empresa,proveedor,consumo]);
  if (!r) throw new ErrorCB2("Consumo no encontrado.",404);
  await disponible(c);
  const [v]=await rows(c,"SELECT linea_id,revision_asignacion,snapshot,motivo,creado_por,creado_en FROM flota_cb2_fondos_vinculos WHERE empresa_id=? AND proveedor_id=? AND consumo_id=?",[empresa,proveedor,consumo]);
  const like=`%${buscar.replace(/[\\%_]/g,"\\$&")}%`;
  const items=v?[]:await rows(c,`SELECT l.id,s.codigo,s.estado,CAST(l.cantidad*l.monto AS DECIMAL(22,4)) AS monto,
   DATE_FORMAT(s.fecha_requerimiento,'%Y-%m-%d') AS fecha,l.empleado_nombre AS persona,l.placa
   FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.empresa_id=l.empresa_id AND s.id=l.solicitud_id
   WHERE l.empresa_id=? AND l.categoria='Combustible' AND s.estado IN ('Autorizada','Liquidada') AND (s.codigo LIKE ? OR l.placa LIKE ? OR l.empleado_nombre LIKE ?)
   ORDER BY s.id DESC,l.id LIMIT 50`,[empresa,like,like,like]);
  return {estado:v?Number(v.revision_asignacion)!==Number(r.revision_asignacion)?"REVISAR_ASIGNACION":"VINCULADO_MANUAL":"SIN_CONCILIAR",vinculo:v?{...v,snapshot:JSON.parse(String(v.snapshot))}:null,items};
 } finally {c.release();}
}
export async function vincularFondoCB2(ctx:Contexto,op:z.infer<typeof vincularFondoSchema>) {
 return tx(ctx,async c=>{
  await disponible(c);
  // Mismo orden cabecera/línea de Fondos; el bloqueo serializa también diferentes proveedores.
  const [r]=await rows(c,"SELECT id,vehiculo_id FROM flota_cb2_consumos WHERE empresa_id=? AND proveedor_id=? AND id=?",[ctx.empresaId,ctx.proveedorId,op.consumoId]);
  if (!r) throw new ErrorCB2("Consumo no encontrado.",404);
  const [previo]=await rows(c,"SELECT linea_id,motivo,revision_asignacion,snapshot FROM flota_cb2_fondos_vinculos WHERE empresa_id=? AND proveedor_id=? AND consumo_id=?",[ctx.empresaId,ctx.proveedorId,op.consumoId]);
  if(previo) {
   if(Number(previo.linea_id)!==op.lineaId || previo.motivo!==op.motivo || Number(previo.revision_asignacion)!==op.revision) throw new ErrorCB2("El consumo ya tiene otro vínculo. No se sobrescribe.");
   return {estado:"VINCULADO_MANUAL",repetida:true,snapshot:JSON.parse(String(previo.snapshot))};
  }
  try {await validarLineaFondoCombustibleTx(c,ctx.empresaId,op.lineaId,Number(r.vehiculo_id??0));}
  catch(e) {if(e instanceof ErrorDominioFormulario)throw new ErrorCB2(e.message,409);throw e;}
  const [consumo]=await rows(c,"SELECT *,DATE_FORMAT(fecha_consumo,'%Y-%m-%d') AS fecha FROM flota_cb2_consumos WHERE empresa_id=? AND proveedor_id=? AND id=? FOR UPDATE",[ctx.empresaId,ctx.proveedorId,op.consumoId]);
  if(!consumo || Number(consumo.revision_asignacion)!==op.revision || (consumo.vehiculo_id??null)!==(r.vehiculo_id??null)) throw new ErrorCB2("La asignación cambió; revisa antes de conciliar.");
  await ctx.autorizar();
  const [fondo]=await rows(c,`SELECT l.id,s.codigo,s.estado,CAST(l.cantidad*l.monto AS DECIMAL(22,4)) AS monto,
   DATE_FORMAT(s.fecha_requerimiento,'%Y-%m-%d') AS fecha,l.empleado_nombre AS persona,l.placa
   FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.empresa_id=l.empresa_id AND s.id=l.solicitud_id WHERE l.empresa_id=? AND l.id=?`,[ctx.empresaId,op.lineaId]);
  const original={monto:String(consumo.monto),fecha:String(consumo.fecha),piloto:String(consumo.piloto_informado??""),moneda:String(consumo.moneda)};
  const snapshot={consumo:original,fondo,contraste:contrastarFondo(original,{monto:String(fondo.monto),fecha:String(fondo.fecha),persona:String(fondo.persona??"")})};
  await insert(c,"flota_cb2_fondos_vinculos",{empresa_id:ctx.empresaId,proveedor_id:ctx.proveedorId,consumo_id:op.consumoId,linea_id:op.lineaId,revision_asignacion:op.revision,snapshot:JSON.stringify(snapshot),motivo:op.motivo,creado_por:ctx.actor.id,creado_en:ahoraLocal()});
  await registrarAuditoriaTx(c,{empresaId:ctx.empresaId,usuario:ctx.actor.username,modulo:"flota_combustible",accion:"cb2_vincular_fondo",detalle:JSON.stringify({consumoId:op.consumoId,lineaId:op.lineaId,motivo:op.motivo,diferencias:snapshot.contraste.diferencias})});
  return {estado:"VINCULADO_MANUAL",repetida:false,snapshot};
 });
}
