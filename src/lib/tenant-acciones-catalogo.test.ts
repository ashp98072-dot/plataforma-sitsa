import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("@/lib/permisos", async (original) => ({ ...await original<typeof import("@/lib/permisos")>(), permisosEfectivos: vi.fn() }));
import { getSession } from "./session";
import { obtenerEmpresaPorSlug, empresasParaUsuario } from "./empresas";
import { permisosEfectivos } from "./permisos";
import { requireTenantFacturacion, requireTenantCotizaciones, requireTenantPortalesProveedores, requireTenantProgramacionExportar, requireTenantCotizacionesCosteo, requireTenantModulo } from "./tenant";
import { requireComprasAutorizar } from "./compras/acceso";
import { VERSION_PERMISOS, adaptarPermisosLegacy } from "./permisos-catalogo";
import type { PermisoModulo } from "./permisos-shared";
const p = (modulo: string, flags: Partial<PermisoModulo> = {}): PermisoModulo => ({modulo,puedeVer:false,puedeCrear:false,puedeEditar:false,puedeEliminar:false,...flags});
const empresa = {id:7,slug:"kt",nombre:"KT",activa:true,modulos:["tms"]};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({id:3,rol:"JefeOperaciones",username:"fixture",empresaId:7} as never);
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa] as never);
});
describe("acciones sensibles: guards reales", () => {
  it.each(["tms","reciclaje","tarimas","cms"] as const)("%s respeta acción independiente; Ver no permite gestionar/publicar", async modulo => {
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({...empresa,modulos:[modulo]} as never);
    const permisos = [p(VERSION_PERMISOS,{puedeVer:true}),p(modulo,{puedeVer:true})];
    vi.mocked(permisosEfectivos).mockResolvedValue(permisos);
    expect((await requireTenantModulo("kt",modulo,true)).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([...permisos,p(modulo+"_"+(modulo === "cms" ? "publicar" : "gestionar"),{puedeVer:true})]);
    expect((await requireTenantModulo("kt",modulo,true)).error).toBeUndefined();
  });
  it.each(["emitir","anular","pagos"] as const)("ver permite entrar pero no %s; grant propio permite", async accion => {
    vi.mocked(permisosEfectivos).mockResolvedValue([p("facturacion",{puedeVer:true})]);
    expect((await requireTenantFacturacion("kt","ver")).error).toBeUndefined();
    expect((await requireTenantFacturacion("kt",accion)).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([p("facturacion",{puedeVer:true}),p("facturacion_"+accion,{puedeVer:true})]);
    expect((await requireTenantFacturacion("kt",accion)).error).toBeUndefined();
  });
  it("denegar emitir explícitamente prevalece sobre editar legacy; no conceder editar desde emitir", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([p("facturacion",{puedeVer:true,puedeEditar:true}),p("facturacion_emitir")]);
    expect((await requireTenantFacturacion("kt","emitir")).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([p("facturacion",{puedeVer:true}),p("facturacion_emitir",{puedeVer:true})]);
    expect((await requireTenantFacturacion("kt","editar")).error?.status).toBe(403);
  });
  it("emitir sin base Ver no funciona, eliminar no concede anular", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([p("facturacion_emitir",{puedeVer:true})]);
    expect((await requireTenantFacturacion("kt","emitir")).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([p("facturacion",{puedeVer:true,puedeEliminar:true})]);
    expect((await requireTenantFacturacion("kt","anular")).error?.status).toBe(403);
  });
  it("compatibilidad del antiguo editar, Admin y tenant ajeno", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue(adaptarPermisosLegacy([p("facturacion",{puedeEditar:true})]));
    expect((await requireTenantFacturacion("kt","emitir")).error).toBeUndefined();
    vi.mocked(getSession).mockResolvedValue({id:3,rol:"Admin",empresaId:7} as never);
    expect((await requireTenantFacturacion("kt","anular")).error).toBeUndefined();
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);
    expect((await requireTenantFacturacion("kt","emitir")).error?.status).toBe(403);
  });
  it("cotizaciones: negar estado no bloquea editar borrador ni hereda TMS", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([p("cotizaciones",{puedeVer:true,puedeEditar:true}),p("tms",{puedeEditar:true}),p("cotizaciones_estado")]);
    expect((await requireTenantCotizaciones("kt","estado")).error?.status).toBe(403);
    expect((await requireTenantCotizaciones("kt","editar")).error).toBeUndefined();
  });
  it("exportar explícitamente denegado prevalece sobre Ver", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([p("programacion",{puedeVer:true}),p("programacion_exportar")]);
    expect((await requireTenantProgramacionExportar("kt")).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([p("programacion",{puedeVer:true}),p("programacion_exportar",{puedeVer:true})]);
    expect((await requireTenantProgramacionExportar("kt")).error).toBeUndefined();
  });
  it("autorizar compras y ver costeo confidencial no heredan de acciones generales", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([p("tms",{puedeVer:true,puedeEditar:true}),p("compras_requerimientos",{puedeVer:true,puedeEditar:true})]);
    expect((await requireComprasAutorizar("kt","editar")).error?.status).toBe(403);
    expect((await requireTenantCotizacionesCosteo("kt","ver")).error?.status).toBe(403);
  });
  it("portales valida base y acción sin alterar asignación / cifrado", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([p(VERSION_PERMISOS,{puedeVer:true}),p("proveedor_portales",{puedeVer:true})]);
    expect((await requireTenantPortalesProveedores("kt","ver")).error).toBeUndefined();
    expect((await requireTenantPortalesProveedores("kt","crear")).error?.status).toBe(403);
  });
});
