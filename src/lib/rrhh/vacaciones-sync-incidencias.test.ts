import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ eventos: [] as string[], failDirty: false }));
vi.mock("@/lib/db", () => ({
  query: async (sql: string) => sql.includes("FROM incidencias") ? [] : [{ id: 1 }],
  getPool: () => ({ getConnection: async () => ({
    beginTransaction: async () => { h.eventos.push("begin"); },
    commit: async () => { h.eventos.push("commit"); },
    rollback: async () => { h.eventos.push("rollback"); },
    release: () => { h.eventos.push("release"); },
    execute: async (sql: string, p: unknown[]) => {
      if (sql.includes("rrhh_vacaciones_sync_estado")) {
        expect(p).toEqual([7, 1]); h.eventos.push("dirty"); if (h.failDirty) throw new Error("dirty falló");
      } else h.eventos.push("insert");
      return [{ insertId: 5, affectedRows: 1 }];
    },
  }) }),
}));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: async () => ({ empresa: { id: 7 }, session: { username: "rrhh" } }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("./vacaciones", () => ({ contarDiasHabiles: async () => 1 }));
import { POST as incidencia } from "@/app/api/empresas/[slug]/rrhh/incidencias/route";
import { POST as anexo } from "@/app/api/empresas/[slug]/rrhh/incidencias/anexo/route";
const ctx = { params: Promise.resolve({ slug: "empresa" }) };
const req = (tipo: string) => new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ empleadoId: 1, tipo, fecha: "2026-10-12", fechaInicio: "2026-10-12", fechaFin: "2026-10-12" }) });
beforeEach(() => { h.eventos = []; h.failDirty = false; });
it.each([incidencia, anexo])("incidencias de vacaciones invalidan dentro de la transacción", async (post) => {
  expect((await post(req("Vacaciones"), ctx)).status).toBe(200);
  expect(h.eventos).toEqual(["begin", "insert", "dirty", "commit", "release"]);
});
it.each([incidencia, anexo])("otros tipos no invalidan vacaciones", async (post) => {
  expect((await post(req("Permiso con goce"), ctx)).status).toBe(200);
  expect(h.eventos).toEqual(["begin", "insert", "commit", "release"]);
});
it("incidencia revierte cuando dirty falla", async () => {
  h.failDirty = true; await expect(incidencia(req("Vacaciones"), ctx)).rejects.toThrow("dirty falló");
  expect(h.eventos).toEqual(["begin", "insert", "dirty", "rollback", "release"]);
});
it("anexo responde error sin confirmar si dirty falla", async () => {
  h.failDirty = true; const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try { expect((await anexo(req("A cuenta de Vacaciones"), ctx)).status).toBe(500); }
  finally { log.mockRestore(); }
  expect(h.eventos).toEqual(["begin", "insert", "dirty", "rollback", "release"]);
});
