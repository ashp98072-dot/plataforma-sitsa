import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ErrorCB2, hash } from "./model";
import { rows, insert, tx, type Contexto } from "./repository";
import { altaTercero, reconocerTercero, type AsociacionExterna } from "./terceros-model";
import { nombreComparable, placaComparable } from "../combustible-coincidencias";
import type { PoolConnection } from "mysql2/promise";

// Política D2 aprobada. Su activación operativa sigue siendo explícita y cerrada por defecto.
export const tercerosHabilitados = () => process.env.CB2_TERCEROS_D2_APROBADA === "1";
export function exigirTerceros() { if (!tercerosHabilitados()) throw new ErrorCB2("Tercerizados deshabilitados por configuración. La activación corresponde al propietario.", 403); }
async function autorizarGestion(c: PoolConnection, ctx: Contexto) {
  // Revalidar después de esperar empresa, incluso si el proveedor era distinto.
  exigirTerceros(); await ctx.autorizar();
  const [empresa] = await rows(c, "SELECT activa FROM empresas WHERE id=? FOR UPDATE", [ctx.empresaId]);
  const [actor] = await rows(c, "SELECT id,activo,rol_global FROM usuarios WHERE id=? LOCK IN SHARE MODE", [ctx.actor.id]);
  if (!empresa || Number(empresa.activa) !== 1 || !actor || Number(actor.activo) !== 1 || actor.rol_global !== "Admin") throw new ErrorCB2("La gestión requiere administrador activo y empresa vigente.", 403);
}
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
export async function registrarTerceros(ctx: Contexto, entrada: unknown) {
  exigirTerceros(); const op = altaTercero.parse(entrada);
  if (op.proveedorId !== ctx.proveedorId) throw new ErrorCB2("Proveedor incompatible con el contexto.", 400);
  return tx(ctx, async c => {
    // Cerrojo empresarial, compartido entre proveedores: evita altas y verificaciones cruzadas concurrentes.
    await rows(c, "SELECT id FROM empresas WHERE id=? FOR UPDATE", [ctx.empresaId]);
    await autorizarGestion(c, ctx);
    const referenciaPiloto = hash(nombreComparable(op.pilotoReferencia)), referenciaUnidad = hash(nombreComparable(op.unidadReferencia));
    const [p] = await rows(c, "SELECT * FROM flota_cb2_externos_pilotos WHERE empresa_id=? AND referencia_hash=? FOR UPDATE", [ctx.empresaId, referenciaPiloto]);
    const [u] = await rows(c, "SELECT * FROM flota_cb2_externos_unidades WHERE empresa_id=? AND referencia_hash=? FOR UPDATE", [ctx.empresaId, referenciaUnidad]);
    if (p && nombreComparable(String(p.nombre)) !== nombreComparable(op.nombre)) throw new ErrorCB2("Referencia de piloto con datos contradictorios; requiere revisión.");
    if (u && (placaComparable(String(u.placa)) !== placaComparable(op.placa) || u.tipo !== op.tipo)) throw new ErrorCB2("Referencia de unidad con datos contradictorios; requiere revisión.");
    const piloto = p ? Number(p.id) : await insert(c, "flota_cb2_externos_pilotos", { empresa_id: ctx.empresaId, referencia: op.pilotoReferencia, referencia_hash: referenciaPiloto, nombre: op.nombre });
    const unidad = u ? Number(u.id) : await insert(c, "flota_cb2_externos_unidades", { empresa_id: ctx.empresaId, referencia: op.unidadReferencia, referencia_hash: referenciaUnidad, placa: op.placa, tipo: op.tipo, descripcion: op.descripcion });
    const [a] = await rows(c, "SELECT id,relacion FROM flota_cb2_externos_asociaciones WHERE empresa_id=? AND piloto_id=? AND unidad_id=? FOR UPDATE", [ctx.empresaId, piloto, unidad]);
    if (a && a.relacion !== op.relacion) throw new ErrorCB2("Relación contradictoria; no se sobrescribe la asociación.");
    if (a) return { id: Number(a.id), existente: true };
    const id = await insert(c, "flota_cb2_externos_asociaciones", { empresa_id: ctx.empresaId, piloto_id: piloto, unidad_id: unidad, relacion: op.relacion, evidencia: op.evidencia, creado_por: ctx.actor.id, estado: "PENDIENTE", revision: 0 });
    await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.actor.username, modulo: "flota_combustible", accion: "cb2_tercero_propuesto", detalle: JSON.stringify({ asociacionId: id, empresaId: ctx.empresaId, actorId: ctx.actor.id, creadoPor: ctx.actor.id, pilotoId: piloto, unidadId: unidad, estado: "PENDIENTE", revision: 0 }) });
    return { id, existente: false };
  });
}
export async function revisarTerceros(ctx: Contexto, id: number, revision: number, estado: "VERIFICADA" | "REVOCADA") {
  exigirTerceros();
  return tx(ctx, async c => {
    await rows(c, "SELECT id FROM empresas WHERE id=? FOR UPDATE", [ctx.empresaId]);
    await autorizarGestion(c, ctx);
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
export async function validarTercero(c: PoolConnection, ctx: Contexto, asociacionId: number, unidad: number, nombre: string, placa: string) {
  exigirTerceros(); await rows(c, "SELECT id FROM empresas WHERE id=? FOR UPDATE", [ctx.empresaId]);
  exigirTerceros(); // La configuración pudo cambiar mientras esperaba el cerrojo empresarial.
  const catalogo = await catalogoTerceros(c, ctx.empresaId, true), a = catalogo.find(a => a.id === asociacionId);
  // La elección manual de un ID estable puede resolver homónimos; nunca sustituye verificación ni compatibilidad.
  if (!a || a.estado !== "VERIFICADA" || a.unidad_id !== unidad || nombreComparable(a.nombre) !== nombreComparable(nombre) || placaComparable(a.placa) !== placaComparable(placa))
    throw new ErrorCB2("Tercero pendiente, revocado o incompatible con los datos originales.");
  return a;
}
export { reconocerTercero };
