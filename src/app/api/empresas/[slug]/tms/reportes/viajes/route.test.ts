import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/tms/reportes-viajes", () => ({
  obtenerReporteViajes: vi.fn(() => Promise.resolve([])),
  obtenerKpisReporte: vi.fn(() => Promise.resolve({
    totalViajes: 0, cerrados: 0, pendientesCierre: 0, enRuta: 0, cancelados: 0,
    totalEvidencias: 0, totalKmRecorridos: 0, valorProgramado: 0, valorCerrado: 0, promedioIngresoPorViaje: 0,
  })),
  contarReporteViajes: vi.fn(() => Promise.resolve(0)),
  filtrosReporteDesdeUrl: vi.fn(() => ({})),
  LIMITE_PAGINA_DEFECTO: 200,
  LIMITE_PAGINA_MAXIMO: 500,
}));

import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { contarReporteViajes, obtenerKpisReporte, obtenerReporteViajes } from "@/lib/tms/reportes-viajes";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue(
    { empresa: { id: 7, nombre: "SITSA" }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>,
  );
  vi.mocked(obtenerReporteViajes).mockResolvedValue([]);
  vi.mocked(contarReporteViajes).mockResolvedValue(0);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tms/reportes/viajes — lectura: mismo permiso que TMS/Programación, sin permiso nuevo", () => {
  it("11) exige permiso ANTES de tocar la DB", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(obtenerReporteViajes).not.toHaveBeenCalled();
  });

  it("responde 200 con planes, kpi y totalReal del tenant del guard", async () => {
    vi.mocked(contarReporteViajes).mockResolvedValue(350);
    const res = await GET(new Request("http://localhost/x?fechaDesde=2026-08-01"), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("planes");
    expect(data).toHaveProperty("kpi");
    expect(data.totalReal).toBe(350);
    expect(obtenerReporteViajes).toHaveBeenCalledWith(7, expect.anything(), expect.anything());
    expect(obtenerKpisReporte).toHaveBeenCalledWith(7, expect.anything());
  });
});

describe("[HALLAZGO 3] paginación server-side", () => {
  it("1) pagina el listado con page/pageSize por defecto (page=1, pageSize=200 → offset=0)", async () => {
    await GET(new Request("http://localhost/x"), ctx);
    expect(obtenerReporteViajes).toHaveBeenCalledWith(7, expect.anything(), { limit: 200, offset: 0 });
  });

  it("respeta page/pageSize explícitos en la URL", async () => {
    await GET(new Request("http://localhost/x?page=3&pageSize=50"), ctx);
    expect(obtenerReporteViajes).toHaveBeenCalledWith(7, expect.anything(), { limit: 50, offset: 100 });
  });

  it("nunca deja que pageSize exceda el máximo permitido", async () => {
    await GET(new Request("http://localhost/x?pageSize=99999"), ctx);
    expect(obtenerReporteViajes).toHaveBeenCalledWith(7, expect.anything(), { limit: 500, offset: 0 });
  });

  it("2/3) totalReal y KPI vienen de consultas SEPARADAS del listado paginado — pueden reflejar más de lo que trae la página", async () => {
    vi.mocked(contarReporteViajes).mockResolvedValue(9000);
    vi.mocked(obtenerKpisReporte).mockResolvedValue({
      totalViajes: 9000, cerrados: 8000, pendientesCierre: 100, enRuta: 500, cancelados: 400,
      totalEvidencias: 20000, totalKmRecorridos: 999999, valorProgramado: 1000000, valorCerrado: 900000, promedioIngresoPorViaje: 111,
    });
    vi.mocked(obtenerReporteViajes).mockResolvedValue([{ id: 1 }] as unknown as Awaited<ReturnType<typeof obtenerReporteViajes>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    const data = await res.json();
    expect(data.planes).toHaveLength(1); // la página trae poco
    expect(data.totalReal).toBe(9000); // pero el total real es correcto
    expect(data.kpi.totalViajes).toBe(9000); // y el KPI también, sin depender de la página
  });
});
