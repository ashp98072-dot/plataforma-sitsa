import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { predicadoVehiculoAccesible } from "../acceso";
import { identificarPlaca, placaComparable } from "../combustible-coincidencias";
import { ErrorCB2, hash } from "./model";
import { rows, tx, type Contexto } from "./repository";

export async function esquemaPlacas(c: PoolConnection) {
  const [r] = await rows(c, "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_placas_equivalencias'");
  if (!r) return false;
  const indices = await rows(c, "SELECT INDEX_NAME,MAX(NON_UNIQUE) no_unico,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columnas FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_placas_equivalencias' AND INDEX_NAME='PRIMARY' GROUP BY INDEX_NAME");
  if (r.ENGINE !== "InnoDB" || indices.length !== 1 || Number(indices[0].no_unico) !== 0 || indices[0].columnas !== "empresa_id,proveedor_id,placa_hash") throw new ErrorCB2("Esquema de equivalencias de placas incompatible.", 503);
  return true;
}

async function catalogo(c: PoolConnection, empresa: number) {
  const vs = await rows(c, `SELECT v.id,v.placa,v.estado,v.activo FROM flota_vehiculos v WHERE ${predicadoVehiculoAccesible("v", "?")} ORDER BY v.id`, [empresa, empresa]);
  return vs.map(v => ({ id: Number(v.id), placa: String(v.placa), disponible: v.estado === "Activo" && Number(v.activo) === 1 }));
}

/** Sólo propone equivalencias vigentes cuyo vehículo sigue autorizado y cuya placa no identifica ya una unidad real. */
export async function sugerenciasPlacas(c: PoolConnection, ctx: Contexto, placas: string[]) {
  if (!(await esquemaPlacas(c))) return new Map<string, { vehiculoId: number; placa: string }>();
  const claves = [...new Set(placas.map(placaComparable).filter(p => p && p.length <= 255))];
  const vs = await catalogo(c, ctx.empresaId), result = new Map<string, { vehiculoId: number; placa: string }>();
  for (let i = 0; i < claves.length; i += 200) {
    const parte = claves.slice(i, i + 200);
    const encontradas = await rows(c, `SELECT placa_hash,placa_normalizada,vehiculo_id FROM flota_cb2_placas_equivalencias WHERE empresa_id=? AND proveedor_id=? AND revocado_en IS NULL AND placa_hash IN (${parte.map(() => "?").join(",")})`, [ctx.empresaId, ctx.proveedorId, ...parte.map(hash)]);
    for (const e of encontradas) {
      const original = String(e.placa_normalizada), v = vs.find(v => v.id === Number(e.vehiculo_id) && v.disponible);
      if (v && hash(original) === e.placa_hash && identificarPlaca(original, vs, x => x.placa).estado === "INEXISTENTE") result.set(original, { vehiculoId: v.id, placa: v.placa });
    }
  }
  return result;
}

/** Se llama sólo después de resolver satisfactoriamente el consumo, en la transacción de importación. */
export async function recordarPlacaTx(c: PoolConnection, ctx: Contexto, original: string, vehiculoId: number, motivo: string) {
  if (!(await esquemaPlacas(c))) throw new ErrorCB2("Instala la migración de equivalencias de placas antes de recordarla.", 503);
  const normalizada = placaComparable(original);
  if (!normalizada || normalizada.length > 255 || original.length > 255 || motivo.trim().length < 10 || vehiculoId <= 0) throw new ErrorCB2("Equivalencia de placa inválida.", 400);
  // La misma fila serializa las altas y ediciones de Flota de esta empresa.
  const [empresa] = await rows(c, "SELECT id FROM empresas WHERE id=? AND activa=1 FOR UPDATE", [ctx.empresaId]);
  if (!empresa) throw new ErrorCB2("Empresa no disponible.", 403);
  const vs = await catalogo(c, ctx.empresaId);
  if (!vs.some(v => v.id === vehiculoId && v.disponible)) throw new ErrorCB2("Unidad no autorizada o inactiva.", 403);
  if (identificarPlaca(normalizada, vs, v => v.placa).estado !== "INEXISTENTE") throw new ErrorCB2("La placa reportada coincide con una unidad real; revisa el conflicto.", 409);
  const clave = hash(normalizada);
  const [previa] = await rows(c, "SELECT placa_normalizada,vehiculo_id,revocado_en FROM flota_cb2_placas_equivalencias WHERE empresa_id=? AND proveedor_id=? AND placa_hash=? FOR UPDATE", [ctx.empresaId, ctx.proveedorId, clave]);
  if (previa) {
    if (previa.placa_normalizada !== normalizada || Number(previa.vehiculo_id) !== vehiculoId || previa.revocado_en) throw new ErrorCB2("La equivalencia está en conflicto o revocada; requiere revisión.", 409);
    return;
  }
  await c.execute("INSERT INTO flota_cb2_placas_equivalencias (empresa_id,proveedor_id,placa_hash,placa_normalizada,placa_original,vehiculo_id,motivo,creado_por,creado_en) VALUES (?,?,?,?,?,?,?,?,?)", [ctx.empresaId, ctx.proveedorId, clave, normalizada, original, vehiculoId, motivo.trim(), ctx.actor.id, ahoraLocal()]);
  await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.actor.username, modulo: "flota_combustible", accion: "cb2_recordar_placa", detalle: JSON.stringify({ proveedorId: ctx.proveedorId, placaHash: clave, vehiculoId, actorId: ctx.actor.id }) });
}

export async function listarPlacas(empresaId: number) {
  const tablas = await query<RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_placas_equivalencias' AND ENGINE='InnoDB'");
  if (!Number(tablas[0].n)) return { instalado: false, items: [] };
  const items = await query<RowDataPacket[]>("SELECT e.proveedor_id,p.nombre_comercial proveedor,e.placa_hash,e.placa_original,e.vehiculo_id,v.placa,e.motivo,e.creado_por,e.creado_en,e.revocado_por,e.revocado_en FROM flota_cb2_placas_equivalencias e JOIN compras_proveedores p ON p.id=e.proveedor_id AND p.empresa_id=e.empresa_id JOIN flota_vehiculos v ON v.id=e.vehiculo_id WHERE e.empresa_id=? ORDER BY e.creado_en DESC LIMIT 1000", [empresaId]);
  return { instalado: true, items };
}

export async function revocarPlaca(ctx: Contexto, placaHash: string) {
  return tx(ctx, async c => {
    if (!(await esquemaPlacas(c))) throw new ErrorCB2("Registro de equivalencias no instalado.", 503);
    const [anterior] = await rows(c, "SELECT revocado_en FROM flota_cb2_placas_equivalencias WHERE empresa_id=? AND proveedor_id=? AND placa_hash=? FOR UPDATE", [ctx.empresaId, ctx.proveedorId, placaHash]);
    if (!anterior) throw new ErrorCB2("Equivalencia no encontrada.", 404);
    if (anterior.revocado_en) return { ok: true, repetida: true };
    await c.execute("UPDATE flota_cb2_placas_equivalencias SET revocado_por=?,revocado_en=? WHERE empresa_id=? AND proveedor_id=? AND placa_hash=?", [ctx.actor.id, ahoraLocal(), ctx.empresaId, ctx.proveedorId, placaHash]);
    await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.actor.username, modulo: "flota_combustible", accion: "cb2_revocar_placa", detalle: JSON.stringify({ proveedorId: ctx.proveedorId, placaHash, actorId: ctx.actor.id }) });
    return { ok: true, repetida: false };
  });
}
