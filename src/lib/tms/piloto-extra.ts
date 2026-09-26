import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { execute, query, type SqlParams } from "@/lib/db";
import { personalDesdeEmpleado } from "./personal-resolucion";
import { MSG_EXTRA_INVALIDO } from "./piloto-extra-comun";

/**
 * PROGRAMACIÓN — PILOTO EXTRA. Un viaje Propio puede tener, además del piloto PRINCIPAL (`tms_planes_viaje.piloto_id`, que no
 * cambia), UN piloto extra: se guarda en `tms_plan_pilotos_adicionales` (tabla hermana de `tms_plan_auxiliares`, ver
 * sql/migrate-2026-09-tms-plan-pilotos-adicionales.sql). El piloto extra es un PILOTO real de RRHH (empleado activo → tms_personal
 * tipo 'Piloto'): nunca un auxiliar ni un nombre libre, y usa las MISMAS reglas de disponibilidad, viáticos y portal que el principal.
 *
 * Decisiones deliberadas de compatibilidad (el principal sigue siendo UNA identidad para todo lo que la necesita):
 *   - cierre, responsable histórico, flota_viajes/portal de salida y cualquier flujo "un piloto" siguen usando `piloto_id`;
 *   - el piloto extra es un co-piloto: ocupa disponibilidad, recibe su viático, ve el viaje en el portal y sale en reportes.
 */

export { MAX_PILOTOS_EXTRA, MSG_EXTRA_INVALIDO, MSG_EXTRA_SOLO_PROPIO, MSG_PERSONA_DUPLICADA, hayPersonaDuplicada, textoPilotos } from "./piloto-extra-comun";

export type PilotoExtraPlan = { personalId: number; empleadoId: number | null; nombre: string; telefono: string | null };

async function run<T extends RowDataPacket[]>(conn: PoolConnection | undefined, sql: string, params: SqlParams = []): Promise<T> {
  if (conn) return (await conn.query<RowDataPacket[]>(sql, params))[0] as T;
  return query<T>(sql, params);
}
async function exec(conn: PoolConnection | undefined, sql: string, params: SqlParams = []): Promise<ResultSetHeader> {
  if (conn) return (await conn.execute<ResultSetHeader>(sql, params))[0];
  return execute(sql, params);
}

/**
 * Piloto extra de VARIOS planes en UNA consulta (sin N+1). Igual que los auxiliares, tolera que la tabla aún no exista
 * (devuelve vacío): nunca rompe el listado de Programación.
 */
export async function pilotoExtraDePlanes(planIds: number[]): Promise<Map<number, PilotoExtraPlan>> {
  const map = new Map<number, PilotoExtraPlan>();
  const ids = [...new Set(planIds.map(Number).filter((id) => id > 0))];
  if (!ids.length) return map;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT x.plan_id, x.personal_id, per.id_empleado, per.nombre, emp.telefono
       FROM tms_plan_pilotos_adicionales x
       INNER JOIN tms_personal per ON per.id = x.personal_id
       LEFT JOIN empleados emp ON emp.id = per.id_empleado AND emp.empresa_id = per.empresa_id
       WHERE x.plan_id IN (${ids.map(() => "?").join(",")})
       ORDER BY x.plan_id, x.orden, x.id`,
      ids,
    );
    for (const r of rows) {
      const planId = Number(r.plan_id);
      if (map.has(planId)) continue; // hoy solo 1 por viaje
      map.set(planId, {
        personalId: Number(r.personal_id),
        empleadoId: r.id_empleado != null ? Number(r.id_empleado) : null,
        nombre: String(r.nombre),
        telefono: r.telefono ? String(r.telefono) : null,
      });
    }
  } catch {
    /* tabla aún no existe */
  }
  return map;
}

/** Id (tms_personal) del piloto extra de UN plan, dentro de la conexión dada. `null` si no tiene. */
export async function pilotoExtraIdDePlan(planId: number, conn?: PoolConnection): Promise<number | null> {
  try {
    const rows = await run<RowDataPacket[]>(conn, `SELECT personal_id FROM tms_plan_pilotos_adicionales WHERE plan_id = ? ORDER BY orden, id LIMIT 1`, [planId]);
    return rows[0] ? Number(rows[0].personal_id) : null;
  } catch {
    return null;
  }
}

/**
 * Reemplaza el piloto extra del plan (DELETE + INSERT) — dentro de la MISMA transacción del plan cuando se pasa `conn`
 * (los errores se propagan para poder hacer ROLLBACK). `personalId = null` lo quita.
 */
export async function guardarPilotoExtraPlan(empresaId: number, planId: number, personalId: number | null, conn: PoolConnection): Promise<void> {
  await exec(conn, "DELETE FROM tms_plan_pilotos_adicionales WHERE plan_id = ? AND empresa_id = ?", [planId, empresaId]);
  if (personalId != null) {
    await exec(conn, `INSERT INTO tms_plan_pilotos_adicionales (empresa_id, plan_id, personal_id, orden) VALUES (?, ?, ?, 1)`, [empresaId, planId, personalId]);
  }
}

export type ResultadoPilotoExtra = { ok: true; personalId: number } | { ok: false; status: number; error: string };

/**
 * Resuelve el piloto extra desde su `empleados.id` (RRHH): empleado ACTIVO de esta empresa con puesto/categoría de piloto (la misma
 * regla del catálogo `personal-ops?tipo=Piloto` que alimenta el selector del piloto principal) → `tms_personal` tipo 'Piloto'.
 * Nunca acepta texto libre.
 */
export async function resolverPilotoExtraDesdeEmpleado(empresaId: number, empleadoId: number, conn?: PoolConnection): Promise<ResultadoPilotoExtra> {
  const emp = await run<RowDataPacket[]>(
    conn,
    `SELECT id FROM empleados
     WHERE id = ? AND empresa_id = ? AND estado = 'Activo'
       AND (categoria_ops = 'Piloto' OR LOWER(COALESCE(puesto, '')) LIKE '%piloto%' OR LOWER(COALESCE(categoria_ops, '')) LIKE '%piloto%')
     LIMIT 1`,
    [empleadoId, empresaId],
  );
  if (!emp[0]) return { ok: false, status: 400, error: MSG_EXTRA_INVALIDO };
  const personalId = await personalDesdeEmpleado(empresaId, empleadoId, "Piloto", conn);
  if (!personalId) return { ok: false, status: 400, error: MSG_EXTRA_INVALIDO };
  return { ok: true, personalId };
}

/** Valida un `tms_personal.id` exacto como piloto extra (tipo Piloto, activo, de la empresa). */
export async function validarPilotoExtraPersonalId(empresaId: number, personalId: number): Promise<ResultadoPilotoExtra> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM tms_personal WHERE id = ? AND empresa_id = ? AND tipo = 'Piloto' AND estado = 'Activo' LIMIT 1`,
    [personalId, empresaId],
  );
  return rows[0] ? { ok: true, personalId: Number(rows[0].id) } : { ok: false, status: 400, error: MSG_EXTRA_INVALIDO };
}
