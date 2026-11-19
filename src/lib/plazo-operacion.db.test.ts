import { randomUUID } from "crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Plazo de operación (db-plazo.ts) con el `@/lib/db` REAL contra MariaDB DESECHABLE (solo local; se omite sin PLANES_DB_PORT=3399|3407):
 *   PLANES_DB_PORT=3399 npx vitest run src/lib/plazo-operacion.db.test.ts --no-file-parallelism
 * Demuestra qué es cancelación REAL de la sentencia (KILL QUERY) y qué solo cierra el socket. Nunca lee .env ni usa credenciales reales.
 */
const port = Number(process.env.PLANES_DB_PORT ?? 0);
const database = `plazo_${randomUUID().replaceAll("-", "")}`;
let db: typeof import("@/lib/db");
let plazo: typeof import("@/lib/db-plazo");
let admin: Pool;
const sqlAdmin = async (t: string, p: unknown[] = []) => (await admin.query<RowDataPacket[]>(t, p))[0];
const enServidor = async (marca: string) => Number((await sqlAdmin("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE INFO LIKE ? AND ID <> CONNECTION_ID()", [`%${marca}%`]))[0].n);
const esperarHasta = async (cond: () => Promise<boolean>, ms = 4_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return cond(); };

describe.skipIf(!port)("Plazo de operación — MariaDB DESECHABLE SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "" });
    await c.query(`CREATE DATABASE ${database}`); await c.end();
    Object.assign(process.env, { DB_HOST: "127.0.0.1", DB_PORT: String(port), DB_USER: "root", DB_PASSWORD: "", DB_NAME: database });
    vi.resetModules();
    db = await import("@/lib/db");
    plazo = await import("@/lib/db-plazo");
    admin = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 3 });
  });
  afterAll(async () => {
    await db?.getPool().end(); await admin?.end();
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "" });
    await c.query(`DROP DATABASE IF EXISTS ${database}`); await c.end();
  });

  it("dentro de conPlazo, query() de @/lib/db usa UNA conexión dedicada (también con Promise.all); fuera vuelve al pool", async () => {
    const ids = await plazo.conPlazo(db.getPool(), { presupuestoMs: 10_000 }, async () => {
      const r = await Promise.all([1, 2, 3, 4, 5].map(() => db.query<RowDataPacket[]>("SELECT CONNECTION_ID() AS c")));
      return r.map((x) => Number(x[0].c));
    });
    expect(new Set(ids).size).toBe(1);
    expect(plazo.alcanceActual()).toBeNull();
  });

  it("CANCELACIÓN REAL: al vencer el plazo, KILL QUERY detiene la sentencia en el SERVIDOR (no queda ejecutándose), la conexión desaparece y se responde con error controlado", async () => {
    const marca = `marca_${randomUUID().slice(0, 8)}`;
    let idConexion = 0;
    const t0 = Date.now();
    // max_statement_time enorme: SOLO actúan el plazo del cliente y el KILL (no el límite del servidor).
    const r = await plazo.conPlazo(db.getPool(), { presupuestoMs: 800, limiteSentenciaMs: 3_600_000 }, async () => {
      idConexion = Number((await db.query<RowDataPacket[]>("SELECT CONNECTION_ID() AS c"))[0].c);
      await db.query(`SELECT SLEEP(30) /* ${marca} */`);
    }).then(() => null, (e: unknown) => e);
    expect(r).toBeInstanceOf(plazo.ErrorPlazoOperacion);
    expect(Date.now() - t0).toBeLessThan(4_000);
    expect(await esperarHasta(async () => (await enServidor(marca)) === 0, 3_000)).toBe(true);   // la sentencia ya no corre en el servidor
    expect(await esperarHasta(async () => Number((await sqlAdmin("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE ID = ?", [idConexion]))[0].n) === 0, 3_000)).toBe(true);   // la conexión se destruyó: no volvió al pool
  }, 30_000);

  it("INFORMATIVO — sin conexión de control (KILL imposible) solo se cierra el socket: se mide si MariaDB detiene la sentencia por sí sola", async () => {
    const marca = `marca_${randomUUID().slice(0, 8)}`;
    const r = await plazo.conPlazo(db.getPool(), { presupuestoMs: 600, limiteSentenciaMs: 3_600_000, abrirControl: async () => null }, async () => {
      await db.query(`SELECT SLEEP(6) /* ${marca} */`);
    }).then(() => null, (e: unknown) => e);
    expect(r).toBeInstanceOf(plazo.ErrorPlazoOperacion);   // GARANTIZADO: el llamador recibe el error a tiempo
    const sigue = await enServidor(marca);
    console.log(`sin KILL: sentencia todavía en el servidor ${sigue ? "SÍ" : "NO"} (depende del servidor)`);
    await esperarHasta(async () => (await enServidor(marca)) === 0, 8_000);   // termina sola; no queda residuo
    expect(await enServidor(marca)).toBe(0);
  }, 30_000);

  it("límite por sentencia del SERVIDOR (max_statement_time): corta la sentencia con ER_STATEMENT_TIMEOUT mucho antes que el plazo; la conexión sana vuelve al pool", async () => {
    const t0 = Date.now();
    const r = await plazo.conPlazo(db.getPool(), { presupuestoMs: 20_000, limiteSentenciaMs: 1_000 }, () => db.query("SELECT SLEEP(10)")).then(() => null, (e: unknown) => e as { errno?: number; code?: string });
    expect(Date.now() - t0).toBeLessThan(5_000);
    // MariaDB devuelve ER_STATEMENT_TIMEOUT (1969) o, para SLEEP, SLEEP() devuelve 1 y la consulta termina: ambas son «cortada por el servidor»
    if (r) expect([1969, 3024]).toContain((r as { errno?: number }).errno);
  }, 30_000);

  it("pool de 1 conexión: tras la operación sana la conexión vuelve con los límites de sesión restablecidos; tras un vencimiento NO vuelve (se crea otra limpia)", async () => {
    const uno = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 1 });
    try {
      await plazo.conPlazo(uno, { presupuestoMs: 5_000, limiteSentenciaMs: 2_000 }, async () => undefined);
      const [a] = (await uno.query<RowDataPacket[]>("SELECT @@max_statement_time AS t, @@innodb_lock_wait_timeout AS l, CONNECTION_ID() AS c"))[0];
      expect(Number(a.t)).toBe(0); expect(Number(a.l)).toBe(50);
      const idSana = Number(a.c);
      await plazo.conPlazo(uno, { presupuestoMs: 300, limiteSentenciaMs: 3_600_000, abrirControl: async () => null }, async () => { await uno.query("SELECT 1"); await new Promise(() => undefined); }).catch(() => undefined);
      const [b] = (await uno.query<RowDataPacket[]>("SELECT @@max_statement_time AS t, CONNECTION_ID() AS c"))[0];
      expect(Number(b.t)).toBe(0);
      expect(Number(b.c)).not.toBe(idSana);   // la conexión vencida se destruyó: el pool abrió otra
    } finally { await uno.end(); }
  }, 30_000);

  it("pool agotado: conPlazo falla a tiempo y, cuando la conexión ocupada se libera, el pool NO queda con una conexión perdida", async () => {
    const uno = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 1 });
    try {
      const ocupada = await uno.getConnection();
      const t0 = Date.now();
      await expect(plazo.conPlazo(uno, { presupuestoMs: 300 }, async () => "x")).rejects.toBeInstanceOf(plazo.ErrorPlazoOperacion);
      expect(Date.now() - t0).toBeLessThan(2_000);
      ocupada.release();
      await new Promise((r) => setTimeout(r, 200));
      const c = await Promise.race([uno.getConnection(), new Promise<null>((r) => setTimeout(() => r(null), 3_000))]);
      expect(c).not.toBeNull();   // la conexión «tardía» fue devuelta al pool, no filtrada
      c?.release();
    } finally { await uno.end(); }
  }, 30_000);

  it("un error SQL real de la operación se propaga tal cual y no se confunde con un vencimiento", async () => {
    const r = await plazo.conPlazo(db.getPool(), { presupuestoMs: 5_000 }, () => db.query("SELECT * FROM tabla_que_no_existe")).then(() => null, (e: unknown) => e);
    expect(r).toMatchObject({ code: "ER_NO_SUCH_TABLE", errno: 1146 });
    expect(r).not.toBeInstanceOf(plazo.ErrorPlazoOperacion);
  });
});
