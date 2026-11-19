import type { Pool, PoolConnection } from "mysql2/promise";
import { codigoErrorSql } from "@/lib/tms/codigo-plan-colision";
import { aplicarLimitesSesion, cancelarConsulta, conLimite, esErrorSqlLimpio, restablecerLimitesSesion, type ConexionControl } from "@/lib/db-limites";
import { abrirConexionControl } from "@/lib/db-plazo";

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

/** Copia por llamada de lo servido desde la caché: ningún consumidor puede alterar lo que verá el siguiente. */
function copiaDeResultado(r: unknown): unknown {
  if (Array.isArray(r) && Array.isArray(r[0])) return [r[0].map((f: unknown) => (f && typeof f === "object" ? { ...(f as object) } : f)), ...r.slice(1)];
  if (Array.isArray(r) && r[0] && typeof r[0] === "object") return [{ ...(r[0] as object) }, ...r.slice(1)];
  return r;
}

export async function abrirLectorVistaPrevia(
  pool: Pick<Pool, "getConnection">,
  opts: { empresaId?: number; presupuestoMs?: number; limiteSentenciaMs?: number; ahora?: () => number; abrirControl?: () => Promise<ConexionControl | null> } = {},
): Promise<LectorVistaPrevia> {
  const presupuestoMs = opts.presupuestoMs ?? PRESUPUESTO_VISTA_PREVIA_MS;
  const limiteMs = opts.limiteSentenciaMs ?? LIMITE_SENTENCIA_VISTA_PREVIA_MS;
  const ahora = opts.ahora ?? Date.now;
  const limite = ahora() + presupuestoMs;
  const restante = () => limite - ahora();
  const ambito = opts.empresaId != null ? `e${opts.empresaId}` : "e*";

  // getConnection también cuenta contra el presupuesto: un pool agotado no puede dejar la pantalla esperando. Si la conexión llega TARDE (ya vencido el plazo), se devuelve al pool sin usarla.
  const pendiente = pool.getConnection();
  const crearError = () => new ErrorVistaPrevia(MSG_TIEMPO);
  const conn = await conLimite(pendiente, restante(), () => { void pendiente.then((c) => c.release(), () => undefined); }, crearError);

  let envia = 0;
  let liberada = false;
  let descartada = false;
  let aplicadas: string[] = [];
  let cancelacion: Promise<unknown> = Promise.resolve();
  const abrirControl = opts.abrirControl ?? abrirConexionControl;

  // Límites de sesión: solo se tolera «variable no soportada»; cualquier otro fallo (conexión caída…) aborta y descarta la conexión.
  try { aplicadas = await aplicarLimitesSesion(conn, limiteMs); }
  catch (e) {
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
      // Al vencer: se marca descartada y se CANCELA la sentencia en curso (KILL QUERY, best-effort) antes de destruir la conexión en `liberar()`.
      previa = conLimite(original(texto, args), restante(), () => { descartada = true; cancelacion = cancelarConsulta(abrirControl, (conn as { threadId?: number }).threadId); }, crearError)
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
      if (!descartada && !(await restablecerLimitesSesion(conn, aplicadas))) descartada = true;
      if (descartada) { await cancelacion.catch(() => undefined); try { conn.destroy(); } catch { /* ya cerrada */ } } else conn.release();
    },
  };
}
