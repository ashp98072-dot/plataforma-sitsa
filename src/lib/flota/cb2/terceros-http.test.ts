import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), registrar: vi.fn(), listar: vi.fn(), revisar: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => { throw Error("DB_REAL_PROHIBIDA"); } }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: m.guard }));
vi.mock("./terceros", async original => ({ ...await original<typeof import("./terceros")>(), registrarTerceros: m.registrar, listarTerceros: m.listar, revisarTerceros: m.revisar }));
import { tercerosHttp } from "./terceros-http";
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("CB2_TERCEROS_D2_APROBADA", "1"); m.guard.mockResolvedValue({ session: { id: 9, username: "demo", rol: "Admin" }, empresa: { id: 1 } }); m.registrar.mockResolvedValue({ id: 31 }); m.listar.mockResolvedValue([]); });
afterEach(() => vi.unstubAllEnvs());
const req = (body: unknown = { proveedorId: 3 }, origin = "http://localhost") => new Request("http://localhost/api/terceros", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
it("D2 por defecto apagada bloquea lectura y escritura antes de acceder a BD", async () => {
  vi.stubEnv("CB2_TERCEROS_D2_APROBADA", "");
  expect((await tercerosHttp(req(), "demo")).status).toBe(403);
  expect((await tercerosHttp(new Request("http://localhost/api/terceros"), "demo")).status).toBe(403);
  expect(m.guard).not.toHaveBeenCalled(); expect(m.registrar).not.toHaveBeenCalled();
});
it("no autenticado y usuario sin rol permitido no pueden gestionar", async () => {
  m.guard.mockResolvedValueOnce({ error: new Response(null, { status: 401 }) });
  expect((await tercerosHttp(req(), "demo")).status).toBe(401);
  m.guard.mockResolvedValueOnce({ session: { id: 9, rol: "Operaciones" }, empresa: { id: 1 } });
  expect((await tercerosHttp(req(), "demo")).status).toBe(403); expect(m.registrar).not.toHaveBeenCalled();
});
it("contexto viene del guard; revalida actor/empresa/rol después de esperar el lock", async () => {
  m.registrar.mockImplementationOnce(async ctx => { expect(ctx.empresaId).toBe(1); m.guard.mockResolvedValueOnce({ session: { id: 10, rol: "Admin" }, empresa: { id: 2 } }); await ctx.autorizar(); });
  expect((await tercerosHttp(req(), "demo")).status).toBe(403);
});
it("origen ajeno y JSON no objeto son rechazados", async () => {
  expect((await tercerosHttp(req({}, "https://external.invalid"), "demo")).status).toBe(403);
  expect((await tercerosHttp(req(null), "demo")).status).toBe(400); expect(m.registrar).not.toHaveBeenCalled();
});
