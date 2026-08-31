import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/empresas", () => ({ empresasParaUsuario: vi.fn(), obtenerEmpresaPorSlug: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/permisos", async () => ({ ...await vi.importActual("@/lib/permisos-shared"), permisosEfectivos: vi.fn() }));
import { empresasParaUsuario, obtenerEmpresaPorSlug } from "@/lib/empresas";
import { getSession } from "@/lib/session";
import { permisosEfectivos, permisosDefaultPorRol } from "@/lib/permisos";
import { requireTenantModulo } from "@/lib/tenant";
import { getPool } from "@/lib/db";
import { GET, POST } from "@/app/api/empresas/[slug]/contabilidad/asientos/route";
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
it("API permite leer ambos libros sin asignaciones secundarias, pero no crear", async () => {
  const conn = { query: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM empresas")) return [[{ id: 7 }]];
    if (sql.includes("FROM cont_entidades")) return [[{ id: 9, activa: 1 }]];
    if (sql.includes("cont_entidad_usuarios")) throw new Error("No debe consultar permisos duplicados");
    return [[]];
  });
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as never);
  const ctx = { params: Promise.resolve({ slug: "prueba" }) };
  for (const entidad of [9, 10]) {
    expect((await GET(new Request(`https://local.test/?entidad=${entidad}`), ctx)).status).toBe(200);
    expect(conn.query).toHaveBeenCalledWith(expect.stringContaining("FROM cont_entidades"), [7, entidad]);
    expect((await POST(new Request(`https://local.test/?entidad=${entidad}`, { method: "POST", body: "{}" }), ctx)).status).toBe(403);
  }
  vi.mocked(permisosEfectivos).mockResolvedValue(permisos(false, false, false));
  const llamadas = conn.query.mock.calls.length;
  expect((await GET(new Request("https://local.test/?entidad=9"), ctx)).status).toBe(403);
  expect(conn.query).toHaveBeenCalledTimes(llamadas);
});
