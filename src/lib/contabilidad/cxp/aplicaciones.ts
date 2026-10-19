import Decimal from "decimal.js";
import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";

/** Lo mínimo que necesitamos de una conexión (pool o transacción). */
export type ConexionLectura = { query: (sql: string, params: unknown[]) => Promise<unknown> };

const esTablaInexistente = (e: unknown) => (e as { code?: string } | null)?.code === "ER_NO_SUCH_TABLE";

/**
 * Suma de aplicaciones VIGENTES por factura = pagos REGISTRADOS (los REVERSADOS no cuentan). La retención de ISR NO es una aplicación.
 * Siempre acotado a (empresa, entidad). Dentro de una transacción que ya bloqueó las facturas (`FOR UPDATE`) el resultado es estable.
 * Con `tolerarSinMigracion` (solo LECTURAS de listado/consulta), si las tablas de pagos aún no existen devuelve 0.00 para todas: mientras no se
 * aplique la migración M-3B1 no puede existir ningún pago, así que 0.00 es exacto y Facturas sigue funcionando. Las ESCRITURAS nunca lo toleran.
 */
export async function obtenerAplicado(
  empresaId: number, entidadId: number, ids: number[], conexion?: ConexionLectura, { tolerarSinMigracion = false } = {},
): Promise<Map<number, string>> {
  const resultado = new Map(ids.map(id => [id, "0.00"]));
  if (!ids.length) return resultado;
  const sql = `SELECT a.factura_id, SUM(a.monto) AS pagado
      FROM cxp_pago_aplicaciones a JOIN cxp_pagos p ON p.empresa_id = a.empresa_id AND p.entidad_id = a.entidad_id AND p.id = a.pago_id
     WHERE a.empresa_id = ? AND a.entidad_id = ? AND p.estado = 'REGISTRADO' AND a.factura_id IN (${ids.map(() => "?").join(",")})
     GROUP BY a.factura_id`;
  const params = [empresaId, entidadId, ...ids];
  try {
    const bruto = conexion ? await conexion.query(sql, params) : await getPool().query(sql, params);
    const rows = (Array.isArray(bruto) && Array.isArray(bruto[0]) ? bruto[0] : bruto) as RowDataPacket[];
    for (const r of rows) resultado.set(Number(r.factura_id), new Decimal(String(r.pagado ?? "0")).toFixed(2));
  } catch (e) {
    if (tolerarSinMigracion && esTablaInexistente(e)) return resultado;
    throw e;
  }
  return resultado;
}
