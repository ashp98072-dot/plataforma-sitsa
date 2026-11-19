import type { Pool, PoolConnection } from "mysql2/promise";

/**
 * Piezas compartidas para ACOTAR en tiempo una operación contra MariaDB/MySQL sin dejar sentencias ni conexiones en estado inseguro.
 * Sin dependencias del proyecto (puras): las usan `db-plazo.ts` (operación completa) y el lector de la vista previa.
 *
 * GARANTÍAS REALES vs. DEPENDIENTES DEL SERVIDOR (ver también el PR):
 *  - Garantizado por este código: nada se envía a una conexión tras vencer el plazo; la conexión vencida se DESTRUYE (no vuelve al pool);
 *    el llamador recibe un error controlado en cuanto vence el plazo.
 *  - Depende del servidor: que la sentencia YA enviada termine de verdad en el servidor. Se intenta (1) `max_statement_time`/`max_execution_time`
 *    de sesión, (2) `KILL QUERY` desde una conexión de control, (3) cierre del socket. Ninguno está garantizado en un hosting compartido.
 */

/** ÚNICOS errores tolerados al configurar un límite de sesión: la variable no existe en este servidor (1193) o no es de sesión (1238). */
const ERRNO_VARIABLE_NO_SOPORTADA = new Set([1193, 1238]);
export const esVariableNoSoportada = (e: unknown) => ERRNO_VARIABLE_NO_SOPORTADA.has(Number((e as { errno?: unknown } | null)?.errno));

/** El error es una respuesta SQL normal del servidor (la conexión sigue sana): tiene código ER_ (y errno) y no es fatal. Cualquier otra cosa deja la conexión en estado incierto. */
export const esErrorSqlLimpio = (e: unknown) => {
  const err = e as { errno?: unknown; code?: unknown; fatal?: unknown } | null;
  return !!err && err.fatal !== true && typeof err.errno === "number" && typeof err.code === "string" && /^ER_/.test(err.code);
};

/** Aplica los límites de sesión. Solo tolera «variable no soportada»; cualquier otro error se propaga (el llamador debe destruir la conexión). */
export async function aplicarLimitesSesion(conn: Pick<PoolConnection, "query">, limiteSentenciaMs: number): Promise<string[]> {
  const aplicadas: string[] = [];
  const segundos = Math.max(1, Math.ceil(limiteSentenciaMs / 1000));
  for (const [variable, valor] of [["max_statement_time", limiteSentenciaMs / 1000], ["max_execution_time", limiteSentenciaMs], ["lock_wait_timeout", segundos], ["innodb_lock_wait_timeout", segundos]] as const) {
    try { await conn.query(`SET SESSION ${variable} = ?`, [valor]); aplicadas.push(variable); }
    catch (e) { if (!esVariableNoSoportada(e)) throw e; }
  }
  return aplicadas;
}

/** Espera `p` como máximo `ms`; si vence, ejecuta `alVencer()` y rechaza con `crearError()`. El temporizador siempre se limpia y `p` nunca queda sin manejar. */
export function conLimite<T>(p: Promise<T>, ms: number, alVencer: () => void, crearError: () => Error): Promise<T> {
  p.catch(() => undefined);
  if (ms <= 0) { alVencer(); return Promise.reject(crearError()); }
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { alVencer(); reject(crearError()); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Restablece los límites de sesión. true = la conexión quedó limpia; false = hay que destruirla. */
export async function restablecerLimitesSesion(conn: Pick<PoolConnection, "query">, aplicadas: readonly string[], ms = 2_000): Promise<boolean> {
  for (const variable of aplicadas) {
    try { await conLimite(Promise.resolve(conn.query(`SET SESSION ${variable} = DEFAULT`)), ms, () => undefined, () => new Error("restablecer: tiempo agotado")); }
    catch { return false; }
  }
  return true;
}

export type ConexionControl = { query: (sql: string) => Promise<unknown>; destroy: () => void };

/**
 * Cancela la sentencia en curso de la conexión `threadId` con `KILL QUERY` desde una conexión de control APARTE (no del pool: el pool puede estar
 * saturado justamente por las sentencias colgadas). Best-effort: devuelve false si no se pudo (sin conexión de control, sin privilegios, tiempo agotado);
 * el llamador debe destruir igualmente la conexión afectada.
 */
export async function cancelarConsulta(abrirControl: () => Promise<ConexionControl | null>, threadId: unknown, ms = 2_000): Promise<boolean> {
  const id = Number(threadId);
  if (!Number.isInteger(id) || id <= 0) return false;
  let control: ConexionControl | null = null;
  try {
    control = await conLimite(abrirControl(), ms, () => undefined, () => new Error("control: tiempo agotado"));
    if (!control) return false;
    await conLimite(Promise.resolve(control.query(`KILL QUERY ${id}`)), ms, () => undefined, () => new Error("control: tiempo agotado"));
    return true;
  } catch {
    return false;
  } finally {
    try { control?.destroy(); } catch { /* ya cerrada */ }
  }
}

export type PoolConConexion = Pick<Pool, "getConnection">;
