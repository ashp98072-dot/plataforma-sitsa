import { describe, it, expect, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({ guard: vi.fn(), list: vi.fn(), resume: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: mock.guard }));
vi.mock("./service", () => ({ consultar: mock.list, reanudarArchivo: mock.resume }));
import { cb2Http, bodyAcotado } from "./http";
const session = { id: 1, username: "op", rol: "Admin" }, empresa = { id: 1 };
beforeEach(() => { mock.guard.mockResolvedValue({ session, empresa }); mock.list.mockResolvedValue([]); mock.resume.mockResolvedValue({ ok: true }); });
describe("CB2 HTTP", () => {
    it.each([401, 403, 404])("propaga guard %s sin tocar datos", async (status) => { mock.guard.mockResolvedValue({ error: new Response(null, { status }) }); expect((await cb2Http(new Request("http://localhost/test"), "otra", "consumos")).status).toBe(status); expect(mock.list).not.toHaveBeenCalled(); });
    it("lectura tenant del servidor, paginada y no-store", async () => { const r = await cb2Http(new Request("http://localhost/test?limite=20&despues=4"), "demo", "consumos"); expect(mock.list).toHaveBeenCalledWith(1, "consumos", undefined, 20, 4); expect(mock.guard).toHaveBeenCalledWith("demo", "ver", { soloLectura: true }); expect(r.headers.get("cache-control")).toContain("no-store"); });
    it("limites de lectura y IDs invalidos", async () => { expect((await cb2Http(new Request("http://localhost/test?limite=501"), "demo", "consumos")).status).toBe(400); expect((await cb2Http(new Request("http://localhost/test"), "demo", "filas", "0")).status).toBe(400); });
    it("conciliar no concede resolucion", async () => { mock.guard.mockResolvedValue({ session: { ...session, rol: "JefeOperaciones" }, empresa }); expect((await cb2Http(new Request("http://localhost/test", { method: "POST", body: "{}" }), "demo", "reanudar")).status).toBe(403); expect(mock.resume).not.toHaveBeenCalled(); });
    it("revalida permiso despues del bloqueo", async () => { mock.resume.mockImplementationOnce(async (ctx) => { mock.guard.mockResolvedValue({ error: new Response(null, { status: 403 }) }); await ctx.autorizar(); }); const r = await cb2Http(new Request("http://localhost/test", { method: "POST", body: JSON.stringify({ proveedorId: 1, importacionId: 1, revision: 1, clave: "abcdefghijklmnop", seleccion: [], motivo: "fixture" }) }), "demo", "reanudar"); expect(r.status).toBe(403); });
    it("rechaza otro Origin y JSON de datos arbitrarios", async () => { expect((await cb2Http(new Request("http://localhost/test", { method: "POST", headers: { Origin: "https://otro.test" }, body: "{}" }), "demo", "asociar")).status).toBe(403); expect((await cb2Http(new Request("http://localhost/test", { method: "POST", body: '{"force":true}' }), "demo", "asociar")).status).toBe(400); });
    it("acota bytes reales sin confiar en content-length", async () => { await expect(bodyAcotado(new Request("http://localhost/test", { method: "POST", body: "123456" }), 5)).rejects.toMatchObject({ status: 413 }); });
    it("no filtra SQL ni rutas ante error de driver", async () => { mock.list.mockRejectedValueOnce(new Error("secret SQL private/file")); const r = await cb2Http(new Request("http://localhost/test"), "demo", "consumos"); expect(r.status).toBe(500); expect(await r.text()).not.toMatch(/secret|private|SQL/); });
});
