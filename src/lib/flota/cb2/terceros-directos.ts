import type { PoolConnection } from "mysql2/promise";
import { ErrorCB2 } from "./model";
import { rows, type Contexto } from "./repository";
import { catalogosTercerosTx } from "./terceros";
import { nombreComparable } from "../combustible-coincidencias";
import { unidadTerceraCompatible } from "./terceros-busqueda";
import { tipoTerceroCompatible } from "./identidad-directa";

/** Política nueva, activación posterior a migración auditada; no deriva de D2 antigua. */
export const tercerosDirectosHabilitados = () => process.env.CB2_TERCEROS_DIRECTOS_APROBADA === "1";
export async function validarTerceroDirecto(c: PoolConnection, ctx: Contexto, pilotoId: number, unidadId: number, nombre: string, placa: string, motivo = "") {
  if (!tercerosDirectosHabilitados()) throw new ErrorCB2("Registro directo de terceros no habilitado.", 403);
  const [empresa] = await rows(c, "SELECT id,activa FROM empresas WHERE id=? FOR UPDATE", [ctx.empresaId]);
  await ctx.autorizar();
  if (!tercerosDirectosHabilitados()) throw new ErrorCB2("Registro directo deshabilitado durante la espera.", 403);
  const [actor] = await rows(c, "SELECT id,activo FROM usuarios WHERE id=? LOCK IN SHARE MODE", [ctx.actor.id]);
  if (!empresa || Number(empresa.activa) !== 1 || !actor || Number(actor.activo) !== 1) throw new ErrorCB2("Usuario o empresa no vigentes.", 403);
  const cat = await catalogosTercerosTx(c, ctx.empresaId);
  const piloto = cat.pilotos.find(p => p.id === pilotoId), unidad = cat.unidades.find(u => u.id === unidadId);
  if (!piloto || !unidad || !tipoTerceroCompatible(placa, unidad) || nombreComparable(piloto.nombre) !== nombreComparable(nombre) || !unidadTerceraCompatible(placa, unidadId, cat.unidades, motivo)) throw new ErrorCB2("Piloto o unidad externos incompatibles o ajenos a la empresa.");
  return { piloto_id: piloto.id, unidad_id: unidad.id, nombre: piloto.nombre, placa: unidad.placa, tipo: unidad.tipo, descripcion: unidad.descripcion, piloto_referencia: piloto.referencia, unidad_referencia: unidad.referencia, politica: "DIRECTA_V1" };
}
