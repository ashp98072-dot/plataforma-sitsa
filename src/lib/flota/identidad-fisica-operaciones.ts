import type { PoolConnection } from "mysql2/promise";
import { ErrorCB2 } from "./cb2/model";
import { rows } from "./cb2/repository";

/** Interruptor (reversible, apagado por defecto): con `1`, las operaciones abiertas NO bloquean si todas están en la ficha REPRESENTANTE de la empresa que opera. */
export const operacionesAbiertasEnRepresentante = (env: NodeJS.ProcessEnv = process.env) => env.FLOTA_IDENTIDAD_OPERACIONES_EN_REPRESENTANTE === "1";

export type MiembroIdentidad = { id: number; empresa_id: number };

/**
 * Ficha REPRESENTANTE de una empresa dentro de una identidad: la propia con menor ID; si no tiene ninguna, la de menor ID. Es la misma regla con la que los catálogos
 * (`catalogoSinAlias` / `resolverUnidadCanonica`) eligen la ficha en la que se guardan las operaciones NUEVAS de esa empresa.
 */
export function representanteParaEmpresa(miembros: MiembroIdentidad[], empresaId: number): number | null {
  const propias = miembros.filter(m => Number(m.empresa_id) === empresaId).map(m => Number(m.id)).sort((a, b) => a - b);
  if (propias.length) return propias[0];
  const todas = miembros.map(m => Number(m.id)).sort((a, b) => a - b);
  return todas.length ? todas[0] : null;
}

export type OperacionAbierta = { empresa_id: number; miembro: number };

/**
 * ¿Alguna operación abierta cae en una ficha que NO es la representante de la empresa que la realiza? Solo en ese caso puede haber doble reserva de una misma unidad
 * física con dos IDs distintos. Una operación abierta en la ficha representante sigue apuntando a su mismo ID: no hay conflicto.
 */
export const operacionesFueraDelRepresentante = (operaciones: OperacionAbierta[], miembros: MiembroIdentidad[]) =>
  operaciones.filter(o => representanteParaEmpresa(miembros, Number(o.empresa_id)) !== Number(o.miembro));

/** Contract from schema.sql and the private restored schema, not from consumption fixtures.
 * Both TMS references identify flota IDs; unidad_id itself is a tms_unidades ID.
 * Scan all companies without exposing their operational data or moving references.
 * `miembros` (opcional) + interruptor `FLOTA_IDENTIDAD_OPERACIONES_EN_REPRESENTANTE=1`: permite operaciones abiertas solo en la ficha representante de su empresa. */
export async function sinOperacionesAbiertas(c: PoolConnection, ids: number[], miembros?: MiembroIdentidad[]) {
  if (!ids.length) throw new ErrorCB2("Faltan unidades para revisar operaciones.", 400);
  const requeridas: Record<string, string[]> = {
    flota_viajes: ["id", "empresa_id", "vehiculo_id", "estado", "hora_llegada"],
    tms_planes_viaje: ["id", "empresa_id", "tc_vehiculo_id", "unidad_id", "estado"],
    tms_unidades: ["id", "flota_vehiculo_id"],
  };
  const columnas = await rows(c, "SELECT c.TABLE_NAME,c.COLUMN_NAME,t.ENGINE FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME WHERE c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME IN ('flota_viajes','tms_planes_viaje','tms_unidades')");
  const faltantes = Object.entries(requeridas).flatMap(([tabla, campos]) => campos.filter(campo => !columnas.some(c => c.TABLE_NAME === tabla && c.COLUMN_NAME === campo && c.ENGINE === "InnoDB")).map(campo => `${tabla}.${campo}`));
  if (faltantes.length) throw new ErrorCB2(`Esquema de operaciones incompatible: comprobar preflight (${faltantes.join(", ")}).`, 503);
  const marks = ids.map(() => "?").join(",");
  // A closed Flota trip requires physical arrival; date does not reopen historical trips.
  const viajes = await rows(c, `SELECT id, empresa_id, vehiculo_id AS miembro FROM flota_viajes WHERE vehiculo_id IN (${marks}) AND (estado IS NULL OR estado<>'cerrado' OR hora_llegada IS NULL) FOR UPDATE`, ids);
  // Descargado is still pending administrative closure. Unknown states block conservatively.
  // Terminal plans never reserve the unit just because fecha_plan is today/future.
  const planesTc = await rows(c, `SELECT p.id, p.empresa_id, p.tc_vehiculo_id AS miembro FROM tms_planes_viaje p WHERE p.tc_vehiculo_id IN (${marks}) AND (p.estado IS NULL OR p.estado NOT IN ('Cerrado','Cancelado')) ORDER BY p.id FOR UPDATE`, ids);
  const planesUnidad = await rows(c, `SELECT p.id, p.empresa_id, u.flota_vehiculo_id AS miembro FROM tms_planes_viaje p JOIN tms_unidades u ON u.id=p.unidad_id WHERE u.flota_vehiculo_id IN (${marks}) AND (p.estado IS NULL OR p.estado NOT IN ('Cerrado','Cancelado')) ORDER BY p.id FOR UPDATE`, ids);
  const abiertas = [...viajes, ...planesTc, ...planesUnidad];
  if (!abiertas.length) return;
  if (operacionesAbiertasEnRepresentante() && miembros?.length) {
    const fuera = operacionesFueraDelRepresentante(abiertas.map(o => ({ empresa_id: Number(o.empresa_id), miembro: Number(o.miembro) })), miembros);
    if (!fuera.length) return;
    throw new ErrorCB2("Hay viajes, reservas o diferencias operativas pendientes en una ficha que no es la representante de su empresa; resolver antes de consolidar.");
  }
  throw new ErrorCB2("Hay viajes, reservas o diferencias operativas pendientes; resolver antes de consolidar.");
}
