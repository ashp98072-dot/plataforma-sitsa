import { describe, it, expect, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: state.get }) }));
import { tx } from "./repository";
const ctx = { empresaId: 1, proveedorId: 1, actor: { id: 1, username: "DEMO" }, autorizar: vi.fn(async () => { }) };
const connection = () => ({ query: vi.fn(async (sql: string) => sql.startsWith("SELECT @@SESSION") ? [[{ mode: "NO_ENGINE_SUBSTITUTION", innodb: 0 }]] : sql.startsWith("SELECT @@foreign") ? [[{ fk: 1, ck: 1 }]] : sql.includes("FROM compras_proveedores") ? [[{ id: 1, activo: 1 }]] : [[]]), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn() });
beforeEach(() => { ctx.autorizar.mockReset(); ctx.autorizar.mockResolvedValue(); });
describe("CB2 transaccion", () => {
    it("reserva conexiones para revalidar el guard central", async () => {
        state.get.mockImplementation(async () => connection());
        let liberar!: () => void, activas = 0, maximo = 0;
        const gate = new Promise<void>(resolve => { liberar = resolve; });
        const fn = vi.fn(async () => { activas++; maximo = Math.max(maximo, activas); await gate; activas--; });
        const llamadas = Array.from({ length: 5 }, () => tx(ctx, fn));
        await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(4));
        liberar(); await Promise.all(llamadas);
        expect(maximo).toBe(4); expect(fn).toHaveBeenCalledTimes(5);
    });
    it("commit incierto destruye conexion y no reejecuta; rollback conserva causa", async () => { const c = connection(); c.commit.mockRejectedValueOnce(new Error("socket")); state.get.mockResolvedValue(c); const fn = vi.fn(async () => 1); await expect(tx(ctx, fn)).rejects.toMatchObject({ status: 503 }); expect(fn).toHaveBeenCalledTimes(1); expect(c.destroy).toHaveBeenCalled(); expect(c.release).not.toHaveBeenCalled(); });
    it("deadlock reintenta acotado con el mismo callback y restaura modos", async () => { const c = connection(); state.get.mockResolvedValue(c); const fn = vi.fn().mockRejectedValueOnce({ code: "ER_LOCK_DEADLOCK" }).mockResolvedValue(2); expect(await tx(ctx, fn)).toBe(2); expect(c.rollback).toHaveBeenCalledTimes(1); expect(c.commit).toHaveBeenCalledTimes(1); expect(c.query).toHaveBeenCalledWith("SET SESSION innodb_strict_mode=?", [0]); expect(c.query).toHaveBeenCalledWith("SET SESSION sql_mode=?", ["NO_ENGINE_SUBSTITUTION"]); });
    it("FK/CHECK deshabilitados rechaza sin forzarlos", async () => { const c = connection(); c.query.mockImplementation(async (sql) => sql.startsWith("SELECT @@SESSION") ? [[{ mode: "", innodb: 0 }]] : sql.startsWith("SELECT @@foreign") ? [[{ fk: 0, ck: 1 }]] : [[]]); state.get.mockResolvedValue(c); const fn = vi.fn(); await expect(tx(ctx, fn)).rejects.toMatchObject({ status: 503 }); expect(fn).not.toHaveBeenCalled(); });
});
