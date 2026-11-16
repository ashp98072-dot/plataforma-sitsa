import type { Pool } from "mysql2/promise";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PRICESMART API-26 — la validación COMPLETA de la configuración sandbox (archivos + hash, ~18 ms síncronos) ya no se repite en cada sentencia SQL, pero sigue detectando de inmediato cualquier cambio de
// entorno y se repite de forma periódica (manifiesto alterado). La identidad de la BASE se verifica antes de CADA sentencia como siempre.
const validate = vi.hoisted(() => vi.fn());
vi.mock("../../scripts/sandbox-config.mjs", () => ({ validateSandboxConfig: validate }));
import { sandboxPool } from "./sandbox-db";

const CONFIG = { id: "qa-s02", root: "/x", uploads: "/x/uploads" };
const ENV = { NOVALVION_ENV: "sandbox", DB_HOST: "127.0.0.1", DB_PORT: "3310", DB_NAME: "sandbox_qa", DB_USER: "sandbox_u", DB_PASSWORD: "sandbox:qa-s02:" + "a".repeat(64) };
function fake() {
  const conn = { query: vi.fn().mockResolvedValue([[{ db: "sandbox_qa", environment: "sandbox", sandbox_id: "qa-s02" }]]), execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn() };
  return { conn, pool: sandboxPool({ getConnection: vi.fn().mockResolvedValue(conn) } as unknown as Pool) };
}
const saved = { ...process.env };
beforeEach(() => { vi.useFakeTimers(); validate.mockReset(); validate.mockReturnValue(CONFIG); Object.assign(process.env, ENV); });
afterEach(() => { vi.useRealTimers(); for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); });

describe("API-26 revalidación acotada de la configuración sandbox", () => {
  it("60 sentencias seguidas validan la configuración UNA sola vez, y la identidad de la base se consulta antes de CADA sentencia", async () => {
    const { pool, conn } = fake();
    for (let i = 0; i < 60; i++) await pool.execute("UPDATE synthetic SET value = 1");
    expect(validate).toHaveBeenCalledTimes(1); expect(conn.query).toHaveBeenCalledTimes(120);   // 2 verificaciones por sentencia (al obtener la conexión y antes de ejecutar)
    expect(conn.execute).toHaveBeenCalledTimes(60);
  });
  it("pasado el intervalo vuelve a validar (un manifiesto alterado se detecta): si la validación falla, la sentencia NO se ejecuta", async () => {
    const { pool, conn } = fake(); await pool.execute("UPDATE synthetic SET value = 1"); expect(validate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200); await pool.execute("UPDATE synthetic SET value = 1"); expect(validate).toHaveBeenCalledTimes(1);   // aún dentro del intervalo
    vi.advanceTimersByTime(100); validate.mockImplementation(() => { throw new Error("Configuración sandbox inválida"); });
    await expect(pool.execute("DELETE FROM synthetic")).rejects.toThrow(/inválida/); expect(validate).toHaveBeenCalledTimes(2);
    expect(conn.execute).toHaveBeenCalledTimes(2);   // la tercera nunca llegó a la base
  });
  it("cualquier cambio de las variables vigiladas obliga a validar DE INMEDIATO (sin esperar al intervalo)", async () => {
    const { pool } = fake(); await pool.execute("UPDATE synthetic SET value = 1"); expect(validate).toHaveBeenCalledTimes(1);
    process.env.UPLOAD_DIR = "/otro"; validate.mockImplementation(() => { throw new Error("Configuración sandbox inválida"); });
    await expect(pool.execute("UPDATE synthetic SET value = 1")).rejects.toThrow(/inválida/); expect(validate).toHaveBeenCalledTimes(2);
  });
  it("cambiar la base o la cuenta tras crear el pool se rechaza SIEMPRE (instantánea del pool), también dentro del intervalo y sin volver a leer archivos", async () => {
    const { pool, conn } = fake(); await pool.execute("UPDATE synthetic SET value = 1");
    for (const name of ["DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST", "DB_PORT"]) {
      const before = process.env[name]; process.env[name] = `${before}x`;
      await expect(pool.execute("UPDATE synthetic SET value = 1"), name).rejects.toThrow(/modificada|inválida/); process.env[name] = before;
    }
    expect(conn.execute).toHaveBeenCalledTimes(1);
  });
  it("sin configuración sandbox válida (validate devuelve null) nada se ejecuta y no se cachea el fallo", async () => {
    const { pool, conn } = fake(); validate.mockReturnValue(null);
    await expect(pool.execute("UPDATE synthetic SET value = 1")).rejects.toThrow(/modificada/); await expect(pool.execute("UPDATE synthetic SET value = 1")).rejects.toThrow(/modificada/);
    expect(validate).toHaveBeenCalledTimes(2); expect(conn.execute).not.toHaveBeenCalled();
    validate.mockReturnValue(CONFIG); await pool.execute("UPDATE synthetic SET value = 1"); expect(conn.execute).toHaveBeenCalledTimes(1);
  });
  it("un reloj que retrocede no prolonga la validez de la caché", async () => {
    const { pool } = fake(); await pool.execute("UPDATE synthetic SET value = 1");
    vi.setSystemTime(new Date(Date.now() - 60_000)); await pool.execute("UPDATE synthetic SET value = 1"); expect(validate).toHaveBeenCalledTimes(2);
  });
});
