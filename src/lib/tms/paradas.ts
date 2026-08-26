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
  /**
   * OPS-3.2d: identidad de la parada YA EXISTENTE (tms_plan_paradas.id).
   * Ausente/undefined = parada NUEVA (se inserta). Presente = parada
   * existente que se actualiza IN-PLACE, conservando el mismo id — así
   * las evidencias ya subidas (tms_evidencias.parada_id /
   * flota_viaje_evidencias.parada_id, ninguna con FK/cascade) siguen
   * apuntando a una fila real. Nunca se confía en este id sin validarlo
   * contra el plan real (ver guardarParadasPlan).
   */
  id?: number;
};

export type ResultadoGuardarParadas =
  | { ok: true }
  | { ok: false; error: string };

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
 * OPS-3.2d — guardado SEGURO por identidad, ya no destructivo.
 *
 * Antes: DELETE FROM tms_plan_paradas WHERE plan_id = ? + INSERT de todas
 * de nuevo, siempre con ids nuevos. Eso era inofensivo mientras "paradas"
 * estuvo bloqueado en cualquier estado con evidencia (En ruta). Ahora que
 * OPS-3.2b/c/d permiten corregir un plan pendiente de cierre — momento en
 * el que YA puede haber evidencia subida por el piloto (tms_evidencias.
 * parada_id / flota_viaje_evidencias.parada_id, ambas columnas
 * aditivas SIN FK ni ON DELETE CASCADE, confirmado en
 * src/lib/flota/schema.ts) — repetir ese DELETE+INSERT habría dejado esas
 * evidencias con un parada_id que ya no existe: invisibles en el conteo
 * de cualquier parada nueva, pero sin borrarse (huérfanas).
 *
 * Estrategia por identidad (ParadaInput.id, opcional):
 * - Con id: DEBE existir y pertenecer a ESTE plan (si no, error — nunca
 *   se confía en un id del cliente) → UPDATE in-place, mismo id, mismas
 *   evidencias siguen vinculadas.
 * - Sin id: parada nueva → INSERT (mismo comportamiento de siempre).
 * - Una parada EXISTENTE que no aparece en `paradas` (omitida del
 *   payload) se interpreta como "se quiere eliminar" — permitido SOLO si
 *   no tiene evidencia asociada (tms_evidencias + flota_viaje_evidencias);
 *   si tiene, se rechaza ANTES de escribir nada (ok:false), para que el
 *   caller pueda hacer rollback completo de la transacción del PATCH sin
 *   dejar cambios parciales.
 *
 * Para un plan NUEVO (POST) o sin paradas previas, `actuales` sale vacío
 * — el comportamiento se reduce exactamente al INSERT de siempre, sin
 * ningún UPDATE/DELETE ni validación de por medio.
 *
 * `conn` opcional: si viene (dentro de una transacción de Programación),
 * TODAS las escrituras/lecturas internas usan esa misma conexión, para
 * que el guardado de paradas sea atómico junto con el resto del cambio.
 */
export async function guardarParadasPlan(
  empresaId: number,
  planId: number,
  paradas: ParadaInput[],
  conn?: PoolConnection,
): Promise<ResultadoGuardarParadas> {
  // 1) Estado actual real del plan: id + conteo de evidencias de cada
  // parada YA guardada — misma definición de "evidencias" que ya usa
  // listarParadasDePlanes (con el mismo fallback si flota_viaje_evidencias
  // aún no tiene la columna parada_id en este entorno).
  const actuales = await runQuery<RowDataPacket[]>(
    conn,
    `SELECT pp.id,
            (
              (SELECT COUNT(*) FROM tms_evidencias ev WHERE ev.parada_id = pp.id)
              +
              (SELECT COUNT(*) FROM flota_viaje_evidencias fe WHERE fe.parada_id = pp.id)
            ) AS evidencias
     FROM tms_plan_paradas pp
     WHERE pp.plan_id = ?`,
    [planId],
  ).catch(async () =>
    runQuery<RowDataPacket[]>(
      conn,
      `SELECT pp.id, (SELECT COUNT(*) FROM tms_evidencias ev
                      WHERE ev.parada_id = pp.id) AS evidencias
       FROM tms_plan_paradas pp
       WHERE pp.plan_id = ?`,
      [planId],
    ).catch(() => [] as RowDataPacket[]),
  );
  const evidenciasPorId = new Map<number, number>(
    actuales.map((r) => [Number(r.id), Number(r.evidencias ?? 0)]),
  );

  // 2) Validar de una vez todos los ids que llegaron — nunca se confía en
  // un id del cliente: debe existir y pertenecer a ESTE plan.
  const idsEnviados = new Set<number>();
  for (const p of paradas) {
    if (p.id == null) continue;
    const id = Number(p.id);
    if (!evidenciasPorId.has(id)) {
      return {
        ok: false,
        error: `Una de las paradas enviadas (id ${id}) no existe o no pertenece a este viaje.`,
      };
    }
    idsEnviados.add(id);
  }

  // 3) Cualquier parada EXISTENTE que no vino en el payload se interpreta
  // como "eliminar" — bloqueado si tiene evidencia. Se revisa ANTES de
  // escribir nada, para poder devolver el error sin dejar cambios
  // parciales (el caller hace rollback de la transacción completa).
  const idsAEliminar: number[] = [];
  for (const [id, evidencias] of evidenciasPorId) {
    if (idsEnviados.has(id)) continue;
    if (evidencias > 0) {
      return {
        ok: false,
        error: "No se puede eliminar una parada que ya tiene evidencias asociadas.",
      };
    }
    idsAEliminar.push(id);
  }

  // 4) A partir de aquí, todo lo recibido es válido — aplicar cambios.
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

    if (p.id != null) {
      // Parada EXISTENTE — UPDATE in-place, mismo id, evidencias intactas.
      try {
        await runExecute(
          conn,
          `UPDATE tms_plan_paradas
            SET orden = ?, lugar_id = ?, lugar_nombre = ?, tipo = ?,
                requiere_evidencia = ?, cliente_ubicacion_id = ?
           WHERE id = ? AND plan_id = ?`,
          [ordenActual, lugarId, nombre, tipo, requiereEvidencia, p.clienteUbicacionId ?? null, p.id, planId],
        );
      } catch {
        await runExecute(
          conn,
          `UPDATE tms_plan_paradas
            SET orden = ?, lugar_id = ?, lugar_nombre = ?, tipo = ?,
                requiere_evidencia = ?
           WHERE id = ? AND plan_id = ?`,
          [ordenActual, lugarId, nombre, tipo, requiereEvidencia, p.id, planId],
        );
      }
    } else {
      // Parada NUEVA — INSERT (mismo comportamiento de siempre).
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

  // 5) Eliminar las que quedaron omitidas y SIN evidencia (ya validado en
  // el paso 3 que ninguna de estas tiene evidencia asociada).
  if (idsAEliminar.length) {
    await runExecute(
      conn,
      `DELETE FROM tms_plan_paradas WHERE plan_id = ? AND id IN (${idsAEliminar.map(() => "?").join(",")})`,
      [planId, ...idsAEliminar],
    );
  }

  return { ok: true };
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
