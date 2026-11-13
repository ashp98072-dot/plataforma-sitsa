import type { PoolConnection } from "mysql2/promise";
import { ErrorCB2 } from "./model";
import { rows, vehiculos, type Contexto } from "./repository";
import { catalogosTercerosTx } from "./terceros";
import { tercerosDirectosHabilitados } from "./terceros-directos";
import { tipoTerceroCompatible } from "./identidad-directa";
import { unidadTerceraCompatible } from "./terceros-busqueda";
import { nombreComparable } from "../combustible-coincidencias";

export type IdentidadIndependiente = { pilotoTipo?: "INTERNO" | "EXTERNO" | "REPORTADO"; metodoPiloto?: "AUTOMATICA" | "MANUAL"; pilotoExternoId?: number; empleadoId?: number | null; vehiculoId: number; motivoUnidad?: string; asociacionExternaId?: number };
export async function validarAsignacionIndependiente(c: PoolConnection, ctx: Contexto, s: IdentidadIndependiente, nombre: string, placa: string) {
  if (!tercerosDirectosHabilitados()) throw new ErrorCB2("Identidades independientes requieren terceros directos aprobados.", 403);
  const ready = await rows(c, "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2_piloto_unico'");
  if (!ready.length) throw new ErrorCB2("Falta aplicar y verificar la migración de identidades independientes.", 503);
  const [empresa] = await rows(c,"SELECT id,activa FROM empresas WHERE id=? FOR UPDATE",[ctx.empresaId]);
  await ctx.autorizar();
  const [actor] = await rows(c,"SELECT id,activo FROM usuarios WHERE id=? LOCK IN SHARE MODE",[ctx.actor.id]);
  if (!tercerosDirectosHabilitados() || !empresa || Number(empresa.activa)!==1 || !actor || Number(actor.activo)!==1) throw new ErrorCB2("Permiso o empresa no vigentes.",403);
  const reportado = s.pilotoTipo === "REPORTADO";
  if (reportado && !(await rows(c,"SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2_piloto_reportado'")).length) throw new ErrorCB2("Falta verificar la ampliacion SQL de piloto reportado.",503);
  if (s.asociacionExternaId != null || !s.pilotoTipo || (reportado ? s.vehiculoId > 0 || s.empleadoId != null || s.pilotoExternoId != null : s.pilotoTipo === "INTERNO" ? !s.empleadoId || s.pilotoExternoId != null : !s.pilotoExternoId || s.empleadoId != null)) throw new ErrorCB2("Selecciona una sola identidad de piloto.",400);
  const cat = await catalogosTercerosTx(c,ctx.empresaId);
  if(!reportado && s.metodoPiloto!=="MANUAL"){
    const internos=await rows(c,"SELECT id,nombre FROM empleados WHERE empresa_id=? AND estado='Activo' ORDER BY id",[ctx.empresaId]);
    const exactos=internos.filter(p=>nombreComparable(String(p.nombre))===nombreComparable(nombre));
    const externos=cat.pilotos.filter(p=>nombreComparable(p.nombre)===nombreComparable(nombre));
    if(s.pilotoTipo==='INTERNO' ? exactos.length!==1||Number(exactos[0]?.id)!==s.empleadoId||externos.length!==0 : externos.length!==1||externos[0]?.id!==s.pilotoExternoId||exactos.length!==0)throw new ErrorCB2("Propuesta automatica ambigua entre pilotos internos y externos. Selecciona manualmente.");
  }
  let piloto: { tipo: string; id: number | null; nombre: string };
  if (reportado) {
    piloto = {tipo:"REPORTADO",id:null,nombre};
  } else if (s.pilotoTipo === "INTERNO") {
    const [p] = await rows(c,"SELECT id,nombre FROM empleados WHERE empresa_id=? AND id=? AND estado='Activo' LOCK IN SHARE MODE",[ctx.empresaId,s.empleadoId!]);
    if (!p) throw new ErrorCB2("Piloto interno ajeno o inactivo.",403);
    piloto = {tipo:"INTERNO",id:Number(p.id),nombre:String(p.nombre)};
  } else {
    const p = cat.pilotos.find(p=>p.id===s.pilotoExternoId);
    if (!p) throw new ErrorCB2("Piloto tercerizado ajeno o no disponible.",403);
    if (s.metodoPiloto !== "MANUAL" && (nombreComparable(p.nombre)!==nombreComparable(nombre) || cat.pilotos.filter(x=>nombreComparable(x.nombre)===nombreComparable(nombre)).length!==1)) throw new ErrorCB2("Propuesta de piloto externo ambigua o cambió. Elige manualmente.");
    piloto = {tipo:"EXTERNO",id:p.id,nombre:p.nombre};
  }
  let unidad: { tipo: string; id: number; placa: string };
  if (s.vehiculoId > 0) {
    const propias = await vehiculos(c,ctx,[s.vehiculoId]);
    unidad = {tipo:"FLOTA",id:s.vehiculoId,placa:propias.get(s.vehiculoId)!};
  } else {
    const u = cat.unidades.find(u=>u.id===-s.vehiculoId);
    if (!u || !tipoTerceroCompatible(placa,u) || !unidadTerceraCompatible(placa,u.id,cat.unidades,s.motivoUnidad)) throw new ErrorCB2("Unidad tercerizada incompatible o ajena a la empresa.");
    unidad = {tipo:"EXTERNA",id:u.id,placa:u.placa};
  }
  return {politica:reportado?"REPORTADO_V1":"INDEPENDIENTE_V1",piloto,unidad,piloto_id:s.pilotoExternoId??null,unidad_id:s.vehiculoId<0?-s.vehiculoId:null,nombre:piloto.nombre,placa:unidad.placa,metodoPiloto:s.metodoPiloto??"AUTOMATICA"};
}
