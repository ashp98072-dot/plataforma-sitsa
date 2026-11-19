import { describe, expect, it, vi } from "vitest";
import { alcanceActual, conPlazo, ErrorPlazoOperacion, plazoRestanteMs } from "./db-plazo";
import { query } from "./db";

const sqlError = (code: string, errno: number) => Object.assign(new Error(`${code} texto interno`), { code, errno });

function entorno(handler: (sql: string) => unknown = () => [[{ ok: 1 }]]) {
  const orden: string[] = [];
  const conn = {
    threadId: 4242,
    query: vi.fn((sql: string) => { orden.push(`query:${sql.slice(0, 24)}`); return Promise.resolve(handler(sql)); }),
    execute: vi.fn((sql: string) => Promise.resolve(handler(sql))),
    release: vi.fn(() => { orden.push("release"); }),
    destroy: vi.fn(() => { orden.push("destroy"); }),
  };
  const control = { query: vi.fn(async (sql: string) => { orden.push(`control:${sql}`); return [[]]; }), destroy: vi.fn(() => { orden.push("control.destroy"); }) };
  const abrirControl = vi.fn(async () => control);
  return { conn, control, abrirControl, orden, pool: { getConnection: vi.fn(async () => conn) } as never };
}
const datos = (conn: { query: ReturnType<typeof vi.fn> }) => conn.query.mock.calls.map((c) => String(c[0])).filter((q) => !/^SET SESSION/.test(q));

describe("conPlazo — las sentencias de @/lib/db pasan por la conexión dedicada de la operación", () => {
  it("dentro del alcance query() usa la conexión dedicada (en serie, también con Promise.all); fuera no hay alcance", async () => {
    const { conn, pool } = entorno();
    expect(alcanceActual()).toBeNull();
    const r = await conPlazo(pool, { presupuestoMs: 5_000 }, async () => {
      expect(alcanceActual()).not.toBeNull();
      expect(plazoRestanteMs()).toBeGreaterThan(0);
      return Promise.all([query("SELECT 1"), query("SELECT 2"), query("SELECT 3")]);
    });
    expect(r).toHaveLength(3);
    expect(datos(conn)).toEqual(["SELECT 1", "SELECT 2", "SELECT 3"]);
    expect(alcanceActual()).toBeNull();
    expect(plazoRestanteMs()).toBe(Number.POSITIVE_INFINITY);
  });
  it("terminada la operación, no se puede seguir usando la conexión (sentencias tardías rechazadas)", async () => {
    const { conn, pool } = entorno();
    let tardia: Promise<unknown> = Promise.resolve();
    await conPlazo(pool, { presupuestoMs: 5_000 }, async () => { tardia = new Promise((r) => setTimeout(r, 30)).then(() => query("SELECT 99")); tardia.catch(() => undefined); });
    await expect(tardia).rejects.toBeInstanceOf(ErrorPlazoOperacion);
    expect(datos(conn)).not.toContain("SELECT 99");
  });
});

