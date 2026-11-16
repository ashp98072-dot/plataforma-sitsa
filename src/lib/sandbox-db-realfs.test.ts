import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { sandboxPool } from "./sandbox-db";

// PRICESMART API-26 — EVIDENCIA de la caché de validación del pool sandbox con ARCHIVOS REALES (sin simular `validateSandboxConfig`): ninguna alteración del manifiesto, de la raíz, de las cargas, de los
// secretos, de la base o de los `.env*` pasa inadvertida (ni siquiera un instante), el fallo es cerrado (la sentencia NO llega a la base), la caché es privada de cada pool y el costo en ráfagas queda acotado.
vi.mock("mysql2/promise", () => ({ default: { createPool: vi.fn(() => { throw new Error("REAL DB FORBIDDEN"); }) } }));
let root: string; let cwd: string; let manifest: Record<string, unknown> & { secretSha256: Record<string, string>; database: Record<string, string> };
const manifestPath = () => join(root, "isolation.json");
const saveManifest = () => writeFileSync(manifestPath(), JSON.stringify(manifest));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "novalvion-sbx-realfs-")); cwd = join(root, "app"); mkdirSync(cwd); mkdirSync(join(root, "uploads"));
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.stubEnv("NOVALVION_ENV", "sandbox"); vi.stubEnv("SANDBOX_ID", "qa-s02"); vi.stubEnv("SANDBOX_ROOT", root); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_TELEMETRY_DISABLED", "1");
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) vi.stubEnv(key, "");
  const database = { DB_HOST: "127.0.0.1", DB_PORT: "43306", DB_NAME: "sandbox_qa", DB_USER: "sandbox_qa" };
  for (const [key, value] of Object.entries(database)) vi.stubEnv(key, value);
  const hashes: Record<string, string> = {};
  for (const key of ["AUTH_SECRET", "DB_PASSWORD", "PORTAL_CREDENTIALS_KEY"]) { const value = `sandbox:qa-s02:${randomBytes(32).toString("hex")}`; vi.stubEnv(key, value); hashes[key] = createHash("sha256").update(value).digest("hex"); }
  vi.stubEnv("FEL_CREDENTIALS_KEY", ""); vi.stubEnv("CB2_DOCUMENTOS_FASE2", "0"); vi.stubEnv("FLOTA_PROPIEDAD_EXTERNA", "0"); vi.stubEnv("CB2_PUBLIC_ORIGIN", "https://localhost:4316");
  vi.stubEnv("EMPRESA_DOMINIOS", '{"localhost":"kt-monaco"}'); vi.stubEnv("UPLOAD_DIR", join(root, "uploads"));
  manifest = { environment: "sandbox", id: "qa-s02", database, secretSha256: hashes, origin: "https://localhost:4316" }; saveManifest();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

function fake(db = "sandbox_qa") {
  const conn = { query: vi.fn().mockResolvedValue([[{ db, environment: "sandbox", sandbox_id: "qa-s02" }]]), execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn() };
  return { conn, pool: sandboxPool({ getConnection: vi.fn().mockResolvedValue(conn) } as unknown as Pool) };
}
const run = (pool: Pool) => pool.execute("UPDATE synthetic SET value = 1");
const mustFail = async (pool: Pool, conn: { execute: { mock: { calls: unknown[] } } }, what: string) => { const before = conn.execute.mock.calls.length; await expect(run(pool), what).rejects.toThrow(); expect(conn.execute.mock.calls.length, `${what}: la sentencia NO debe llegar a la base`).toBe(before); };

