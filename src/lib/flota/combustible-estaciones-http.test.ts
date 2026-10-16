import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), guardar: vi.fn(), listar: vi.fn(), proveedores: vi.fn(), catalogos: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: m.guard }));
vi.mock("./combustible-estaciones", async original => ({ ...await original<typeof import("./combustible-estaciones")>(), guardarEstacion: m.guardar, listarEstaciones: m.listar, listarProveedoresActivos: m.proveedores }));
vi.mock("./combustible-staff", () => ({ catalogosCombustible: m.catalogos }));
import { estacionGuardar, estacionesGet } from "./combustible-estaciones-http";
import { GET as catalogosGet } from "@/app/api/empresas/[slug]/flota/combustible/catalogos/route";
const req = (body: object) => new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); m.guard.mockResolvedValue({ empresa: { id: 7 }, session: { id: 9, username: "op" } }); m.guardar.mockResolvedValue(11); m.listar.mockResolvedValue([]); m.proveedores.mockResolvedValue([]); m.catalogos.mockResolvedValue({ estaciones: [] }); });
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

import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import { respuestaErrorBdEstacion } from "./combustible-estaciones-http";
const errBd = (errno: number, code: string) => Object.assign(new Error(code), { errno, code });
it("el listado trae los proveedores ACTIVOS (el mantenimiento no depende del catálogo de captura ni del permiso Ver)", async () => {
  m.proveedores.mockResolvedValue([{ id: 3, nombre: "Shell" }]);
  const res = await estacionesGet(new Request("http://localhost/x"), "a");
  expect(await res.json()).toEqual({ items: [], proveedores: [{ id: 3, nombre: "Shell" }] });
  expect(m.proveedores).toHaveBeenCalledWith(7);
});
it("si falla el listado: JSON con mensaje y referencia (no un 500 vacío)", async () => {
  m.listar.mockRejectedValue(new Error("boom"));
  const res = await estacionesGet(new Request("http://localhost/x"), "a");
  expect(res.status).toBe(500);
  expect((await res.json()).error).toMatch(/No se pudo cargar las estaciones\. Referencia [0-9a-f]{8}\./);
});
it("guardar nueva estación (flujo del formulario): 201 con el id y datos del servidor", async () => {
  const res = await estacionGuardar(req({ proveedorId: 3, nombre: "Shell Roosevelt", direccion: "Km 12" }), "a");
  expect(res.status).toBe(201); expect(await res.json()).toEqual({ id: 11 });
  expect(m.guardar).toHaveBeenCalledWith(7, { usuarioId: 9, username: "op" }, { proveedorId: 3, nombre: "Shell Roosevelt", direccion: "Km 12", activo: true }, undefined);
});
it.each([
  ["proveedor inexistente / de otra empresa", new ErrorDominioFormulario("Proveedor no válido para esta empresa."), 400, "Proveedor no válido para esta empresa."],
  ["proveedor inactivo", new ErrorDominioFormulario("El proveedor está inactivo."), 400, "El proveedor está inactivo."],
])("error de dominio visible: %s", async (_n, error, status, mensaje) => {
  m.guardar.mockRejectedValue(error);
  const res = await estacionGuardar(req({ proveedorId: 3, nombre: "A" }), "a");
  expect(res.status).toBe(status); expect((await res.json()).error).toBe(mensaje);
});
it("validación con el mensaje real, no un genérico", async () => {
  expect((await (await estacionGuardar(req({ proveedorId: 3, nombre: "   " }), "a")).json()).error).toBe("Indica el nombre de la estación.");
  expect((await (await estacionGuardar(req({ nombre: "A" }), "a")).json()).error).toBe("Selecciona un proveedor.");
});
it.each([
  [errBd(1146, "ER_NO_SUCH_TABLE"), 503, /migración/],
  [errBd(1054, "ER_BAD_FIELD_ERROR"), 503, /migración/],
  [errBd(1452, "ER_NO_REFERENCED_ROW_2"), 409, /proveedor ya no es válido/],
  [errBd(1406, "ER_DATA_TOO_LONG"), 400, /excede el largo/],
  [errBd(4025, "ER_CONSTRAINT_FAILED"), 400, /no puede estar vacío/],
  [errBd(1213, "ER_LOCK_DEADLOCK"), 409, /Otro usuario/],
])("error de BD reconocible → mensaje accionable (%#)", async (error, status, texto) => {
  m.guardar.mockRejectedValue(error);
  const res = await estacionGuardar(req({ proveedorId: 3, nombre: "A" }), "a");
  expect(res.status).toBe(status); expect((await res.json()).error).toMatch(texto);
});
it("error desconocido: 500 con referencia para soporte y sin detalles internos", async () => {
  m.guardar.mockRejectedValue(new Error("detalle interno secreto"));
  const res = await estacionGuardar(req({ proveedorId: 3, nombre: "A" }), "a");
  const { error } = await res.json();
  expect(res.status).toBe(500); expect(error).toMatch(/Referencia [0-9a-f]{8}/); expect(error).not.toContain("secreto");
});
it("respuestaErrorBdEstacion ignora lo que no reconoce", () => {
  expect(respuestaErrorBdEstacion(new Error("x"))).toBeNull();
  expect(respuestaErrorBdEstacion(null)).toBeNull();
});
