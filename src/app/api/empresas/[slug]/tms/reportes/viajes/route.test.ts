import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/tms/reportes-viajes", () => ({
  obtenerReporteViajes: vi.fn(() => Promise.resolve([])),
  calcularKpisReporte: vi.fn(() => ({
    totalViajes: 0, cerrados: 0, pendientesCierre: 0, enRuta: 0, cancelados: 0,
    totalEvidencias: 0, totalKmRecorridos: 0, valorProgramado: 0, valorCerrado: 0, promedioIngresoPorViaje: 0,
  })),
  filtrosReporteDesdeUrl: vi.fn(() => ({})),
}));

import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { obtenerReporteViajes } from "@/lib/tms/reportes-viajes";
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

describe("GET /tms/reportes/viajes — lectura: mismo permiso que TMS/Programación, sin permiso nuevo", () => {
  it("11) exige permiso ANTES de tocar la DB", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(obtenerReporteViajes).not.toHaveBeenCalled();
  });

  it("responde 200 con planes y kpi del tenant del guard", async () => {
    const res = await GET(new Request("http://localhost/x?fechaDesde=2026-08-01"), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("planes");
    expect(data).toHaveProperty("kpi");
    expect(obtenerReporteViajes).toHaveBeenCalledWith(7, expect.anything());
  });
});
