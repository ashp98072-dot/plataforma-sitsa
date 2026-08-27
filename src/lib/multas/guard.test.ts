import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ empresasParaUsuario: vi.fn(), obtenerEmpresaPorSlug: vi.fn() }));
vi.mock("@/lib/permisos", async (original) => ({ ...await original<object>(), permisosEfectivos: vi.fn() }));
import { requireTenantMultas } from "@/lib/tenant";
import { getSession } from "@/lib/session";
import { empresasParaUsuario, obtenerEmpresaPorSlug, type Empresa } from "@/lib/empresas";
import { permisosEfectivos, permisoFull, permisoVacio, permisosDefaultPorRol, tienePermiso, moduloEmpresaDelPermiso, GRUPOS_PERMISOS } from "@/lib/permisos";
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 1, username: "prueba", rol: "GerenteOperaciones", empresaId: 2 });
  const empresa = { id: 2, activa: true, modulos: ["tms"] } as Empresa;
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa);
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa]);
  vi.mocked(permisosEfectivos).mockResolvedValue([permisoVacio("multas"), permisoFull("tms"), permisoFull("flota"), permisoFull("programacion")]);
});
describe("guard y permisos Multas", () => {
  it("sin multas:ver devuelve 403 aunque tenga TMS/Flota o sea gerente", async () => {
    expect((await requireTenantMultas("prueba")).error?.status).toBe(403);
  });
  it("empresa sin TMS devuelve 403 aunque tenga permiso", async () => {
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ id: 2, activa: true, modulos: ["rrhh"] } as Empresa);
    vi.mocked(permisosEfectivos).mockResolvedValue([permisoFull("multas")]);
    expect((await requireTenantMultas("prueba")).error?.status).toBe(403);
  });
  it("respeta permisos efectivos sin decidir por rol", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: 1, username: "prueba", rol: "Facturador", empresaId: 2 });
    vi.mocked(permisosEfectivos).mockResolvedValue([permisoFull("multas")]);
    expect((await requireTenantMultas("prueba", "editar")).error).toBeUndefined();
  });
  it("tenant sin acceso y sin sesión se rechazan", async () => {
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);
    expect((await requireTenantMultas("prueba")).error?.status).toBe(403);
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await requireTenantMultas("prueba")).error?.status).toBe(401);
  });
  it("Admin conserva excepción global del patrón existente", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: 1, username: "prueba", rol: "Admin", empresaId: 2 });
    expect((await requireTenantMultas("prueba", "editar")).error).toBeUndefined();
    expect(permisosEfectivos).not.toHaveBeenCalled();
  });
  it.each(["GerenteOperaciones", "JefeOperaciones", "AuxiliarOperaciones", "Facturador", "Piloto", "Admin"] as const)("defaults de %s", (rol) => {
    const p = permisosDefaultPorRol(rol);
    const operativo = ["GerenteOperaciones", "JefeOperaciones", "AuxiliarOperaciones", "Admin"].includes(rol);
    expect(tienePermiso(p, "multas", "ver")).toBe(operativo);
    expect(tienePermiso(p, "multas", "crear")).toBe(operativo);
    expect(tienePermiso(p, "multas", "editar")).toBe(operativo && rol !== "AuxiliarOperaciones");
    expect(tienePermiso(p, "multas", "eliminar")).toBe(rol === "Admin");
  });
  it("catálogo y grupo corresponden a Operaciones/TMS", () => {
    expect(moduloEmpresaDelPermiso("multas")).toBe("tms");
    expect(GRUPOS_PERMISOS.find((g) => g.id === "operaciones")?.modulos).toContain("multas");
  });
});
