import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { execute, query, type SqlParams } from "@/lib/db";

/**
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 5, ajuste post-revisión) —
 * `conn` opcional, mismo patrón `runQuery`/`runExecute` ya usado en
 * disponibilidad-traslapes.ts/paradas.ts/plan-comunes.ts: si se pasa
 * (dentro de la transacción de `confirmarImportacionProgramacion`), la
 * lectura/escritura usa esa MISMA conexión, para que la materialización
 * de tms_personal participe del rollback todo-o-nada del lote. Sin
 * `conn`, comportamiento IDÉNTICO al actual (pool global) — el POST/PATCH
 * de planes, que siguen llamando esta función sin `conn`, no cambian en
 * absoluto.
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
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 1) — extracción SIN CAMBIO DE
 * COMPORTAMIENTO de `personalDesdeEmpleado`/`validarPersonalId`, antes
 * definidas de forma local (no exportadas) dentro de
 * `.../tms/planes/route.ts`. Se mueven aquí tal cual, mismas queries,
 * mismas reglas, mismos contratos — el único cambio es que ahora son
 * reutilizables desde otro módulo (la futura importación masiva de
 * Programación desde Excel, ver docs/TMS-IMPORTACION-PROGRAMACION-EXCEL-1-
 * PROPUESTA-FINAL.md) sin duplicar la lógica.
 *
 * `planes/route.ts` (POST y PATCH) sigue siendo el único llamador hoy;
 * este PR no le cambia ni una query ni una regla — solo reubica el código
 * y lo importa donde antes estaba definido localmente.
 */

/**
 * Resuelve un `empleados.id` (maestro RRHH, código estable) al
 * `tms_personal.id` operativo real que usan `tms_planes_viaje.piloto_id` /
 * `auxiliar_id` / `tms_plan_auxiliares.personal_id`, creando o
 * actualizando el registro de `tms_personal` cuando corresponde (bridging
 * vía `tms_personal.id_empleado`, ver
 * sql/migrate-2026-08-fase0-tms-personal-empleado.sql). Devuelve `null` si
 * el `empleadoId` no viene, o si el empleado no existe/no está activo en
 * esta empresa.
 */
export async function personalDesdeEmpleado(
  empresaId: number,
  empleadoId: number | undefined,
  tipo: "Piloto" | "Auxiliar",
  conn?: PoolConnection,
): Promise<number | null> {
  if (!empleadoId) return null;
  const emp = await runQuery<RowDataPacket[]>(
    conn,
    `SELECT id, codigo, nombre FROM empleados
     WHERE id = ? AND empresa_id = ? AND estado = 'Activo' LIMIT 1`,
    [empleadoId, empresaId],
  );
  if (!emp[0]) return null;
  const codigo = String(emp[0].codigo);
  const nombre = String(emp[0].nombre);
  const existing = await runQuery<RowDataPacket[]>(
    conn,
    `SELECT id FROM tms_personal
     WHERE empresa_id = ? AND codigo = ? AND tipo = ? LIMIT 1`,
    [empresaId, codigo, tipo],
  );
  if (existing[0]) {
    await runExecute(
      conn,
      `UPDATE tms_personal SET id_empleado = ?, nombre = ?
       WHERE id = ? AND empresa_id = ?
         AND (id_empleado IS NULL OR id_empleado = ?)`,
      [empleadoId, nombre, existing[0].id, empresaId, empleadoId],
    );
    return Number(existing[0].id);
  }
  const r = await runExecute(
    conn,
    `INSERT INTO tms_personal
      (empresa_id, codigo, nombre, tipo, estado, id_empleado)
     VALUES (?, ?, ?, ?, 'Activo', ?)`,
    [empresaId, codigo, nombre, tipo, empleadoId],
  );
  return Number(r.insertId);
}

/**
 * Fase P5.1a: valida un personal_id EXACTO (sin resolver/auto-crear por
 * nombre o id_empleado) — existe, pertenece a la empresa, es del tipo
 * esperado y está activo. Usado por los campos pilotoPersonalId/
 * auxiliarPersonalIds de Programación.
 */
export async function validarPersonalId(
  empresaId: number,
  personalId: number,
  tipoEsperado: "Piloto" | "Auxiliar",
): Promise<{ id: number; nombre: string } | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, nombre FROM tms_personal
     WHERE id = ? AND empresa_id = ? AND tipo = ? AND estado = 'Activo' LIMIT 1`,
    [personalId, empresaId, tipoEsperado],
  );
  return rows[0]
    ? { id: Number(rows[0].id), nombre: String(rows[0].nombre) }
    : null;
}
