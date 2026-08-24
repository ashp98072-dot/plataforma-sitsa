import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { execute, query, type SqlParams } from "@/lib/db";

/**
 * Fase P5.1b: helpers de lectura/escritura conn-aware. Si se pasa `conn`
 * (dentro de una transacción), usan esa misma conexión; si no, mantienen
 * exactamente el comportamiento actual (pool global vía @/lib/db).
 */
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

async function runQuery<T extends RowDataPacket[]>(
  conn: PoolConnection | undefined,
  sql: string,
  params: SqlParams = [],
): Promise<T> {
  if (conn) {
    const [rows] = await conn.query<T>(sql, params);
    return rows;
  }
  return query<T>(sql, params);
}

export type TipoParada = "Carga" | "Descarga" | "Entrega";

export type PlanParada = {
  id: number;
  plan_id: number;
  orden: number;
  lugar_id: number | null;
  lugar_nombre: string;
  tipo: string;
  requiere_evidencia: boolean;
  evidencias: number;
};

export type ParadaInput = {
  lugarNombre: string;
  tipo?: TipoParada | string;
  requiereEvidencia?: boolean;
  lugarId?: number | null;
  /**
   * VIAT-1: id de tms_cliente_ubicaciones (la ubicación guardada del
   * cliente) de la que salió esta parada, si el programador la eligió del
   * catálogo en vez de escribirla a mano. Puramente informativo/de
   * referencia — `lugarNombre` sigue siendo el texto/dirección HISTÓRICO
   * real de este viaje, no se recalcula desde la ubicación si esta cambia
   * después.
   */
  clienteUbicacionId?: number | null;
};

function mapParadaRow(r: RowDataPacket): PlanParada {
  return {
    id: Number(r.id),
    plan_id: Number(r.plan_id),
    orden: Number(r.orden),
    lugar_id: r.lugar_id != null ? Number(r.lugar_id) : null,
    lugar_nombre: String(r.lugar_nombre),
    tipo: String(r.tipo ?? "Entrega"),
    requiere_evidencia: Number(r.requiere_evidencia ?? 1) === 1,
    evidencias: Number(r.evidencias ?? 0),
  };
}

export async function listarParadasDelPlan(
  planId: number,
): Promise<PlanParada[]> {
  const byPlan = await listarParadasDePlanes([planId]);
  return byPlan.get(planId) ?? [];
}

/** Paradas de varios planes en 1–2 queries (evita N+1 en reportes). */
export async function listarParadasDePlanes(
  planIds: number[],
): Promise<Map<number, PlanParada[]>> {
  const map = new Map<number, PlanParada[]>();
  const ids = [...new Set(planIds.map(Number).filter((id) => id > 0))];
  if (!ids.length) return map;

  const placeholders = ids.map(() => "?").join(",");
  const rows = await query<RowDataPacket[]>(
    `SELECT pp.id, pp.plan_id, pp.orden, pp.lugar_id, pp.lugar_nombre, pp.tipo,
            pp.requiere_evidencia,
            (
              (SELECT COUNT(*) FROM tms_evidencias ev WHERE ev.parada_id = pp.id)
              +
              (SELECT COUNT(*) FROM flota_viaje_evidencias fe WHERE fe.parada_id = pp.id)
            ) AS evidencias
     FROM tms_plan_paradas pp
     WHERE pp.plan_id IN (${placeholders})
     ORDER BY pp.plan_id ASC, pp.orden ASC, pp.id ASC`,
    ids,
  ).catch(async () =>
    query<RowDataPacket[]>(
      `SELECT pp.id, pp.plan_id, pp.orden, pp.lugar_id, pp.lugar_nombre, pp.tipo,
              pp.requiere_evidencia,
              (SELECT COUNT(*) FROM tms_evidencias ev
               WHERE ev.parada_id = pp.id) AS evidencias
       FROM tms_plan_paradas pp
       WHERE pp.plan_id IN (${placeholders})
       ORDER BY pp.plan_id ASC, pp.orden ASC, pp.id ASC`,
      ids,
    ).catch(() => [] as RowDataPacket[]),
  );

  for (const r of rows) {
    const planId = Number(r.plan_id);
    const list = map.get(planId) ?? [];
    list.push(mapParadaRow(r));
    map.set(planId, list);
  }
  return map;
}

