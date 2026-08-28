import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/tms/reportes-viajes", () => ({
  obtenerReporteViajes: vi.fn(() => Promise.resolve([])),
  calcularKpisReporte: vi.fn(() => ({
    totalViajes: 0, cerrados: 0, pendientesCierre: 0, enRuta: 0, cancelados: 0,
    totalEvidencias: 0, totalKmRecorridos: 0, valorProgramado: 0, valorCerrado: 0, promedioIngresoPorViaje: 0,
  })),
  filtrosReporteDesdeUrl: vi.fn((url: URL) => ({
    fechaDesde: url.searchParams.get("fechaDesde") ?? undefined,
    estado: url.searchParams.get("estado") ?? undefined,
  })),
}));
vi.mock("@/lib/rrhh/export-files", () => ({
  tablaAExcel: vi.fn(() => Promise.resolve(Buffer.from("xlsx"))),
  tablaAPdf: vi.fn(() => Promise.resolve(Buffer.from("pdf"))),
}));

import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { filtrosReporteDesdeUrl, obtenerReporteViajes } from "@/lib/tms/reportes-viajes";
import { tablaAExcel, tablaAPdf } from "@/lib/rrhh/export-files";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue(
    { empresa: { id: 7, nombre: "SITSA" }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>,
  );
  vi.mocked(obtenerReporteViajes).mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tms/reportes/viajes/export — 14) recibe y aplica los MISMOS filtros que el listado", () => {
  it("exige permiso antes de generar el archivo", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>);
    const res = await GET(new Request("http://localhost/x?formato=xlsx"), ctx);
    expect(res.status).toBe(403);
    expect(obtenerReporteViajes).not.toHaveBeenCalled();
  });

  it("usa filtrosReporteDesdeUrl (la MISMA función que el listado) para parsear los filtros, y los pasa a obtenerReporteViajes", async () => {
    const res = await GET(new Request("http://localhost/x?formato=xlsx&fechaDesde=2026-08-01&estado=Cerrado"), ctx);
    expect(res.status).toBe(200);
    expect(filtrosReporteDesdeUrl).toHaveBeenCalledTimes(1);
    expect(obtenerReporteViajes).toHaveBeenCalledWith(7, { fechaDesde: "2026-08-01", estado: "Cerrado" });
  });

  it('formato=xlsx genera Excel (Content-Type xlsx) reutilizando tablaAExcel', async () => {
    const res = await GET(new Request("http://localhost/x?formato=xlsx"), ctx);
    expect(tablaAExcel).toHaveBeenCalledTimes(1);
    expect(tablaAPdf).not.toHaveBeenCalled();
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
  });

  it("formato=pdf genera PDF reutilizando tablaAPdf", async () => {
    const res = await GET(new Request("http://localhost/x?formato=pdf"), ctx);
    expect(tablaAPdf).toHaveBeenCalledTimes(1);
    expect(tablaAExcel).not.toHaveBeenCalled();
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });
});
