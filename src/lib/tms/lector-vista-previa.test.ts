import { describe, expect, it, vi } from "vitest";
import { abrirLectorVistaPrevia, ErrorVistaPrevia, errorVistaPrevia } from "./lector-vista-previa";

const sqlError = (code: string, errno: number, sqlMessage = "texto sql interno `tabla_secreta`") => Object.assign(new Error(sqlMessage), { code, errno, sqlMessage });
function pool(handler: (sql: string, args?: unknown[]) => unknown = () => [[]]) {
  const conn = { query: vi.fn(async (sql: string, args?: unknown[]) => handler(sql, args)), release: vi.fn(), destroy: vi.fn() };
  return { conn, pool: { getConnection: vi.fn(async () => conn) } as never };
}
const datos = (conn: { query: ReturnType<typeof vi.fn> }) => conn.query.mock.calls.map((c) => String(c[0])).filter((q) => !/^SET SESSION/i.test(q));

describe("abrirLectorVistaPrevia — solo lectura, sin bloqueos", () => {
  it.each([
    "SELECT id FROM tms_unidades WHERE empresa_id=? ORDER BY id FOR UPDATE",
    "select 1 from empresas lock in share mode",
    "SELECT 1 FOR SHARE",
    "SELECT GET_LOCK('x', 5)",
    "SELECT * FROM t INTO OUTFILE '/tmp/x'",
    "UPDATE tms_unidades SET placa='x'",
    "INSERT INTO tms_unidades(placa) VALUES('x')",
    "DELETE FROM tms_unidades",
    "SET GLOBAL innodb_lock_wait_timeout=1",
  ])("rechaza «%s» sin enviarla a la base", async (sentencia) => {
    const { conn, pool: p } = pool();
    const lector = await abrirLectorVistaPrevia(p);
    await expect(lector.query(sentencia as never)).rejects.toBeInstanceOf(ErrorVistaPrevia);
    await expect(lector.execute(sentencia as never)).rejects.toBeInstanceOf(ErrorVistaPrevia);
    expect(datos(conn)).toEqual([]);
  });

  it("un SELECT puro sí se ejecuta", async () => {
    const { conn, pool: p } = pool(() => [[{ id: 1 }]]);
    const lector = await abrirLectorVistaPrevia(p);
    expect(await lector.query("SELECT id FROM tms_unidades WHERE empresa_id=?" as never, [7] as never)).toEqual([[{ id: 1 }]]);
    expect(datos(conn)).toHaveLength(1);
  });

  it("reutiliza sentencias idénticas (metadatos de information_schema, listas por empresa): UNA consulta por sentencia distinta, no por unidad", async () => {
    const { conn, pool: p } = pool(() => [[{ n: 1 }]]);
    const lector = await abrirLectorVistaPrevia(p);
    for (let unidad = 0; unidad < 28; unidad++) {
      await lector.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_vehiculos_fusiones'" as never);
      await lector.query("SELECT id,placa FROM tms_unidades WHERE empresa_id=? ORDER BY id" as never, [7] as never);
      await lector.query("SELECT id FROM flota_vehiculos WHERE id=?" as never, [100 + unidad] as never);   // distinta por unidad: no se reutiliza
    }
    expect(datos(conn)).toHaveLength(2 + 28);
    expect(lector.sentencias()).toBe(30);
  });

  it("los parámetros distintos NO comparten caché", async () => {
    const { conn, pool: p } = pool();
    const lector = await abrirLectorVistaPrevia(p);
    await lector.query("SELECT 1 FROM t WHERE a=?" as never, [1] as never);
    await lector.query("SELECT 1 FROM t WHERE a=?" as never, [2] as never);
    expect(datos(conn)).toHaveLength(2);
  });

  it("un fallo no queda en caché: el siguiente intento vuelve a consultar", async () => {
    let n = 0;
    const { pool: p } = pool((sql) => { if (!/^SET SESSION/.test(sql) && ++n === 1) throw sqlError("ER_LOCK_DEADLOCK", 1213); return [[{ ok: 1 }]]; });
    const lector = await abrirLectorVistaPrevia(p);
    await expect(lector.query("SELECT 1 FROM t" as never)).rejects.toMatchObject({ code: "ER_LOCK_DEADLOCK" });
    expect(await lector.query("SELECT 1 FROM t" as never)).toEqual([[{ ok: 1 }]]);
  });
});

