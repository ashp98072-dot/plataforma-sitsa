import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("./empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("./permisos", async (original) => ({ ...(await original<typeof import("./permisos")>()), permisosEfectivos: vi.fn() }));
import { getSession } from "./session";
import { obtenerEmpresaPorSlug, empresasParaUsuario } from "./empresas";
import { permisosEfectivos } from "./permisos";
import { requireTenantContReporte, requireTenantCxc, requireTenantModulo } from "./tenant";

const empresa = { id: 7, slug: "kt", nombre: "KT", activa: true, modulos: ["contabilidad"] };
const fila = (modulo: string, v: boolean) => ({ modulo, puedeVer: v, puedeCrear: false, puedeEditar: false, puedeEliminar: false });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 3, rol: "Contabilidad", username: "conta", empresaId: 7 } as never);
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa] as never);
});

describe("permisos de reportes contables (M-4)", () => {
  it("cada reporte exige SU fila: ver Diario no concede Mayor ni Balance", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("contabilidad_diario", true)]);
    expect((await requireTenantContReporte("kt", "contabilidad_diario")).error).toBeUndefined();
    expect((await requireTenantContReporte("kt", "contabilidad_mayor")).error?.status).toBe(403);
    expect((await requireTenantContReporte("kt", "contabilidad_balance")).error?.status).toBe(403);
  });
  it("el permiso general de Contabilidad (y CxC) NO abre los reportes; los reportes no abren CxC ni escriben asientos", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("contabilidad", true), fila("cxc_cuentas", true)]);
    for (const f of ["contabilidad_diario", "contabilidad_mayor", "contabilidad_balance"] as const) expect((await requireTenantContReporte("kt", f)).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("contabilidad_diario", true), fila("contabilidad_mayor", true), fila("contabilidad_balance", true)]);
    expect((await requireTenantCxc("kt", "cxc_cuentas", "ver")).error?.status).toBe(403);
    expect((await requireTenantModulo("kt", "contabilidad", true)).error?.status).toBe(403);
  });
  it("sin permisos propios se niega; la empresa debe tener Contabilidad; Admin pasa; otra empresa no", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([]);
    expect((await requireTenantContReporte("kt", "contabilidad_balance")).error?.status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("contabilidad_balance", true)]);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ ...empresa, modulos: ["facturacion"] } as never);
    expect((await requireTenantContReporte("kt", "contabilidad_balance")).error?.status).toBe(403);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
    vi.mocked(getSession).mockResolvedValue({ id: 1, rol: "Admin", username: "root", empresaId: 7 } as never);
    expect((await requireTenantContReporte("kt", "contabilidad_mayor")).error).toBeUndefined();
    vi.mocked(empresasParaUsuario).mockResolvedValue([] as never);
    expect((await requireTenantContReporte("kt", "contabilidad_mayor")).error?.status).toBe(403);
  });
});
