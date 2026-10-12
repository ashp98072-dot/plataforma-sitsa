import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ dirty: 0, gen: 0, saldos: 1, fail: false, eventos: [] as string[] }));
vi.mock("@/lib/db", () => ({
  query: async (sql: string) => sql.includes("FROM configuracion") ? [{ valor: "0" }] : h.dirty ? [{ id: 1 }] : [],
  getPool: () => ({ getConnection: async () => {
    let foto = { dirty: h.dirty, gen: h.gen, saldos: h.saldos };
    return {
      query: async (sql: string) => [sql.includes("COUNT(*)") ? [{ n: 0 }] : [{ ok: 1 }]],
      execute: async (sql: string, p: unknown[]) => {
        if (sql.includes("rrhh_vacaciones_sync_estado")) {
          expect(p).toEqual([7]); h.eventos.push("dirty");
          if (h.fail) throw new Error("fallo estado"); h.dirty = 1; h.gen++;
        } else if (sql.startsWith("DELETE FROM saldos_vacaciones")) { h.saldos = 0; h.eventos.push("delete-saldos"); }
        return [{ affectedRows: 1 }];
      },
      beginTransaction: async () => { foto = { dirty: h.dirty, gen: h.gen, saldos: h.saldos }; h.eventos.push("begin"); },
      commit: async () => { h.eventos.push("commit"); },
      rollback: async () => { Object.assign(h, foto); h.eventos.push("rollback"); },
      release: () => undefined,
    };
  } }),
}));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { limpiarModuloEmpresa } from "./limpiar-modulo";
import { candidatosVacaciones } from "@/lib/rrhh/vacaciones-sync-estado";
beforeEach(() => { h.dirty = 0; h.gen = 0; h.saldos = 1; h.fail = false; h.eventos = []; });
it("borrar saldos invalida estado fresco y el siguiente batch selecciona empleado", async () => {
  expect(await candidatosVacaciones(7)).toEqual([]);
  await limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "rrhh_vacaciones", usuario: "admin", usuarioId: 1 });
  expect(h.saldos).toBe(0); expect(h.dirty).toBe(1); expect(h.gen).toBe(1);
  expect(await candidatosVacaciones(7)).toEqual([1]);
  expect(h.eventos).toEqual(["begin", "delete-saldos", "dirty", "commit"]);
});
it("limpiar incidencias que afectan consumo también invalida", async () => {
  await limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "rrhh_incidencias", usuario: "admin", usuarioId: 1 });
  expect(h.dirty).toBe(1); expect(await candidatosVacaciones(7)).toEqual([1]);
});
it("si invalidación falla se revierte limpieza: no quedan saldos borrados con fresh", async () => {
  h.fail = true;
  await expect(limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "rrhh_vacaciones", usuario: "admin", usuarioId: 1 })).rejects.toThrow("fallo estado");
  expect(h.saldos).toBe(1); expect(h.dirty).toBe(0); expect(h.eventos).not.toContain("commit");
});
