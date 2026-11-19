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

/**
 * Aplica los límites de sesión. Solo tolera «variable no soportada»; cualquier otro error se propaga (el llamador debe destruir la conexión).
 * Con `soloLectura` la sesión queda en `TRANSACTION READ ONLY`: el SERVIDOR rechaza toda escritura (ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION) aunque
 * el código del cliente se equivocara. Ese modo NO se tolera si el servidor no lo admite (falla cerrado).
 */
export async function aplicarLimitesSesion(conn: Pick<PoolConnection, "query">, limiteSentenciaMs: number, opts: { soloLectura?: boolean } = {}): Promise<string[]> {
  const aplicadas: string[] = [];
  const segundos = Math.max(1, Math.ceil(limiteSentenciaMs / 1000));
  for (const [variable, valor] of [["max_statement_time", limiteSentenciaMs / 1000], ["max_execution_time", limiteSentenciaMs], ["lock_wait_timeout", segundos], ["innodb_lock_wait_timeout", segundos]] as const) {
    try { await conn.query(`SET SESSION ${variable} = ?`, [valor]); aplicadas.push(variable); }
    catch (e) { if (!esVariableNoSoportada(e)) throw e; }
  }
  if (opts.soloLectura) { await conn.query("SET SESSION TRANSACTION READ ONLY"); aplicadas.push(MARCA_SOLO_LECTURA); }
  return aplicadas;
}

/** Marca interna (no es una variable) en la lista de límites aplicados cuando la sesión quedó en solo lectura. */
export const MARCA_SOLO_LECTURA = "tx_read_only";

/** Espera `p` como máximo `ms`; si vence, ejecuta `alVencer()` y rechaza con `crearError()`. El temporizador siempre se limpia y `p` nunca queda sin manejar. */
export function conLimite<T>(p: Promise<T>, ms: number, alVencer: () => void, crearError: () => Error): Promise<T> {
  p.catch(() => undefined);
  if (ms <= 0) { alVencer(); return Promise.reject(crearError()); }
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { alVencer(); reject(crearError()); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Restablece los límites de sesión con UNA sola sentencia (acotada) y, si hubo solo lectura, otra para volver a lectura/escritura.
 * true = la conexión quedó limpia; false = hay que destruirla (nunca debe volver al pool con la sesión alterada).
 */
export async function restablecerLimitesSesion(conn: Pick<PoolConnection, "query">, aplicadas: readonly string[], ms = 2_000): Promise<boolean> {
  const variables = aplicadas.filter((v) => v !== MARCA_SOLO_LECTURA);
  const falla = () => new Error("restablecer: tiempo agotado");
  try {
    if (variables.length) await conLimite(Promise.resolve(conn.query(`SET SESSION ${variables.map((v) => `${v} = DEFAULT`).join(", ")}`)), ms, () => undefined, falla);
    if (aplicadas.includes(MARCA_SOLO_LECTURA)) await conLimite(Promise.resolve(conn.query("SET SESSION TRANSACTION READ WRITE")), ms, () => undefined, falla);
    return true;
  } catch { return false; }
}

export type ConexionControl = { query: (sql: string) => Promise<unknown>; destroy: () => void };

/**
 * Cancela la sentencia en curso de la conexión `threadId` con `KILL QUERY` desde una conexión de control APARTE (no del pool: el pool puede estar
 * saturado justamente por las sentencias colgadas). Best-effort: devuelve false si no se pudo; el llamador debe destruir igualmente la conexión.
 *
 * SOLO apunta a la conexión de la operación vencida: (1) `threadId` es el de la conexión que la operación obtuvo del pool y mantiene en exclusiva
 * hasta destruirla; (2) ANTES de matar se verifica en `information_schema.PROCESSLIST` que ese hilo existe y que su sentencia actual EMPIEZA por el
 * mismo texto que la operación envió (`prefijoSql`); si el hilo está ocioso o ejecuta otra cosa, NO se mata nada.
 */
export async function cancelarConsulta(abrirControl: () => Promise<ConexionControl | null>, threadId: unknown, prefijoSql: string, ms = 2_000): Promise<boolean> {
  const id = Number(threadId);
  const prefijo = prefijoSql.replace(/\s+/g, " ").trim().slice(0, 60).toLowerCase();
  if (!Number.isInteger(id) || id <= 0 || prefijo.length < 6) return false;
  let control: ConexionControl | null = null;
  try {
    const pendiente = abrirControl();
    control = await conLimite(pendiente, ms, () => { void pendiente.then((c) => { try { c?.destroy(); } catch { /* ya cerrada */ } }, () => undefined); }, () => new Error("control: tiempo agotado"));
    if (!control) return false;
    const resultado = await conLimite(Promise.resolve(control.query(`SELECT INFO FROM information_schema.PROCESSLIST WHERE ID = ${id}`)), ms, () => undefined, () => new Error("control: tiempo agotado"));
    const filas = (Array.isArray(resultado) ? resultado[0] : resultado) as { INFO?: unknown }[] | undefined;
    const info = typeof filas?.[0]?.INFO === "string" ? filas[0].INFO.replace(/\s+/g, " ").trim().toLowerCase() : "";
    if (!info.startsWith(prefijo)) return false;   // ocioso o ejecutando otra cosa: no se mata
    await conLimite(Promise.resolve(control.query(`KILL QUERY ${id}`)), ms, () => undefined, () => new Error("control: tiempo agotado"));
    return true;
  } catch {
    return false;
  } finally {
    try { control?.destroy(); } catch { /* ya cerrada */ }
  }
}

export type PoolConConexion = Pick<Pool, "getConnection">;
