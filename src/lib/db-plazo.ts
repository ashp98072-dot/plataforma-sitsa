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

/** La operación declarada de solo lectura intentó una sentencia que no es de lectura (no se envía a la base). */
export class ErrorOperacionSoloLectura extends Error {
  constructor() { super("Operación de solo lectura: se rechazó una sentencia que no es de lectura."); this.name = "ErrorOperacionSoloLectura"; }
}
const SENTENCIA_DE_LECTURA = /^\s*(?:SELECT|SHOW|WITH)\b/i;

export async function conPlazo<T>(
  pool: PoolConConexion,
  opts: { presupuestoMs: number; limiteSentenciaMs?: number; soloLectura?: boolean; abrirControl?: () => Promise<ConexionControl | null>; ahora?: () => number },
  fn: () => Promise<T>,
): Promise<T> {
  const ahora = opts.ahora ?? Date.now;
  const limite = ahora() + opts.presupuestoMs;
  const restante = () => limite - ahora();
  const crearError = () => new ErrorPlazoOperacion(MSG_TIEMPO);
  const soloLectura = opts.soloLectura === true;

  // La conexión también cuenta contra el plazo: un pool agotado no puede dejar la operación esperando. Si llega tarde, se devuelve al pool sin usarla.
  const pendiente = pool.getConnection();
  const conn = await conLimite(pendiente, restante(), () => { void pendiente.then((c) => c.release(), () => undefined); }, crearError);
  // Esta conexión es EXCLUSIVA de la operación hasta que se libere o destruya: nadie más la usa y su thread id identifica solo a esta operación.

  // Preparar la sesión también está acotado por el plazo; si cuelga o falla, la conexión se destruye.
  let aplicadas: string[] = [];
  try { aplicadas = await conLimite(aplicarLimitesSesion(conn, opts.limiteSentenciaMs ?? 10_000, { soloLectura }), restante(), () => undefined, crearError); }
  catch (e) {
    try { conn.destroy(); } catch { /* ya cerrada */ }
    if (e instanceof ErrorPlazoOperacion) throw e;
    const codigo = codigoErrorSql(e);
    throw new ErrorPlazoOperacion(`No se pudo preparar la conexión${codigo ? ` (error de base de datos ${codigo})` : ""}. Intenta de nuevo.`, codigo, { cause: e });
  }

  let vencido = false;
  let finalizado = false;
  let incierta = false;
  let cerrada = false;
  const enVuelo: string[] = [];   // sentencias enviadas y sin respuesta, en orden: la primera es la que el servidor está ejecutando
  const abrirControl = opts.abrirControl ?? abrirConexionControl;
  const threadId = () => (conn as PoolConnection & { threadId?: number }).threadId;
  const cancelarEnCurso = async () => { if (enVuelo.length) await cancelarConsulta(abrirControl, threadId(), enVuelo[0]); };

  const cerrar = async (destruir: boolean) => {
    if (cerrada) return;   // idempotente
    cerrada = true;
    let limpia = !destruir && !incierta && enVuelo.length === 0;   // con una sentencia sin terminar la conexión NO es reutilizable
    if (limpia) limpia = await restablecerLimitesSesion(conn, aplicadas);
    if (limpia) conn.release(); else { try { conn.destroy(); } catch { /* ya cerrada */ } }
  };

  const alcance: Alcance = {
    restanteMs: restante,
    async consultar(sql, params, modo) {
      if (finalizado || cerrada) throw new ErrorPlazoOperacion("La operación ya terminó.");
      if (soloLectura && !SENTENCIA_DE_LECTURA.test(sql)) throw new ErrorOperacionSoloLectura();   // además, el servidor la rechazaría (TRANSACTION READ ONLY)
      if (vencido || restante() <= 0) { vencido = true; throw crearError(); }
      enVuelo.push(sql);
      try {
        return await (modo === "query" ? conn.query(sql, params as never) : conn.execute(sql, params as never));
      } catch (e) {
        if (!(e instanceof ErrorPlazoOperacion) && !esErrorSqlLimpio(e)) incierta = true;   // error de socket/protocolo: conexión incierta
        throw e;
      } finally { const i = enVuelo.indexOf(sql); if (i >= 0) enVuelo.splice(i, 1); }
    },
  };

  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const plazo = new Promise<never>((_, reject) => {
    temporizador = setTimeout(() => {
      vencido = true;
      void (async () => {
        // (2) cancelar la sentencia en curso (best-effort, verificada) y (3) destruir la conexión ANTES de responder.
        await cancelarEnCurso();
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
    // Si la función terminó dejando sentencias sin respuesta (promesas no esperadas), la conexión no es reutilizable: se cancela y se destruye.
    if (!cerrada) { if (enVuelo.length) { await cancelarEnCurso(); await cerrar(true); } else await cerrar(false); }   // si el plazo ya la cerró, no se repite nada
  }
}

export { esErrorSqlLimpio };
