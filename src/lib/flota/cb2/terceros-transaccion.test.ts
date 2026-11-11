import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ get: vi.fn(), query: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: m.get }) }));
import { txTerceros } from "./terceros-transaccion";
const ctx = { empresaId: 1, actor: { id: 9, username: "Ficticio" }, autorizar: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("CB2_TERCEROS_D2_APROBADA", "1"); m.get.mockResolvedValue(m);
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes("@@SESSION")) return [[{ mode: "STRICT_TRANS_TABLES", innodb: 1, fk: 1, ck: 1 }]];
    if (sql.includes("FROM empresas")) return [[{ id: 1, activa: 1 }]];
    if (sql.includes("FROM usuarios")) return [[{ id: 9, activo: 1, rol_global: "Admin" }]];
    return [[]];
  });
});
afterEach(() => vi.unstubAllEnvs());
it("cerrada por defecto, sin adquirir conexiones", async () => {
  vi.stubEnv("CB2_TERCEROS_D2_APROBADA", undefined); const fn = vi.fn();
  await expect(txTerceros(ctx, fn)).rejects.toMatchObject({ status: 403 }); expect(m.get).not.toHaveBeenCalled(); expect(fn).not.toHaveBeenCalled();
});
it("error antes de commit revierte, conserva el error y restaura la sesión", async () => {
  const error = Error("auditoria fallida"); await expect(txTerceros(ctx, async () => { throw error; })).rejects.toBe(error);
  expect(m.rollback).toHaveBeenCalledOnce(); expect(m.commit).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledOnce(); expect(m.query).toHaveBeenCalledWith("SET SESSION sql_mode=?", ["STRICT_TRANS_TABLES"]);
  expect(m.query.mock.calls.some(([sql]) => sql.includes("proveedor"))).toBe(false);
});
it("commit incierto descarta conexion sin repetir el alta", async () => {
  m.commit.mockRejectedValue(Error("respuesta perdida")); const fn = vi.fn().mockResolvedValue({ id: 10 });
  await expect(txTerceros(ctx, fn)).rejects.toMatchObject({ status: 503, incierto: true }); expect(fn).toHaveBeenCalledOnce(); expect(m.destroy).toHaveBeenCalledOnce(); expect(m.release).not.toHaveBeenCalled();
});
it("rollback fallido descarta conexion; no informa éxito", async () => {
  m.rollback.mockRejectedValue(Error("rollback fallido"));
  await expect(txTerceros(ctx, async () => { throw Error("fallo original"); })).rejects.toMatchObject({ status: 503, incierto: true }); expect(m.destroy).toHaveBeenCalledOnce(); expect(m.release).not.toHaveBeenCalled();
});
it("deadlock previo a commit reintenta con revalidacion empresarial", async () => {
  const fn = vi.fn().mockRejectedValueOnce(Object.assign(Error("deadlock"), { code: "ER_LOCK_DEADLOCK" })).mockResolvedValue({ id: 10 });
  expect(await txTerceros(ctx, fn)).toEqual({ id: 10 }); expect(m.rollback).toHaveBeenCalledOnce(); expect(m.commit).toHaveBeenCalledOnce(); expect(ctx.autorizar).toHaveBeenCalledTimes(2);
});
it("revocacion del permiso bajo cerrojo bloquea el callback de escritura", async () => {
  ctx.autorizar.mockRejectedValue(Error("revocado")); const fn = vi.fn();
  await expect(txTerceros(ctx, fn)).rejects.toThrow("revocado"); expect(fn).not.toHaveBeenCalled(); expect(m.rollback).toHaveBeenCalledOnce();
});
