import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { assertSandboxPath, validateSandboxConfig } from "../../scripts/sandbox-config.mjs";
import { sandboxPool } from "./sandbox-db";
import { mapaDominios } from "./dominios";
import { getAuthSecretBytes } from "./auth-secret";
import { validarOrigenCB2 } from "./flota/cb2/origin";
import { absPathFromRelative, getUploadsRoot, guardarUpload } from "./uploads";

// All DB operations below use a fake Pool. No mysql driver connection is created.
vi.mock("mysql2/promise", () => ({ default: { createPool: vi.fn(() => { throw new Error("REAL DB FORBIDDEN"); }) } }));
let root: string;
let cwd: string;
let manifest: Record<string, unknown>;
function saveManifest() { writeFileSync(join(root, "isolation.json"), JSON.stringify(manifest)); }
beforeEach(() => {
  vi.resetModules();
  root = mkdtempSync(join(tmpdir(), "novalvion-sandbox-"));
  cwd = join(root, "app");
  mkdirSync(cwd); mkdirSync(join(root, "uploads"));
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.stubEnv("NOVALVION_ENV", "sandbox");
  vi.stubEnv("SANDBOX_ID", "qa-s02"); vi.stubEnv("SANDBOX_ROOT", root);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_TELEMETRY_DISABLED", "1");
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) vi.stubEnv(key, "");
  const database = { DB_HOST: "127.0.0.1", DB_PORT: "43306", DB_NAME: "sandbox_qa", DB_USER: "sandbox_qa" };
  for (const [key, value] of Object.entries(database)) vi.stubEnv(key, value);
  const hashes: Record<string, string> = {};
  for (const key of ["AUTH_SECRET", "DB_PASSWORD", "PORTAL_CREDENTIALS_KEY"]) {
    const value = `sandbox:qa-s02:${randomBytes(32).toString("hex")}`;
    vi.stubEnv(key, value); hashes[key] = createHash("sha256").update(value).digest("hex");
  }
  vi.stubEnv("FEL_CREDENTIALS_KEY", ""); vi.stubEnv("CB2_DOCUMENTOS_FASE2", "0");
  vi.stubEnv("FLOTA_PROPIEDAD_EXTERNA", "0");
  vi.stubEnv("CB2_PUBLIC_ORIGIN", "https://localhost:4316");
  vi.stubEnv("EMPRESA_DOMINIOS", '{"localhost":"kt-monaco"}');
  vi.stubEnv("UPLOAD_DIR", join(root, "uploads"));
  manifest = { environment: "sandbox", id: "qa-s02", database, secretSha256: hashes, origin: "https://localhost:4316" };
  saveManifest();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("NETWORK FORBIDDEN"); }));
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe("sandbox configuration without services", () => {
  it("accepts an explicit private manifest independently of NODE_ENV", () => {
    expect(validateSandboxConfig()?.id).toBe("qa-s02");
    vi.stubEnv("NODE_ENV", "development");
    expect(validateSandboxConfig()?.id).toBe("qa-s02");
    expect(getUploadsRoot()).toBe(join(root, "uploads"));
    expect(mapaDominios()).toEqual({ localhost: "kt-monaco" });
    expect(getAuthSecretBytes().length).toBeGreaterThan(32);
  });
  it.each([
    ["NOVALVION_ENV", "sandobx"], ["NOVALVION_ENV", "production"],
    ["SANDBOX_ID", ""], ["SANDBOX_ROOT", "relative"],
    ["DB_HOST", "db.production.invalid"], ["DB_PORT", "3306"],
    ["DB_NAME", "production"], ["DB_USER", "root"],
    ["AUTH_SECRET", "a-production-secret-canary"], ["DB_PASSWORD", ""],
    ["PORTAL_CREDENTIALS_KEY", ""], ["UPLOAD_DIR", ""],
    ["CB2_PUBLIC_ORIGIN", "https://novalvion.com"], ["CB2_PUBLIC_ORIGIN", ""],
    ["EMPRESA_DOMINIOS", '{"logiserviciosmonaco.com":"kt-monaco"}'],
    ["EMPRESA_DOMINIOS", "null"], ["FEL_CREDENTIALS_KEY", "canary"],
    ["CB2_DOCUMENTOS_FASE2", "1"], ["FLOTA_PROPIEDAD_EXTERNA", "1"],
    ["NEXT_TELEMETRY_DISABLED", "0"], ["HTTPS_PROXY", "http://production.invalid"],
  ])("rejects invalid %s without disclosing its value", (key, value) => {
    vi.stubEnv(key, value);
    expect(() => validateSandboxConfig()).toThrow(/sandbox/);
    try { validateSandboxConfig(); } catch (error) {
      expect(String(error)).not.toContain("canary");
    }
  });
  it("rejects a foreign secret with the right sandbox prefix but wrong fingerprint", () => {
    vi.stubEnv("AUTH_SECRET", `sandbox:qa-s02:${"a".repeat(64)}`);
    expect(() => validateSandboxConfig()).toThrow();
  });
  it("rejects missing, malformed and foreign manifests", () => {
    rmSync(join(root, "isolation.json")); expect(() => validateSandboxConfig()).toThrow();
    writeFileSync(join(root, "isolation.json"), "not json"); expect(() => validateSandboxConfig()).toThrow();
    manifest.id = "other"; saveManifest(); expect(() => validateSandboxConfig()).toThrow();
  });
  it("blocks the legacy DB initialization script before any SQL", async () => {
    await expect(import("../../scripts/init-db.mjs")).rejects.toThrow(/db:init/);
    const mysql = (await import("mysql2/promise")).default;
    expect(mysql.createPool).not.toHaveBeenCalled();
  });
  it("blocks the direct collaborator script before dotenv or a connection", async () => {
    await expect(import("../../scripts/crear-colaborador-prueba.mjs")).rejects.toThrow(/no permitido en sandbox/);
  });
  it.each([".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.test.local"])("rejects Next automatic input %s", (name) => {
    writeFileSync(join(cwd, name), "AUTH_SECRET=CANARY");
    expect(() => validateSandboxConfig()).toThrow();
  });
  it("ignores parent config even after production loader cached its path", async () => {
    mkdirSync(join(root, "config"));
    writeFileSync(join(root, "config", ".env"), "AUTH_SECRET=production-canary");
    const { loadRuntimeEnv } = await import("./load-env");
    const secret = process.env.AUTH_SECRET;
    loadRuntimeEnv(); expect(process.env.AUTH_SECRET).toBe(secret);
  });
  it("rejects shared paths, sibling prefixes, traversal and escaping directory links", () => {
    vi.stubEnv("UPLOAD_DIR", cwd); expect(() => validateSandboxConfig()).toThrow();
    vi.stubEnv("UPLOAD_DIR", join(root, "uploads"));
    expect(() => absPathFromRelative("../uploads-shared/file")).toThrow();
    expect(() => assertSandboxPath(root, join(root, "..", "shared"))).toThrow();
    symlinkSync(cwd, join(root, "uploads", "escape"), "junction");
    expect(() => absPathFromRelative("escape/file.pdf")).toThrow();
  });
  it("rejects links inside upload directories before creating or writing files", async () => {
    mkdirSync(join(root, "uploads", "empresas"));
    symlinkSync(cwd, join(root, "uploads", "empresas", "1"), "junction");
    await expect(guardarUpload(1, "documentos", "qa", {
      name: "test.pdf", size: 1, arrayBuffer: async () => new ArrayBuffer(1),
    })).rejects.toThrow();
  });
  it("does not inherit production domains or origin fallbacks", () => {
    expect(mapaDominios()["novalvion.com"]).toBeUndefined();
    vi.stubEnv("CB2_PUBLIC_ORIGIN", undefined);
    expect(() => validarOrigenCB2(new Request("https://localhost:4316", { headers: { origin: "https://novalvion.com" } }))).toThrow();
    vi.stubEnv("AUTH_SECRET", "production-canary");
    expect(() => getAuthSecretBytes()).toThrow();
  });
  it("rejects an upload file instead of a directory and sanitizes malformed domains", () => {
    rmSync(join(root, "uploads"), { recursive: true });
    writeFileSync(join(root, "uploads"), "fixture");
    expect(() => validateSandboxConfig()).toThrow();
    vi.stubEnv("EMPRESA_DOMINIOS", "secret-canary-not-json");
    expect(() => mapaDominios()).toThrow("Dominios sandbox inválidos.");
  });
});