/**
 * Fase P5.1b: `conn` opcional — si viene (dentro de una transacción de
 * Programación), TODAS las escrituras/lecturas internas (DELETE, el
 * auto-alta de tms_lugares, e INSERT de cada parada) usan esa misma
 * conexión, para que un reemplazo de paradas sea atómico junto con el
 * resto del cambio. Sin `conn`, comportamiento idéntico al actual (pool
 * global) — compatibilidad total con los 2 consumidores existentes
 * (POST/PATCH de tms/planes/route.ts), que siguen llamándola sin `conn`.
 */
export async function guardarParadasPlan(
  empresaId: number,
  planId: number,
  paradas: ParadaInput[],
  conn?: PoolConnection,
): Promise<void> {
  await runExecute(conn, "DELETE FROM tms_plan_paradas WHERE plan_id = ?", [planId]);
  let orden = 1;
  for (const p of paradas) {
    const nombre = (p.lugarNombre || "").trim();
    if (!nombre) continue;
    const tipo = String(p.tipo || "Entrega");
    let lugarId = p.lugarId ?? null;
    if (!lugarId) {
      const existing = await runQuery<RowDataPacket[]>(
        conn,
        "SELECT id FROM tms_lugares WHERE empresa_id = ? AND nombre = ? LIMIT 1",
        [empresaId, nombre],
      );
      if (existing[0]) {
        lugarId = Number(existing[0].id);
      } else {
        const r = await runExecute(
          conn,
          "INSERT INTO tms_lugares (empresa_id, nombre, tipo) VALUES (?, ?, ?)",
          [empresaId, nombre, tipo === "Carga" ? "Carga" : "Descarga"],
        );
        lugarId = Number(r.insertId);
      }
    }
    const ordenActual = orden++;
    const requiereEvidencia = p.requiereEvidencia === false ? 0 : 1;
    try {
      // VIAT-1: intenta guardar cliente_ubicacion_id (columna aditiva, ver
      // sql/migrate-2026-08-viat-1-cliente-ubicaciones.sql). Si esa
      // migración todavía no se aplicó en este entorno, MySQL rechaza la
      // columna desconocida y se reintenta sin ella (mismo `ordenActual`,
      // capturado ANTES del try — no se pierde la parada ni se salta un
      // número de orden por un campo opcional/de referencia).
      await runExecute(
        conn,
        `INSERT INTO tms_plan_paradas
          (plan_id, orden, lugar_id, lugar_nombre, tipo, requiere_evidencia, cliente_ubicacion_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [planId, ordenActual, lugarId, nombre, tipo, requiereEvidencia, p.clienteUbicacionId ?? null],
      );
    } catch {
      await runExecute(
        conn,
        `INSERT INTO tms_plan_paradas
          (plan_id, orden, lugar_id, lugar_nombre, tipo, requiere_evidencia)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [planId, ordenActual, lugarId, nombre, tipo, requiereEvidencia],
      );
    }
  }
}

/** Paradas que aún no tienen evidencia (requiere_evidencia = 1). */
export async function paradasPendientesEvidencia(
  planId: number,
): Promise<PlanParada[]> {
  const all = await listarParadasDelPlan(planId);
  return all.filter((p) => p.requiere_evidencia && p.evidencias < 1);
}

export async function validarParadaDelPlan(
  empresaId: number,
  planId: number,
  paradaId: number,
): Promise<PlanParada | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT pp.id, pp.plan_id, pp.orden, pp.lugar_id, pp.lugar_nombre, pp.tipo,
            pp.requiere_evidencia
     FROM tms_plan_paradas pp
     INNER JOIN tms_planes_viaje p ON p.id = pp.plan_id
     WHERE pp.id = ? AND pp.plan_id = ? AND p.empresa_id = ?
     LIMIT 1`,
    [paradaId, planId, empresaId],
  ).catch(() => [] as RowDataPacket[]);
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    plan_id: Number(rows[0].plan_id),
    orden: Number(rows[0].orden),
    lugar_id: rows[0].lugar_id != null ? Number(rows[0].lugar_id) : null,
    lugar_nombre: String(rows[0].lugar_nombre),
    tipo: String(rows[0].tipo ?? "Entrega"),
    requiere_evidencia: Number(rows[0].requiere_evidencia ?? 1) === 1,
    evidencias: 0,
  };
}
