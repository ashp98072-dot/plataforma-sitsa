import { createHmac } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";

/**
 * A4 — Protección contra intentos de login (staff, portal de colaboradores, portal de clientes).
 *
 * · PERSISTENTE y compartida entre instancias: los contadores viven en MariaDB (`auth_intentos_login`, sql/migrate-2026-12-auth-intentos-login.sql) y cada actualización
 *   se hace en su propia transacción con la fila bloqueada (`FOR UPDATE`), con reintentos ante colisiones (1020/1205/1213). Toda la aritmética de tiempo usa el reloj de la base.
 * · Dos contadores por intento: el IDENTIFICADOR normalizado (5 fallos / 15 min ⇒ bloqueo progresivo 1, 2, 4, 8 y 15 min como máximo) y el ORIGEN (IP: 30 fallos / 15 min ⇒
 *   bloqueo fijo corto, 5 min, para no castigar de más a una oficina detrás de un NAT). Los fallos se cuentan EXISTA O NO el identificador (no revela existencia).
 * · Durante un bloqueo NO se verifica la contraseña (no se pueden seguir probando) ni se alarga el bloqueo (un atacante no puede dejar fuera a alguien de forma indefinida).
 * · Un login correcto borra el contador de su identificador, NUNCA el de la IP (un atacante no puede «limpiar» su IP entrando con una cuenta propia).
 * · Privacidad: solo se guardan HMAC-SHA256 con un secreto propio (`AUTH_INTENTOS_SECRETO`), nunca el usuario, el correo ni la IP en claro ni hashes sin clave.
 * · Activación explícita: `AUTH_INTENTOS_PROTECCION=1`. Apagada (por defecto) el login funciona como antes. ENCENDIDA y con la tabla ausente/inutilizable o sin secreto,
 *   el login FALLA CERRADO (503 genérico) y se registra el código del problema, sin datos sensibles.
 */
export type AlcanceLogin = "staff" | "colaborador" | "cliente";

export type ConfigIntentos = {
  activa: boolean; secreto: string;
  idMax: number; ipMax: number; ventanaS: number; bloqueoIdBaseS: number; bloqueoIdMaxS: number; bloqueoIpS: number;
  retencionS: number; maxFilas: number; probabilidadLimpieza: number;
};

const entero = (v: string | undefined, def: number, min: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : def; };

export function leerConfigIntentos(env: Record<string, string | undefined> = process.env): ConfigIntentos {
  return {
    activa: env.AUTH_INTENTOS_PROTECCION === "1",
    secreto: env.AUTH_INTENTOS_SECRETO ?? "",
    idMax: entero(env.AUTH_INTENTOS_ID_MAX, 5, 3, 50),
    ipMax: entero(env.AUTH_INTENTOS_IP_MAX, 30, 10, 1000),
    ventanaS: entero(env.AUTH_INTENTOS_VENTANA_S, 900, 60, 86_400),
    bloqueoIdBaseS: entero(env.AUTH_INTENTOS_BLOQUEO_ID_BASE_S, 60, 10, 3600),
    bloqueoIdMaxS: entero(env.AUTH_INTENTOS_BLOQUEO_ID_MAX_S, 900, 60, 3600),
    bloqueoIpS: entero(env.AUTH_INTENTOS_BLOQUEO_IP_S, 300, 30, 3600),
    retencionS: entero(env.AUTH_INTENTOS_RETENCION_S, 86_400, 3600, 7 * 86_400),
    maxFilas: entero(env.AUTH_INTENTOS_MAX_FILAS, 200_000, 1000, 5_000_000),
    probabilidadLimpieza: 0.02,
  };
}

/** Error de la PROTECCIÓN (no de las credenciales): la ruta responde 503 genérico. `codigo` es seguro para el registro (sin datos de la persona). */
export class ErrorProteccionLogin extends Error {
  constructor(readonly codigo: "SECRETO_INVALIDO" | "TABLA_INUTILIZABLE") { super(codigo); this.name = "ErrorProteccionLogin"; }
}

/** Duración del n-ésimo bloqueo del identificador: base·2^(n-1), con tope (60 s, 120 s, 240 s, 480 s, 900 s, 900 s…). */
export const duracionBloqueoId = (n: number, c: Pick<ConfigIntentos, "bloqueoIdBaseS" | "bloqueoIdMaxS">) =>
  Math.min(c.bloqueoIdMaxS, c.bloqueoIdBaseS * 2 ** Math.min(Math.max(n, 1) - 1, 20));

/** Forma canónica del identificador para el contador: sin espacios externos, Unicode NFKC y minúsculas (las variantes de mayúsculas no evaden el límite). */
export const normalizarIdentificador = (v: string) => v.normalize("NFKC").trim().toLowerCase();

export function claveHmac(secreto: string, partes: readonly string[]): string {
  return createHmac("sha256", secreto).update(partes.join("\u0000"), "utf8").digest("hex");
}

