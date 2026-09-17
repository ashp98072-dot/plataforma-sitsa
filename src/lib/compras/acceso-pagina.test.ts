import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), empresas: vi.fn(), empresa: vi.fn(), permisos: vi.fn(), tenant: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/empresas", () => ({ empresasParaUsuario: mocks.empresas, obtenerEmpresaPorSlug: mocks.empresa }));
vi.mock("@/lib/tenant", () => ({ requireTenant: mocks.tenant }));
vi.mock("@/lib/permisos", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/permisos")>(), permisosEfectivos: mocks.permisos }));
import { obtenerAccesoComprasPagina } from "./acceso";
beforeEach(() => {
  vi.resetAllMocks(); mocks.session.mockResolvedValue({ id: 8, rol: "Operaciones", empresaId: 2 });
  mocks.empresa.mockResolvedValue({ id: 1, activa: true, modulos: ["tms"] }); mocks.empresas.mockResolvedValue([{ id: 1 }]);
  mocks.permisos.mockResolvedValue([{ modulo: "compras_proveedores", puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false }]);
});
it("cambio tenant en página no intenta renovar cookie de sesión", async () => {
  const guard = await obtenerAccesoComprasPagina("a"); expect(guard.error).toBeUndefined(); if (guard.error) throw new Error("Acceso inesperadamente rechazado"); expect(guard.empresa.id).toBe(1); expect(mocks.tenant).not.toHaveBeenCalled(); expect(mocks.permisos).toHaveBeenCalledOnce();
});
it.each([null, { id: 8, rol: "Operaciones" }])("sin sesión o sin acceso tenant no abre página", async session => {
  mocks.session.mockResolvedValue(session); mocks.empresas.mockResolvedValue([{ id: 2 }]); expect((await obtenerAccesoComprasPagina("a")).error?.status).toBe(session ? 403 : 401);
});
it("empresa inactiva y falta de permiso propio rechazan", async () => {
  mocks.empresa.mockResolvedValue({ id: 1, activa: false, modulos: ["tms"] }); expect((await obtenerAccesoComprasPagina("a")).error?.status).toBe(403);
  mocks.empresa.mockResolvedValue({ id: 1, activa: true, modulos: ["tms"] }); mocks.permisos.mockResolvedValue([]); expect((await obtenerAccesoComprasPagina("a")).error?.status).toBe(403);
});
