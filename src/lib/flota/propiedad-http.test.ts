import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlota: m.guard }));
vi.mock("@/lib/flota/propiedad", async importOriginal => ({ ...await importOriginal<typeof import("./propiedad")>(), guardarPropiedad: m.save }));
import { PATCH, POST } from "@/app/api/empresas/[slug]/flota/vehiculos/propiedad/route";
const ctx = { params: Promise.resolve({ slug: "administradora" }) };
const req = (origin = "https://novalvion.com") => new Request("https://novalvion.com/api/empresas/administradora/flota/vehiculos/propiedad", {
  method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ empresaId: 99, usuario: "falso" }),
});
beforeEach(() => { vi.resetAllMocks(); m.guard.mockResolvedValue({ empresa: { id: 1 }, session: { username: "real" } }); m.save.mockResolvedValue({ id: 5 }); });
it.each([401, 403])("rechaza sin sesión o permiso (%s)", async status => {
  m.guard.mockResolvedValue({ error: new Response(null, { status }) });
  expect((await PATCH(req(), ctx)).status).toBe(status); expect(m.save).not.toHaveBeenCalled();
});
it("usa editar/crear existentes y actor/empresa del guard, nunca los enviados", async () => {
  await PATCH(req(), ctx); expect(m.guard).toHaveBeenCalledWith("administradora", "flota_vehiculos", "editar");
  expect(m.save).toHaveBeenCalledWith(1, "real", expect.anything(), false);
  await POST(req(), ctx); expect(m.guard).toHaveBeenLastCalledWith("administradora", "flota_vehiculos", "crear");
  expect(m.save).toHaveBeenLastCalledWith(1, "real", expect.anything(), true);
});
it("rechaza origen ajeno", async () => { expect((await PATCH(req("https://otro.test"), ctx)).status).toBe(403); expect(m.save).not.toHaveBeenCalled(); });
it("rechaza JSON inválido", async () => {
  const r = req(); await r.text();
  const bad = new Request(r.url, { method: "PATCH", headers: r.headers, body: "{" });
  expect((await PATCH(bad, ctx)).status).toBe(400); expect(m.save).not.toHaveBeenCalled();
});
