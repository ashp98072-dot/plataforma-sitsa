import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("./empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("./permisos", async original => ({ ...await original<typeof import("./permisos")>(), permisosEfectivos: vi.fn() }));
import { getSession, createSessionToken, setSessionCookie } from "./session";
import { obtenerEmpresaPorSlug, empresasParaUsuario } from "./empresas";
import { permisosEfectivos } from "./permisos";
import { requireTenantFlotaCombustible } from "./tenant";
const empresa = { id: 7, slug: "kt", nombre: "KT", activa: true, modulos: ["tms"] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 3, rol: "JefeOperaciones", username: "op", empresaId: 7 } as never);
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa] as never);
  vi.mocked(permisosEfectivos).mockResolvedValue([{ modulo: "flota_combustible", puedeVer: true, puedeCrear: false, puedeEditar: true, puedeEliminar: false }]);
});
it("Operaciones conserva acciones legacy sin acceso completo a Flota", async () => {
  expect((await requireTenantFlotaCombustible("kt", "ver")).error).toBeUndefined();
  expect((await requireTenantFlotaCombustible("kt", "revisar")).error).toBeUndefined();
});
it("requiere permiso propio, no hereda autoridad de TMS", async () => {
  vi.mocked(permisosEfectivos).mockResolvedValue([{ modulo: "tms", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true }]);
  expect((await requireTenantFlotaCombustible("kt", "revisar")).error?.status).toBe(403);
});
it("ver no permite registrar/editar/revisar", async () => {
  vi.mocked(permisosEfectivos).mockResolvedValue([{ modulo: "flota_combustible", puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false }]);
  expect((await requireTenantFlotaCombustible("kt", "ver")).error).toBeUndefined();
  expect((await requireTenantFlotaCombustible("kt", "revisar")).error?.status).toBe(403);
});
it("empresa sin TMS no habilita combustibles por tener Flota", async () => {
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ ...empresa, modulos: ["flota"] } as never);
  expect((await requireTenantFlotaCombustible("kt", "ver")).error?.status).toBe(403);
});
it("Admin no puede cruzar empresa fuera de su acceso", async () => {
  vi.mocked(getSession).mockResolvedValue({ id: 3, rol: "Admin", empresaId: 7 } as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([]);
  expect((await requireTenantFlotaCombustible("kt", "revisar")).error?.status).toBe(403);
});
it("preview en otra empresa autorizada no cambia cookie ni objeto de sesión", async () => {
  const session = { id: 3, rol: "JefeOperaciones", username: "op", empresaId: 99 } as const;
  vi.mocked(getSession).mockResolvedValue(session as never);
  const g = await requireTenantFlotaCombustible("kt", "conciliar", { soloLectura: true });
  expect(g.error).toBeUndefined(); expect(g.empresa?.id).toBe(7);
  expect(session.empresaId).toBe(99);
  expect(createSessionToken).not.toHaveBeenCalled(); expect(setSessionCookie).not.toHaveBeenCalled();
});
it("guard histórico mantiene selección de empresa por defecto", async () => {
  const session = { id: 3, rol: "JefeOperaciones", username: "op", empresaId: 99 };
  vi.mocked(getSession).mockResolvedValue(session as never);
  vi.mocked(createSessionToken).mockResolvedValue("token-sintetico");
  expect((await requireTenantFlotaCombustible("kt", "conciliar")).error).toBeUndefined();
  expect(setSessionCookie).toHaveBeenCalledWith("token-sintetico"); expect(session.empresaId).toBe(7);
});