describe("conPlazo — vencimiento: cancelar la sentencia en curso, destruir la conexión y RECIÉN ENTONCES responder", () => {
  it("sentencia colgada: KILL QUERY por conexión de control → destroy → rechazo, en ese orden; la conexión no vuelve al pool", async () => {
    const e = entorno((sql) => (/^SELECT SLEEP/.test(sql) ? new Promise(() => undefined) : [[]]));
    const t0 = Date.now();
    const r = await conPlazo(e.pool, { presupuestoMs: 60, abrirControl: e.abrirControl }, () => query("SELECT SLEEP(100)")).then(() => null, (x: unknown) => x);
    expect(r).toBeInstanceOf(ErrorPlazoOperacion);
    expect((r as ErrorPlazoOperacion).status).toBe(503);
    expect((r as ErrorPlazoOperacion).message).toMatch(/tardó demasiado.*No se guardó ningún cambio/);
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(e.control.query).toHaveBeenCalledWith("KILL QUERY 4242");
    const i = (x: string) => e.orden.indexOf(x);
    expect(i("control:KILL QUERY 4242")).toBeGreaterThan(-1);
    expect(i("destroy")).toBeGreaterThan(i("control:KILL QUERY 4242"));   // primero se cancela, luego se destruye
    expect(e.conn.release).not.toHaveBeenCalled();
    expect(e.conn.destroy).toHaveBeenCalledTimes(1);
    expect(e.control.destroy).toHaveBeenCalledTimes(1);   // la conexión de control tampoco se filtra
  });
  it("sin sentencia en curso (solo trabajo no SQL colgado) NO hace falta KILL; igual se destruye la conexión y se responde", async () => {
    const e = entorno();
    const r = await conPlazo(e.pool, { presupuestoMs: 40, abrirControl: e.abrirControl }, () => new Promise<never>(() => undefined)).then(() => null, (x: unknown) => x);
    expect(r).toBeInstanceOf(ErrorPlazoOperacion);
    expect(e.abrirControl).not.toHaveBeenCalled();
    expect(e.conn.destroy).toHaveBeenCalledTimes(1);
    expect(e.conn.release).not.toHaveBeenCalled();
  });
  it("si no se puede abrir la conexión de control (sin privilegios/límite de conexiones) el plazo se cumple igual: destroy y error controlado", async () => {
    const e = entorno((sql) => (/^SELECT SLEEP/.test(sql) ? new Promise(() => undefined) : [[]]));
    const r = await conPlazo(e.pool, { presupuestoMs: 50, abrirControl: async () => { throw sqlError("ER_USER_LIMIT_REACHED", 1226); } }, () => query("SELECT SLEEP(100)")).then(() => null, (x: unknown) => x);
    expect(r).toBeInstanceOf(ErrorPlazoOperacion);
    expect(e.conn.destroy).toHaveBeenCalledTimes(1);
    expect(e.conn.release).not.toHaveBeenCalled();
  });
  it("las sentencias de la operación vencida que siguen en cola NO se envían a la base", async () => {
    const e = entorno((sql) => (/^SELECT SLEEP/.test(sql) ? new Promise(() => undefined) : [[]]));
    let siguiente: unknown = null;
    await conPlazo(e.pool, { presupuestoMs: 50, abrirControl: e.abrirControl }, async () => {
      const lenta = query("SELECT SLEEP(100)"); lenta.catch(() => undefined);
      setTimeout(() => { siguiente = query("SELECT 'tras el vencimiento'").catch((x) => x); }, 120);
      await lenta;
    }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 200));
    expect(await siguiente).toBeInstanceOf(ErrorPlazoOperacion);
    expect(datos(e.conn)).toEqual(["SELECT SLEEP(100)"]);
  });
  it("sin rechazos no manejados: el trabajo abandonado que luego falla no produce unhandledRejection", async () => {
    const huerfanos: unknown[] = [];
    const h = (r: unknown) => huerfanos.push(r);
    process.on("unhandledRejection", h);
    try {
      const e = entorno((sql) => (/^SELECT SLEEP/.test(sql) ? new Promise((_, rej) => setTimeout(() => rej(new Error("cortada")), 100)) : [[]]));
      await conPlazo(e.pool, { presupuestoMs: 30, abrirControl: e.abrirControl }, () => query("SELECT SLEEP(100)")).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 250));
    } finally { process.off("unhandledRejection", h); }
    expect(huerfanos).toEqual([]);
  });
});

