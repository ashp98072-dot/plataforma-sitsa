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
  // La conexión de control responde a la verificación del hilo con la sentencia que este ejecuta (por omisión, la que colgó la prueba).
  const info = { valor: "SELECT SLEEP(100)" as string | null };
  const control = { query: vi.fn(async (sql: string) => { orden.push(`control:${sql}`); return /^SELECT INFO/.test(sql) ? [[{ INFO: info.valor }]] : [[]]; }), destroy: vi.fn(() => { orden.push("control.destroy"); }) };
  const abrirControl = vi.fn(async () => control);
  return { conn, control, info, abrirControl, orden, pool: { getConnection: vi.fn(async () => conn) } as never };
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
    expect(i("control:SELECT INFO FROM information_schema.PROCESSLIST WHERE ID = 4242")).toBeLessThan(i("control:KILL QUERY 4242"));   // primero se VERIFICA el hilo, luego se mata
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
    expect(e.conn.query.mock.calls.map((c) => String(c[0]))).toContain("SET SESSION max_statement_time = DEFAULT, max_execution_time = DEFAULT, lock_wait_timeout = DEFAULT, innodb_lock_wait_timeout = DEFAULT");   // UNA sola sentencia de restablecimiento
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

describe("conPlazo — KILL QUERY identifica EXCLUSIVAMENTE la conexión y la sentencia de la operación vencida", () => {
  const colgada = (sql: string) => (/^SELECT SLEEP/.test(sql) ? new Promise(() => undefined) : [[]]);
  it("si el hilo ejecuta OTRA sentencia (otro usuario/solicitud) o está ocioso, NO se mata nada; la conexión igual se destruye y se responde", async () => {
    for (const info of ["SELECT * FROM otra_cosa_de_otra_solicitud", null]) {
      const e = entorno(colgada);
      e.info.valor = info;
      const r = await conPlazo(e.pool, { presupuestoMs: 40, abrirControl: e.abrirControl }, () => query("SELECT SLEEP(100)")).then(() => null, (x: unknown) => x);
      expect(r).toBeInstanceOf(ErrorPlazoOperacion);
      expect(e.control.query.mock.calls.map((c) => String(c[0])).some((q) => /^KILL/.test(q))).toBe(false);
      expect(e.conn.destroy).toHaveBeenCalledTimes(1);
    }
  });
  it("el id usado es el thread id de la conexión de la operación (nunca otro) y la conexión de control se cierra siempre", async () => {
    const e = entorno(colgada);
    e.conn.threadId = 777;
    e.info.valor = "SELECT SLEEP(100)";
    await conPlazo(e.pool, { presupuestoMs: 40, abrirControl: e.abrirControl }, () => query("SELECT SLEEP(100)")).catch(() => undefined);
    expect(e.control.query.mock.calls.map((c) => String(c[0]))).toEqual(["SELECT INFO FROM information_schema.PROCESSLIST WHERE ID = 777", "KILL QUERY 777"]);
    expect(e.control.destroy).toHaveBeenCalledTimes(1);
  });
  it("sin thread id conocido (conexión envuelta) no se intenta ningún KILL", async () => {
    const e = entorno(colgada);
    (e.conn as { threadId?: number }).threadId = undefined;
    await conPlazo(e.pool, { presupuestoMs: 40, abrirControl: e.abrirControl }, () => query("SELECT SLEEP(100)")).catch(() => undefined);
    expect(e.abrirControl).not.toHaveBeenCalled();
    expect(e.conn.destroy).toHaveBeenCalledTimes(1);
  });
  it("una conexión de control que tarda en abrirse y llega TARDE se destruye (no se filtra)", async () => {
    const e = entorno(colgada);
    const tardia = { query: vi.fn(async () => [[]]), destroy: vi.fn() };
    let abrir!: (c: unknown) => void;
    const lenta = vi.fn(() => new Promise((r) => { abrir = r; })) as never;
    await conPlazo(e.pool, { presupuestoMs: 30, abrirControl: lenta }, () => query("SELECT SLEEP(100)")).catch(() => undefined);
    abrir(tardia);
    await new Promise((r) => setTimeout(r, 10));
    expect(tardia.destroy).toHaveBeenCalledTimes(1);
    expect(tardia.query).not.toHaveBeenCalled();
  }, 10_000);
});

