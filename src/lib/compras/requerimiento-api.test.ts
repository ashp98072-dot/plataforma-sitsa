import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const m = vi.hoisted(() => ({ tenant: vi.fn(), permisos: vi.fn(), guardar: vi.fn(), listar: vi.fn(), obtener: vi.fn(), catalogos: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenant: m.tenant }));
vi.mock("@/lib/permisos", async original => ({ ...await original<typeof import("@/lib/permisos")>(), permisosEfectivos: m.permisos }));
vi.mock("./requerimientos", async original => ({ ...await original<typeof import("./requerimientos")>(), guardarRequerimiento: m.guardar, listarRequerimientos: m.listar, obtenerRequerimiento: m.obtener, catalogosCompra: m.catalogos }));
import { comprasCatalogosGet, requerimientoGet, requerimientoGuardar } from "./requerimiento-api";
import { CONFLICTO_COMPRA, ErrorCompra } from "./requerimientos";
import { catalogoGlobalPermisos, permisosDefaultPorRol, type PermisoModulo } from "@/lib/permisos-shared";
const payload = { fecha_requerimiento: "2026-09-17", entidad_requirente_id: 4, requirente_usuario_id: 9, lineas: [{ fecha: "2026-09-17", proveedor_id: 3, repuesto_descripcion: "Filtro", metodo_pago: "Efectivo", condicion_pago: "Contado", total: "10.25" }] };
const request = (body: unknown = payload) => new Request("https://example.test/api", { method: "POST", body: JSON.stringify(body) });
let permisos: PermisoModulo[];
beforeEach(() => {
  vi.resetAllMocks(); permisos = [{ modulo: "compras_requerimientos", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: false }];
  m.permisos.mockImplementation(async () => permisos); m.tenant.mockResolvedValue({ empresa: { id: 1, modulos: ["tms"] }, session: { id: 8, username: "operador", rol: "Operaciones" } });
  m.guardar.mockResolvedValue({ id: 12, codigo: "RC-2026-000012", version: 1 }); m.listar.mockResolvedValue([]); m.obtener.mockResolvedValue(null); m.catalogos.mockResolvedValue({ proveedores: [] });
});
it.each(["crear", "ver", "editar"])("acción %s exige permiso propio no proveedor/TMS", async accion => {
  permisos = [{ modulo: "compras_proveedores", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true }, { modulo: "tms", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true }];
  const res = accion === "ver" ? await requerimientoGet(request(), "a") : await requerimientoGuardar(request(), "a", accion === "editar" ? "12" : undefined);
  expect(res.status).toBe(403); expect(m.guardar).not.toHaveBeenCalled(); expect(m.listar).not.toHaveBeenCalled(); expect(res.headers.get("Cache-Control")).toBe("private, no-store");
});
it("POST utiliza empresa y solicitante de sesión y no necesita permiso proveedores", async () => {
  const res = await requerimientoGuardar(request(), "a"); expect(res.status).toBe(201);
  expect(m.guardar.mock.calls[0].slice(0, 3)).toEqual([1, 8, "operador"]); expect(m.guardar.mock.calls[0][4]).toBe(false);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
});
it("PATCH versión y eliminar separados de editar", async () => {
  await requerimientoGuardar(request({ ...payload, version: 2 }), "a", "12"); expect(m.guardar.mock.calls[0][3].version).toBe(2); expect(m.guardar.mock.calls[0].slice(-2)).toEqual([false, 12]);
});
it("404 para id ajeno y formato inválido", async () => {
  expect((await requerimientoGet(request(), "a", "99")).status).toBe(404); expect(m.obtener).toHaveBeenCalledWith(1, 99);
  expect((await requerimientoGet(request(), "a", "1e2")).status).toBe(404); expect(m.obtener).toHaveBeenCalledOnce();
});
it("GET filtros / catálogos usan empresa actual", async () => {
  expect((await requerimientoGet(new Request("https://example.test?codigo=RC&desde=2026-09-01&proveedor_id=3"), "a")).status).toBe(200);
  expect(m.listar).toHaveBeenCalledWith(1, { codigo: "RC", desde: "2026-09-01", proveedor_id: 3 });
  expect((await comprasCatalogosGet("a")).status).toBe(200); expect(m.catalogos).toHaveBeenCalledWith(1);
});
it("rechaza campos manipulados y filtros inválidos sin ejecutar modelo", async () => {
  expect((await requerimientoGuardar(request({ ...payload, total: 1 }), "a")).status).toBe(400);
  expect((await requerimientoGet(new Request("https://example.test?desde=2026-02-30"), "a")).status).toBe(400);
  expect(m.guardar).not.toHaveBeenCalled(); expect(m.listar).not.toHaveBeenCalled();
});
it("409 exacto de versión, errores internos sin stack ni mensaje SQL", async () => {
  m.guardar.mockRejectedValueOnce(new ErrorCompra(CONFLICTO_COMPRA, 409)); const res = await requerimientoGuardar(request({ ...payload, version: 2 }), "a", "12"); expect(res.status).toBe(409); expect(await res.json()).toEqual({ error: CONFLICTO_COMPRA });
  m.guardar.mockRejectedValue(new Error("secreto SQL")); const fallo = await requerimientoGuardar(request(), "a"); expect(fallo.status).toBe(500); expect(await fallo.text()).not.toContain("secreto");
});
it("sin sesión y tenant inválido no consulta catálogos", async () => {
  m.tenant.mockResolvedValue({ error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) }); expect((await comprasCatalogosGet("b")).status).toBe(401); expect(m.catalogos).not.toHaveBeenCalled();
});
it("catálogo asignable pero sin defaults nuevos no Admin", () => {
  expect(catalogoGlobalPermisos()).toContain("compras_requerimientos");
  for (const rol of ["Operaciones", "GerenteOperaciones", "JefeOperaciones", "AuxiliarOperaciones", "Facturador", "CoordinadorCompras", "Visualizador", "RRHH", "Contabilidad", "Piloto", "Marcaje"] as const) {
    const p = permisosDefaultPorRol(rol).find(v => v.modulo === "compras_requerimientos");
    expect(!p || !(p.puedeVer || p.puedeCrear || p.puedeEditar || p.puedeEliminar)).toBe(true);
  }
});
