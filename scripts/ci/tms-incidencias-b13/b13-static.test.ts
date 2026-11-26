// Pruebas ESTÁTICAS del laboratorio B13 (sin base de datos). Fijan el SQL bajo prueba y las guardas del ejecutor.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { B13_TABLES, SEED, SQL_B13_SHA256, b13MigrationStatements, sha256Lf, usuariosFixtureStatements } from "./ddl.mjs";
import { ACK_ENV, ACK_PHRASE, B13_BRANCH, REQUIRED_CASES, assertGate, evaluateRun } from "./run-windows.mjs";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SQL = read("sql/migrate-2026-11-tms-incidencias-resoluciones.sql");

describe("B13 SQL bajo prueba", () => {
  it("es exactamente el de PR #599 (hash fijado)", () => { expect(sha256Lf(SQL)).toBe(SQL_B13_SHA256); });
  it("contiene 3 sentencias, 2 tablas nuevas y 5 ON DELETE RESTRICT, sin sentencias destructivas", () => {
    const st = b13MigrationStatements(SQL); expect(st).toHaveLength(3);
    for (const t of B13_TABLES) expect(SQL).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
    expect((SQL.match(/ON DELETE RESTRICT/g) ?? []).length).toBe(5);
    expect(() => b13MigrationStatements(SQL + "\nDROP TABLE x;")).toThrow();
  });
  it("las tablas de apoyo usan los tipos reales de schema.sql", () => {
    expect(usuariosFixtureStatements(read("scripts/ci/tms-incidencias-b13/fixture-usuarios.sql"))).toHaveLength(1);
    expect(read("sql/schema.sql")).toMatch(/CREATE TABLE IF NOT EXISTS usuarios \(\s*id INT AUTO_INCREMENT PRIMARY KEY,\s*username VARCHAR\(80\) NOT NULL UNIQUE/);
  });
  it("los datos sembrados son ficticios y solo INSERT", () => { expect(SEED.length).toBeGreaterThanOrEqual(5); expect(SEED.every((s) => /^INSERT INTO /.test(s))).toBe(true); });
});

describe("B13 ejecutor", () => {
  const ok = { argv: ["--run-isolated"], env: { [ACK_ENV]: ACK_PHRASE }, platform: "win32", branch: B13_BRANCH, envFilesInCwd: [] as string[] };
  it("exige modo, plataforma, rama, entorno limpio y confirmación", () => {
    expect(assertGate(ok)).toBe("--run-isolated");
    expect(() => assertGate({ ...ok, argv: [] })).toThrow(); expect(() => assertGate({ ...ok, platform: "linux" })).toThrow();
    expect(() => assertGate({ ...ok, branch: "main" })).toThrow(); expect(() => assertGate({ ...ok, env: {} })).toThrow();
    expect(() => assertGate({ ...ok, envFilesInCwd: [".env"] })).toThrow();
    expect(assertGate({ ...ok, argv: ["--preflight-only"], env: {} })).toBe("--preflight-only");
  });
  it("evaluateRun solo da PASS con los 13 casos pasados y sin omitidos", () => {
    const mk = (skip?: string) => ({ testResults: [{ assertionResults: REQUIRED_CASES.map((c) => ({ title: `${c} x`, fullName: `${c} x`, status: c === skip ? "skipped" : "passed" })) }], numTotalTests: 13 });
    expect(evaluateRun({ status: 0 }, mk()).state).toBe("PASS");
    expect(evaluateRun({ status: 0 }, mk("B13.5")).state).not.toBe("PASS");
    expect(evaluateRun(null, null).state).toBe("INCOMPLETO");
  });
});
