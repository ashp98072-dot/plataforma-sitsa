import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { query, type SqlParams } from "@/lib/db";
import { esColisionIndiceCodigoPlan, type IntentoCodigoPlan } from "./codigo-plan-colision";

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
 * SOLO una violación real del UNIQUE KEY (empresa_id, codigo) —`uq_plan`— debe interpretarse como "código duplicado,
 * reintentar con otro". Cualquier otro error del INSERT (FK, dato inválido, trigger, timeout, esquema…, e incluso un
 * ER_DUP_ENTRY de OTRO índice) debe propagarse tal cual — nunca esconderse detrás de un falso "no se pudo generar un
 * código de plan único". La lógica vive en `codigo-plan-colision.ts` (módulo puro); aquí se conserva el nombre
 * histórico para los llamadores existentes. Pasar `intento` permite reconocer la colisión aunque el índice se llame
 * distinto en una instalación (el valor duplicado es `<empresa_id>-<codigo>`).
 */
export function esDuplicadoCodigoPlan(e: unknown, intento?: IntentoCodigoPlan): boolean {
  return esColisionIndiceCodigoPlan(e, intento);
}