describe("conPlazo — conexiones nunca en estado inseguro", () => {
  it("camino sano: restablece los límites de sesión y devuelve la conexión al pool (una sola vez)", async () => {
    const e = entorno();
    await conPlazo(e.pool, { presupuestoMs: 5_000 }, async () => { await query("SELECT 1"); });
    expect(e.conn.query.mock.calls.map((c) => String(c[0]))).toEqual(expect.arrayContaining(["SET SESSION max_statement_time = DEFAULT", "SET SESSION innodb_lock_wait_timeout = DEFAULT"]));
    expect(e.conn.release).toHaveBeenCalledTimes(1);
    expect(e.conn.destroy).not.toHaveBeenCalled();
  });
  it("un error SQL normal de la operación se propaga TAL CUAL y la conexión sana vuelve al pool", async () => {
    const e = entorno((sql) => { if (/FROM t/.test(sql)) throw sqlError("ER_BAD_FIELD_ERROR", 1054); return [[]]; });
    const err = await conPlazo(e.pool, { presupuestoMs: 5_000 }, () => query("SELECT x FROM t")).then(() => null, (x: unknown) => x);
    expect(err).toMatchObject({ code: "ER_BAD_FIELD_ERROR" });
    expect(e.conn.release).toHaveBeenCalledTimes(1);
    expect(e.conn.destroy).not.toHaveBeenCalled();
  });
  it.each([
    ["error sin código SQL", new Error("socket hang up")],
    ["error fatal de conexión", Object.assign(new Error("lost"), { code: "PROTOCOL_CONNECTION_LOST", fatal: true })],
  ])("%s: conexión en estado INCIERTO → destroy, nunca vuelve al pool", async (_n, err) => {
    const e = entorno((sql) => { if (/FROM t/.test(sql)) throw err; return [[]]; });
    await conPlazo(e.pool, { presupuestoMs: 5_000 }, () => query("SELECT 1 FROM t")).catch(() => undefined);
    expect(e.conn.destroy).toHaveBeenCalledTimes(1);
    expect(e.conn.release).not.toHaveBeenCalled();
  });
  it("si no se pueden restablecer los límites al terminar, la conexión se destruye", async () => {
    const e = entorno((sql) => { if (/= DEFAULT/.test(sql)) throw new Error("conexión perdida"); return [[]]; });
    await conPlazo(e.pool, { presupuestoMs: 5_000 }, async () => undefined);
    expect(e.conn.destroy).toHaveBeenCalledTimes(1);
    expect(e.conn.release).not.toHaveBeenCalled();
  });
  it("fallo GRAVE al configurar los límites (no «variable no soportada»): no se ejecuta nada, se destruye y el error es controlado", async () => {
    const e = entorno((sql) => { if (/max_statement_time/.test(sql)) throw sqlError("ER_ACCESS_DENIED_ERROR", 1045); return [[]]; });
    const fn = vi.fn();
    const r = await conPlazo(e.pool, { presupuestoMs: 5_000 }, fn).then(() => null, (x: unknown) => x);
    expect(r).toBeInstanceOf(ErrorPlazoOperacion);
    expect((r as ErrorPlazoOperacion).message).toContain("ER_ACCESS_DENIED_ERROR");
    expect(fn).not.toHaveBeenCalled();
    expect(e.conn.destroy).toHaveBeenCalledTimes(1);
    expect(e.conn.release).not.toHaveBeenCalled();
  });
  it("«variable no soportada» (1193) sí se tolera", async () => {
    const e = entorno((sql) => { if (/max_execution_time/.test(sql)) throw sqlError("ER_UNKNOWN_SYSTEM_VARIABLE", 1193); return [[]]; });
    await expect(conPlazo(e.pool, { presupuestoMs: 5_000 }, async () => "ok")).resolves.toBe("ok");
  });
  it("pool agotado: getConnection que no responde dentro del plazo falla controlado y la conexión tardía se DEVUELVE sin usarla", async () => {
    let entregar!: (c: unknown) => void;
    const tarde = { threadId: 1, query: vi.fn(async () => [[]]), release: vi.fn(), destroy: vi.fn() };
    const pool = { getConnection: vi.fn(() => new Promise((r) => { entregar = r; })) } as never;
    await expect(conPlazo(pool, { presupuestoMs: 40 }, async () => "x")).rejects.toBeInstanceOf(ErrorPlazoOperacion);
    entregar(tarde);
    await new Promise((r) => setTimeout(r, 10));
    expect(tarde.release).toHaveBeenCalledTimes(1);
    expect(tarde.query).not.toHaveBeenCalled();
  });
});
