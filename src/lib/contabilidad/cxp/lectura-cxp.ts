import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool, type SqlValue } from "@/lib/db";
import { ErrorCxp } from "./errores";

/**
 * Piezas de LECTURA compartidas por los reportes de CxP (antigüedad MIL-CXP-01, estado de cuenta MIL-CXP-02). SOLO LECTURA.
 * Existen para NO duplicar: la definición de «pagado» (aplicaciones de pagos REGISTRADOS), la instantánea consistente, la validación de que la
 * entidad pertenezca a la empresa, la tolerancia a tablas de pagos ausentes y las expresiones de antigüedad/vencimiento viven aquí una sola vez.
 */

export const esTablaInexistente = (e: unknown) => {
  const err = e as { code?: string; errno?: number };
  return err?.errno === 1146 || err?.code === "ER_NO_SUCH_TABLE";
};
export const mencionaPagos = (e: unknown) => /cxp_pago/i.test(String((e as { sqlMessage?: string; message?: string })?.sqlMessage ?? (e as Error)?.message ?? ""));

/** Fecha AAAA-MM-DD como literal SQL (se reutiliza en varias expresiones) SOLO tras validarla estrictamente. */
export function literalFecha(corte: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corte) || new Date(`${corte}T00:00:00Z`).toISOString().slice(0, 10) !== corte) {
    throw new ErrorCxp("Fecha de corte inválida.", 400, "CORTE_INVALIDO");
  }
  return `'${corte}'`;
}

/** Expresión SQL del importe pagado vigente de la factura `x` (requiere el JOIN de `subPagos`). */
export const PAGADO = "COALESCE(pg.total, 0)";

/**
 * Subconsulta (con su `ON`) del pagado vigente por factura: aplicaciones de pagos REGISTRADOS (los REVERSADOS no cuentan; la retención de ISR NO es
 * una aplicación) — la MISMA definición de `aplicaciones.ts`. Sin tablas de pagos: subconsulta vacía → pagado 0.00 exacto.
 * Sus `?` (empresa, entidad) van PRIMERO en el texto SQL: usar `paramsPagos`.
 */
export function subPagos(conPagos: boolean): string {
  return conPagos
    ? `(SELECT a.factura_id, SUM(a.monto) AS total
       FROM cxp_pago_aplicaciones a JOIN cxp_pagos g ON g.empresa_id = a.empresa_id AND g.entidad_id = a.entidad_id AND g.id = a.pago_id
      WHERE a.empresa_id = ? AND a.entidad_id = ? AND g.estado = 'REGISTRADO' GROUP BY a.factura_id) pg ON pg.factura_id = x.id`
    : "(SELECT NULL AS factura_id, 0 AS total FROM DUAL WHERE 1 = 0) pg ON pg.factura_id = x.id";
}
export const paramsPagos = (conPagos: boolean, empresaId: number, entidadId: number): SqlValue[] => (conPagos ? [empresaId, entidadId] : []);

/** Días desde el documento, tramo y situación de vencimiento a la fecha de corte (literal ya validado por `literalFecha`). */
export function exprsVencimiento(corteSql: string) {
  const dias = `GREATEST(0, DATEDIFF(${corteSql}, x.fecha_documento))`;
  const tramo = `CASE WHEN ${dias} <= 15 THEN '0-15' WHEN ${dias} <= 30 THEN '16-30' WHEN ${dias} <= 60 THEN '31-60' WHEN ${dias} <= 90 THEN '61-90' ELSE '90+' END`;
  const situacion = `CASE WHEN x.fecha_vencimiento IS NULL THEN 'SIN_VENCIMIENTO' WHEN x.fecha_vencimiento < ${corteSql} THEN 'VENCIDA' ELSE 'VIGENTE' END`;
  const diasVencidos = `CASE WHEN x.fecha_vencimiento IS NULL THEN NULL ELSE GREATEST(0, DATEDIFF(${corteSql}, x.fecha_vencimiento)) END`;
  return { dias, tramo, situacion, diasVencidos };
}

/** UNA transacción de solo lectura con instantánea consistente: filas, líneas y totales de una misma lectura no se desfasan. */
export async function enInstantanea<T>(fn: (c: PoolConnection) => Promise<T>, opciones: { lecturaRepetible?: boolean } = {}): Promise<T> {
  const c = await getPool().getConnection();
  try {
    if (opciones.lecturaRepetible) await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await c.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    try { return await fn(c); } finally { await c.query("COMMIT"); }
  } finally {
    c.release();
  }
}

/**
 * La entidad debe pertenecer a la empresa de la sesión (404 si es de otra empresa o no existe). Las inactivas siguen siendo consultables
 * (historia). Esto NO es autorización por usuario–entidad (política vigente; ticket transversal #555).
 */
export async function exigirEntidadEnEmpresa(c: Pick<PoolConnection, "query">, empresaId: number, entidadId: number): Promise<void> {
  const [ent] = await c.query<RowDataPacket[]>("SELECT id FROM cont_entidades WHERE empresa_id = ? AND id = ? LIMIT 1", [empresaId, entidadId]);
  if (!ent[0]) throw new ErrorCxp("Entidad no disponible.", 404, "ENTIDAD_NO_DISPONIBLE");
}

/**
 * Ejecuta la lectura con las tablas de pagos; si no existen (M-3B1 sin aplicar) no puede haber pagos → reintenta con pagado 0.00 exacto. Si falta
 * cualquier otra tabla CxP (M-3A), responde MIGRACION_PENDIENTE (503).
 */
export async function conLecturaCxp<T>(fn: (conPagos: boolean) => Promise<T>, que = "este reporte"): Promise<T> {
  try {
    return await fn(true);
  } catch (e) {
    if (!esTablaInexistente(e)) throw e;
    if (mencionaPagos(e)) {
      try { return await fn(false); } catch (e2) { if (!esTablaInexistente(e2)) throw e2; }
    }
    throw new ErrorCxp(`Esquema de Cuentas por pagar pendiente. Aplica las migraciones CxP (M-3A y M-3B1) antes de usar ${que}.`, 503, "MIGRACION_PENDIENTE");
  }
}
