import type { Pool, PoolConnection } from "mysql2/promise";
import { codigoErrorSql } from "@/lib/tms/codigo-plan-colision";

/**
 * Lector de la VISTA PREVIA de «Copiar programación»: una conexión dedicada, SOLO LECTURA, con presupuesto de tiempo.
 *  - Rechaza cualquier sentencia que no sea un SELECT puro (FOR UPDATE, LOCK IN SHARE MODE, GET_LOCK, INTO OUTFILE…): la vista previa
 *    jamás adquiere bloqueos de escritura ni espera a otras transacciones por filas.
 *  - Reutiliza dentro de la operación el resultado de sentencias idénticas (metadatos de information_schema, listas por empresa…): una
 *    sola consulta por sentencia distinta en vez de repetirla por cada unidad.
 *  - Límite de TODA la operación (`presupuestoMs`) y por sentencia (`max_statement_time` / `max_execution_time` / `lock_wait_timeout` de sesión,
 *    restablecidos al liberar). Al agotarse lanza `ErrorVistaPrevia` (nunca se ignora ni se acumula por unidad).
 * Los mensajes del error son controlados: solo el código `ER_*` (nunca texto SQL, valores ni nombres de tablas).
 */
export class ErrorVistaPrevia extends Error {
  readonly status = 503 as const;
  constructor(mensaje: string, readonly codigo: string | null = null, options?: { cause?: unknown }) {
    super(mensaje, options);
    this.name = "ErrorVistaPrevia";
  }
}

export const PRESUPUESTO_VISTA_PREVIA_MS = 20_000;
export const LIMITE_SENTENCIA_VISTA_PREVIA_MS = 5_000;

const SELECT_PURO = /^\s*SELECT\b/i;
const PROHIBIDO = /\bFOR\s+UPDATE\b|\bLOCK\s+IN\s+SHARE\s+MODE\b|\bFOR\s+SHARE\b|\bGET_LOCK\s*\(|\bINTO\s+(?:OUTFILE|DUMPFILE|@)/i;

export type LectorVistaPrevia = {
  query: PoolConnection["query"];
  execute: PoolConnection["execute"];
  /** Sentencias realmente enviadas a la base (excluye las servidas desde la caché de la operación). */
  readonly sentencias: () => number;
  liberar: () => Promise<void>;
};

/** Convierte un fallo técnico en un error controlado para la interfaz (sin filtrar texto SQL). */
export function errorVistaPrevia(e: unknown): ErrorVistaPrevia {
  if (e instanceof ErrorVistaPrevia) return e;
  const codigo = codigoErrorSql(e);
  if (codigo === "ER_LOCK_WAIT_TIMEOUT" || codigo === "ER_LOCK_DEADLOCK") {
    return new ErrorVistaPrevia(`No se pudo verificar la identidad de las unidades: la base de datos está ocupada con otra operación (error ${codigo}). Intenta de nuevo en unos minutos.`, codigo, { cause: e });
  }
  if (codigo === "ER_STATEMENT_TIMEOUT" || codigo === "ER_QUERY_TIMEOUT" || (e as { errno?: number } | null)?.errno === 1969 || (e as { errno?: number } | null)?.errno === 3024) {
    return new ErrorVistaPrevia(`No se pudo verificar la identidad de las unidades: la consulta tardó demasiado${codigo ? ` (error ${codigo})` : ""}. Intenta de nuevo.`, codigo, { cause: e });
  }
  return new ErrorVistaPrevia(`No se pudo verificar la identidad de las unidades${codigo ? ` (error de base de datos ${codigo})` : ""}. Intenta de nuevo.`, codigo, { cause: e });
}

export async function abrirLectorVistaPrevia(
  pool: Pick<Pool, "getConnection">,
  opts: { presupuestoMs?: number; limiteSentenciaMs?: number; ahora?: () => number } = {},
): Promise<LectorVistaPrevia> {
  const presupuestoMs = opts.presupuestoMs ?? PRESUPUESTO_VISTA_PREVIA_MS;
  const limiteMs = opts.limiteSentenciaMs ?? LIMITE_SENTENCIA_VISTA_PREVIA_MS;
  const ahora = opts.ahora ?? Date.now;
  const conn = await pool.getConnection();
  const limite = ahora() + presupuestoMs;
  let envia = 0;
  let aplicadas: string[] = [];
  // Límites de sesión (MariaDB: max_statement_time en segundos; MySQL: max_execution_time en ms). Cada uno es opcional según el servidor.
  for (const [variable, valor] of [["max_statement_time", limiteMs / 1000], ["max_execution_time", limiteMs], ["lock_wait_timeout", Math.max(1, Math.ceil(limiteMs / 1000))], ["innodb_lock_wait_timeout", Math.max(1, Math.ceil(limiteMs / 1000))]] as const) {
    try { await conn.query(`SET SESSION ${variable} = ?`, [valor]); aplicadas.push(variable); } catch { /* variable no soportada por este servidor */ }
  }
  const cache = new Map<string, Promise<unknown>>();
  const original = conn.query.bind(conn) as (sql: string, args?: unknown[]) => Promise<unknown>;

  const consultar = async (sql: unknown, args?: unknown[]): Promise<unknown> => {
    const texto = typeof sql === "string" ? sql : "";
    if (!SELECT_PURO.test(texto) || PROHIBIDO.test(texto)) throw new ErrorVistaPrevia("La vista previa solo puede ejecutar consultas de lectura.");
    if (ahora() > limite) throw new ErrorVistaPrevia("No se pudo verificar la identidad de las unidades: la verificación tardó demasiado. Intenta de nuevo.");
    const clave = `${texto}\u0000${JSON.stringify(args ?? [])}`;
    let previa = cache.get(clave);
    if (!previa) {
      envia++;
      previa = original(texto, args).catch((e) => { cache.delete(clave); throw e; });
      cache.set(clave, previa);
    }
    return await previa;
  };

  return {
    query: ((sql: unknown, args?: unknown[]) => consultar(sql, args)) as PoolConnection["query"],
    execute: ((sql: unknown, args?: unknown[]) => consultar(sql, args)) as PoolConnection["execute"],
    sentencias: () => envia,
    async liberar() {
      let limpia = true;
      for (const variable of aplicadas) {
        try { await conn.query(`SET SESSION ${variable} = DEFAULT`); } catch { limpia = false; }
      }
      aplicadas = [];
      if (limpia) conn.release(); else conn.destroy();   // una conexión con límites de sesión alterados nunca vuelve al pool
    },
  };
}
