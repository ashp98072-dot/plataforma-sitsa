import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("./empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("./permisos", async (original) => ({ ...(await original<typeof import("./permisos")>()), permisosEfectivos: vi.fn() }));
import { getSession } from "./session";
import { obtenerEmpresaPorSlug, empresasParaUsuario } from "./empresas";
import { permisosEfectivos } from "./permisos";
import { requireTenantCxc, requireTenantFacturacion } from "./tenant";
import { PERMISOS_CXC, PLATAFORMA_PERMISIBLES, moduloEmpresaDelPermiso, modulosPropiosDelRol } from "./permisos-shared";
import { CATALOGO_PERMISOS } from "./permisos-catalogo";

const empresa = { id: 7, slug: "kt", nombre: "KT", activa: true, modulos: ["contabilidad", "facturacion"] };
const fila = (modulo: string, v: boolean, e: boolean) => ({ modulo, puedeVer: v, puedeCrear: false, puedeEditar: e, puedeEliminar: false });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 3, rol: "Contabilidad", username: "conta", empresaId: 7 } as never);
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa] as never);
});

describe("permisos propios de CxC (Contabilidad), independientes de Facturación", () => {
  it("usuario con CxC pero SIN acceso a Facturación: ve CxC, cobra, y Facturación sigue cerrada", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("cxc_cuentas", true, false), fila("cxc_cobros", false, true)]);
    expect((await requireTenantCxc("kt", "cxc_cuentas", "ver")).error).toBeUndefined();
    expect((await requireTenantCxc("kt", "cxc_cobros", "editar")).error).toBeUndefined();
    expect((await requireTenantFacturacion("kt", "ver")).error?.status).toBe(403);
    expect((await requireTenantFacturacion("kt", "pagos")).error?.status).toBe(403);
  });
  it("ver CxC no permite cobrar; cobrar no concede ver documentos; sin permisos propios se niega", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("cxc_cuentas", true, false)]);
    expect((await requireTenantCxc("kt", "cxc_cobros", "editar")).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("cxc_cobros", false, true)]);
    expect((await requireTenantCxc("kt", "cxc_cuentas", "ver")).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([]);
    expect((await requireTenantCxc("kt", "cxc_cuentas", "ver")).error?.status).toBe(403);
  });
  it("tener Facturación o el módulo Contabilidad (editar) NO da acceso a CxC (sin fallback)", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("facturacion", true, true), fila("contabilidad", true, true)]);
    expect((await requireTenantCxc("kt", "cxc_cuentas", "ver")).error?.status).toBe(403);
    expect((await requireTenantCxc("kt", "cxc_cobros", "editar")).error?.status).toBe(403);
  });
  it("la empresa debe tener el módulo Contabilidad; Admin pasa por catálogo; Admin no cruza empresa ajena", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("cxc_cuentas", true, false)]);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ ...empresa, modulos: ["facturacion"] } as never);
    expect((await requireTenantCxc("kt", "cxc_cuentas", "ver")).error?.status).toBe(403);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
    vi.mocked(getSession).mockResolvedValue({ id: 1, rol: "Admin", username: "root", empresaId: 7 } as never);
    expect((await requireTenantCxc("kt", "cxc_cobros", "editar")).error).toBeUndefined();
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);
    expect((await requireTenantCxc("kt", "cxc_cobros", "editar")).error?.status).toBe(403);
  });
  it("bitácora de CxC: permiso PROPIO; ver documentos/cobrar no la concede, y la bitácora sola no da documentos", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("cxc_cuentas", true, false), fila("cxc_cobros", false, true)]);
    expect((await requireTenantCxc("kt", "cxc_bitacora", "ver")).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("cxc_bitacora", true, false)]);
    expect((await requireTenantCxc("kt", "cxc_bitacora", "ver")).error).toBeUndefined();
    expect((await requireTenantCxc("kt", "cxc_cuentas", "ver")).error?.status).toBe(403);
    expect((await requireTenantFacturacion("kt", "ver_bitacora")).error?.status).toBe(403); // CxC no abre Facturación
  });
  it("bitácora de facturas: acción propia de Facturación; ver/emitir/anular/pagar facturas NO la concede", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("facturacion", true, true), fila("facturacion_emitir", true, true), fila("facturacion_anular", true, true), fila("facturacion_pagos", true, true)]);
    expect((await requireTenantFacturacion("kt", "ver_bitacora")).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("facturacion", true, false), fila("facturacion_ver_bitacora", true, false)]);
    expect((await requireTenantFacturacion("kt", "ver_bitacora")).error).toBeUndefined();
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("facturacion_ver_bitacora", true, false)]);
    expect((await requireTenantFacturacion("kt", "ver_bitacora")).error?.status).toBe(403); // exige además el acceso base al módulo
  });
  it("catálogo: filas CxC registradas en Contabilidad, ningún rol las trae por defecto, cobrar exige ver", () => {
    expect(PERMISOS_CXC).toEqual(["cxc_cuentas", "cxc_cobros", "cxc_bitacora", "cxc_anular_cobro"]);
    for (const p of PERMISOS_CXC) {
      expect(PLATAFORMA_PERMISIBLES).toContain(p);
      expect(moduloEmpresaDelPermiso(p)).toBe("contabilidad");
      for (const rol of ["Contabilidad", "Visualizador", "Facturacion"]) expect(modulosPropiosDelRol(rol as never)).not.toContain(p);
    }
    const acciones = CATALOGO_PERMISOS.find((x) => x.id === "contabilidad")!.acciones;
    expect(acciones.map((a) => a.id)).toEqual(expect.arrayContaining(["cxc_ver", "cxc_cobrar", "cxc_ver_bitacora", "cxc_anular_cobro"]));
    expect(acciones.find((a) => a.id === "cxc_cobrar")).toMatchObject({ requiere: "cxc_ver" });
    expect(new Set(acciones.map((a) => a.id)).size).toBe(acciones.length);
  });
});
