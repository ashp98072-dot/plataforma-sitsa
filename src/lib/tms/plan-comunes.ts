import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { execute, query, type SqlParams } from "@/lib/db";

/**
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 5) — extracción SIN CAMBIO DE
 * COMPORTAMIENTO de `upsertLugar`/`guardarAuxiliaresPlan`, antes
 * definidas de forma local (no exportadas) dentro de
 * `.../tms/planes/route.ts`. Se mueven aquí tal cual (mismo código) para
 * que la importación masiva de Programación (confirmarImportacionProgramacion,
 * src/lib/tms/programacion-import.ts) pueda reutilizarlas sin duplicar
 * lógica — mismo criterio ya aplicado en el PR 1 con
 * personalDesdeEmpleado/validarPersonalId (src/lib/tms/personal-resolucion.ts).
 *
 * `planes/route.ts` (POST y PATCH) sigue siendo el llamador original;
 * este cambio no le altera ni una query ni una regla.
 */

async function runQuery<T extends RowDataPacket[]>(
  conn: PoolConnection | undefined,
  sql: string,
  params: SqlParams = [],
): Promise<T> {
  if (conn) {
    const [rows] = await conn.query<RowDataPacket[]>(sql, params);
    return rows as T;
  }
  return query<T>(sql, params);
}

async function runExecute(
  conn: PoolConnection | undefined,
  sql: string,
  params: SqlParams = [],
): Promise<ResultSetHeader> {
  if (conn) {
    const [result] = await conn.execute<ResultSetHeader>(sql, params);
    return result;
  }
  return execute(sql, params);
}

/**
 * Resuelve un nombre de lugar a `tms_lugares.id`, creándolo si no existe.
 * `undefined`/vacío -> `null` (sin lugar). `conn` opcional (PR 5, ajuste
 * post-revisión): si viene, tanto el SELECT como el INSERT usan esa
 * misma conexión/transacción — mismo patrón que `guardarAuxiliaresPlan`
 * más abajo. Sin `conn`, comportamiento IDÉNTICO al actual (pool global).
 */
export async function upsertLugar(
  empresaId: number,
  nombre: string | undefined,
  tipo: string,
  conn?: PoolConnection,
): Promise<number | null> {
  if (!nombre?.trim()) return null;
  const existing = await runQuery<RowDataPacket[]>(
    conn,
    "SELECT id FROM tms_lugares WHERE empresa_id = ? AND nombre = ? LIMIT 1",
    [empresaId, nombre.trim()],
  );
  if (existing[0]) return Number(existing[0].id);
  const r = await runExecute(
    conn,
    "INSERT INTO tms_lugares (empresa_id, nombre, tipo) VALUES (?, ?, ?)",
    [empresaId, nombre.trim(), tipo],
  );
  return Number(r.insertId);
}

/**
 * Fase P5.1b: `conn` opcional — si viene (dentro de una transacción de
 * Programación), el DELETE + INSERTs usan esa misma conexión y los errores
 * SE PROPAGAN (para que el caller pueda hacer ROLLBACK) en vez de
 * silenciarse. Sin `conn`, comportamiento IDÉNTICO al actual: pool global
 * y errores silenciados (tolerancia histórica a "tabla aún no existe").
 */
export async function guardarAuxiliaresPlan(
  planId: number,
  personalIds: number[],
  conn?: PoolConnection,
): Promise<void> {
  async function escribir(): Promise<void> {
    await runExecute(conn, "DELETE FROM tms_plan_auxiliares WHERE plan_id = ?", [
      planId,
    ]);
    let orden = 1;
    for (const pid of personalIds.slice(0, 8)) {
      await runExecute(
        conn,
        `INSERT INTO tms_plan_auxiliares (plan_id, personal_id, orden)
         VALUES (?, ?, ?)`,
        [planId, pid, orden++],
      );
    }
  }
  if (conn) {
    await escribir();
    return;
  }
  try {
    await escribir();
  } catch {
    /* tabla aún no existe (comportamiento legado, sin conn) */
  }
}