describe("read-only DB identity gate", () => {
  function fake(rows = [{ db: "sandbox_qa", environment: "sandbox", sandbox_id: "qa-s02" }]) {
    const conn = { query: vi.fn().mockResolvedValue([rows]), execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn() };
    const raw = { getConnection: vi.fn().mockResolvedValue(conn) };
    return { conn, raw, pool: sandboxPool(raw as unknown as Pool) };
  }
  it("checks the SAME connection before writes and transaction checkout", async () => {
    const { pool, conn } = fake();
    await pool.execute("UPDATE synthetic SET value = 1");
    expect(conn.query.mock.calls[0][0]).toMatch(/^SELECT DATABASE\(\)/);
    expect(conn.query.mock.invocationCallOrder[0]).toBeLessThan(conn.execute.mock.invocationCallOrder[0]);
    expect(conn.release).toHaveBeenCalledOnce();
    expect(Object.is(await pool.getConnection(), conn)).toBe(false);
    expect(conn.query).toHaveBeenCalledTimes(3);
  });
  it("rechecks an acquired connection before every operation", async () => {
    const { pool, conn } = fake();
    const acquired = await pool.getConnection();
    conn.query.mockRejectedValue(new Error("identity changed after checkout"));
    await expect(acquired.execute("UPDATE synthetic SET value = 1")).rejects.toThrow(/identidad/);
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.destroy).toHaveBeenCalledOnce();
  });
  it("does not expose raw connection or changeUser/prepare escape hatches", async () => {
    const { pool } = fake();
    const acquired = await pool.getConnection();
    for (const key of ["connection", "pool", "changeUser", "prepare", "constructor"]) {
      expect(() => Reflect.get(acquired, key)).toThrow(/permitida/);
    }
  });
  it("cannot reuse a released connection", async () => {
    const { pool, conn } = fake();
    const acquired = await pool.getConnection(); acquired.release();
    await expect(acquired.execute("UPDATE synthetic SET value = 1")).rejects.toThrow(/liberada/);
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it("validates before begin, execute, commit and rollback on the same driver connection", async () => {
    const { pool, conn } = fake();
    const acquired = await pool.getConnection();
    await acquired.beginTransaction(); await acquired.execute("UPDATE synthetic SET value = 1");
    await acquired.commit(); await acquired.rollback(); acquired.release();
    expect(conn.query).toHaveBeenCalledTimes(5);
    const order = conn.query.mock.invocationCallOrder;
    expect(order[1]).toBeLessThan(conn.beginTransaction.mock.invocationCallOrder[0]);
    expect(order[2]).toBeLessThan(conn.execute.mock.invocationCallOrder[0]);
    expect(order[3]).toBeLessThan(conn.commit.mock.invocationCallOrder[0]);
    expect(order[4]).toBeLessThan(conn.rollback.mock.invocationCallOrder[0]);
    expect(Object.getOwnPropertyNames(acquired)).toEqual([]);
    expect(Object.getPrototypeOf(acquired)).toBeNull();
  });
  it.each([[], [{ db: "production", environment: "sandbox", sandbox_id: "qa-s02" }], [{ db: "sandbox_qa", environment: "production", sandbox_id: "qa-s02" }], [{ db: "sandbox_qa", environment: "sandbox", sandbox_id: "other" }]].map((rows) => [rows]))("rejects mismatched identity without application SQL", async (rows) => {
    const { pool, conn } = fake(rows);
    await expect(pool.execute("DELETE FROM synthetic")).rejects.toThrow(/identidad/);
    expect(conn.execute).not.toHaveBeenCalled(); expect(conn.destroy).toHaveBeenCalledOnce();
  });
  it("sanitizes marker query errors and destroys the connection", async () => {
    const { pool, conn } = fake(); conn.query.mockRejectedValue(new Error("password-canary"));
    await expect(pool.getConnection()).rejects.toThrow("No se pudo verificar la identidad de la base sandbox.");
    expect(conn.destroy).toHaveBeenCalledOnce();
  });
  it("rejects configuration changes before opening another connection", async () => {
    const { pool, raw } = fake(); vi.stubEnv("DB_PASSWORD", "wrong");
    await expect(pool.getConnection()).rejects.toThrow(); expect(raw.getConnection).not.toHaveBeenCalled();
  });
  it("gates the public DB helpers and rejects invalid config before pool creation", async () => {
    const mysql = (await import("mysql2/promise")).default;
    const { getPool, execute, query } = await import("./db");
    const { raw, conn } = fake();
    vi.mocked(mysql.createPool).mockReturnValue(raw as unknown as Pool);
    vi.stubEnv("DB_HOST", "production.invalid");
    expect(() => getPool()).toThrow(); expect(mysql.createPool).not.toHaveBeenCalled();
    vi.stubEnv("DB_HOST", "127.0.0.1");
    await execute("UPDATE synthetic SET value = 1");
    await query("SELECT synthetic FROM fixture");
    expect(conn.query.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringMatching(/^SELECT DATABASE/), expect.stringMatching(/^SELECT DATABASE/),
      expect.stringMatching(/^SELECT DATABASE/), expect.stringMatching(/^SELECT DATABASE/), "SELECT synthetic FROM fixture",
    ]);
    vi.stubEnv("NOVALVION_ENV", "production"); vi.stubEnv("SANDBOX_ROOT", undefined); vi.stubEnv("SANDBOX_ID", undefined);
    expect(() => getPool()).toThrow(/entorno/);
  });
  it("rejects a photo read through an escaping junction", async () => {
    const mysql = (await import("mysql2/promise")).default;
    const { raw, conn } = fake();
    vi.mocked(mysql.createPool).mockReturnValue(raw as unknown as Pool);
    conn.query.mockImplementation(async (sql: string) => [sql.startsWith("SELECT DATABASE()")
      ? [{ db: "sandbox_qa", environment: "sandbox", sandbox_id: "qa-s02" }]
      : [{ id: 1, ruta_archivo: "empresas/1/documentos/photo.png" }]]);
    mkdirSync(join(root, "uploads", "empresas", "1"), { recursive: true });
    writeFileSync(join(cwd, "photo.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    symlinkSync(cwd, join(root, "uploads", "empresas", "1", "documentos"), "junction");
    const { respuestaFotoEmpleado } = await import("./rrhh/foto-empleado");
    await expect(respuestaFotoEmpleado(1, 1)).rejects.toThrow(/sandbox/);
  });
});

describe("legacy production startup regression", () => {
  beforeEach(() => {
    vi.stubEnv("NOVALVION_ENV", undefined); vi.stubEnv("SANDBOX_ROOT", undefined); vi.stubEnv("SANDBOX_ID", undefined);
  });
  it("keeps persistent config precedence and reload behavior", async () => {
    mkdirSync(join(root, "config"));
    const path = join(root, "config", ".env");
    writeFileSync(path, "AUTH_SECRET=production-fixture-secret-one");
    const { loadRuntimeEnv } = await import("./load-env");
    loadRuntimeEnv(); expect(process.env.AUTH_SECRET).toBe("production-fixture-secret-one");
    writeFileSync(path, "AUTH_SECRET=production-fixture-secret-two");
    loadRuntimeEnv(); expect(process.env.AUTH_SECRET).toBe("production-fixture-secret-two");
    // Cached production path must never be read once sandbox is selected.
    vi.stubEnv("NOVALVION_ENV", "sandbox"); vi.stubEnv("SANDBOX_ROOT", root); vi.stubEnv("SANDBOX_ID", "qa-s02");
    expect(() => loadRuntimeEnv()).toThrow();
    expect(process.env.AUTH_SECRET).toBe("production-fixture-secret-two");
  });
  it("preserves production auth validation, domains, storage and CB2 origin", () => {
    expect(validateSandboxConfig()).toBeNull();
    expect(mapaDominios()["logiserviciosmonaco.com"]).toBe("kt-monaco");
    expect(getUploadsRoot()).toBe(join(root, "uploads"));
    vi.stubEnv("AUTH_SECRET", "production-fixture-secret"); expect(getAuthSecretBytes().length).toBeGreaterThan(16);
    vi.stubEnv("AUTH_SECRET", "short"); expect(() => getAuthSecretBytes()).toThrow();
    vi.stubEnv("CB2_PUBLIC_ORIGIN", undefined);
    expect(() => validarOrigenCB2(new Request("https://novalvion.com", { headers: { origin: "https://novalvion.com" } }))).not.toThrow();
  });
  it("preserves the production pool options and does not query a sandbox marker", async () => {
    const mysql = (await import("mysql2/promise")).default;
    const raw = { query: vi.fn(), execute: vi.fn() } as unknown as Pool;
    vi.mocked(mysql.createPool).mockReturnValue(raw);
    vi.stubEnv("DB_HOST", "localhost");
    const { getPool } = await import("./db");
    expect(getPool()).toBe(raw); expect(getPool()).toBe(raw);
    expect(mysql.createPool).toHaveBeenCalledWith(expect.objectContaining({
      host: "127.0.0.1", connectionLimit: 15, queueLimit: 50, timezone: "local",
    }));
    expect(raw.query).not.toHaveBeenCalled();
  });
});
