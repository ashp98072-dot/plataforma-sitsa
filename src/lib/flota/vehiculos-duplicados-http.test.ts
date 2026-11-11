import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), listar: vi.fn(), revisar: vi.fn(), desactivar: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlota: m.guard }));
vi.mock("./vehiculos-duplicados", () => ({ listarPlacasDuplicadas: m.listar, revisarPlacaDuplicada: m.revisar, desactivarDuplicado: m.desactivar }));
vi.mock("@/lib/db", () => ({ getPool: () => { throw Error("DB_REAL_PROHIBIDA"); } }));
import { duplicadosHttp } from "./vehiculos-duplicados-http";
const datos = { id: 10, conservarId: 20, revision: "a".repeat(64), motivo: "Revision ficticia segura", confirmado: true };
const req = (body: unknown = datos, origin = "http://localhost") => new Request("http://localhost/api/duplicados", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); m.guard.mockResolvedValue({ empresa: { id: 1 }, session: { id: 9, rol: "Admin", username: "Ficticio" } }); m.listar.mockResolvedValue([]); m.revisar.mockResolvedValue({}); m.desactivar.mockResolvedValue({ id: 10 }); });
it("autenticacion y Admin obligatorios tambien para leer", async () => {
  m.guard.mockResolvedValueOnce({ error: new Response(null, { status: 401 }) }); expect((await duplicadosHttp(req(), "demo")).status).toBe(401);
  m.guard.mockResolvedValue({ empresa: { id: 1 }, session: { id: 9, rol: "Operaciones" } });
  expect((await duplicadosHttp(new Request("http://localhost/api/duplicados"), "demo")).status).toBe(403); expect(m.listar).not.toHaveBeenCalled();
});
it("scope solo del guard; no-store y permiso de vehiculos", async () => {
  const r = await duplicadosHttp(new Request("http://localhost/api/duplicados?id=10"), "demo");
  expect(r.headers.get("cache-control")).toBe("private, no-store"); expect(m.revisar).toHaveBeenCalledWith(1, 10); expect(m.guard).toHaveBeenCalledWith("demo", "flota_vehiculos", "ver");
});
it("rechaza origen ajeno, confirmacion omitida y empresa manipulada", async () => {
  expect((await duplicadosHttp(req(datos, "https://ajeno.invalid"), "demo")).status).toBe(403);
  expect((await duplicadosHttp(req({ ...datos, confirmado: false }), "demo")).status).toBe(400);
  expect((await duplicadosHttp(req({ ...datos, empresaId: 2 }), "demo")).status).toBe(400); expect(m.desactivar).not.toHaveBeenCalled();
});
it("revalida actor/empresa/rol bajo bloqueo", async () => {
  m.desactivar.mockImplementation(async ctx => { m.guard.mockResolvedValueOnce({ empresa: { id: 2 }, session: { id: 9, rol: "Admin" } }); await ctx.autorizar(); });
  expect((await duplicadosHttp(req(), "demo")).status).toBe(403);
});