/**
 * IP de origen. Detrás del proxy del alojamiento, la IP real es la ÚLTIMA de `X-Forwarded-For` (la añade el proxy más cercano); se acepta `X-Real-IP` como alternativa.
 * Sin una IP válida, el límite por IP NO se aplica (el del identificador sí): así un origen desconocido nunca agrupa a todos los usuarios en un mismo contador.
 */
export function ipDeSolicitud(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  const candidata = (xff ? xff.split(",").map((s) => s.trim()).filter(Boolean).at(-1) : null) ?? headers.get("x-real-ip")?.trim() ?? null;
  if (!candidata || candidata.length > 64) return null;
  return /^[0-9a-fA-F:.]+$/.test(candidata) ? candidata.toLowerCase() : null;
}

type Fila = RowDataPacket & { tipo: "ID" | "IP"; restante_ms: number | null };
export type Llaves = { alcance: AlcanceLogin; id: string; ip: string | null };

export function llavesDe(c: ConfigIntentos, alcance: AlcanceLogin, identificador: string, ip: string | null): Llaves {
  if (c.secreto.length < 32) throw new ErrorProteccionLogin("SECRETO_INVALIDO");
  return { alcance, id: claveHmac(c.secreto, ["login-id", alcance, normalizarIdentificador(identificador)]), ip: ip ? claveHmac(c.secreto, ["login-ip", alcance, ip]) : null };
}

const TABLA = "auth_intentos_login";
const REINTENTABLES = new Set([1020, 1205, 1213]);

async function conConexion<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento++) {
    let conn: PoolConnection | null = null;
    try {
      conn = await getPool().getConnection();
      await conn.beginTransaction();
      const r = await fn(conn);
      await conn.commit();
      return r;
    } catch (e) {
      if (conn) { try { await conn.rollback(); } catch { /* conexión perdida */ } }
      const errno = (e as { errno?: number } | null)?.errno;
      if (intento < 6 && errno != null && REINTENTABLES.has(errno)) { await new Promise((r) => setTimeout(r, 10 * intento + Math.floor(Math.random() * 20))); continue; }
      throw e;
    } finally { conn?.release(); }
  }
}

/** Milisegundos de bloqueo vigente (el mayor entre identificador e IP), o 0. Solo lectura, sin bloquear filas. */
export async function bloqueoVigente(ll: Llaves): Promise<number> {
  const pares: string[] = ["(tipo = 'ID' AND clave = ?)"]; const args: unknown[] = [ll.alcance, ll.id];
  if (ll.ip) { pares.push("(tipo = 'IP' AND clave = ?)"); args.push(ll.ip); }
  const [rows] = await getPool().query<Fila[]>(
    `SELECT tipo, TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(6), bloqueado_hasta) DIV 1000 AS restante_ms FROM ${TABLA}
     WHERE alcance = ? AND (${pares.join(" OR ")}) AND bloqueado_hasta > UTC_TIMESTAMP(6)`, args);
  return rows.reduce((m, r) => Math.max(m, Number(r.restante_ms ?? 0)), 0);
}