describe("abrirLectorVistaPrevia — límite de tiempo de TODA la operación", () => {
  it("agotado el presupuesto, la siguiente consulta falla de inmediato (no se acumulan esperas por unidad) y no llega a la base", async () => {
    let reloj = 1_000;
    const { conn, pool: p } = pool();
    const lector = await abrirLectorVistaPrevia(p, { presupuestoMs: 20_000, ahora: () => reloj });
    await lector.query("SELECT 1 FROM t WHERE a=?" as never, [1] as never);
    reloj += 20_001;
    await expect(lector.query("SELECT 1 FROM t WHERE a=?" as never, [2] as never)).rejects.toMatchObject({ name: "ErrorVistaPrevia", status: 503, message: expect.stringContaining("tardó demasiado") });
    expect(datos(conn)).toHaveLength(1);
  });

  it("aplica límites de sesión por sentencia y los restablece al liberar; la conexión limpia vuelve al pool", async () => {
    const { conn, pool: p } = pool();
    const lector = await abrirLectorVistaPrevia(p, { limiteSentenciaMs: 5_000 });
    const sets = conn.query.mock.calls.map((c) => String(c[0])).filter((q) => /^SET SESSION/.test(q));
    expect(sets).toEqual(expect.arrayContaining(["SET SESSION max_statement_time = ?", "SET SESSION max_execution_time = ?", "SET SESSION lock_wait_timeout = ?", "SET SESSION innodb_lock_wait_timeout = ?"]));
    await lector.liberar();
    expect(conn.query.mock.calls.map((c) => String(c[0]))).toEqual(expect.arrayContaining(["SET SESSION max_statement_time = DEFAULT", "SET SESSION innodb_lock_wait_timeout = DEFAULT"]));
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(conn.destroy).not.toHaveBeenCalled();
  });

  it("si no se pueden restablecer los límites, la conexión se DESTRUYE (nunca vuelve al pool con la sesión alterada)", async () => {
    const { conn, pool: p } = pool((sql) => { if (/= DEFAULT$/.test(sql)) throw new Error("conexión perdida"); return [[]]; });
    const lector = await abrirLectorVistaPrevia(p);
    await lector.liberar();
    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.release).not.toHaveBeenCalled();
  });

  it("un servidor sin alguna de las variables de sesión no impide abrir el lector", async () => {
    const { pool: p } = pool((sql) => { if (/max_execution_time/.test(sql)) throw sqlError("ER_UNKNOWN_SYSTEM_VARIABLE", 1193); return [[]]; });
    await expect(abrirLectorVistaPrevia(p)).resolves.toBeDefined();
  });
});

describe("errorVistaPrevia — mensajes CONTROLADOS (código ER_*, nunca texto SQL)", () => {
  it.each([
    [sqlError("ER_LOCK_WAIT_TIMEOUT", 1205), "ocupada con otra operación", "ER_LOCK_WAIT_TIMEOUT"],
    [sqlError("ER_LOCK_DEADLOCK", 1213), "ocupada con otra operación", "ER_LOCK_DEADLOCK"],
    [sqlError("ER_STATEMENT_TIMEOUT", 1969), "tardó demasiado", "ER_STATEMENT_TIMEOUT"],
    [sqlError("ER_QUERY_TIMEOUT", 3024), "tardó demasiado", "ER_QUERY_TIMEOUT"],
    [sqlError("ER_BAD_FIELD_ERROR", 1054), "error de base de datos ER_BAD_FIELD_ERROR", "ER_BAD_FIELD_ERROR"],
    [new Error("socket hang up con host interno 10.0.0.5"), "No se pudo verificar la identidad de las unidades", null],
  ])("%#", (e, fragmento, codigo) => {
    const r = errorVistaPrevia(e);
    expect(r).toBeInstanceOf(ErrorVistaPrevia);
    expect(r.status).toBe(503);
    expect(r.codigo).toBe(codigo);
    expect(r.message).toContain(fragmento);
    expect(r.message).not.toMatch(/tabla_secreta|10\.0\.0\.5|socket/);   // nada de texto SQL ni datos internos
  });
  it("un ErrorVistaPrevia no se re-envuelve", () => {
    const e = new ErrorVistaPrevia("x");
    expect(errorVistaPrevia(e)).toBe(e);
  });
});

