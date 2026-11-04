import { beforeEach, describe, expect, it, vi } from "vitest";

// Se usa el requireTenantFacturacion REAL (sesión, empresa y permisos simulados) para verificar Admin y no Admin.
vi.mock("./../session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("./../empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("./../permisos", async (original) => ({ ...(await original<typeof import("../permisos")>()), permisosEfectivos: vi.fn() }));

const m = vi.hoisted(() => ({ listar: vi.fn(), exportar: vi.fn(), entidades: vi.fn() }));
vi.mock("@/lib/facturacion/antiguedad-cxc", async (original) => ({
  ...(await original<typeof import("./antiguedad-cxc")>()),
  listarAntiguedadCxc: m.listar,
  listarAntiguedadParaExportar: m.exportar,
}));
vi.mock("@/lib/facturacion/contexto-factura", () => ({ listarEntidadesEmisoras: m.entidades }));

import { getSession } from "../session";
import { obtenerEmpresaPorSlug, empresasParaUsuario } from "../empresas";
import { permisosEfectivos } from "../permisos";
import { ErrorAntiguedad } from "./antiguedad-cxc";
import { GET as getLista } from "../../app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/antiguedad/route";
import { GET as getExport } from "../../app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/antiguedad/export/route";

const empresa = { id: 7, slug: "kt", nombre: "KT", activa: true, modulos: ["contabilidad", "facturacion"] };
const fila = (modulo: string, v: boolean, e = false) => ({ modulo, puedeVer: v, puedeCrear: false, puedeEditar: e, puedeEliminar: false });
const ctx = { params: Promise.resolve({ slug: "kt" }) };
const req = (qs = "") => new Request(`http://x/api?${qs}`);
const vacia = { filas: [], totalReal: 0, page: 1, pageSize: 25, fechaCorte: "2026-11-30", totalesPorTramo: [], totalesPorMoneda: [], rotulo: "r" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 3, rol: "Contabilidad", username: "conta", empresaId: 7 } as never);
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa] as never);
  vi.mocked(permisosEfectivos).mockResolvedValue([fila("facturacion", true)] as never);
  m.listar.mockResolvedValue(vacia);
  m.exportar.mockResolvedValue({ ok: true, filas: [], totales: [], totalesPorMoneda: [], fechaCorte: "2026-11-30" });
  m.entidades.mockResolvedValue([]);
});

describe("MIL-CXC-ANT-01 · permisos y ámbito de las rutas", () => {
  it("no Admin con facturacion:ver: lista y exporta; la empresa sale de la sesión, no de la query", async () => {
    expect((await getLista(req("empresaId=999&entidad=sin&moneda=gtq"), ctx)).status).toBe(200);
    expect(m.listar).toHaveBeenCalledWith(7, { entidad: "sin", moneda: "GTQ" });
    expect((await getExport(req("empresa_id=999"), ctx)).status).toBe(200);
    expect(m.exportar).toHaveBeenCalledWith(7, {});
  });
  it("Admin de la empresa: permitido", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: 1, rol: "Admin", username: "root", empresaId: 7 } as never);
    expect((await getLista(req(), ctx)).status).toBe(200);
  });
  it("no Admin SIN permiso de Facturación (p. ej. solo CxC de Contabilidad): 403 y no consulta nada", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([fila("cxc_cuentas", true)] as never);
    expect((await getLista(req(), ctx)).status).toBe(403);
    expect((await getExport(req(), ctx)).status).toBe(403);
    expect(m.listar).not.toHaveBeenCalled();
    expect(m.exportar).not.toHaveBeenCalled();
  });
  it("empresa sin módulo Facturación (ni uno que lo derive): 403; Admin de otra empresa: 403", async () => {
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ ...empresa, modulos: ["rrhh"] } as never);
    expect((await getLista(req(), ctx)).status).toBe(403);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
    vi.mocked(getSession).mockResolvedValue({ id: 1, rol: "Admin", username: "root", empresaId: 7 } as never);
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);
    expect((await getLista(req(), ctx)).status).toBe(403);
    expect(m.listar).not.toHaveBeenCalled();
  });
  it("sin sesión: se rechaza", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    expect((await getLista(req(), ctx)).status).toBeGreaterThanOrEqual(401);
    expect(m.listar).not.toHaveBeenCalled();
  });
});

describe("MIL-CXC-ANT-01 · errores controlados", () => {
  it("MIGRACION_PENDIENTE → 503 con código (lista y exportación)", async () => {
    m.listar.mockRejectedValue(new ErrorAntiguedad("Esquema de cobros pendiente.", "MIGRACION_PENDIENTE", 503));
    m.exportar.mockRejectedValue(new ErrorAntiguedad("Esquema de cobros pendiente.", "MIGRACION_PENDIENTE", 503));
    for (const r of [await getLista(req(), ctx), await getExport(req(), ctx)]) {
      expect(r.status).toBe(503);
      expect((await r.json()).codigo).toBe("MIGRACION_PENDIENTE");
    }
  });
  it("error inesperado → 500 genérico sin detalles internos", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m.listar.mockRejectedValue(Object.assign(new Error("SELECT secreto FROM x"), { code: "ER_X" }));
    const r = await getLista(req(), ctx);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/secreto|SELECT/);
    spy.mockRestore();
  });
  it("exportación que excede el límite → 400 con mensaje", async () => {
    m.exportar.mockResolvedValue({ ok: false, error: "El filtro devuelve más de 20000 facturas." });
    expect((await getExport(req(), ctx)).status).toBe(400);
  });
  it("exportación OK: xlsx con cabeceras de descarga privadas", async () => {
    const r = await getExport(req(), ctx);
    expect(r.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(r.headers.get("Content-Disposition")).toContain("antiguedad-2026-11-30.xlsx");
  });
});
