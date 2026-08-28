import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/empresas", () => ({ empresasParaUsuario: vi.fn(), obtenerEmpresaPorSlug: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("@/lib/permisos", async () => ({ ...await vi.importActual("@/lib/permisos-shared"), permisosEfectivos: vi.fn() }));
import { empresasParaUsuario, obtenerEmpresaPorSlug } from "@/lib/empresas";
import { getSession } from "@/lib/session";
import { permisosEfectivos, permisosDefaultPorRol } from "@/lib/permisos";
import { requireTenantModulo } from "@/lib/tenant";
const permisos = (crear = false, editar = false, ver = true) => [{ modulo: "contabilidad", puedeVer: ver, puedeCrear: crear, puedeEditar: editar, puedeEliminar: false }];
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 1, username: "prueba", rol: "Contabilidad", empresaId: 7 });
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ id: 7, activa: true, modulos: ["contabilidad", "rrhh"] } as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([{ id: 7 }] as never);
  vi.mocked(permisosEfectivos).mockResolvedValue(permisos());
});
it("rol Contabilidad con solo lectura puede consultar pero no escribir", async () => {
  expect((await requireTenantModulo("prueba", "contabilidad")).error).toBeUndefined();
  expect((await requireTenantModulo("prueba", "contabilidad", true)).error?.status).toBe(403);
});
it.each([[true, false], [false, true]])("conserva escritura explícita crear=%s editar=%s", async (crear, editar) => {
  vi.mocked(permisosEfectivos).mockResolvedValue(permisos(crear, editar));
  expect((await requireTenantModulo("prueba", "contabilidad", true)).error).toBeUndefined();
});
it("conserva los permisos predeterminados del rol", async () => {
  vi.mocked(permisosEfectivos).mockResolvedValue(permisosDefaultPorRol("Contabilidad"));
  expect((await requireTenantModulo("prueba", "contabilidad", true)).error).toBeUndefined();
});
it("revocación total bloquea lectura", async () => {
  vi.mocked(permisosEfectivos).mockResolvedValue(permisos(false, false, false));
  expect((await requireTenantModulo("prueba", "contabilidad")).error?.status).toBe(403);
});
it("sin sesión o sin empresa autorizada no permite acceder", async () => {
  vi.mocked(empresasParaUsuario).mockResolvedValue([]);
  expect((await requireTenantModulo("prueba", "contabilidad", true)).error?.status).toBe(403);
  vi.mocked(getSession).mockResolvedValue(null);
  expect((await requireTenantModulo("prueba", "contabilidad")).error?.status).toBe(401);
});
it("Admin conserva acceso", async () => {
  vi.mocked(getSession).mockResolvedValue({ id: 1, username: "admin", rol: "Admin", empresaId: 7 });
  expect((await requireTenantModulo("prueba", "contabilidad", true)).error).toBeUndefined();
});
it("no cambia la autorización existente de otro módulo", async () => {
  vi.mocked(getSession).mockResolvedValue({ id: 1, username: "rrhh", rol: "RRHH", empresaId: 7 });
  vi.mocked(permisosEfectivos).mockResolvedValue([]);
  expect((await requireTenantModulo("prueba", "rrhh", true)).error).toBeUndefined();
});