describe("abrirLectorVistaPrevia — configuración de límites: solo se tolera «variable no soportada»", () => {
  const fatal = (code: string) => Object.assign(new Error("conexión perdida (host interno)"), { code, fatal: true });
  it.each([[1193, "ER_UNKNOWN_SYSTEM_VARIABLE"], [1238, "ER_INCORRECT_GLOBAL_LOCAL_VAR"]])("errno %i (%s) se tolera y el lector abre", async (errno, code) => {
    const { pool: p } = pool((sql) => { if (/max_execution_time/.test(sql)) throw sqlError(code, errno); return [[]]; });
    const lector = await abrirLectorVistaPrevia(p);
    expect(lector.limitesAplicados).not.toContain("max_execution_time");
    expect(lector.limiteSentenciaDisponible).toBe(true);   // max_statement_time sí quedó aplicado
  });
  it.each([
    ["conexión caída (fatal)", fatal("PROTOCOL_CONNECTION_LOST")],
    ["ECONNRESET", fatal("ECONNRESET")],
    ["demasiadas conexiones", sqlError("ER_CON_COUNT_ERROR", 1040)],
    ["sin privilegios", sqlError("ER_SPECIFIC_ACCESS_DENIED_ERROR", 1227)],
    ["error de sintaxis (no es «variable no soportada»)", sqlError("ER_PARSE_ERROR", 1064)],
    ["error sin código SQL", new Error("boom")],
  ])("%s NO se ignora: el lector no abre, la conexión se DESTRUYE y el error es controlado", async (_n, err) => {
    const { conn, pool: p } = pool((sql) => { if (/max_statement_time/.test(sql)) throw err; return [[]]; });
    const r = await abrirLectorVistaPrevia(p).then(() => null, (e: unknown) => e);
    expect(r).toBeInstanceOf(ErrorVistaPrevia);
    expect((r as ErrorVistaPrevia).message).not.toMatch(/host interno|boom/);
    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.release).not.toHaveBeenCalled();
  });
  it("sin ningún límite por sentencia disponible, lo declara (solo queda el presupuesto de la operación)", async () => {
    const { pool: p } = pool((sql) => { if (/max_statement_time|max_execution_time/.test(sql)) throw sqlError("ER_UNKNOWN_SYSTEM_VARIABLE", 1193); return [[]]; });
    const lector = await abrirLectorVistaPrevia(p);
    expect(lector.limiteSentenciaDisponible).toBe(false);
    expect(lector.limitesAplicados).toEqual(["lock_wait_timeout", "innodb_lock_wait_timeout"]);
  });
});

describe("abrirLectorVistaPrevia — límite ESTRICTO de la operación (también para una consulta ya enviada)", () => {
  it("una consulta que nunca responde se corta al vencer el presupuesto, la conexión se DESCARTA y se destruye (no vuelve al pool)", async () => {
    const { conn, pool: p } = pool((sql) => (/^SET SESSION/.test(sql) ? [[]] : new Promise(() => undefined)));
    const lector = await abrirLectorVistaPrevia(p, { presupuestoMs: 60 });
    const t0 = Date.now();
    await expect(lector.query("SELECT SLEEP(100)" as never)).rejects.toMatchObject({ name: "ErrorVistaPrevia", status: 503, message: expect.stringContaining("tardó demasiado") });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(lector.estado().descartada).toBe(true);
    await expect(lector.query("SELECT 2" as never)).rejects.toBeInstanceOf(ErrorVistaPrevia);   // nada más se envía por esa conexión
    await lector.liberar();
    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.release).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.map((c) => String(c[0])).filter((q) => /= DEFAULT/.test(q))).toEqual([]);   // no se intenta restablecer sobre una conexión incierta
  });
  it("getConnection que no responde dentro del presupuesto: falla controlado y, si la conexión llega tarde, se devuelve al pool", async () => {
    let entregar!: (c: unknown) => void;
    const tarde = { query: vi.fn(async () => [[]]), release: vi.fn(), destroy: vi.fn() };
    const p = { getConnection: vi.fn(() => new Promise((r) => { entregar = r; })) } as never;
    await expect(abrirLectorVistaPrevia(p, { presupuestoMs: 40 })).rejects.toMatchObject({ name: "ErrorVistaPrevia", message: expect.stringContaining("tardó demasiado") });
    entregar(tarde);
    await new Promise((r) => setTimeout(r, 10));
    expect(tarde.release).toHaveBeenCalledTimes(1);
    expect(tarde.query).not.toHaveBeenCalled();   // nunca se usa una conexión que llegó fuera de plazo
  });
});