describe("API-26 caché de validación sandbox con archivos reales: sin ventana ante alteraciones, falla cerrado y se recupera", () => {
  it("línea base: con la configuración válida las sentencias se ejecutan", async () => { const { pool, conn } = fake(); await run(pool); await run(pool); expect(conn.execute).toHaveBeenCalledTimes(2); });

  it("manifiesto reemplazado (otro id, otra base, otro hash de secreto, JSON inválido, vacío): la PRIMERA sentencia posterior falla sin esperar; al restaurarlo se recupera", async () => {
    const { pool, conn } = fake(); await run(pool); const original = readFileSync(manifestPath(), "utf8");
    const variants: Array<[string, () => void]> = [
      ["otro id", () => { manifest.id = "otro-sandbox"; saveManifest(); }], ["otra base", () => { manifest.database = { ...manifest.database, DB_NAME: "sandbox_otra" }; saveManifest(); }],
      ["hash de secreto revocado/rotado", () => { manifest.secretSha256 = { ...manifest.secretSha256, DB_PASSWORD: "0".repeat(64) }; saveManifest(); }], ["JSON inválido", () => writeFileSync(manifestPath(), "{no es json")], ["vacío", () => writeFileSync(manifestPath(), "")],
    ];
    for (const [name, tamper] of variants) {
      const saved = { ...manifest, secretSha256: { ...manifest.secretSha256 }, database: { ...manifest.database } };
      tamper(); await mustFail(pool, conn, name); writeFileSync(manifestPath(), original); Object.assign(manifest, saved); await run(pool);   // recuperación al restaurar
    }
  });

  it("manifiesto eliminado, convertido en carpeta o ilegible: falla cerrado al instante y se recupera al restaurarlo", async () => {
    const { pool, conn } = fake(); await run(pool); const original = readFileSync(manifestPath(), "utf8");
    rmSync(manifestPath()); await mustFail(pool, conn, "eliminado"); writeFileSync(manifestPath(), original); await run(pool);
    rmSync(manifestPath()); mkdirSync(manifestPath()); await mustFail(pool, conn, "carpeta"); rmSync(manifestPath(), { recursive: true }); writeFileSync(manifestPath(), original); await run(pool);
    if (process.platform !== "win32") { chmodSync(manifestPath(), 0o000); try { if (process.getuid?.() !== 0) await mustFail(pool, conn, "sin permiso de lectura"); } finally { chmodSync(manifestPath(), 0o600); } await run(pool); }
  });

  it("alteración que CONSERVA tamaño y mtime (la huella no cambia): la red de seguridad temporal la detecta en menos de 250 ms + el siguiente ciclo; nunca queda aceptada", async () => {
    const { pool, conn } = fake(); await run(pool); const before = statSync(manifestPath());
    const tampered = readFileSync(manifestPath(), "utf8").replace('"qa-s02"', '"qa-sXX"');   // mismo largo
    expect(tampered.length).toBe(readFileSync(manifestPath(), "utf8").length);
    writeFileSync(manifestPath(), tampered); utimesSync(manifestPath(), before.atime, before.mtime);   // el atacante restaura la fecha de modificación
    await sleep(320); await mustFail(pool, conn, "mismo tamaño y mtime");
  });

  it("secreto rotado/revocado en el entorno, cambio de base o cuenta, proxy o carpeta de cargas: falla de inmediato", async () => {
    const { pool, conn } = fake(); await run(pool);
    for (const [name, value] of [["AUTH_SECRET", `sandbox:qa-s02:${"b".repeat(64)}`], ["DB_PASSWORD", `sandbox:qa-s02:${"c".repeat(64)}`], ["DB_NAME", "sandbox_otra"], ["DB_USER", "sandbox_otro"], ["HTTPS_PROXY", "http://proxy.local:8080"], ["FEL_CREDENTIALS_KEY", "x"], ["EMPRESA_DOMINIOS", '{"produccion.com":"kt-monaco"}'], ["CB2_PUBLIC_ORIGIN", "https://produccion.com"]] as const) {
      const prev = process.env[name]; vi.stubEnv(name, value); await mustFail(pool, conn, name); vi.stubEnv(name, prev ?? ""); if (prev !== undefined) vi.stubEnv(name, prev);
    }
    await run(pool);
  });

  it("aparece un `.env` en el directorio de trabajo (segunda fuente de secretos) o desaparece la carpeta de cargas: falla de inmediato y se recupera al corregirlo", async () => {
    const { pool, conn } = fake(); await run(pool);
    writeFileSync(join(cwd, ".env.production"), "DB_HOST=db.produccion.com"); await mustFail(pool, conn, ".env.production"); rmSync(join(cwd, ".env.production")); await run(pool);
    rmSync(join(root, "uploads"), { recursive: true }); await mustFail(pool, conn, "sin carpeta de cargas"); mkdirSync(join(root, "uploads")); await run(pool);
  });

  it("raíz reemplazada por un enlace simbólico o carpeta de cargas convertida en enlace: falla cerrado (se omite donde el sistema no permite crear enlaces)", async () => {
    const { pool, conn } = fake(); await run(pool); const outside = mkdtempSync(join(tmpdir(), "novalvion-outside-"));
    try { renameSync(join(root, "uploads"), join(root, "uploads-real")); symlinkSync(outside, join(root, "uploads"), "junction"); }
    catch { return; }   // sin permiso para enlaces
    await mustFail(pool, conn, "cargas como enlace"); rmSync(join(root, "uploads")); renameSync(join(root, "uploads-real"), join(root, "uploads")); await run(pool);
    rmSync(outside, { recursive: true, force: true }); expect(existsSync(join(root, "uploads"))).toBe(true);
  });

  it("la caché es PRIVADA de cada pool: un pool no hereda la validación de otro ni de otro entorno (cambiar el entorno rompe al pool viejo y el nuevo valida por su cuenta)", async () => {
    const a = fake(); await run(a.pool);
    vi.stubEnv("DB_NAME", "sandbox_otra"); manifest.database = { ...manifest.database, DB_NAME: "sandbox_otra" }; saveManifest();   // el «otro entorno» es válido por sí mismo
    const b = fake("sandbox_otra"); await run(b.pool); expect(b.conn.execute).toHaveBeenCalledTimes(1);
    await mustFail(a.pool, a.conn, "el pool viejo conserva SU instantánea y no se beneficia de la validación del nuevo");
  });

  it("COSTO ACOTADO bajo concurrencia: 3000 sentencias simultáneas con validación REAL (≈18 ms cada una antes del cambio, ≈54 s) terminan en pocos segundos", async () => {
    const { pool, conn } = fake(); const t0 = Date.now();
    await Promise.all(Array.from({ length: 3000 }, () => run(pool)));
    const elapsed = Date.now() - t0; expect(conn.execute).toHaveBeenCalledTimes(3000); expect(elapsed, `${elapsed} ms`).toBeLessThan(6000);
  }, 30000);
});
