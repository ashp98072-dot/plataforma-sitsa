import { unidadTerceraCompatible } from "./terceros-busqueda";
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ErrorCB2, hash } from "./model";
import { rows, insert, type Contexto } from "./repository";
import { altaPiloto, altaUnidad, altaAsociacion, reconocerTercero, type AsociacionExterna, type CatalogosTerceros, type PilotoTercero, type UnidadTercera } from "./terceros-model";
import { exigirTerceros, txTerceros, type ContextoTerceros } from "./terceros-transaccion";
export { exigirTerceros, tercerosHabilitados } from "./terceros-transaccion";
import { tercerosHabilitados } from "./terceros-transaccion";
import { identificarPlaca, nombreComparable, placaComparable } from "../combustible-coincidencias";
import type { PoolConnection } from "mysql2/promise";

export async function catalogoTerceros(c: PoolConnection, empresa: number, lock = false): Promise<AsociacionExterna[]> {
  return await rows(c, `SELECT a.id,a.piloto_id,a.unidad_id,p.nombre,u.placa,u.tipo,u.descripcion,a.relacion,a.estado,a.revision,a.creado_por,a.verificado_por,p.referencia AS piloto_referencia,u.referencia AS unidad_referencia
    FROM flota_cb2_externos_asociaciones a JOIN flota_cb2_externos_pilotos p ON p.empresa_id=a.empresa_id AND p.id=a.piloto_id
    JOIN flota_cb2_externos_unidades u ON u.empresa_id=a.empresa_id AND u.id=a.unidad_id
    WHERE a.empresa_id=? ORDER BY a.id${lock ? " FOR UPDATE" : ""}`, [empresa]) as unknown as AsociacionExterna[];
}
export async function listarTerceros(empresa: number) {
  if (!tercerosHabilitados()) return [];
  const c = await getPool().getConnection();
  try { return await catalogoTerceros(c, empresa); } finally { c.release(); }
}
export async function catalogosTercerosTx(c: PoolConnection, empresa: number): Promise<CatalogosTerceros> {
  const pilotos = await rows(c, "SELECT id,referencia,nombre FROM flota_cb2_externos_pilotos WHERE empresa_id=? ORDER BY id", [empresa]) as unknown as PilotoTercero[];
  const unidades = await rows(c, "SELECT id,referencia,placa,tipo,descripcion FROM flota_cb2_externos_unidades WHERE empresa_id=? ORDER BY id", [empresa]) as unknown as UnidadTercera[];
  return { pilotos, unidades, asociaciones: await catalogoTerceros(c, empresa) };
}
export async function listarCatalogosTerceros(empresa: number): Promise<CatalogosTerceros> {
  if (!tercerosHabilitados()) return { pilotos: [], unidades: [], asociaciones: [] };
  const c = await getPool().getConnection(); try { return await catalogosTercerosTx(c, empresa); } finally { c.release(); }
}
export async function registrarPiloto(ctx: ContextoTerceros, entrada: unknown) {
  exigirTerceros(); const op = altaPiloto.parse(entrada);
  return txTerceros(ctx, async c => {
    const [p] = await rows(c, "SELECT * FROM flota_cb2_externos_pilotos WHERE empresa_id=? AND referencia_hash=? FOR UPDATE", [ctx.empresaId, hash(nombreComparable(op.referencia))]);
    if (p && nombreComparable(String(p.nombre)) !== nombreComparable(op.nombre)) throw new ErrorCB2("Referencia de piloto con datos contradictorios; requiere revisión.");
    if (p) return { id: Number(p.id), existente: true };
    const candidatos = await rows(c, "SELECT id,nombre,referencia FROM flota_cb2_externos_pilotos WHERE empresa_id=? ORDER BY id FOR UPDATE", [ctx.empresaId]);
    const coincidencias = candidatos.filter(p => nombreComparable(String(p.nombre)) === nombreComparable(op.nombre)).map(p => Number(p.id));
    if (coincidencias.length && !op.confirmarCoincidencias) throw new ErrorCB2(`Nombre coincidente con pilotos #${coincidencias.join(", #")}. Reutiliza su referencia o confirma que es otra persona con referencia real distinta.`);
    const id = await insert(c, "flota_cb2_externos_pilotos", { empresa_id: ctx.empresaId, referencia: op.referencia, referencia_hash: hash(nombreComparable(op.referencia)), nombre: op.nombre });
    await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.actor.username, modulo: "flota_combustible", accion: "cb2_piloto_tercero_creado", detalle: JSON.stringify({ id, actorId: ctx.actor.id, coincidenciasRevisadas: coincidencias }) });
    return { id, existente: false };
  });
}
export async function registrarUnidad(ctx: ContextoTerceros, entrada: unknown) {
  exigirTerceros(); const op = altaUnidad.parse(entrada);
  return txTerceros(ctx, async c => {
    const [u] = await rows(c, "SELECT * FROM flota_cb2_externos_unidades WHERE empresa_id=? AND referencia_hash=? FOR UPDATE", [ctx.empresaId, hash(nombreComparable(op.referencia))]);
    if (u && (placaComparable(String(u.placa)) !== placaComparable(op.placa) || u.tipo !== op.tipo)) throw new ErrorCB2("Referencia de unidad con datos contradictorios; requiere revisión.");
    if (u) return { id: Number(u.id), existente: true };
    const candidatos = await rows(c, "SELECT id,placa,referencia FROM flota_cb2_externos_unidades WHERE empresa_id=? ORDER BY id FOR UPDATE", [ctx.empresaId]) as unknown as UnidadTercera[];
    const coincidencias = candidatos.filter(u => identificarPlaca(op.placa, [u], u => u.placa).candidatos.length || identificarPlaca(u.placa, [{ placa: op.placa }], u => u.placa).candidatos.length).map(u => u.id);
    if (coincidencias.length && !op.confirmarCoincidencias) throw new ErrorCB2(`Placa coincidente con unidades #${coincidencias.join(", #")}. Reutiliza su referencia o confirma una unidad distinta con referencia real.`);
    const id = await insert(c, "flota_cb2_externos_unidades", { empresa_id: ctx.empresaId, referencia: op.referencia, referencia_hash: hash(nombreComparable(op.referencia)), placa: op.placa, tipo: op.tipo, descripcion: op.descripcion });
    await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.actor.username, modulo: "flota_combustible", accion: "cb2_unidad_tercera_creada", detalle: JSON.stringify({ id, actorId: ctx.actor.id, coincidenciasRevisadas: coincidencias }) });
    return { id, existente: false };
  });
}
export async function crearAsociacion(ctx: ContextoTerceros, entrada: unknown) {
  exigirTerceros(); const op = altaAsociacion.parse(entrada);
  return txTerceros(ctx, async c => {
    const [p] = await rows(c, "SELECT id FROM flota_cb2_externos_pilotos WHERE empresa_id=? AND id=? FOR UPDATE", [ctx.empresaId, op.pilotoId]);
    const [u] = await rows(c, "SELECT id FROM flota_cb2_externos_unidades WHERE empresa_id=? AND id=? FOR UPDATE", [ctx.empresaId, op.unidadId]);
    if (!p || !u) throw new ErrorCB2("Piloto o unidad no disponibles en esta empresa.", 404);
    const piloto = Number(p.id), unidad = Number(u.id);
    const [a] = await rows(c, "SELECT id,relacion FROM flota_cb2_externos_asociaciones WHERE empresa_id=? AND piloto_id=? AND unidad_id=? FOR UPDATE", [ctx.empresaId, piloto, unidad]);
    if (a && a.relacion !== op.relacion) throw new ErrorCB2("Relación contradictoria; no se sobrescribe la asociación.");
    if (a) return { id: Number(a.id), existente: true };
    const id = await insert(c, "flota_cb2_externos_asociaciones", { empresa_id: ctx.empresaId, piloto_id: piloto, unidad_id: unidad, relacion: op.relacion, evidencia: op.evidencia, creado_por: ctx.actor.id, estado: "PENDIENTE", revision: 0 });
    await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.actor.username, modulo: "flota_combustible", accion: "cb2_tercero_propuesto", detalle: JSON.stringify({ asociacionId: id, empresaId: ctx.empresaId, actorId: ctx.actor.id, creadoPor: ctx.actor.id, pilotoId: piloto, unidadId: unidad, estado: "PENDIENTE", revision: 0 }) });
    return { id, existente: false };
  });
}
export async function revisarTerceros(ctx: ContextoTerceros, id: number, revision: number, estado: "VERIFICADA" | "REVOCADA") {
  exigirTerceros();
  return txTerceros(ctx, async c => {
    const [a] = await rows(c, "SELECT * FROM flota_cb2_externos_asociaciones WHERE empresa_id=? AND id=? FOR UPDATE", [ctx.empresaId, id]);
    if (!a) throw new ErrorCB2("Asociación no disponible en la empresa.", 404);
    if (Number(a.revision) !== revision) throw new ErrorCB2("Revisión obsoleta.");
    if (estado === "VERIFICADA" && Number(a.creado_por) === ctx.actor.id) throw new ErrorCB2("La verificación requiere otro responsable.", 403);
    const estadoAnterior = a.estado;
    const verificadoPor = estado === "VERIFICADA" ? ctx.actor.id : a.verificado_por;
    const [resultado] = await c.execute<import("mysql2").ResultSetHeader>("UPDATE flota_cb2_externos_asociaciones SET estado=?,revision=revision+1,verificado_por=? WHERE empresa_id=? AND id=? AND revision=?", [estado, verificadoPor ?? null, ctx.empresaId, id, revision]);
    if (resultado.affectedRows !== 1) throw new ErrorCB2("La asociación cambió; actualiza antes de revisar.");
    await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.actor.username, modulo: "flota_combustible", accion: "cb2_tercero_revision", detalle: JSON.stringify({ id, empresaId: ctx.empresaId, actorId: ctx.actor.id, creadoPor: Number(a.creado_por), verificadoPor: verificadoPor ?? null, estadoAnterior, estado, revisionAnterior: revision, revision: revision + 1, pilotoId: Number(a.piloto_id), unidadId: Number(a.unidad_id) }) });
    return { id, revision: revision + 1, estado };
  });
}
export async function validarTercero(c: PoolConnection, ctx: Contexto, asociacionId: number, unidad: number, nombre: string, placa: string, motivo = "") {
  exigirTerceros(); await rows(c, "SELECT id FROM empresas WHERE id=? FOR UPDATE", [ctx.empresaId]);
  exigirTerceros(); // La configuración pudo cambiar mientras esperaba el cerrojo empresarial.
  const catalogo = await catalogoTerceros(c, ctx.empresaId, true), a = catalogo.find(a => a.id === asociacionId);
  const unidades = await rows(c, "SELECT id,placa FROM flota_cb2_externos_unidades WHERE empresa_id=? ORDER BY id FOR UPDATE", [ctx.empresaId]) as unknown as { id: number; placa: string }[];
  // La elección manual de un ID estable puede resolver homónimos; nunca sustituye verificación ni compatibilidad.
  if (!a || a.estado !== "VERIFICADA" || a.unidad_id !== unidad || nombreComparable(a.nombre) !== nombreComparable(nombre) || !unidadTerceraCompatible(placa, unidad, unidades, motivo))
    throw new ErrorCB2("Tercero pendiente, revocado o incompatible con los datos originales.");
  return a;
}
export { reconocerTercero };