describe("abrirLectorVistaPrevia — ciclo de vida de la conexión", () => {
  it("liberar() es idempotente: varias llamadas (también concurrentes) liberan UNA sola vez; después no se puede consultar", async () => {
    const { conn, pool: p } = pool();
    const lector = await abrirLectorVistaPrevia(p);
    await Promise.all([lector.liberar(), lector.liberar(), lector.liberar()]);
    await lector.liberar();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(conn.destroy).not.toHaveBeenCalled();
    expect(lector.estado()).toEqual({ liberada: true, descartada: false });
    await expect(lector.query("SELECT 1" as never)).rejects.toBeInstanceOf(ErrorVistaPrevia);
    expect(datos(conn)).toEqual([]);
  });
  it("conexión descartada: varias llamadas a liberar() destruyen UNA vez y nunca la liberan", async () => {
    const { conn, pool: p } = pool((sql) => { if (/= DEFAULT/.test(sql)) throw new Error("conexión perdida"); return [[]]; });
    const lector = await abrirLectorVistaPrevia(p);
    await lector.liberar(); await lector.liberar();
    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.release).not.toHaveBeenCalled();
  });
  it("un error SQL normal del servidor (ER_LOCK_WAIT_TIMEOUT) deja la conexión sana: se restablece y vuelve al pool", async () => {
    const { conn, pool: p } = pool((sql) => { if (/FROM t/.test(sql)) throw sqlError("ER_LOCK_WAIT_TIMEOUT", 1205); return [[]]; });
    const lector = await abrirLectorVistaPrevia(p);
    await expect(lector.query("SELECT 1 FROM t" as never)).rejects.toMatchObject({ code: "ER_LOCK_WAIT_TIMEOUT" });
    expect(lector.estado().descartada).toBe(false);
    await lector.liberar();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(conn.destroy).not.toHaveBeenCalled();
  });
  it.each([
    ["error sin código SQL (socket)", new Error("socket hang up")],
    ["error fatal de conexión", Object.assign(new Error("lost"), { code: "PROTOCOL_CONNECTION_LOST", fatal: true })],
    ["código ER_ pero marcado fatal", Object.assign(new Error("x"), { code: "ER_SERVER_SHUTDOWN", errno: 1053, fatal: true })],
  ])("%s deja la conexión en estado INCIERTO: se destruye y no vuelve al pool", async (_n, err) => {
    const { conn, pool: p } = pool((sql) => { if (/FROM t/.test(sql)) throw err; return [[]]; });
    const lector = await abrirLectorVistaPrevia(p);
    await expect(lector.query("SELECT 1 FROM t" as never)).rejects.toBe(err);
    expect(lector.estado().descartada).toBe(true);
    await lector.liberar();
    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.release).not.toHaveBeenCalled();
  });
});

describe("abrirLectorVistaPrevia — caché: ni se mezcla entre empresas ni se altera por accidente", () => {
  const filas = (empresa: number) => [{ id: 1, empresa_id: empresa, placa: `P-${empresa}` }];
  it("lo servido es una COPIA: modificar el resultado de una llamada no altera el de la siguiente", async () => {
    const { conn, pool: p } = pool(() => [filas(7), [{ name: "id" }]]);
    const lector = await abrirLectorVistaPrevia(p, { empresaId: 7 });
    const a = (await lector.query("SELECT id, placa FROM tms_unidades WHERE empresa_id=?" as never, [7] as never)) as unknown as [{ placa: string }[]];
    a[0][0].placa = "MUTADA"; a[0].push({ placa: "EXTRA" });
    const b = (await lector.query("SELECT id, placa FROM tms_unidades WHERE empresa_id=?" as never, [7] as never)) as unknown as [{ placa: string }[]];
    expect(b[0]).toEqual([{ id: 1, empresa_id: 7, placa: "P-7" }]);
    expect(datos(conn)).toHaveLength(1);   // seguía sirviéndose desde la caché
  });
  it("dos operaciones de empresas distintas con la MISMA sentencia no comparten nada (cada lector tiene su propia caché y su ámbito)", async () => {
    const A = pool((_s, a) => [filas(Number((a as number[])[0]))]);
    const B = pool((_s, a) => [filas(Number((a as number[])[0]))]);
    const la = await abrirLectorVistaPrevia(A.pool, { empresaId: 7 });
    const lb = await abrirLectorVistaPrevia(B.pool, { empresaId: 8 });
    const ra = (await la.query("SELECT id, placa FROM tms_unidades WHERE empresa_id=?" as never, [7] as never)) as unknown as [{ placa: string }[]];
    const rb = (await lb.query("SELECT id, placa FROM tms_unidades WHERE empresa_id=?" as never, [8] as never)) as unknown as [{ placa: string }[]];
    expect(ra[0][0].placa).toBe("P-7");
    expect(rb[0][0].placa).toBe("P-8");
    expect(datos(A.conn)).toHaveLength(1); expect(datos(B.conn)).toHaveLength(1);
  });
  it("dentro de un mismo lector, el empresa_id como parámetro forma parte de la clave: no se reutiliza un resultado de otra empresa", async () => {
    const { conn, pool: p } = pool((_s, a) => [filas(Number((a as number[])[0]))]);
    const lector = await abrirLectorVistaPrevia(p, { empresaId: 7 });
    const r7 = (await lector.query("SELECT id, placa FROM tms_unidades WHERE empresa_id=?" as never, [7] as never)) as unknown as [{ placa: string }[]];
    const r8 = (await lector.query("SELECT id, placa FROM tms_unidades WHERE empresa_id=?" as never, [8] as never)) as unknown as [{ placa: string }[]];
    expect([r7[0][0].placa, r8[0][0].placa]).toEqual(["P-7", "P-8"]);
    expect(datos(conn)).toHaveLength(2);
  });
});
