import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { query, type SqlParams } from "@/lib/db";

/** Prefijo estable: PLAN-YYYYMMDD-### (único por empresa). */
export function prefijoCodigoPlan(fechaPlan: string): string {
  const ymd = fechaPlan.replace(/-/g, "").slice(0, 8);
  return `PLAN-${ymd}-`;
}

/** Ejecutor de SQL: `query()` del pool (conexión suelta) o `conn.query()` de una transacción abierta. */
type EjecutorSql = <T extends RowDataPacket[]>(sql: string, params: SqlParams) => Promise<T>;
const viaPool: EjecutorSql = (sql, params) => query(sql, params);
const viaConexion = (conn: PoolConnection): EjecutorSql => async (sql, params) => (await conn.query(sql, params))[0] as never;

async function generarCodigoPlanCon(
  ejecutar: EjecutorSql,
  empresaId: number,
  fechaPlan: string,
): Promise<string> {
  const prefix = prefijoCodigoPlan(fechaPlan);
  const rows = await ejecutar<RowDataPacket[]>(
    `SELECT codigo FROM tms_planes_viaje
     WHERE empresa_id = ? AND codigo LIKE ?
     ORDER BY id DESC
     LIMIT 40`,
    [empresaId, `${prefix}%`],
  );
  let max = 0;
  for (const r of rows) {
    const m = String(r.codigo ?? "").match(/-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

async function asegurarCodigoPlanUnicoCon(
  ejecutar: EjecutorSql,
  empresaId: number,
  fechaPlan: string,
  deseado?: string | null,
): Promise<string> {
  let codigo = (deseado ?? "").trim();
  if (!codigo) {
    codigo = await generarCodigoPlanCon(ejecutar, empresaId, fechaPlan);
  }
  for (let i = 0; i < 8; i++) {
    const hit = await ejecutar<RowDataPacket[]>(
      `SELECT id FROM tms_planes_viaje
       WHERE empresa_id = ? AND codigo = ? LIMIT 1`,
      [empresaId, codigo],
    );
    if (!hit[0]) return codigo;
    codigo = await generarCodigoPlanCon(ejecutar, empresaId, fechaPlan);
  }
  return `${prefijoCodigoPlan(fechaPlan)}${Date.now().toString().slice(-5)}`;
}

export async function generarCodigoPlan(empresaId: number, fechaPlan: string): Promise<string> {
  return generarCodigoPlanCon(viaPool, empresaId, fechaPlan);
}

/** Si el código ya existe, propone el siguiente del mismo día. */
export async function asegurarCodigoPlanUnico(
  empresaId: number,
  fechaPlan: string,
  deseado?: string | null,
): Promise<string> {
  return asegurarCodigoPlanUnicoCon(viaPool, empresaId, fechaPlan, deseado);
}

/**
 * PROGRAMACION-COPIA-LOTE-TX-1 — variantes TRANSACTION-AWARE: consultan con LA MISMA conexión `conn` de una
 * transacción abierta, así ven sus propios INSERT todavía sin commit (el bug real de "copiar varios planes a la vez
 * falla": cada fila del lote generaba su código con `query()` del pool, una conexión DISTINTA que no ve los INSERT
 * sin confirmar de la propia transacción — dos filas del mismo lote podían proponerse el mismo código). Nunca abren
 * ni cierran la transacción; el caller es dueño de `conn` (begin/commit/rollback/release).
 */
export async function generarCodigoPlanTx(conn: PoolConnection, empresaId: number, fechaPlan: string): Promise<string> {
  return generarCodigoPlanCon(viaConexion(conn), empresaId, fechaPlan);
}

export async function asegurarCodigoPlanUnicoTx(
  conn: PoolConnection,
  empresaId: number,
  fechaPlan: string,
  deseado?: string | null,
): Promise<string> {
  return asegurarCodigoPlanUnicoCon(viaConexion(conn), empresaId, fechaPlan, deseado);
}

/**
 * AJUSTE PRE-MERGE PR #173 (punto 1, ya existente en solicitudes-cliente-operaciones.ts) — SOLO una violación real
 * del UNIQUE KEY (empresa_id, codigo) debe interpretarse como "código duplicado, reintentar con otro". Cualquier
 * otro error del INSERT (FK, dato inválido, timeout, esquema…) debe propagarse tal cual — nunca esconderse detrás de
 * un falso "no se pudo generar un código de plan único". Centralizado aquí para no duplicarlo en cada caller.
 */
export function esDuplicadoCodigoPlan(e: unknown): boolean {
  const err = e as { code?: string; errno?: number } | null;
  return !!err && (err.code === "ER_DUP_ENTRY" || err.errno === 1062);
}
