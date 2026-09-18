import { resolve } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), read: vi.fn(), real: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: m.query }));
vi.mock("node:fs/promises", () => ({ readFile: m.read, realpath: m.real }));
import { firmaHistoricaCompraReporte } from "./requerimiento-firma-reporte";
import { pngFirmaFixture } from "./requerimiento-exportaciones.fixture";
afterEach(() => vi.unstubAllEnvs());
const row = { payload_canonico: JSON.stringify({ nombreFirmante: "Nombre al firmar", rolFirmante: "Rol al firmar" }), imagen_ruta: "empresas/1/firmas/historica.png", fecha: "2026-09-18 10:15:00", codigo_firma: "SIG-ABC" };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("UPLOAD_DIR", resolve("tmp/storage-test"));
  m.query.mockResolvedValue([row]); m.read.mockResolvedValue(pngFirmaFixture); m.real.mockImplementation(async (s: string) => s);
});
it("consulta limitada a tenant+COMPRAS+REQUERIMIENTO_COMPRA+AUTORIZAR_COMPRA, identidad congelada", async () => {
  const firma = await firmaHistoricaCompraReporte(1, 12);
  const [sql, params] = m.query.mock.calls[0]; expect(params).toEqual([1, 12]);
  for (const filtro of ["empresa_id = ?", "modulo = 'COMPRAS'", "entidad_tipo = 'REQUERIMIENTO_COMPRA'", "entidad_id = ?", "accion = 'AUTORIZAR_COMPRA'"]) expect(sql).toContain(filtro);
  expect(sql).not.toMatch(/usuario_firmas|JOIN|usuarios/);
  expect(firma).toMatchObject({ nombre: "Nombre al firmar", rol: "Rol al firmar", fecha: row.fecha, codigo: "SIG-ABC", imagen: { buffer: pngFirmaFixture } });
});
it.each(["../secreto.png", "empresas/2/firmas/x.png", "empresas/1/../2/firmas/x.png", "/ruta/absoluta.png"])("rechaza ruta insegura %s", async imagen_ruta => {
  m.query.mockResolvedValue([{ ...row, imagen_ruta }]); expect((await firmaHistoricaCompraReporte(1, 12))?.imagen).toBeNull(); expect(m.read).not.toHaveBeenCalled();
});
it("rechaza archivo/symlink que escapa al tenant", async () => {
  m.real.mockImplementation(async (s: string) => s.endsWith("historica.png") ? resolve("tmp/otra-empresa.png") : s);
  expect((await firmaHistoricaCompraReporte(1, 12))?.imagen).toBeNull(); expect(m.read).not.toHaveBeenCalled();
});
it("archivo ausente o no PNG no sustituye por firma actual", async () => {
  m.read.mockRejectedValueOnce(new Error("ENOENT")); expect((await firmaHistoricaCompraReporte(1, 12))?.imagen).toBeNull();
  m.read.mockResolvedValueOnce(Buffer.from("no PNG")); expect((await firmaHistoricaCompraReporte(1, 12))?.imagen).toBeNull();
});
it("sin firma =>null; payload corrupto no inventa identidad", async () => {
  m.query.mockResolvedValueOnce([]); expect(await firmaHistoricaCompraReporte(1, 12)).toBeNull();
  m.query.mockResolvedValueOnce([{ ...row, payload_canonico: "null" }]); expect(await firmaHistoricaCompraReporte(1, 12)).toMatchObject({ nombre: null, rol: null });
});
