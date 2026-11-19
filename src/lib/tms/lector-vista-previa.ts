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
  /** Variables de sesión de límite efectivamente aplicadas (según lo que soporte el servidor). */
  readonly limitesAplicados: readonly string[];
  /** true si el servidor admite al menos un límite POR SENTENCIA (max_statement_time o max_execution_time). */
  readonly limiteSentenciaDisponible: boolean;
  /** Idempotente: llamarlo varias veces libera/destruye la conexión UNA sola vez. */
  liberar: () => Promise<void>;
  /** Estado de la conexión: `descartada` = quedó en estado incierto y se destruirá en vez de volver al pool. */
  readonly estado: () => { liberada: boolean; descartada: boolean };
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

const MSG_TIEMPO = "No se pudo verificar la identidad de las unidades: la verificación tardó demasiado. Intenta de nuevo.";

/** ÚNICOS errores tolerados al configurar un límite de sesión: la variable no existe en este servidor (1193) o no es de sesión (1238). Todo lo demás es un fallo real. */
const ERRNO_VARIABLE_NO_SOPORTADA = new Set([1193, 1238]);
const esVariableNoSoportada = (e: unknown) => ERRNO_VARIABLE_NO_SOPORTADA.has(Number((e as { errno?: unknown } | null)?.errno));

/** El error es una respuesta SQL normal del servidor (la conexión sigue sana): tiene código ER_ (y errno) y no es fatal. Cualquier otra cosa deja la conexión en estado incierto. */
const esErrorSqlLimpio = (e: unknown) => {
  const err = e as { errno?: unknown; code?: unknown; fatal?: unknown } | null;
  return !!err && err.fatal !== true && typeof err.errno === "number" && typeof err.code === "string" && /^ER_/.test(err.code);
};

/** Copia por llamada de lo servido desde la caché: ningún consumidor puede alterar lo que verá el siguiente. */
function copiaDeResultado(r: unknown): unknown {
  if (Array.isArray(r) && Array.isArray(r[0])) return [r[0].map((f: unknown) => (f && typeof f === "object" ? { ...(f as object) } : f)), ...r.slice(1)];
  if (Array.isArray(r) && r[0] && typeof r[0] === "object") return [{ ...(r[0] as object) }, ...r.slice(1)];
  return r;
}

/** Espera `p` como máximo `ms`; si vence, rechaza con `ErrorVistaPrevia` (el temporizador siempre se limpia). */
function conLimite<T>(p: Promise<T>, ms: number, alVencer: () => void): Promise<T> {
  if (ms <= 0) { p.catch(() => undefined); alVencer(); return Promise.reject(new ErrorVistaPrevia(MSG_TIEMPO)); }
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { alVencer(); reject(new ErrorVistaPrevia(MSG_TIEMPO)); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function abrirLectorVistaPrevia(
  pool: Pick<Pool, "getConnection">,
  opts: { empresaId?: number; presupuestoMs?: number; limiteSentenciaMs?: number; ahora?: () => number } = {},
): Promise<LectorVistaPrevia> {
  const presupuestoMs = opts.presupuestoMs ?? PRESUPUESTO_VISTA_PREVIA_MS;
  const limiteMs = opts.limiteSentenciaMs ?? LIMITE_SENTENCIA_VISTA_PREVIA_MS;
  const ahora = opts.ahora ?? Date.now;
  const limite = ahora() + presupuestoMs;
  const restante = () => limite - ahora();
  const ambito = opts.empresaId != null ? `e${opts.empresaId}` : "e*";

  // getConnection también cuenta contra el presupuesto: un pool agotado no puede dejar la pantalla esperando. Si la conexión llega TARDE (ya vencido el plazo), se devuelve al pool sin usarla.
  const pendiente = pool.getConnection();
  const conn = await conLimite(pendiente, restante(), () => { void pendiente.then((c) => c.release(), () => undefined); });

  let envia = 0;
  let liberada = false;
  let descartada = false;
  const aplicadas: string[] = [];

  // Límites de sesión (MariaDB: max_statement_time en segundos; MySQL: max_execution_time en ms). Solo se tolera «variable no soportada»; cualquier otro fallo (conexión caída…) aborta y descarta la conexión.
  try {
    for (const [variable, valor] of [["max_statement_time", limiteMs / 1000], ["max_execution_time", limiteMs], ["lock_wait_timeout", Math.max(1, Math.ceil(limiteMs / 1000))], ["innodb_lock_wait_timeout", Math.max(1, Math.ceil(limiteMs / 1000))]] as const) {
      try { await conn.query(`SET SESSION ${variable} = ?`, [valor]); aplicadas.push(variable); }
      catch (e) { if (!esVariableNoSoportada(e)) throw e; }
    }
  } catch (e) {
    try { conn.destroy(); } catch { /* ya cerrada */ }
    liberada = true; descartada = true;
    throw errorVistaPrevia(e);
  }

  const cache = new Map<string, Promise<unknown>>();
  const original = conn.query.bind(conn) as (sql: string, args?: unknown[]) => Promise<unknown>;

  const consultar = async (sql: unknown, args?: unknown[]): Promise<unknown> => {
    const texto = typeof sql === "string" ? sql : "";
    if (liberada) throw new ErrorVistaPrevia("El lector de la vista previa ya fue liberado.");
    if (descartada) throw new ErrorVistaPrevia(MSG_TIEMPO);
    if (!SELECT_PURO.test(texto) || PROHIBIDO.test(texto)) throw new ErrorVistaPrevia("La vista previa solo puede ejecutar consultas de lectura.");
    if (restante() <= 0) { descartada = true; throw new ErrorVistaPrevia(MSG_TIEMPO); }
    // Caché ligada al ámbito (empresa) de ESTA operación; la clave incluye SQL y parámetros.
    const clave = `${ambito}\u0000${texto}\u0000${JSON.stringify(args ?? [])}`;
    let previa = cache.get(clave);
    if (!previa) {
      envia++;
      // Una sentencia YA enviada también está limitada por lo que resta del presupuesto. Si vence, la conexión queda en estado incierto: se descarta (nunca vuelve al pool).
      previa = conLimite(original(texto, args), restante(), () => { descartada = true; })
        .catch((e) => { cache.delete(clave); if (!(e instanceof ErrorVistaPrevia) && !esErrorSqlLimpio(e)) descartada = true; throw e; });
      cache.set(clave, previa);
    }
    return copiaDeResultado(await previa);
  };

  return {
    query: ((sql: unknown, args?: unknown[]) => consultar(sql, args)) as PoolConnection["query"],
    execute: ((sql: unknown, args?: unknown[]) => consultar(sql, args)) as PoolConnection["execute"],
    sentencias: () => envia,
    limitesAplicados: aplicadas,
    limiteSentenciaDisponible: aplicadas.includes("max_statement_time") || aplicadas.includes("max_execution_time"),
    estado: () => ({ liberada, descartada }),
    async liberar() {
      if (liberada) return;   // idempotente: una segunda llamada no libera ni destruye otra vez
      liberada = true;
      if (!descartada) {
        // Restablece los límites; si alguno falla, o si la conexión está en estado incierto, se destruye en vez de volver al pool.
        for (const variable of aplicadas) {
          try { await conLimite(conn.query(`SET SESSION ${variable} = DEFAULT`), 2_000, () => { descartada = true; }); } catch { descartada = true; break; }
        }
      }
      if (descartada) { try { conn.destroy(); } catch { /* ya cerrada */ } } else conn.release();
    },
  };
}
