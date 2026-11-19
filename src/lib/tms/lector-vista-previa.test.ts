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