/** Suma un fallo a UNA clave en su propia transacción (fila bloqueada). Devuelve true si este fallo abrió un bloqueo. */
async function sumarFallo(c: ConfigIntentos, alcance: AlcanceLogin, tipo: "ID" | "IP", clave: string): Promise<boolean> {
  return conConexion(async (conn) => {
    await conn.execute(
      `INSERT INTO ${TABLA} (alcance, tipo, clave, fallos, ventana_inicio, bloqueos, bloqueado_hasta, actualizado) VALUES (?, ?, ?, 0, UTC_TIMESTAMP(6), 0, NULL, UTC_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE fallos = fallos`, [alcance, tipo, clave]);
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT fallos, bloqueos, TIMESTAMPDIFF(SECOND, ventana_inicio, UTC_TIMESTAMP(6)) AS edad_s, (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > UTC_TIMESTAMP(6)) AS bloqueado
       FROM ${TABLA} WHERE alcance = ? AND tipo = ? AND clave = ? FOR UPDATE`, [alcance, tipo, clave]);
    const f = rows[0];
    if (!f) throw new Error("FILA_AUSENTE");
    if (Number(f.bloqueado) === 1) {   // ya bloqueado (carrera con otro intento): no se alarga el bloqueo
      await conn.execute(`UPDATE ${TABLA} SET actualizado = UTC_TIMESTAMP(6) WHERE alcance = ? AND tipo = ? AND clave = ?`, [alcance, tipo, clave]);
      return false;
    }
    const vencida = Number(f.edad_s) >= c.ventanaS;
    const fallos = (vencida ? 0 : Number(f.fallos)) + 1;
    const max = tipo === "ID" ? c.idMax : c.ipMax;
    if (fallos >= max) {
      const bloqueos = Math.min(Number(f.bloqueos) + 1, 65_000);
      const dur = tipo === "ID" ? duracionBloqueoId(bloqueos, c) : c.bloqueoIpS;
      await conn.execute(
        `UPDATE ${TABLA} SET fallos = 0, ventana_inicio = UTC_TIMESTAMP(6), bloqueos = ?, bloqueado_hasta = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? SECOND), actualizado = UTC_TIMESTAMP(6)
         WHERE alcance = ? AND tipo = ? AND clave = ?`, [bloqueos, dur, alcance, tipo, clave]);
      return true;
    }
    await conn.execute(
      `UPDATE ${TABLA} SET fallos = ?, ventana_inicio = ${vencida ? "UTC_TIMESTAMP(6)" : "ventana_inicio"}, bloqueado_hasta = NULL, actualizado = UTC_TIMESTAMP(6)
       WHERE alcance = ? AND tipo = ? AND clave = ?`, [fallos, alcance, tipo, clave]);
    return false;
  });
}

export async function registrarFallo(c: ConfigIntentos, ll: Llaves): Promise<void> {
  // Cada clave en su PROPIA transacción y en orden fijo (ID, luego IP): nunca se sostienen dos filas a la vez, así que no hay interbloqueos entre instancias.
  await sumarFallo(c, ll.alcance, "ID", ll.id);
  if (ll.ip) await sumarFallo(c, ll.alcance, "IP", ll.ip);
  if (Math.random() < c.probabilidadLimpieza) await limpiarIntentos(c).catch(() => undefined);
}

/** Login correcto: se olvida el contador del IDENTIFICADOR (no el de la IP). */
export async function registrarExito(ll: Llaves): Promise<void> {
  await getPool().execute(`DELETE FROM ${TABLA} WHERE alcance = ? AND tipo = 'ID' AND clave = ?`, [ll.alcance, ll.id]);
}

/**
 * Limpieza acotada: borra filas sin bloqueo vigente e inactivas más allá de la retención y, si la tabla supera `maxFilas`, las más antiguas sin bloqueo vigente.
 * Cada pasada borra como máximo 1000 filas (no bloquea la tabla). Se llama al azar en ~2 % de los fallos; también puede invocarse manualmente.
 */
export async function limpiarIntentos(c: ConfigIntentos): Promise<number> {
  const pool = getPool();
  const [r1] = await pool.execute<import("mysql2/promise").ResultSetHeader>(
    `DELETE FROM ${TABLA} WHERE actualizado < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? SECOND) AND (bloqueado_hasta IS NULL OR bloqueado_hasta <= UTC_TIMESTAMP(6)) LIMIT 1000`, [c.retencionS]);
  let borradas = r1.affectedRows;
  const [[n]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${TABLA}`);
  if (Number(n.n) > c.maxFilas) {
    const [r2] = await pool.execute<import("mysql2/promise").ResultSetHeader>(
      `DELETE FROM ${TABLA} WHERE bloqueado_hasta IS NULL OR bloqueado_hasta <= UTC_TIMESTAMP(6) ORDER BY actualizado LIMIT 1000`, []);
    borradas += r2.affectedRows;
  }
  return borradas;
}

export type ResultadoLogin<T> = { tipo: "ok"; valor: T } | { tipo: "credenciales" } | { tipo: "bloqueado"; retryAfterS: number };

/**
 * Envuelve la verificación de credenciales de una ruta de login. `verificar` debe devolver el usuario o null (y tardar lo mismo exista o no el identificador: ver
 * `verificacionFicticia` en password.ts). Los errores de `verificar` se propagan tal cual; los de la protección se convierten en `ErrorProteccionLogin`.
 */
export async function protegerLogin<T>(
  entrada: { alcance: AlcanceLogin; identificador: string; headers: Headers },
  verificar: () => Promise<T | null>,
  config: ConfigIntentos = leerConfigIntentos(),
): Promise<ResultadoLogin<T>> {
  if (!config.activa) { const v = await verificar(); return v ? { tipo: "ok", valor: v } : { tipo: "credenciales" }; }
  const ll = llavesDe(config, entrada.alcance, entrada.identificador, ipDeSolicitud(entrada.headers));
  const almacen = async <R>(fn: () => Promise<R>): Promise<R> => {
    try { return await fn(); } catch (e) { if (e instanceof ErrorProteccionLogin) throw e; throw Object.assign(new ErrorProteccionLogin("TABLA_INUTILIZABLE"), { cause: e }); }
  };
  const restanteMs = await almacen(() => bloqueoVigente(ll));
  if (restanteMs > 0) return { tipo: "bloqueado", retryAfterS: Math.max(1, Math.ceil(restanteMs / 1000)) };
  const v = await verificar();
  if (v) { await almacen(() => registrarExito(ll)); return { tipo: "ok", valor: v }; }
  await almacen(() => registrarFallo(config, ll));
  return { tipo: "credenciales" };
}

/** Código seguro para el registro de la aplicación (sin usuario, IP ni mensaje del motor). */
export function registrarFalloProteccion(ruta: string, e: ErrorProteccionLogin): void {
  const causa = (e as { cause?: { code?: unknown; errno?: unknown } }).cause;
  console.error(`[auth-intentos] ${ruta}: protección de login no disponible (${e.codigo}${causa?.code ? ` ${String(causa.code)}` : ""}${causa?.errno ? `/${String(causa.errno)}` : ""}); el login responde 503.`);
}
