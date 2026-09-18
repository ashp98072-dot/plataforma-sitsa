import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ tenant: vi.fn(), permisos: vi.fn(), obtener: vi.fn(), firma: vi.fn(), pdf: vi.fn(), excel: vi.fn(), env: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenant: m.tenant }));
vi.mock("@/lib/permisos", async original => ({ ...await original<typeof import("@/lib/permisos")>(), permisosEfectivos: m.permisos }));
vi.mock("./requerimientos", () => ({ obtenerRequerimiento: m.obtener }));
vi.mock("./requerimiento-firma-reporte", () => ({ firmaHistoricaCompraReporte: m.firma }));
vi.mock("./requerimiento-exportaciones", () => ({ requerimientoCompraPdf: m.pdf, requerimientoCompraExcel: m.excel }));
vi.mock("@/lib/load-env", () => ({ loadRuntimeEnv: m.env }));
import { requerimientoExportar } from "./requerimiento-exportaciones-api";
import { GET as pdfGet } from "@/app/api/empresas/[slug]/compras/requerimientos/[id]/pdf/route";
import { GET as excelGet } from "@/app/api/empresas/[slug]/compras/requerimientos/[id]/excel/route";
import { compraReporteFixture as d, pngFirmaFixture } from "./requerimiento-exportaciones.fixture";
beforeEach(() => {
  vi.resetAllMocks();
  m.tenant.mockResolvedValue({ empresa: { id: 1, nombre: "Tenant Real", modulos: ["tms"] }, session: { id: 8, rol: "Operaciones" } });
  m.permisos.mockResolvedValue([{ modulo: "compras_requerimientos", puedeVer: true }]);
  m.obtener.mockResolvedValue(d); m.pdf.mockResolvedValue(Buffer.from("%PDF-fixture")); m.excel.mockResolvedValue(Buffer.from("XLSX-fixture"));
  m.firma.mockResolvedValue({ nombre: "Histórico", imagen: { buffer: pngFirmaFixture, mime: "image/png" } });
});
it.each(["pdf", "excel"] as const)("%s: tenant, ver y cabeceras attachment seguras/no-store", async formato => {
  const route = formato === "pdf" ? pdfGet : excelGet;
  const r = await route(new Request("https://test/api?empresaId=999"), { params: Promise.resolve({ slug: "a", id: "12" }) });
  expect(r.status).toBe(200); expect(m.tenant).toHaveBeenCalledWith("a"); expect(m.obtener).toHaveBeenCalledWith(1, 12);
  expect(r.headers.get("Content-Type")).toBe(formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect(r.headers.get("Content-Disposition")).toContain(`attachment; filename="Requerimiento-Compra-${d.codigo}.${formato === "pdf" ? "pdf" : "xlsx"}"`);
  expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  expect(m.firma).not.toHaveBeenCalled();
});
it.each(["pdf", "excel"] as const)("%s sin ver =>403 aunque tenga autorizar/editar", async formato => {
  m.permisos.mockResolvedValue([{ modulo: "compras_requerimientos", puedeEditar: true, puedeVer: false }, { modulo: "compras_autorizar", puedeVer: true, puedeEditar: true }]);
  expect((await requerimientoExportar("a", "12", formato)).status).toBe(403); expect(m.obtener).not.toHaveBeenCalled();
});
it.each(["pdf", "excel"] as const)("%s ID de otro tenant =>404 sin consultar firmas/generar", async formato => {
  m.obtener.mockResolvedValue(null);
  expect((await requerimientoExportar("a", "12", formato)).status).toBe(404);
  expect(m.obtener).toHaveBeenCalledWith(1, 12); expect(m.firma).not.toHaveBeenCalled(); expect(m.pdf).not.toHaveBeenCalled(); expect(m.excel).not.toHaveBeenCalled();
});
it.each(["pdf", "excel"] as const)("%s tenant no permitido =>403", async formato => {
  m.tenant.mockResolvedValue({ error: new Response("Sin acceso", { status: 403 }) });
  expect((await requerimientoExportar("b", "12", formato)).status).toBe(403); expect(m.obtener).not.toHaveBeenCalled();
});
it.each(["0", "-1", "abc", "2147483648", "1.5"])("ID inválido %s rechazado antes de consultar", async id => {
  expect((await requerimientoExportar("a", id, "pdf")).status).toBe(404); expect(m.obtener).not.toHaveBeenCalled();
});
it("Autorizada usa firma histórica y carga env antes de resolver imagen", async () => {
  m.obtener.mockResolvedValue({ ...d, estado: "Autorizada" });
  expect((await requerimientoExportar("a", "12", "pdf")).status).toBe(200);
  expect(m.firma).toHaveBeenCalledWith(1, 12);
  expect(m.pdf).toHaveBeenCalledWith(expect.objectContaining({ autorizante_nombre: d.autorizante_nombre }), "Tenant Real", expect.objectContaining({ nombre: "Histórico" }));
  expect(m.env.mock.invocationCallOrder[0]).toBeLessThan(m.firma.mock.invocationCallOrder[0]);
});
it("Autorizada sin imagen histórica =>409, no genera constancia sin firma", async () => {
  m.obtener.mockResolvedValue({ ...d, estado: "Autorizada" }); m.firma.mockResolvedValue(null);
  expect((await requerimientoExportar("a", "12", "pdf")).status).toBe(409); expect(m.pdf).not.toHaveBeenCalled();
});
it("Rechazada no consulta ni usa firma; Excel Autorizada no depende de archivos", async () => {
  m.obtener.mockResolvedValue({ ...d, estado: "Rechazada" });
  await requerimientoExportar("a", "12", "pdf"); expect(m.pdf).toHaveBeenCalledWith(expect.objectContaining({ motivo_rechazo: d.motivo_rechazo }), "Tenant Real", null);
  m.obtener.mockResolvedValue({ ...d, estado: "Autorizada" });
  await requerimientoExportar("a", "12", "excel"); expect(m.firma).not.toHaveBeenCalled();
});
it("errores internos no revelan rutas ni stack, incluso en lectura de firma", async () => {
  m.obtener.mockRejectedValue(new Error("/home/secreto/archivo"));
  const r = await requerimientoExportar("a", "12", "pdf"); expect(r.status).toBe(500); expect(await r.text()).not.toContain("secreto");
});
it("nombres Unicode/control en archivo no rompen headers", async () => {
  m.obtener.mockResolvedValue({ ...d, codigo: "RC-Mo\u0301naco-ñ\r\n" });
  const r = await requerimientoExportar("a", "12", "excel"); expect(r.status).toBe(200);
  expect(r.headers.get("Content-Disposition")).toContain("filename*=UTF-8''"); expect(r.headers.get("Content-Disposition")).not.toContain("\r\n");
});
