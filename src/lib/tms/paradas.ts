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

/**
 * CORRECCIÓN PR #80 (integridad concurrente evidencia ↔ parada) — bloquea
 * (SELECT ... FOR UPDATE) la fila de una parada existente, validando que
 * pertenece al plan indicado y que ese plan pertenece a la empresa
 * indicada, DENTRO de la conexión/transacción del caller. El lock se
 * mantiene hasta que el caller haga commit o rollback.
 *
 * A diferencia de `validarParadaDelPlan` (solo lectura, sin lock, usada
 * por el portal del piloto para una validación rápida antes de subir su
 * evidencia), esta variante existe específicamente para SERIALIZAR dos
 * escrituras que de otro modo podrían dejar una evidencia huérfana:
 * - `guardarParadasPlan` la usa antes de decidir un DELETE definitivo de
 *   una parada candidata (ver más abajo).
 * - El endpoint de staff que sube evidencia con `paradaId`
 *   (src/app/api/empresas/[slug]/flota/viajes/[id]/evidencias/route.ts)
 *   la usa antes de su propio INSERT.
 *
 * Como ambos caminos bloquean la MISMA fila antes de escribir, quedan
 * serializados: el que llega primero mantiene al otro esperando hasta su
 * commit/rollback, y el que llega segundo ve el resultado ya consumado
 * (parada eliminada → ya no existe → se rechaza el INSERT de evidencia;
 * o evidencia ya insertada → el COUNT bajo lock ya no da 0 → no se borra
 * la parada).
 */
export async function bloquearParadaDelPlan(
  conn: PoolConnection,
  empresaId: number,
  planId: number,
  paradaId: number,
): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT pp.id
     FROM tms_plan_paradas pp
     INNER JOIN tms_planes_viaje p ON p.id = pp.plan_id
     WHERE pp.id = ? AND pp.plan_id = ? AND p.empresa_id = ?
     FOR UPDATE`,
    [paradaId, planId, empresaId],
  );
  return rows.length > 0;
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
 *   no tiene evidencia asociada (tms_evidencias + flota_viaje_evidencias).
 *   El COUNT del paso 1 rechaza rápido el caso obvio (ok:false) ANTES de
 *   escribir nada; pero la decisión DEFINITIVA de cada DELETE se toma más
 *   abajo, fila por fila: primero se bloquea la fila de la parada
 *   (`bloquearParadaDelPlan`, FOR UPDATE) y LUEGO se relee la existencia
 *   de evidencia con su propio `SELECT ... LIMIT 1 FOR UPDATE` por tabla
 *   (current/locking read, no un SELECT normal — bajo REPEATABLE READ un
 *   SELECT normal podría seguir viendo el snapshot de una lectura
 *   anterior de la transacción, como `actuales` del paso 1, e ignorar un
 *   INSERT ya confirmado por otra transacción). CORRECCIÓN PR #80: sin
 *   esto, una evidencia podría insertarse concurrentemente entre el
 *   COUNT del paso 1 y el DELETE (vía el endpoint de staff, que adquiere
 *   este mismo lock de la parada antes de insertar) y quedar huérfana.
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

  // 5) CORRECCIÓN PR #80 (integridad concurrente evidencia ↔ parada,
  // ronda 2): el COUNT del paso 1 (usado solo para el rechazo rápido de
  // UX del paso 3) puede quedar desactualizado — sin FK ni lock
  // compartido, una evidencia podría insertarse para una de estas
  // paradas DESPUÉS de ese COUNT y ANTES del DELETE.
  //
  // La primera versión de esta corrección volvía a bloquear la fila de
  // la parada (bloquearParadaDelPlan, FOR UPDATE) pero decidía con un
  // SELECT NORMAL sobre tms_evidencias/flota_viaje_evidencias — bajo
  // REPEATABLE READ (el nivel de aislamiento de este pool), un SELECT
  // sin FOR UPDATE puede seguir devolviendo el snapshot consistente que
  // la transacción ya estableció con una lectura anterior (p.ej. el
  // `actuales` del paso 1), IGNORANDO un INSERT de otra transacción ya
  // confirmado — el mismo problema que OPS-3.2a ya había corregido para
  // el estado del plan, reproducido aquí para evidencias. Bloquear la
  // fila de la parada no alcanza: la lectura que decide el DELETE tiene
  // que ser ella misma un current/locking read.
  //
  // Por eso cada tabla de evidencia se lee con su propio
  // `SELECT id ... LIMIT 1 FOR UPDATE` (existencia, no COUNT — solo
  // importa si hay al menos una), sobre la MISMA `conn`/transacción.
  // Es el mismo lock que adquiere el endpoint de staff
  // (evidencias/route.ts) antes de insertar evidencia con `paradaId` —
  // quien llegue primero (este DELETE o ese INSERT) bloquea al otro
  // hasta su commit/rollback:
  // - PATCH gana el lock de la parada y borra+confirma → el INSERT del
  //   staff ya no encuentra la fila (bloquearParadaDelPlan) → se
  //   rechaza antes de escribir evidencia.
  // - Staff gana el lock, inserta y confirma → el current read de aquí
  //   (hecho DESPUÉS de esperar ese mismo lock) ve la fila YA
  //   confirmada, no un snapshot viejo → esta parada NO se borra, se
  //   aborta con el mismo error de siempre (rollback completo del
  //   PATCH).
  for (const id of idsAEliminar) {
    if (conn) {
      const existe = await bloquearParadaDelPlan(conn, empresaId, planId, id);
      if (!existe) continue; // ya no existe (o dejó de pertenecer) — nada que borrar
    }
    // Current read de tms_evidencias — sin FOR UPDATE no serviría (ver
    // arriba). No se atrapa el error: si esta tabla fallara sería un
    // problema real de conexión/esquema, no el fallback esperado de
    // flota_viaje_evidencias de abajo — mejor abortar toda la
    // transacción (catch de route.ts → rollback) que arriesgar un falso
    // "sin evidencia".
    const tmsEvidencia = await runQuery<RowDataPacket[]>(
      conn,
      `SELECT id FROM tms_evidencias WHERE parada_id = ? LIMIT 1 FOR UPDATE`,
      [id],
    );
    // Current read de flota_viaje_evidencias — mismo fallback de
    // siempre (columna parada_id aditiva, puede no existir todavía en
    // algún entorno): si la columna no existe, no hay ninguna fila que
    // pueda referenciarla, así que se omite el check sin riesgo.
    let flotaEvidencia: RowDataPacket[] = [];
    try {
      flotaEvidencia = await runQuery<RowDataPacket[]>(
        conn,
        `SELECT id FROM flota_viaje_evidencias WHERE parada_id = ? LIMIT 1 FOR UPDATE`,
        [id],
      );
    } catch {
      flotaEvidencia = [];
    }
    if (tmsEvidencia.length || flotaEvidencia.length) {
      return {
        ok: false,
        error: "No se puede eliminar una parada que ya tiene evidencias asociadas.",
      };
    }
    await runExecute(
      conn,
      `DELETE FROM tms_plan_paradas WHERE id = ? AND plan_id = ?`,
      [id, planId],
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
