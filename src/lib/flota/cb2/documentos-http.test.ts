import { beforeEach, afterEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), leer: vi.fn(), editar: vi.fn(), enabled: true, tipo: "COMPLETAR" }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: m.guard }));
vi.mock("@/lib/db", () => ({ getPool: () => { throw new Error("BD prohibida en pruebas"); } }));
vi.mock("./documentos", async () => {
    const { ErrorCB2 } = await import("./model");
    return { documentosHabilitados: () => m.enabled, exigirDocumentos: () => { if (!m.enabled) throw new ErrorCB2("Deshabilitado", 503); }, leerDocumento: m.leer, editarDocumento: m.editar };
});
import { GET, PATCH } from "@/app/api/empresas/[slug]/flota/combustible/cb2/conciliacion-documental/[id]/documento/route";
const context = { params: Promise.resolve({ slug: "demo", id: "10" }) };
const body = { proveedorId: 3, revision: 0, clave: "documento-http-clave-001", total: "100.123456", motivo: "Documento verificado contra original" };
function request(extra: Record<string, unknown> = {}, origin = "https://novalvion.com") { return new Request("http://internal/documento", { method: "PATCH", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify({ ...body, ...extra }) }); }
beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("CB2_PUBLIC_ORIGIN", "https://novalvion.com");
    m.enabled = true; m.tipo = "COMPLETAR"; m.guard.mockReset(); m.leer.mockReset(); m.editar.mockReset();
    m.guard.mockResolvedValue({ empresa: { id: 7 }, session: { id: 9, username: "demo", rol: "Usuario" } });
    m.leer.mockResolvedValue({ facturaId: 10, revision: 0, moneda: "GTQ", valores: { fecha: null, total: null } });
    m.editar.mockImplementation(async (ctx, id, op, autorizar) => { await ctx.autorizar(); await autorizar(m.tipo); return { facturaId: id, revision: 1, moneda: "GTQ", valores: { fecha: null, total: op.total }, tipo: m.tipo }; });
});
afterEach(() => vi.unstubAllEnvs());
it("fase deshabilitada: GET compatible con esquema antiguo, PATCH no escribe", async () => {
    m.enabled = false;
    expect(await (await GET(new Request("http://internal/?proveedorId=3"), context)).json()).toEqual({ habilitado: false });
    expect((await PATCH(request(), context)).status).toBe(503); expect(m.leer).not.toHaveBeenCalled(); expect(m.editar).not.toHaveBeenCalled();
});
it.each([401, 403, 404])("guard de lectura %i bloquea GET/PATCH antes de servicio", async status => {
    m.guard.mockResolvedValue({ error: new Response(null, { status }) });
    expect((await GET(new Request("http://internal/?proveedorId=3"), context)).status).toBe(status);
    expect((await PATCH(request(), context)).status).toBe(status); expect(m.leer).not.toHaveBeenCalled(); expect(m.editar).not.toHaveBeenCalled();
});
it("GET expone capacidades sin conceder edición a lectores", async () => {
    m.guard.mockImplementation(async (_s, accion) => accion === "ver" ? { empresa: { id: 7 }, session: { id: 9 } } : { error: new Response(null, { status: 403 }) });
    const r = await GET(new Request("http://internal/?proveedorId=3&empresaId=88"), context);
    expect(await r.json()).toMatchObject({ habilitado: true, permisos: { completar: false, corregir: false } });
    expect(m.leer).toHaveBeenCalledWith(7, 3, 10); expect(r.headers.get("cache-control")).toBe("private, no-store");
});
it("PATCH usa empresa y actor del guard y revalida completar bajo bloqueo", async () => {
    const r = await PATCH(request(), context); expect(r.status).toBe(200);
    expect(m.editar).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 7, proveedorId: 3, actor: { id: 9, username: "demo" } }), 10, body, expect.any(Function));
    expect(m.guard.mock.calls.filter(c => c[1] === "completar_documentos").length).toBeGreaterThanOrEqual(3);
});
it("clasificación CORREGIR del servicio exige ambos permisos", async () => {
    m.tipo = "CORREGIR";
    m.guard.mockImplementation(async (_s, accion) => accion === "corregir_documentos" ? { error: new Response(null, { status: 403 }) } : { empresa: { id: 7 }, session: { id: 9, username: "demo" } });
    expect((await PATCH(request(), context)).status).toBe(403);
    expect(m.guard).toHaveBeenCalledWith("demo", "corregir_documentos", { soloLectura: true });
});
it("sin completar no entra al servicio aunque exista permiso corregir", async () => {
    m.guard.mockImplementation(async (_s, accion) => accion === "completar_documentos" ? { error: new Response(null, { status: 403 }) } : { empresa: { id: 7 }, session: { id: 9 } });
    expect((await PATCH(request(), context)).status).toBe(403); expect(m.editar).not.toHaveBeenCalled();
});
it("origen externo y clasificación/moneda/empresa enviada por cliente se rechazan", async () => {
    expect((await PATCH(request({}, "https://externo.example"), context)).status).toBe(403);
    for (const extra of [{ tipo: "COMPLETAR" }, { moneda: "USD" }, { empresa_id: 88 }, { revision: -1 }, { total: "1.0000001" }]) expect((await PATCH(request(extra), context)).status).toBe(400);
    expect(m.editar).not.toHaveBeenCalled();
});
it("sesión cambiada durante revalidación impide escribir", async () => {
    m.guard.mockResolvedValueOnce({ empresa: { id: 7 }, session: { id: 9 } }).mockResolvedValue({ empresa: { id: 8 }, session: { id: 9 } });
    expect((await PATCH(request(), context)).status).toBe(403); expect(m.editar).not.toHaveBeenCalled();
});
it("esquema pendiente falla cerrado sin exponer SQL", async () => {
    m.leer.mockRejectedValue({ code: "ER_BAD_FIELD_ERROR", message: "SQL privado" });
    const r = await GET(new Request("http://internal/?proveedorId=3"), context); expect(r.status).toBe(503); expect(JSON.stringify(await r.json())).not.toContain("SQL privado");
});
