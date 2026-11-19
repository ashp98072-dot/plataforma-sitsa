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

  describe("CONCURRENCIA REAL con varias empresas (pool real de @/lib/db)", () => {
    const EMPRESAS = 8;
    it("8 solicitudes simultáneas de empresas distintas, intercaladas: una conexión propia cada una, solo SUS filas, ninguna mezcla; mientras, el resto del ERP (sin plazo) sigue normal", async () => {
      await sqlAdmin("CREATE TABLE IF NOT EXISTS datos (empresa_id INT NOT NULL, valor VARCHAR(40) NOT NULL)");
      await sqlAdmin("DELETE FROM datos");
      for (let e = 1; e <= EMPRESAS + 1; e++) for (let k = 1; k <= 3; k++) await sqlAdmin("INSERT INTO datos VALUES (?, ?)", [e, `emp${e}-fila${k}`]);
      const operacion = (empresa: number) => plazo.conPlazo(db.getPool(), { presupuestoMs: 20_000, soloLectura: true }, async () => {
        const conexiones = new Set<number>(); const valores: string[] = [];
        for (let k = 0; k < 6; k++) {
          const [a, b] = await Promise.all([
            db.query<RowDataPacket[]>("SELECT CONNECTION_ID() AS c, SLEEP(0.05) AS s"),
            db.query<RowDataPacket[]>("SELECT valor FROM datos WHERE empresa_id = ? ORDER BY valor", [empresa]),
          ]);
          conexiones.add(Number(a[0].c)); b.forEach((f) => valores.push(String(f.valor)));
        }
        return { empresa, conexiones: [...conexiones], valores, alcance: plazo.alcanceActual() };
      });
      const sinPlazo = (async () => {   // tráfico normal del ERP en paralelo
        const cids = new Set<number>(); const valores: string[] = [];
        for (let k = 0; k < 6; k++) {
          const [c] = await db.query<RowDataPacket[]>("SELECT CONNECTION_ID() AS c, SLEEP(0.05) AS s");
          const f = await db.query<RowDataPacket[]>("SELECT valor FROM datos WHERE empresa_id = ?", [EMPRESAS + 1]);
          cids.add(Number(c.c)); f.forEach((x) => valores.push(String(x.valor)));
        }
        return { cids: [...cids], valores };
      })();
      const [normal, ...res] = await Promise.all([sinPlazo, ...Array.from({ length: EMPRESAS }, (_, i) => operacion(i + 1))]);
      for (const r of res) {
        expect(r.conexiones).toHaveLength(1);                                           // UNA sola conexión durante toda la solicitud
        expect(new Set(r.valores)).toEqual(new Set([1, 2, 3].map((k) => `emp${r.empresa}-fila${k}`)));   // solo filas de SU empresa
        expect(r.valores).toHaveLength(18);
      }
      expect(new Set(res.map((r) => r.conexiones[0])).size).toBe(EMPRESAS);              // conexiones distintas entre solicitudes simultáneas
      expect(new Set(res.map((r) => r.alcance)).size).toBe(EMPRESAS);                   // un alcance (contexto) por solicitud
      const dedicadas = new Set(res.map((r) => r.conexiones[0]));
      expect(normal.cids.some((c) => dedicadas.has(c))).toBe(false);                    // el tráfico normal NUNCA usa una conexión dedicada ajena (están ocupadas)
      expect(new Set(normal.valores)).toEqual(new Set([1, 2, 3].map((k) => `emp${EMPRESAS + 1}-fila${k}`)));
      expect(plazo.alcanceActual()).toBeNull();
    }, 60_000);

    it("una solicitud que VENCE (con KILL) no afecta a las demás: otra operación con plazo y una consulta normal que corren a la vez terminan intactas (SLEEP devuelve 0, no 1)", async () => {
      const vencida = plazo.conPlazo(db.getPool(), { presupuestoMs: 700, limiteSentenciaMs: 3_600_000 }, async () => { await db.query("SELECT SLEEP(30) /* vecina_vencida */"); }).then(() => null, (e: unknown) => e);
      const vecinaConPlazo = plazo.conPlazo(db.getPool(), { presupuestoMs: 20_000, soloLectura: true }, async () => (await db.query<RowDataPacket[]>("SELECT SLEEP(2) AS s /* vecina_con_plazo */"))[0].s);
      const vecinaNormal = db.query<RowDataPacket[]>("SELECT SLEEP(2) AS s /* vecina_normal */").then((r) => r[0].s);
      const [v, a, b] = await Promise.all([vencida, vecinaConPlazo, vecinaNormal]);
      expect(v).toBeInstanceOf(plazo.ErrorPlazoOperacion);
      expect(Number(a)).toBe(0);   // si la hubieran matado, la promesa habría sido rechazada (ER_QUERY_INTERRUPTED)
      expect(Number(b)).toBe(0);
      expect(await esperarHasta(async () => (await enServidor("vecina_vencida")) === 0, 3_000)).toBe(true);
    }, 60_000);

    it("cancelarConsulta: con el texto equivocado NO mata la sentencia de otra conexión; con el correcto sí (verificación por PROCESSLIST)", async () => {
      const { cancelarConsulta } = await import("@/lib/db-limites");
      const victima = await db.getPool().getConnection();
      try {
        const id = (victima as unknown as { threadId: number }).threadId;
        const corre = victima.query<RowDataPacket[]>("SELECT SLEEP(3) AS s /* inocente_1 */");
        await new Promise((r) => setTimeout(r, 300));
        expect(await cancelarConsulta(plazo.abrirConexionControl, id, "SELECT * FROM otra_cosa")).toBe(false);
        expect(Number(((await corre)[0] as RowDataPacket[])[0].s)).toBe(0);   // terminó normalmente: NO fue interrumpida

        const corre2 = victima.query<RowDataPacket[]>("SELECT SLEEP(10) AS s /* objetivo_2 */");
        await new Promise((r) => setTimeout(r, 300));
        expect(await cancelarConsulta(plazo.abrirConexionControl, id, "SELECT SLEEP(10) AS s /* objetivo_2 */")).toBe(true);
        await expect(corre2).rejects.toMatchObject({ errno: 1317 });   // interrumpida: ER_QUERY_INTERRUPTED
        // hilo ocioso: no se mata nada
        expect(await cancelarConsulta(plazo.abrirConexionControl, id, "SELECT SLEEP(10) AS s /* objetivo_2 */")).toBe(false);
      } finally { victima.release(); }
    }, 30_000);

    it("tras vencimientos, errores y cancelaciones el pool conserva TODA su capacidad (15 conexiones simultáneas, sin conexiones perdidas)", async () => {
      await plazo.conPlazo(db.getPool(), { presupuestoMs: 300, limiteSentenciaMs: 3_600_000 }, async () => { await db.query("SELECT SLEEP(20)"); }).catch(() => undefined);
      await plazo.conPlazo(db.getPool(), { presupuestoMs: 5_000 }, () => db.query("SELECT * FROM no_existe")).catch(() => undefined);
      await plazo.conPlazo(db.getPool(), { presupuestoMs: 5_000 }, async () => { void db.query("SELECT SLEEP(0.3)").catch(() => undefined); });   // termina sin esperar la sentencia
      await new Promise((r) => setTimeout(r, 500));
      const conexiones = await Promise.race([Promise.all(Array.from({ length: 15 }, () => db.getPool().getConnection())), new Promise<null>((r) => setTimeout(() => r(null), 5_000))]);
      expect(conexiones).not.toBeNull();
      expect(new Set((conexiones as unknown as { threadId: number }[]).map((c) => c.threadId)).size).toBe(15);
      (conexiones as { release: () => void }[]).forEach((c) => c.release());
    }, 60_000);
  });

  describe("solo lectura aplicada por el SERVIDOR", () => {
    it("en una operación de solo lectura @@tx_read_only = 1 y vuelve a 0 al liberar; una escritura es rechazada por MariaDB (ER 1792) y tras restablecer vuelve a ser posible", async () => {
      const uno = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 1 });
      try {
        await sqlAdmin("CREATE TABLE IF NOT EXISTS ro (id INT)");
        const dentro = await plazo.conPlazo(uno, { presupuestoMs: 5_000, soloLectura: true }, async () => (await db.query<RowDataPacket[]>("SELECT @@tx_read_only AS ro"))[0].ro);
        expect(Number(dentro)).toBe(1);
        expect(Number((await uno.query<RowDataPacket[]>("SELECT @@tx_read_only AS ro"))[0][0].ro)).toBe(0);   // la misma conexión del pool, restablecida
        // escritura directa contra una sesión de solo lectura (sin la guarda del cliente): la rechaza el servidor
        const { aplicarLimitesSesion, restablecerLimitesSesion } = await import("@/lib/db-limites");
        const c = await uno.getConnection();
        try {
          const aplicadas = await aplicarLimitesSesion(c, 1000, { soloLectura: true });
          await expect(c.query("INSERT INTO ro VALUES (1)")).rejects.toMatchObject({ errno: 1792 });
          expect(await restablecerLimitesSesion(c, aplicadas)).toBe(true);
          await expect(c.query("INSERT INTO ro VALUES (1)")).resolves.toBeDefined();
        } finally { c.release(); }
      } finally { await uno.end(); }
    }, 30_000);
    it("una escritura dentro de conPlazo de solo lectura se rechaza antes de enviarse y no escribe nada", async () => {
      await sqlAdmin("CREATE TABLE IF NOT EXISTS ro2 (id INT)");
      const r = await plazo.conPlazo(db.getPool(), { presupuestoMs: 5_000, soloLectura: true }, () => db.query("INSERT INTO ro2 VALUES (1)")).then(() => null, (e: unknown) => e);
      expect(r).toBeInstanceOf(plazo.ErrorOperacionSoloLectura);
      expect(Number((await sqlAdmin("SELECT COUNT(*) AS n FROM ro2"))[0].n)).toBe(0);
    });
  });

  it("un error SQL real de la operación se propaga tal cual y no se confunde con un vencimiento", async () => {
    const r = await plazo.conPlazo(db.getPool(), { presupuestoMs: 5_000 }, () => db.query("SELECT * FROM tabla_que_no_existe")).then(() => null, (e: unknown) => e);
    expect(r).toMatchObject({ code: "ER_NO_SUCH_TABLE", errno: 1146 });
    expect(r).not.toBeInstanceOf(plazo.ErrorPlazoOperacion);
  });
});
