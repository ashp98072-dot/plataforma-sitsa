import { AsyncLocalStorage } from "node:async_hooks";
import mysql, { type ConnectionOptions, type PoolConnection } from "mysql2/promise";
import { aplicarLimitesSesion, cancelarConsulta, conLimite, esErrorSqlLimpio, restablecerLimitesSesion, type ConexionControl, type PoolConConexion } from "./db-limites";
import { codigoErrorSql } from "./tms/codigo-plan-colision";

/**
 * Plazo para una OPERACIÓN COMPLETA (varias sentencias) con cancelación real, sin abandonar sentencias SQL activas.
 *
 * `conPlazo(pool, opts, fn)` abre UNA conexión dedicada, le aplica límites de sesión por sentencia y ejecuta `fn` dentro de un contexto
 * (AsyncLocalStorage): mientras dure, `query()`/`execute()` de `@/lib/db` pasan por ESA conexión (en serie, autocommit, solo lectura de facto).
 * Al vencer el plazo, en este orden: (1) se marca vencida (no se envía nada más), (2) se cancela la sentencia en curso con `KILL QUERY` desde una
 * conexión de control, (3) se DESTRUYE la conexión (nunca vuelve al pool), (4) recién entonces se responde con `ErrorPlazoOperacion`. Las
 * sentencias en cola fallan al instante por conexión cerrada. El `Promise.race` final solo acota esperas que no son SQL; para el SQL ya hay cancelación.
 */
export class ErrorPlazoOperacion extends Error {
  readonly status = 503 as const;
  constructor(mensaje: string, readonly codigo: string | null = null, options?: { cause?: unknown }) {
    super(mensaje, options);
    this.name = "ErrorPlazoOperacion";
  }
}

const MSG_TIEMPO = "La operación tardó demasiado y se canceló. No se guardó ningún cambio. Intenta de nuevo.";

type Alcance = {
  restanteMs: () => number;
  consultar: (sql: string, params: unknown, modo: "query" | "execute") => Promise<unknown>;
};
const almacen = new AsyncLocalStorage<Alcance>();

/** Alcance activo (null fuera de `conPlazo`). `@/lib/db` lo consulta para decidir por qué conexión pasa cada sentencia. */
export const alcanceActual = (): Alcance | null => almacen.getStore() ?? null;
/** Milisegundos que restan del plazo activo (Infinity si no hay plazo): permite acotar trabajo anidado con su propio presupuesto. */
export const plazoRestanteMs = (): number => almacen.getStore()?.restanteMs() ?? Number.POSITIVE_INFINITY;

let configControl: ConnectionOptions | null = null;
/** Lo registra `getPool()` (fuera de modo sandbox) para poder abrir conexiones de CONTROL (KILL QUERY) independientes del pool. */
export function registrarConfigControl(cfg: ConnectionOptions | null) { configControl = cfg; }
export async function abrirConexionControl(): Promise<ConexionControl | null> {
  if (!configControl) return null;
  const c = await mysql.createConnection({ ...configControl, connectTimeout: 2_000 });
  return { query: (sql) => c.query(sql), destroy: () => c.destroy() };
}

export async function conPlazo<T>(
  pool: PoolConConexion,
  opts: { presupuestoMs: number; limiteSentenciaMs?: number; abrirControl?: () => Promise<ConexionControl | null>; ahora?: () => number },
  fn: () => Promise<T>,
): Promise<T> {
  const ahora = opts.ahora ?? Date.now;
  const limite = ahora() + opts.presupuestoMs;
  const restante = () => limite - ahora();
  const crearError = () => new ErrorPlazoOperacion(MSG_TIEMPO);

  // La conexión también cuenta contra el plazo: un pool agotado no puede dejar la operación esperando. Si llega tarde, se devuelve al pool sin usarla.
  const pendiente = pool.getConnection();
  const conn = await conLimite(pendiente, restante(), () => { void pendiente.then((c) => c.release(), () => undefined); }, crearError);

  let aplicadas: string[] = [];
  try { aplicadas = await aplicarLimitesSesion(conn, opts.limiteSentenciaMs ?? 10_000); }
  catch (e) {
    try { conn.destroy(); } catch { /* ya cerrada */ }
    const codigo = codigoErrorSql(e);
    throw new ErrorPlazoOperacion(`No se pudo preparar la conexión${codigo ? ` (error de base de datos ${codigo})` : ""}. Intenta de nuevo.`, codigo, { cause: e });
  }

  let vencido = false;
  let finalizado = false;
  let incierta = false;
  let enVuelo = 0;
  let cerrada = false;
  const abrirControl = opts.abrirControl ?? abrirConexionControl;

  const cerrar = async (destruir: boolean) => {
    if (cerrada) return;   // idempotente
    cerrada = true;
    let limpia = !destruir && !incierta;
    if (limpia) limpia = await restablecerLimitesSesion(conn, aplicadas);
    if (limpia) conn.release(); else { try { conn.destroy(); } catch { /* ya cerrada */ } }
  };

  const alcance: Alcance = {
    restanteMs: restante,
    async consultar(sql, params, modo) {
      if (finalizado || cerrada) throw new ErrorPlazoOperacion("La operación ya terminó.");
      if (vencido || restante() <= 0) { vencido = true; throw crearError(); }
      enVuelo++;
      try {
        return await (modo === "query" ? conn.query(sql, params as never) : conn.execute(sql, params as never));
      } catch (e) {
        if (!(e instanceof ErrorPlazoOperacion) && !esErrorSqlLimpio(e)) incierta = true;   // error de socket/protocolo: conexión incierta
        throw e;
      } finally { enVuelo--; }
    },
  };

  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const plazo = new Promise<never>((_, reject) => {
    temporizador = setTimeout(() => {
      vencido = true;
      void (async () => {
        // (2) cancelar la sentencia en curso (best-effort) y (3) destruir la conexión ANTES de responder.
        if (enVuelo > 0) await cancelarConsulta(abrirControl, (conn as PoolConnection & { threadId?: number }).threadId);
        await cerrar(true);
        reject(crearError());
      })();
    }, Math.max(0, restante()));
  });
  plazo.catch(() => undefined);

  const trabajo = almacen.run(alcance, fn);
  trabajo.catch(() => undefined);
  try {
    return await Promise.race([trabajo, plazo]);
  } finally {
    finalizado = true;
    if (temporizador) clearTimeout(temporizador);
    await cerrar(false);
  }
}

export { esErrorSqlLimpio };
