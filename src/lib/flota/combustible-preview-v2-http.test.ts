import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), query: vi.fn(), confirm: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: m.guard }));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: () => { throw new Error("Preview no abre transacciones"); }, execute: () => { throw new Error("Preview no escribe"); } }));
vi.mock("@/lib/flota/combustible-importaciones", () => ({ confirmarImportacion: m.confirm }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: m.upload, guardarUploadExcel: m.upload }));
import { previewProveedorV2Http, proveedoresPreviewV2Http } from "./combustible-preview-v2-http";
import { fixtureHalelV2 } from "./combustible-importacion-v2.fixture";
import { hashImportacion } from "./combustible-importacion-parser";

async function request(perfil = "HALEL", proveedor = "3") {
  const form = new FormData(); form.set("perfil", perfil); form.set("proveedorId", proveedor);
  form.set("file", new File([new Uint8Array(await fixtureHalelV2())], "sintetico.xlsx"));
  return new Request("http://localhost/api/preview-v2", { method: "POST", body: form });
}
beforeEach(() => {
  vi.resetAllMocks();
  m.guard.mockResolvedValue({ empresa: { id: 7 }, session: { id: 9, username: "demo" } });
  m.query.mockImplementation(async (sql: string) => sql.includes("FROM compras_proveedores") ? [{ id: 3 }] : []);
});
describe("preview v2 HTTP sin persistencia", () => {
  it("catálogo dedicado consulta solo proveedores de la empresa con guard de solo lectura", async () => {
    expect((await proveedoresPreviewV2Http("empresa-demo")).status).toBe(200);
    expect(m.guard).toHaveBeenCalledWith("empresa-demo", "conciliar", { soloLectura: true });
    expect(m.query.mock.calls[0][1]).toEqual([7]);
    expect(m.query.mock.calls[0][0]).toMatch(/^SELECT.*empresa_id=\?/);
    expect(m.confirm).not.toHaveBeenCalled(); expect(m.upload).not.toHaveBeenCalled();
  });
  it("rechaza cuerpos excesivos y multipart inválido sin consultar proveedores", async () => {
    const r = new Request("http://localhost/x", { method: "POST", body: "x", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "999999999" } });
    expect((await previewProveedorV2Http(r, "empresa-demo")).status).toBe(413);
    const bad = new Request("http://localhost/x", { method: "POST", body: "no multipart", headers: { "content-type": "multipart/form-data; boundary=x" } });
    expect((await previewProveedorV2Http(bad, "empresa-demo")).status).toBe(400);
    expect(m.query).not.toHaveBeenCalled();
  });
  it.each([401, 403])("no consulta ni analiza sin autorización (%s)", async status => {
    m.guard.mockResolvedValue({ error: new Response(null, { status }) });
    expect((await previewProveedorV2Http(await request(), "empresa-demo")).status).toBe(status);
    expect(m.query).not.toHaveBeenCalled();
    expect(m.guard).toHaveBeenCalledWith("empresa-demo", "conciliar", { soloLectura: true });
  });
  it("valida proveedor de la empresa y no persiste archivo ni análisis", async () => {
    const r = await previewProveedorV2Http(await request(), "empresa-demo");
    expect(r.status).toBe(200); expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    const a = await r.json(); expect(a.versionContrato).toBe(2); expect(a).not.toHaveProperty("token");
    expect(m.query.mock.calls[0][1]).toEqual([7, 3]);
    for (const [sql, params] of m.query.mock.calls) {
      expect(sql.trim()).toMatch(/^SELECT/); expect(params.slice(0, 2)).toEqual([7, 3]);
      if (sql.includes("JOIN")) { expect(sql).toContain("c.empresa_id=f.empresa_id"); expect(sql).toContain("c.proveedor_id=?"); }
    }
    expect(m.confirm).not.toHaveBeenCalled(); expect(m.upload).not.toHaveBeenCalled();
  });
  it("rechaza proveedor ajeno o inactivo", async () => {
    m.query.mockResolvedValue([]);
    expect((await previewProveedorV2Http(await request(), "empresa-demo")).status).toBe(403);
    expect(m.query).toHaveBeenCalledTimes(1);
  });
  it.each([["OTRO", "3"], ["SHELL", "0"], ["HALEL", "NaN"]])("rechaza contexto inválido %s/%s", async (p, id) => {
    expect((await previewProveedorV2Http(await request(p, id), "empresa-demo")).status).toBe(400);
    expect(m.query).not.toHaveBeenCalled();
  });
  it("posibles previos son advertencias y se excluyen de totales sin afirmar unicidad definitiva", async () => {
    m.query.mockImplementation(async (sql: string) => sql.includes("FROM compras_proveedores") ? [{ id: 3 }] : [{ clave_operacion: hashImportacion(JSON.stringify(["700000"])) }]);
    const a = await (await previewProveedorV2Http(await request(), "empresa-demo")).json();
    expect(a.resumen).toMatchObject({ posiblesPrevios: 1, elegibles: 19, montoElegible: "3800" });
    expect(a.filas.filter((f: { posiblePrevio: boolean }) => f.posiblePrevio)).toHaveLength(2);
  });
  it("esquema ausente se informa como cobertura no disponible, nunca se auto-crea", async () => {
    m.query.mockImplementation(async (sql: string) => { if (sql.includes("FROM compras_proveedores")) return [{ id: 3 }]; throw { code: "ER_BAD_FIELD_ERROR" }; });
    const a = await (await previewProveedorV2Http(await request(), "empresa-demo")).json();
    expect(a.coberturaPrevios).toContain("no disponible");
  });
  it("un fallo de consulta no se disfraza de historial vacío", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    m.query.mockImplementation(async (sql: string) => { if (sql.includes("FROM compras_proveedores")) return [{ id: 3 }]; throw { code: "ECONNREFUSED" }; });
    expect((await previewProveedorV2Http(await request(), "empresa-demo")).status).toBe(500);
    log.mockRestore();
  });
});