describe("conPlazo — conexiones en errores y cancelaciones", () => {
  it("la función termina SIN esperar una sentencia que sigue en vuelo: la conexión NO vuelve al pool (se cancela y se destruye)", async () => {
    const e = entorno((sql) => (/^SELECT SLEEP/.test(sql) ? new Promise(() => undefined) : [[]]));
    await conPlazo(e.pool, { presupuestoMs: 5_000, abrirControl: e.abrirControl }, async () => { void query("SELECT SLEEP(100)").catch(() => undefined); });
    expect(e.conn.release).not.toHaveBeenCalled();
    expect(e.conn.destroy).toHaveBeenCalledTimes(1);
  });
  it("preparar la sesión que NO responde queda acotado por el plazo: se destruye la conexión y se responde error controlado", async () => {
    const e = entorno((sql) => (/^SET SESSION/.test(sql) ? new Promise(() => undefined) : [[]]));
    const t0 = Date.now();
    await expect(conPlazo(e.pool, { presupuestoMs: 60 }, async () => "x")).rejects.toBeInstanceOf(ErrorPlazoOperacion);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
  it("cerrar es idempotente aunque coincidan plazo, error y cancelación: una sola liberación/destrucción", async () => {
    const e = entorno((sql) => (/^SELECT SLEEP/.test(sql) ? new Promise((_, rej) => setTimeout(() => rej(new Error("cortada")), 30)) : [[]]));
    await conPlazo(e.pool, { presupuestoMs: 30, abrirControl: e.abrirControl }, () => query("SELECT SLEEP(100)")).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 120));
    expect(e.conn.release.mock.calls.length + e.conn.destroy.mock.calls.length).toBe(1);
  });
});

describe("conPlazo — operaciones de SOLO LECTURA", () => {
  it("la sesión queda en TRANSACTION READ ONLY (el servidor rechaza toda escritura) y se restablece a READ WRITE al terminar", async () => {
    const e = entorno();
    await conPlazo(e.pool, { presupuestoMs: 5_000, soloLectura: true }, async () => { await query("SELECT 1"); });
    const q = e.conn.query.mock.calls.map((c) => String(c[0]));
    expect(q).toContain("SET SESSION TRANSACTION READ ONLY");
    expect(q.indexOf("SET SESSION TRANSACTION READ WRITE")).toBeGreaterThan(q.indexOf("SELECT 1"));
    expect(e.conn.release).toHaveBeenCalledTimes(1);
  });
  it.each([
    "INSERT INTO tms_planes_viaje (codigo) VALUES ('x')", "UPDATE tms_unidades SET placa='x'", "DELETE FROM tms_unidades", "REPLACE INTO t VALUES (1)",
    "ALTER TABLE t ADD COLUMN c INT", "CREATE TABLE t2 (id INT)", "DROP TABLE t", "TRUNCATE t", "CALL p()", "SET GLOBAL x=1", "  insert into t values (1)",
  ])("«%s» se rechaza en el cliente y NUNCA llega a la base", async (sentencia) => {
    const e = entorno();
    const r = await conPlazo(e.pool, { presupuestoMs: 5_000, soloLectura: true }, () => query(sentencia)).then(() => null, (x: unknown) => x);
    expect(r).toMatchObject({ name: "ErrorOperacionSoloLectura" });
    expect(datos(e.conn).filter((q) => !/^SET SESSION TRANSACTION/.test(q))).toEqual([]);
    expect(e.conn.release).toHaveBeenCalledTimes(1);   // un rechazo de cliente no ensucia la conexión
  });
  it.each(["SELECT 1", "select 1", "SHOW TABLES", "WITH a AS (SELECT 1) SELECT * FROM a", "  \n SELECT 1"])("«%s» sí se ejecuta", async (sentencia) => {
    const e = entorno();
    await conPlazo(e.pool, { presupuestoMs: 5_000, soloLectura: true }, () => query(sentencia));
    expect(datos(e.conn)).toContain(sentencia);
  });
  it("sin soloLectura (otras operaciones) NO se restringe nada: se comporta como antes", async () => {
    const e = entorno();
    await conPlazo(e.pool, { presupuestoMs: 5_000 }, async () => { await query("INSERT INTO t VALUES (1)"); });
    expect(datos(e.conn)).toContain("INSERT INTO t VALUES (1)");
    expect(e.conn.query.mock.calls.map((c) => String(c[0]))).not.toContain("SET SESSION TRANSACTION READ ONLY");
  });
  it("si el servidor NO admite el modo de solo lectura, falla CERRADO: no se ejecuta la operación y se destruye la conexión", async () => {
    const e = entorno((sql) => { if (/TRANSACTION READ ONLY/.test(sql)) throw sqlError("ER_PARSE_ERROR", 1064); return [[]]; });
    const fn = vi.fn();
    await expect(conPlazo(e.pool, { presupuestoMs: 5_000, soloLectura: true }, fn)).rejects.toBeInstanceOf(ErrorPlazoOperacion);
    expect(fn).not.toHaveBeenCalled();
    expect(e.conn.destroy).toHaveBeenCalledTimes(1);
    expect(e.conn.release).not.toHaveBeenCalled();
  });
});

