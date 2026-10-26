import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), lista: vi.fn(), detalle: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: m.guard }));
vi.mock("./conciliacion-documental", () => ({ consultarDocumental: m.lista, consumosDocumentales: m.detalle }));
// Asegura que ningún módulo de la ruta pueda abrir una conexión accidental.
vi.mock("@/lib/db", () => ({ getPool: () => { throw new Error("BD prohibida en pruebas"); } }));
import { GET } from "@/app/api/empresas/[slug]/flota/combustible/cb2/conciliacion-documental/route";
import { GET as detalle } from "@/app/api/empresas/[slug]/flota/combustible/cb2/conciliacion-documental/[id]/consumos/route";
const ctx = { params: Promise.resolve({ slug: "demo" }) };
beforeEach(() => {
    m.guard.mockReset(); m.lista.mockReset(); m.detalle.mockReset();
    m.guard.mockResolvedValue({ empresa: { id: 7 }, session: { id: 9, username: "lector", rol: "Usuario" } });
    m.lista.mockResolvedValue({ filas: [], siguiente: null }); m.detalle.mockResolvedValue({ filas: [], siguiente: null });
});
it("usa permiso ver y empresa del guard, ignora empresa cliente y admite lectura sin origen de escritura", async () => {
    const r = await GET(new Request("http://local/?empresa_id=99&proveedorId=3&estado=CUADRADA&limite=500&despues=10"), ctx);
    expect(r.status).toBe(200); expect(m.guard).toHaveBeenCalledWith("demo", "ver", { soloLectura: true });
    expect(m.lista).toHaveBeenCalledWith(7, expect.objectContaining({ proveedorId: 3, estado: "CUADRADA" }), 100, 10);
    expect(r.headers.get("cache-control")).toBe("private, no-store"); expect(r.headers.get("x-content-type-options")).toBe("nosniff");
});
it.each([401, 403, 404])("rechaza acceso %i antes de leer facturas o detalle", async status => {
    m.guard.mockResolvedValue({ error: new Response(null, { status }) });
    expect((await GET(new Request("http://local/"), ctx)).status).toBe(status);
    expect((await detalle(new Request("http://local/?proveedorId=3"), { params: Promise.resolve({ slug: "otra", id: "10" }) })).status).toBe(status);
    expect(m.lista).not.toHaveBeenCalled(); expect(m.detalle).not.toHaveBeenCalled();
});
it.each(["estado=FACTURADO", "desde=2026-11-01&hasta=2026-10-01", "fecha=SIN_FECHA&desde=2026-10-01", "proveedorId=0", "limite=0", "despues=-1", "desde=2026-02-30"])("rechaza filtros inválidos: %s", async query => {
    expect((await GET(new Request(`http://local/?${query}`), ctx)).status).toBe(400); expect(m.lista).not.toHaveBeenCalled();
});
it("detalle exige proveedor y factura válidos y mantiene empresa del guard", async () => {
    const c = { params: Promise.resolve({ slug: "demo", id: "10" }) };
    expect((await detalle(new Request("http://local/"), c)).status).toBe(400);
    expect((await detalle(new Request("http://local/?proveedorId=3&empresaId=99&limite=25"), c)).status).toBe(200);
    expect(m.detalle).toHaveBeenCalledWith(7, 3, 10, 25, 0);
});
it("no expone errores internos de lectura", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { m.lista.mockRejectedValue(new Error("SQL secreto")); const r = await GET(new Request("http://local/"), ctx); expect(r.status).toBe(500); expect(JSON.stringify(await r.json())).not.toContain("SQL secreto"); }
    finally { log.mockRestore(); }
});
