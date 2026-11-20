import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { query, type SqlValue } from "@/lib/db";
import { identificarPlaca, placaComparable } from "../combustible-coincidencias";
import { predicadoVehiculoAccesible } from "../acceso";
import { catalogoSinAlias } from "../vehiculos-alias";
import { ErrorCB2 } from "./model";
import { rows, type Contexto } from "./repository";

/** Estado de una unidad que NO se vincula a Flota: la placa original del Excel se conserva y no se crea ningún vehículo. */
export type VinculoUnidad = "AMBIGUA" | "SIN_VINCULO";

/** ¿Está instalada la migración `migrate-2026-11-cb2-vinculo-unidad.sql`? (columna + los dos CHECK). Instalación a medias → 503: nunca se degrada en silencio. */
export async function esquemaVinculoUnidad(c?: PoolConnection): Promise<boolean> {
  const leer = (sql: string) => c ? rows(c, sql) : query<RowDataPacket[]>(sql, [] as SqlValue[]);
  const [col] = await leer("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME='vinculo_unidad'");
  const checks = await leer("SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME IN ('ck_cb2c_unidad_tipo','ck_cb2c_vinculo')");
  const tipo = String(checks.find(r => r.CONSTRAINT_NAME === "ck_cb2c_unidad_tipo")?.CHECK_CLAUSE ?? "");
  const vinculo = checks.some(r => r.CONSTRAINT_NAME === "ck_cb2c_vinculo"), enTipo = tipo.includes("SIN_VINCULO");
  const columna = Number(col?.n) === 1;
  if (!columna && !vinculo && !enTipo) return false;
  if (columna && vinculo && enTipo) return true;
  throw new ErrorCB2("Vínculo de unidad parcialmente instalado; ejecuta el preflight antes de usar Shell.", 503);
}

/** El servidor es la autoridad: comprueba que la placa realmente sea ambigua (≥2 unidades accesibles y activas de la empresa, ya colapsados alias/identidad física)
 * o que no coincida con ninguna. Una placa con una única unidad de Flota debe vincularse; nunca se deja «sin vincular» para saltarse esa validación. */
export async function validarVinculoUnidad(c: PoolConnection, ctx: Contexto, placaNormalizada: string, estado: VinculoUnidad) {
  const comparable = placaComparable(placaNormalizada);
  if (!comparable) throw new ErrorCB2("La placa del Excel no es válida; no se puede conservar como unidad sin vincular.", 400);
  const encontrados = await rows(c, `SELECT v.id,v.empresa_id,v.placa FROM flota_vehiculos v WHERE v.activo=1 AND v.estado='Activo' AND ${predicadoVehiculoAccesible("v", "?")} AND RIGHT(REGEXP_REPLACE(UPPER(v.placa),'[[:space:]‐‑–—-]',''),6)=? ORDER BY v.id`, [ctx.empresaId, ctx.empresaId, comparable.slice(-6)]);
  const catalogo = await catalogoSinAlias(encontrados.map(v => ({ id: Number(v.id), empresa_id: Number(v.empresa_id), placa: String(v.placa) })), ctx.empresaId, (sql, args = []) => rows(c, sql, args));
  const m = identificarPlaca(comparable, catalogo, v => v.placa);
  if (estado === "AMBIGUA" && m.estado !== "AMBIGUA") throw new ErrorCB2("La placa ya no es ambigua en Flota; vincula la unidad correspondiente.");
  if (estado === "SIN_VINCULO" && m.estado !== "INEXISTENTE") throw new ErrorCB2(m.estado === "AMBIGUA" ? "La placa coincide con varias unidades de Flota: guárdala como ambigua." : "La placa coincide con una unidad de Flota: vincúlala.");
  return { estado, candidatos: m.candidatos.map(v => v.id) };
}
