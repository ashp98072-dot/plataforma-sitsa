import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("@/lib/permisos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permisos")>();
  return { ...actual, permisosEfectivos: vi.fn() };
});
import { getSession } from "@/lib/session";
import { empresasParaUsuario, obtenerEmpresaPorSlug } from "@/lib/empresas";
import { permisosEfectivos } from "@/lib/permisos";
import type { PermisoModulo } from "@/lib/permisos-shared";
import { requireTenantCotizacionesCosteo } from "@/lib/tenant";

const empresa = (modulos: string[] = ["tms"]) => ({ id: 1, slug: "kt", nombre: "KT", activa: true, modulos }) as never;
const permiso = (modulo: string, p: Partial<PermisoModulo> = {}): PermisoModulo => ({ modulo, puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: false, ...p });
const sesion = (rol: string) => vi.mocked(getSession).mockResolvedValue({ id: 5, username: "u", nombre: "U", rol } as never);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa());
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa()]);
});

describe("requireTenantCotizacionesCosteo", () => {
  it("Admin siempre pasa, sin consultar la matriz de permisos", async () => {
    sesion("Admin");
    const g = await requireTenantCotizacionesCosteo("kt", "crear");
    expect(g.error).toBeUndefined(); expect(permisosEfectivos).not.toHaveBeenCalled();
  });
  it.each(["ver", "crear", "editar"] as const)("exige EXACTAMENTE cotizaciones_costeo:%s", async (accion) => {
    sesion("Operaciones");
    vi.mocked(permisosEfectivos).mockResolvedValue([permiso("cotizaciones_costeo", { puedeVer: true, puedeCrear: true, puedeEditar: true })]);
    expect((await requireTenantCotizacionesCosteo("kt", accion)).error).toBeUndefined();
  });
  it("la acción pedida debe estar concedida: solo ver no permite crear ni editar", async () => {
    sesion("Operaciones");
    vi.mocked(permisosEfectivos).mockResolvedValue([permiso("cotizaciones_costeo", { puedeVer: true })]);
    expect((await requireTenantCotizacionesCosteo("kt", "ver")).error).toBeUndefined();
    expect((await requireTenantCotizacionesCosteo("kt", "crear")).error?.status).toBe(403);
    expect((await requireTenantCotizacionesCosteo("kt", "editar")).error?.status).toBe(403);
  });
  it("SIN fallback: tms:ver/editar y cotizaciones:ver/crear/editar NO revelan el costeo (403)", async () => {
    sesion("GerenteOperaciones");
    vi.mocked(permisosEfectivos).mockResolvedValue([
      permiso("tms", { puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true }),
      permiso("cotizaciones", { puedeVer: true, puedeCrear: true, puedeEditar: true }),
      permiso("compras_autorizar", { puedeVer: true, puedeEditar: true }),
    ]);
    for (const accion of ["ver", "crear", "editar"] as const) {
      const g = await requireTenantCotizacionesCosteo("kt", accion);
      expect(g.error?.status).toBe(403);
    }
  });
  it("la empresa debe tener TMS aunque el usuario tenga el permiso", async () => {
    sesion("Operaciones");
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa(["rrhh"]));
    vi.mocked(empresasParaUsuario).mockResolvedValue([empresa(["rrhh"])]);
    vi.mocked(permisosEfectivos).mockResolvedValue([permiso("cotizaciones_costeo", { puedeVer: true })]);
    expect((await requireTenantCotizacionesCosteo("kt", "ver")).error?.status).toBe(403);
  });
  it("sin sesión => 401", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    expect((await requireTenantCotizacionesCosteo("kt", "ver")).error?.status).toBe(401);
  });
});
