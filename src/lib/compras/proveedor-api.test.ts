import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ tenant: vi.fn(), permisos: vi.fn(), listar: vi.fn(), obtener: vi.fn(), guardar: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenant: mocks.tenant }));
vi.mock("@/lib/permisos", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/permisos")>(), permisosEfectivos: mocks.permisos }));
vi.mock("./proveedores", async importOriginal => ({ ...await importOriginal<typeof import("./proveedores")>(), listarProveedores: mocks.listar, obtenerProveedor: mocks.obtener, guardarProveedor: mocks.guardar }));
import { ErrorProveedorDuplicado } from "./proveedores";
import { GET, POST } from "@/app/api/empresas/[slug]/compras/proveedores/route";
import { GET as getId, PATCH } from "@/app/api/empresas/[slug]/compras/proveedores/[id]/route";
import { permisosDefaultPorRol, catalogoPermisosRol, type PermisoModulo } from "@/lib/permisos-shared";
const ctx = { params: Promise.resolve({ slug: "a" }) };
const ctxId = { params: Promise.resolve({ slug: "a", id: "7" }) };
const req = (data?: unknown) => new Request("http://local/api", { method: data ? "POST" : "GET", ...(data ? { body: JSON.stringify(data) } : {}) });
const full: PermisoModulo = { modulo: "compras_proveedores", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: false };
beforeEach(() => {
  vi.resetAllMocks(); mocks.tenant.mockResolvedValue({ empresa: { id: 1, modulos: ["tms"] }, session: { id: 8, username: "admin", rol: "Operaciones" } });
  mocks.permisos.mockResolvedValue([full]); mocks.listar.mockResolvedValue([]); mocks.obtener.mockResolvedValue(null); mocks.guardar.mockResolvedValue(7);
});
it("POST crea con identidad tenant/sesión y datos normalizados", async () => {
  expect((await POST(req({ nombre_comercial: " A ", nit: " " }), ctx)).status).toBe(201);
  expect(mocks.guardar).toHaveBeenCalledWith(1, 8, "admin", { nombre_comercial: "A", nit: null }, undefined);
});
it("GET listado usa tenant A y no-cache", async () => { const response = await GET(req(), ctx); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store"); expect(mocks.listar).toHaveBeenCalledWith(1, ""); });
it("GET tenant B se trata como inexistente", async () => { expect((await getId(req(), ctxId)).status).toBe(404); expect(mocks.obtener).toHaveBeenCalledWith(1, 7); });
it("PATCH inexistente no informa otra empresa", async () => { mocks.guardar.mockResolvedValue(null); expect((await PATCH(req({ activo: false }), ctxId)).status).toBe(404); expect(mocks.guardar).toHaveBeenCalledWith(1, 8, "admin", { activo: false }, 7); });
it.each(["ver", "crear", "editar"])("requiere permiso propio %s", async accion => {
  mocks.permisos.mockResolvedValue([{ ...full, modulo: "tms" }, { ...full, modulo: "gastos" }]);
  const response = accion === "ver" ? await GET(req(), ctx) : accion === "crear" ? await POST(req({ nombre_comercial: "A" }), ctx) : await PATCH(req({ activo: false }), ctxId);
  expect(response.status).toBe(403); expect(mocks.listar).not.toHaveBeenCalled(); expect(mocks.guardar).not.toHaveBeenCalled();
});
it("ver no concede crear/editar", async () => { mocks.permisos.mockResolvedValue([{ ...full, puedeCrear: false, puedeEditar: false }]); expect((await GET(req(), ctx)).status).toBe(200); expect((await POST(req({ nombre_comercial: "A" }), ctx)).status).toBe(403); expect((await PATCH(req({ activo: false }), ctxId)).status).toBe(403); });
it("empresa sin TMS no accede", async () => { mocks.tenant.mockResolvedValue({ empresa: { id: 1, modulos: ["rrhh"] }, session: { id: 8, rol: "Admin" } }); expect((await GET(req(), ctx)).status).toBe(403); });
it("preserva rechazo de tenant y sesión", async () => { mocks.tenant.mockResolvedValue({ error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) }); expect((await POST(req({ nombre_comercial: "A" }), ctx)).status).toBe(401); expect(mocks.guardar).not.toHaveBeenCalled(); });
it("validación por campo y no fuga de errores SQL", async () => { const response = await POST(req({ nombre_comercial: " " }), ctx); expect(response.status).toBe(400); expect((await response.json()).erroresCampos.nombre_comercial).toContain("obligatorio"); mocks.guardar.mockRejectedValue(new Error("DB secreto")); expect(JSON.stringify(await (await POST(req({ nombre_comercial: "A" }), ctx)).json())).not.toContain("secreto"); });
it("JSON inválido y id inválido no consultan/escriben", async () => { expect((await POST(new Request("http://local", { method: "POST", body: "{" }), ctx)).status).toBe(400); expect((await getId(req(), { params: Promise.resolve({ slug: "a", id: "-1" }) })).status).toBe(404); expect(mocks.obtener).not.toHaveBeenCalled(); expect(mocks.guardar).not.toHaveBeenCalled(); });
describe("ANTI-DUPLICADOS (sección 10-11, 16 del ticket) — 409 estructurado en el POST", () => {
  it("9) duplicado ACTIVO -> 409 con codigo y proveedorExistente, sin exponer campos extra", async () => {
    mocks.guardar.mockRejectedValue(new ErrorProveedorDuplicado("PROVEEDOR_DUPLICADO", { id: 99, nombre_comercial: "Repuestos López", nit: null, activo: true }));
    const res = await POST(req({ nombre_comercial: "Repuestos López" }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.codigo).toBe("PROVEEDOR_DUPLICADO");
    expect(body.proveedorExistente).toEqual({ id: 99, nombre_comercial: "Repuestos López", nit: null, activo: true });
    expect(typeof body.error).toBe("string");
  });

  it("11) duplicado INACTIVO -> 409 con codigo PROVEEDOR_DUPLICADO_INACTIVO", async () => {
    mocks.guardar.mockRejectedValue(new ErrorProveedorDuplicado("PROVEEDOR_DUPLICADO_INACTIVO", { id: 99, nombre_comercial: "Repuestos López", nit: null, activo: false }));
    const res = await PATCH(req({ nombre_comercial: "Repuestos López" }), ctxId);
    expect(res.status).toBe(409);
    expect((await res.json()).codigo).toBe("PROVEEDOR_DUPLICADO_INACTIVO");
  });

  it("un error genérico de guardarProveedor sigue devolviendo 500 (no se confunde con duplicado)", async () => {
    mocks.guardar.mockRejectedValue(new Error("fallo de conexión"));
    const res = await POST(req({ nombre_comercial: "A" }), ctx);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("fallo de conexión");
  });

  it("17) sección 17 — éxito devuelve un payload mínimo `proveedor` (mismo shape que catalogosCompra)", async () => {
    mocks.obtener.mockResolvedValue({
      id: 7, empresa_id: 1, nombre_comercial: "A", razon_social: null, nit: "X", direccion: null, telefono: "1", correo: null,
      contacto_nombre: "C", contacto_telefono: "2", contacto_correo: null, metodo_pago_habitual: "Transferencia",
      banco: "Banco", numero_cuenta: "123", tipo_cuenta: null, titular_cuenta: null, dias_credito: 30, observaciones: null, activo: true,
    });
    const res = await POST(req({ nombre_comercial: "A" }), ctx);
    const body = await res.json();
    expect(body.proveedor).toEqual({ id: 7, nombre_comercial: "A", nit: "X", contacto_nombre: "C", contacto_telefono: "2", telefono: "1", metodo_pago_habitual: "Transferencia", banco: "Banco", numero_cuenta: "123", dias_credito: 30 });
    expect(body.proveedor).not.toHaveProperty("observaciones");
    expect(body.proveedor).not.toHaveProperty("direccion");
  });
});

it("permiso asignable sin defaults automáticos no Admin", () => {
  for (const rol of ["Operaciones", "GerenteOperaciones", "JefeOperaciones", "AuxiliarOperaciones", "CoordinadorCompras", "RRHH", "Visualizador"] as const) {
    expect(catalogoPermisosRol(rol)).toContain("compras_proveedores");
    expect(permisosDefaultPorRol(rol).find(p => p.modulo === "compras_proveedores")?.puedeVer ?? false).toBe(false);
  }
  expect(permisosDefaultPorRol("Admin").find(p => p.modulo === "compras_proveedores")?.puedeCrear).toBe(true);
});
