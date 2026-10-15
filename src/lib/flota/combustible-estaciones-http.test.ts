import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), guardar: vi.fn(), listar: vi.fn(), catalogos: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: m.guard }));
vi.mock("./combustible-estaciones", async original => ({ ...await original<typeof import("./combustible-estaciones")>(), guardarEstacion: m.guardar, listarEstaciones: m.listar }));
vi.mock("./combustible-staff", () => ({ catalogosCombustible: m.catalogos }));
import { estacionGuardar, estacionesGet } from "./combustible-estaciones-http";
import { GET as catalogosGet } from "@/app/api/empresas/[slug]/flota/combustible/catalogos/route";
const req = (body: object) => new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); m.guard.mockResolvedValue({ empresa: { id: 7 }, session: { id: 9, username: "op" } }); m.guardar.mockResolvedValue(11); m.listar.mockResolvedValue([]); m.catalogos.mockResolvedValue({ estaciones: [] }); });
it("ver consume catálogo sin exigir editar", async () => {
  expect((await catalogosGet(new Request("http://localhost/x"), { params: Promise.resolve({ slug: "a" }) })).status).toBe(200);
  expect(m.guard).toHaveBeenCalledWith("a", "ver"); expect(m.catalogos).toHaveBeenCalledWith(7);
});
it("mantenimiento lista con gestionar_estaciones, filtros y tenant del servidor", async () => {
  const res = await estacionesGet(new Request("http://localhost/x?proveedorId=3&activo=1&buscar=Roosevelt&empresaId=99"), "a");
  expect(res.status).toBe(200); expect(m.guard).toHaveBeenCalledWith("a", "gestionar_estaciones");
  expect(m.listar).toHaveBeenCalledWith(7, { proveedorId: 3, activo: true, buscar: "Roosevelt" });
});
it.each([undefined, 11])("escritura exige gestionar_estaciones (id=%s)", async id => {
  m.guard.mockResolvedValue({ error: new Response(null, { status: 403 }) });
  expect((await estacionGuardar(req({ proveedorId: 3, nombre: "A" }), "a", id)).status).toBe(403);
  expect(m.guard).toHaveBeenCalledWith("a", "gestionar_estaciones"); expect(m.guardar).not.toHaveBeenCalled();
});
it("ignora actor/empresa enviados por cliente", async () => {
  expect((await estacionGuardar(req({ proveedorId: 3, nombre: "A", empresaId: 99, usuarioId: 88 }), "a")).status).toBe(201);
  expect(m.guardar).toHaveBeenCalledWith(7, { usuarioId: 9, username: "op" }, { proveedorId: 3, nombre: "A", direccion: "", activo: true }, undefined);
});
it("proveedor obligatorio al crear y PATCH conserva campos omitidos", async () => {
  expect((await estacionGuardar(req({ nombre: "A" }), "a")).status).toBe(400);
  expect((await estacionGuardar(req({ activo: false }), "a", 11)).status).toBe(200);
  expect(m.guardar).toHaveBeenCalledWith(7, { usuarioId: 9, username: "op" }, { activo: false }, 11);
});