describe("conPlazo — aislamiento ENTRE SOLICITUDES SIMULTÁNEAS (empresas distintas)", () => {
  it("40 operaciones concurrentes e intercaladas: cada una usa SOLO su conexión y recibe SOLO sus resultados; nada se mezcla; el contexto no se filtra", async () => {
    const N = 40;
    const conexiones = Array.from({ length: N }, (_, i) => {
      const e = entorno((sql) => [[{ empresa: i + 1, sql }]]);
      e.conn.threadId = 1000 + i;
      return e;
    });
    let siguiente = 0;
    const pool = { getConnection: vi.fn(async () => { await new Promise((r) => setTimeout(r, Math.random() * 5)); return conexiones[siguiente++].conn; }) } as never;
    const alcances = new Set<unknown>();
    const resultados = await Promise.all(Array.from({ length: N }, async (_, i) => conPlazo(pool, { presupuestoMs: 10_000, soloLectura: true }, async () => {
      alcances.add(alcanceActual());
      const vistas: number[] = [];
      for (let k = 0; k < 6; k++) {
        await new Promise((r) => setTimeout(r, Math.random() * 8));          // intercala con las demás solicitudes
        const [filas] = await Promise.all([query(`SELECT ${k} /* solicitud ${i} */`), new Promise((r) => setTimeout(r, Math.random() * 3))]);
        vistas.push(Number((filas as unknown as { empresa: number }[])[0].empresa));
      }
      expect(alcanceActual()).not.toBeNull();
      return { vistas, conn: conn_de(conexiones, vistas) };
    })));
    // cada operación vio una única empresa (la de SU conexión), todas distintas entre sí
    const propias = resultados.map((r) => new Set(r.vistas));
    expect(propias.every((s) => s.size === 1)).toBe(true);
    expect(new Set(resultados.map((r) => [...new Set(r.vistas)][0])).size).toBe(N);
    expect(alcances.size).toBe(N);   // un alcance distinto por solicitud
    // y cada conexión recibió únicamente las sentencias de su propia solicitud
    conexiones.forEach((e) => {
      const solicitudes = new Set(datos(e.conn).map((q) => q.match(/solicitud (\d+)/)?.[1]));
      expect(solicitudes.size).toBe(1);
      expect(datos(e.conn)).toHaveLength(6);
    });
    expect(alcanceActual()).toBeNull();   // nada queda en el contexto del llamador
  }, 30_000);
  it("una consulta SIN plazo lanzada mientras hay operaciones con plazo NO pasa por ninguna conexión dedicada (el resto del ERP no se altera)", async () => {
    const e = entorno((sql) => [[{ sql }]]);
    let fueraDelAlcance: unknown = "pendiente";
    const dentro = conPlazo(e.pool, { presupuestoMs: 5_000 }, async () => {
      await new Promise((r) => setTimeout(r, 30));
      await query("SELECT 'dentro'");
    });
    // mientras la operación sigue activa, otro flujo independiente consulta alcanceActual()
    await new Promise<void>((r) => setTimeout(() => { fueraDelAlcance = alcanceActual(); r(); }, 5));
    await dentro;
    expect(fueraDelAlcance).toBeNull();
    expect(datos(e.conn)).toEqual(["SELECT 'dentro'"]);
  });
});

// ayuda para el test anterior: identifica a qué conexión (por empresa) pertenecen las vistas
function conn_de(_c: unknown, vistas: number[]) { return vistas[0]; }
