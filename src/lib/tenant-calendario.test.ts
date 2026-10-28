import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ getPool: () => { throw Error("BD prohibida en esta suite"); }, query: vi.fn(), execute: vi.fn() }));
vi.mock("./session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("./empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("./permisos", async (original) => ({ ...(await original<typeof import("./permisos")>()), permisosEfectivos: vi.fn() }));
import { getSession, createSessionToken, setSessionCookie } from "./session";
import { obtenerEmpresaPorSlug, empresasParaUsuario } from "./empresas";
import { permisosEfectivos } from "./permisos";
import { requireTenantCalendario, requireTenantModulo } from "./tenant";
import { CATALOGO_PERMISOS, cambiarAccion, tieneAccionCatalogo } from "./permisos-catalogo";
import { MODULOS, ROLES } from "./roles";
import { PERMISOS_CONT_CALENDARIO, catalogoGlobalPermisos, moduloEmpresaDelPermiso, modulosPropiosDelRol, permisosDefaultPorRol, tienePermiso, permisoVacio } from "./permisos-shared";
const empresa = { id: 7, slug: "e", nombre: "Entidad ficticia", activa: true, modulos: ["contabilidad"] };
const ver = { ...permisoVacio("contabilidad_calendario_ver"), puedeVer: true };
const crear = { ...permisoVacio("contabilidad_calendario_crear"), puedeCrear: true };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 4, username: "actor", rol: "Contabilidad", empresaId: 7 } as never);
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa] as never);
  vi.mocked(permisosEfectivos).mockResolvedValue([]);
});
describe("C3C-1: permisos efectivos y catálogo", () => {
  it("acceso directo a otra empresa autorizada no cambia sesión ni cookies (Server Component)", async () => {
    const session = { id: 4, username: "actor", rol: "Contabilidad", empresaId: 88 };
    vi.mocked(getSession).mockResolvedValue(session as never);
    vi.mocked(permisosEfectivos).mockResolvedValue([ver, crear]);
    expect((await requireTenantCalendario("e", "ver")).error).toBeUndefined();
    expect((await requireTenantCalendario("e", "crear")).error).toBeUndefined();
    expect(createSessionToken).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(session.empresaId).toBe(88);
  });
  it("lectura independiente de crear; ni el rol ni editar Contabilidad conceden acceso", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([{ ...permisoVacio("contabilidad"), puedeVer: true, puedeEditar: true }]);
    expect((await requireTenantCalendario("e", "ver")).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([ver]);
    expect((await requireTenantCalendario("e", "ver")).error).toBeUndefined();
    expect((await requireTenantCalendario("e", "crear")).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([crear]);
    expect((await requireTenantCalendario("e", "crear")).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([ver, crear]);
    expect((await requireTenantCalendario("e", "crear")).error).toBeUndefined();
    expect((await requireTenantModulo("e", "contabilidad", true)).error?.status).toBe(403);
  });
  it("empresa sin Contabilidad y empresa no asignada se rechazan; Admin sigue el patrón existente", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([ver, crear]);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ ...empresa, modulos: ["tms"] } as never);
    expect((await requireTenantCalendario("e", "crear")).error?.status).toBe(403);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
    vi.mocked(getSession).mockResolvedValue({ id: 4, username: "actor", rol: "Admin", empresaId: 7 } as never);
    expect((await requireTenantCalendario("e", "crear")).error).toBeUndefined();
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);
    expect((await requireTenantCalendario("e", "crear")).error?.status).toBe(403);
  });
  it("persiste filas propias, crear implica ver y revocar ver revoca crear sin grants por rol", () => {
    const p = cambiarAccion([], "contabilidad", "calendario_crear", true);
    expect(tieneAccionCatalogo(p, "contabilidad", "calendario_ver")).toBe(true);
    expect(tieneAccionCatalogo(p, "contabilidad", "calendario_crear")).toBe(true);
    expect(tieneAccionCatalogo(cambiarAccion(p, "contabilidad", "calendario_ver", false), "contabilidad", "calendario_crear")).toBe(false);
    for (const fila of PERMISOS_CONT_CALENDARIO) {
      expect(catalogoGlobalPermisos()).toContain(fila);
      expect(moduloEmpresaDelPermiso(fila)).toBe("contabilidad");
      for (const rol of ROLES.filter((r) => r !== "Admin")) {
        expect(modulosPropiosDelRol(rol)).not.toContain(fila);
        expect(tienePermiso(permisosDefaultPorRol(rol), fila, "ver")).toBe(false);
      }
    }
    expect(MODULOS).not.toContain("contabilidad_calendario_ver");
    expect(CATALOGO_PERMISOS.find((m) => m.id === "contabilidad")?.acciones.filter((a) => a.id.startsWith("calendario_")).every((a) => !a.legacy)).toBe(true);
  });
});
