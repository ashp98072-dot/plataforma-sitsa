import type { PoolConnection } from "mysql2/promise";
import { normalizarIdentificador } from "../combustible-identificadores";
import { rows, type Contexto } from "./repository";

/** Lectura actual bajo cerrojo de proveedor; no promueve ni fusiona cargas históricas. */
export async function valesInternos(c: PoolConnection, ctx: Contexto, lock = true) {
  return rows(c, `SELECT id,numero_vale,estado FROM flota_combustible_cargas WHERE empresa_id=? AND proveedor_id=? ORDER BY id${lock ? " FOR UPDATE" : ""}`, [ctx.empresaId, ctx.proveedorId]);
}
export function clavesInternas(filas: Record<string, unknown>[]) {
  return new Set(filas.map(f => normalizarIdentificador(String(f.numero_vale ?? ""))).filter(Boolean));
}
