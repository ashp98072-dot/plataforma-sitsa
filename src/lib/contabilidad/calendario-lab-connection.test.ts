import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const driver = vi.hoisted(() => ({ createPool: vi.fn(), createConnection: vi.fn(), readFileSync: vi.fn() }));
vi.mock("mysql2/promise", () => ({ default: driver }));
vi.mock("node:fs", () => ({ default: { readFileSync: driver.readFileSync } }));
import { crearPoolLaboratorio, controles } from "../../../scripts/ci/c3c1/connection.mjs";
const id = "a".repeat(32);
const runDir = path.join(os.tmpdir(), `novalvion-c3c1-${id}`);
const m = { id, runDir, datadir: path.join(runDir, "data"), pidFile: path.join(runDir, "server.pid"),
  pipe: `c3c1-${id}`, database: `c3c1_lab_${id}`, token: "b".repeat(64), pid: 123 };
afterEach(() => vi.restoreAllMocks());
describe("Conexión C3C-1: driver completamente simulado, sin sockets ni procesos", () => {
  it("la revalidación dentro de BEGIN usa lock S, sin fijar vista consistente ni serializar con lock X", async () => {
    vi.spyOn(process, "kill").mockReturnValue(true);
    driver.readFileSync.mockReturnValue("123");
    let transaccion = false;
    const eventos: string[] = [];
    const raw = {
      query: vi.fn(async (sql: string) => {
        if (transaccion) eventos.push(sql);
        if (sql.startsWith("SELECT @@datadir")) return [[{ datadir: m.datadir, pidFile: m.pidFile, socket: m.pipe,
          sinRed: 1, version: "11.8.9-MariaDB", fk: 1, checks: 1 }]];
        if (sql === "SELECT DATABASE() AS nombre") return [[{ nombre: m.database }]];
        if (sql.includes("_c3c1_identity")) {
          if (transaccion && !sql.endsWith("LOCK IN SHARE MODE")) throw Error("Vista obsoleta antes de serializar");
          return [[{ token: m.token }]];
        }
        return [[{ id: 7 }]];
      }),
      beginTransaction: vi.fn(async () => { transaccion = true; }),
      rollback: vi.fn(async () => { transaccion = false; }), destroy: vi.fn(), release: vi.fn(),
    };
    driver.createPool.mockReturnValue({ getConnection: async () => raw });
    const c = await crearPoolLaboratorio(m).getConnection();
    await c.beginTransaction();
    await c.query("SELECT id FROM empresas WHERE id = ? FOR UPDATE", [7]);
    const marca = eventos.findIndex((s) => s.includes("_c3c1_identity"));
    const empresa = eventos.findIndex((s) => s.includes("FROM empresas"));
    expect(marca).toBeGreaterThanOrEqual(0); expect(marca).toBeLessThan(empresa);
    expect(eventos.filter((s) => s.includes("_c3c1_identity")).every((s) => s.endsWith("LOCK IN SHARE MODE"))).toBe(true);
    expect(eventos.filter((s) => s.includes("FROM empresas"))).toEqual(["SELECT id FROM empresas WHERE id = ? FOR UPDATE"]);
    expect(eventos.some((s) => /SET|SNAPSHOT/.test(s))).toBe(false);
    await c.rollback();
    expect(raw.rollback).toHaveBeenCalledOnce();
  });
  it("revalida antes de escribir y rechaza una base de referencia sin ejecutar la escritura", async () => {
    vi.spyOn(process, "kill").mockReturnValue(true);
    driver.readFileSync.mockReturnValue("123");
    let database = m.database;
    const raw = { query: vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT @@datadir")) return [[{ datadir: m.datadir, pidFile: m.pidFile, socket: m.pipe,
        sinRed: 1, version: "11.8.9-MariaDB", fk: 1, checks: 1 }]];
      if (sql === "SELECT DATABASE() AS nombre") return [[{ nombre: database }]];
      return [[{ token: m.token }]];
    }), execute: vi.fn(), destroy: vi.fn(), release: vi.fn() };
    driver.createPool.mockReturnValue({ getConnection: async () => raw });
    const c = await crearPoolLaboratorio(m).getConnection();
    expect(driver.createPool).toHaveBeenLastCalledWith(expect.objectContaining({ socketPath: `\\\\.\\pipe\\${m.pipe}`, database: m.database }));
    const options = driver.createPool.mock.calls.at(-1)![0];
    expect(options).not.toHaveProperty("host"); expect(options).not.toHaveProperty("port");
    database = "novalvion_pruebas";
    await expect(c.execute("INSERT INTO auditoria VALUES (?)", [1])).rejects.toThrow("Base no autorizada");
    expect(raw.execute).not.toHaveBeenCalled();
    database = m.database;
    await expect(c.query("USE novalvion_pruebas")).rejects.toThrow("fuera del contrato");
    expect(raw.query.mock.calls.some(([sql]) => sql.startsWith("USE"))).toBe(false);
    await c.execute("INSERT INTO auditoria VALUES (?)", [1]);
    expect(raw.execute).toHaveBeenCalledTimes(1);
  });
  it("rechaza el destino de referencia antes de construir un pool", () => {
    driver.createPool.mockClear();
    expect(() => crearPoolLaboratorio({ ...m, database: "novalvion_pruebas" })).toThrow();
    expect(driver.createPool).not.toHaveBeenCalled();
  });
  it("un control rechazado detiene inmediatamente las consultas siguientes", async () => {
    const query = vi.fn().mockResolvedValue([[{ control: "padres", errores: 1 }]]);
    await expect(controles({ query }, "SELECT 1 AS control; SELECT 2 AS control;")).rejects.toThrow("padres");
    expect(query).toHaveBeenCalledTimes(1);
  });
});
