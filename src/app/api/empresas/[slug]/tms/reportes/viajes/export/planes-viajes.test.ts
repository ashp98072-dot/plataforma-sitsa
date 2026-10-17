import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionExportar: vi.fn() }));
vi.mock("@/lib/tms/cuadrilla", () => ({ cuadrillaDePlanes: vi.fn() }));
vi.mock("@/lib/tms/reportes-viajes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tms/reportes-viajes")>()),
  obtenerReporteViajesParaExportar: vi.fn(),
}));

import { execute, getPool, query } from "@/lib/db";
import { requireTenantProgramacionExportar } from "@/lib/tenant";
import { cuadrillaDePlanes } from "@/lib/tms/cuadrilla";
import { obtenerReporteViajesParaExportar, type PlanReporte } from "@/lib/tms/reportes-viajes";
import { planFixture } from "@/lib/tms/planes-viajes-excel.fixture";
import { SHEET_PLANES_VIAJES } from "@/lib/tms/planes-viajes-excel";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const pedir = (qs: string) => GET(new Request(`http://localhost/x?formato=xlsx&vista=planes&${qs}`), ctx);
async function libro(res: Response) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb.getWorksheet(SHEET_PLANES_VIAJES)!;
}
const muchos = (n: number): PlanReporte[] => Array.from({ length: n }, (_, i) => planFixture({ id: i + 1, codigo: `PLAN-${String(i + 1).padStart(4, "0")}` }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionExportar).mockResolvedValue({ empresa: { id: 7, nombre: "SITSA" }, session: { id: 8, username: "ops1" } } as never);
  vi.mocked(obtenerReporteViajesParaExportar).mockResolvedValue({ ok: true, planes: [planFixture()] });
  vi.mocked(cuadrillaDePlanes).mockResolvedValue(new Map());
});

describe("Exportar Excel de Planes / Viajes — endpoint (server-side, todo el filtro)", () => {
  it("responde un .xlsx válido con el nombre planes-viajes_<hoy>.xlsx (o con el rango si hay Desde y Hasta)", async () => {
    const sin = await pedir("");
    expect(sin.status).toBe(200);
    expect(sin.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(sin.headers.get("Content-Disposition")).toMatch(/^attachment; filename="planes-viajes_\d{4}-\d{2}-\d{2}\.xlsx"$/);
    expect(sin.headers.get("Cache-Control")).toBe("private, no-store");
    const rango = await pedir("fechaDesde=2026-10-01&fechaHasta=2026-10-17");
    expect(rango.headers.get("Content-Disposition")).toBe('attachment; filename="planes-viajes_2026-10-01_al_2026-10-17.xlsx"');
    expect((await libro(rango)).rowCount).toBe(2);
  });

  it("exporta TODOS los viajes del filtro, no solo la página visible (sin page/pageSize; más de 200 filas)", async () => {
    vi.mocked(obtenerReporteViajesParaExportar).mockResolvedValue({ ok: true, planes: muchos(450) });
    const res = await pedir("page=2&pageSize=200");
    const ws = await libro(res);
    expect(ws.rowCount).toBe(451); // encabezado + 450 viajes: la paginación de la pantalla no recorta la exportación
    expect(ws.getRow(451).getCell(1).value).toBe("PLAN-0450");
    // El exportador (el MISMO que el listado, sin LIMIT de página) recibe solo filtros, nunca page/pageSize.
    const filtros = vi.mocked(obtenerReporteViajesParaExportar).mock.calls[0][1] as Record<string, unknown>;
    expect(filtros).not.toHaveProperty("page");
    expect(filtros).not.toHaveProperty("pageSize");
    expect(cuadrillaDePlanes).toHaveBeenCalledTimes(1); // 450 ids en lotes de 500
  });

  it("pasa TODOS los filtros de la pantalla (Desde, Hasta, Cliente, Piloto, Unidad, Estado, Ruta, Facturación, Cobro y pestañas) al exportador, con la empresa de la sesión", async () => {
    await pedir("fechaDesde=2026-10-01&fechaHasta=2026-10-17&clienteId=3&pilotoId=9&unidadId=4&estado=Cerrado&ruta=R-01&estadoFacturacion=Facturado&estadoCobro=Cobrado&soloPendientesCierre=1&soloCerrados=1&empresaId=99");
    const [empresaId, filtros] = vi.mocked(obtenerReporteViajesParaExportar).mock.calls[0];
    expect(empresaId).toBe(7); // la de la sesión; ?empresaId= se ignora
    expect(filtros).toMatchObject({
      fechaDesde: "2026-10-01", fechaHasta: "2026-10-17", clienteId: 3, pilotoId: 9, unidadId: 4, estado: "Cerrado", ruta: "R-01", estadoFacturacion: "Facturado", estadoCobro: "Cobrado",
      soloPendientesCierre: true, soloCerrados: true, soloSinCerrar: false,
    });
    await pedir("soloSinCerrar=1");
    expect(vi.mocked(obtenerReporteViajesParaExportar).mock.calls[1][1]).toMatchObject({ soloSinCerrar: true, soloCerrados: false });
  });

  it("incluye la cuadrilla leída de la BD (solo lectura) y tolera una instalación sin esa tabla", async () => {
    vi.mocked(cuadrillaDePlanes).mockResolvedValue(new Map([[1, [{ tipo: "EXTERNO", empleadoId: null, nombre: "Externo Uno", identificacion: null, telefono: null }]]]) as never);
    expect((await (await libro(await pedir(""))).getRow(2).getCell(10).value)).toBe("Externo Uno (externo)");
    vi.mocked(cuadrillaDePlanes).mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" }));
    const res = await pedir("");
    expect(res.status).toBe(200);
    expect((await libro(res)).getRow(2).getCell(10).value ?? "").toBe("");
  });

  it("respeta el límite de volumen del exportador: un filtro demasiado amplio responde 400 con el mensaje (nunca trunca)", async () => {
    vi.mocked(obtenerReporteViajesParaExportar).mockResolvedValue({ ok: false, error: "Acota el rango de fechas para exportar." });
    const res = await pedir("");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Acota el rango de fechas para exportar." });
  });

  it("exige permiso (programacion:exportar sobre ver) ANTES de leer nada", async () => {
    vi.mocked(requireTenantProgramacionExportar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    expect((await pedir("")).status).toBe(403);
    expect(obtenerReporteViajesParaExportar).not.toHaveBeenCalled();
    expect(cuadrillaDePlanes).not.toHaveBeenCalled();
  });

  it("exportar NO modifica ningún registro (ni escribe, ni abre transacciones)", async () => {
    await pedir("fechaDesde=2026-10-01&fechaHasta=2026-10-17");
    expect(execute).not.toHaveBeenCalled();
    expect(getPool).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled(); // el único acceso a datos son las dos lecturas mockeadas
  });

  it("el libro de Reportes (vista por defecto) NO cambia: sigue usando su exportador de siempre", async () => {
    const res = await GET(new Request("http://localhost/x?formato=xlsx"), ctx);
    expect(res.headers.get("Content-Disposition")).toMatch(/reporte-viajes-/);
  });
});
