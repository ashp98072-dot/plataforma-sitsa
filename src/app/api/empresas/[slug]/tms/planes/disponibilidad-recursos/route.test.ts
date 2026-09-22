import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/tms/disponibilidad-programacion-dia", () => ({ listarDisponibilidadProgramacionDia: vi.fn() }));

import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarDisponibilidadProgramacionDia } from "@/lib/tms/disponibilidad-programacion-dia";
import { GET } from "./route";

const ctx = () => ({ params: Promise.resolve({ slug: "kt-monaco" }) });
const url = (qs: string) => new Request(`http://x/api${qs}`);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: null, empresa: { id: 7 }, session: {} } as never);
  vi.mocked(listarDisponibilidadProgramacionDia).mockResolvedValue({
    personal: new Map([[10, { planId: 1, planCodigo: "PLAN-000001", horaInicio: "", horaFin: null }]]),
    unidades: new Map([["P-123ABC", { planId: 2, planCodigo: "PLAN-000002", horaInicio: "", horaFin: null }]]),
  });
});

describe("GET /tms/planes/disponibilidad-recursos", () => {
  it("200: usa solo la fecha aunque se envíen horas y devuelve los mapas como objetos", async () => {
    const res = await GET(url("?fecha=2026-09-22&horaCarga=08:00&regresoEstimado=2026-09-22T11:00"), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.personal[10].planCodigo).toBe("PLAN-000001");
    expect(data.unidades["P-123ABC"].planCodigo).toBe("PLAN-000002");
    expect(listarDisponibilidadProgramacionDia).toHaveBeenCalledWith(7, "2026-09-22", null);
  });

  it("sin horaCarga: conserva la misma consulta por fecha", async () => {
    await GET(url("?fecha=2026-09-22"), ctx());
    expect(listarDisponibilidadProgramacionDia).toHaveBeenCalledWith(7, "2026-09-22", null);
  });

  it("excluirPlanId: se pasa como número (edición — el propio plan no choca consigo mismo)", async () => {
    await GET(url("?fecha=2026-09-22&excluirPlanId=123"), ctx());
    expect(listarDisponibilidadProgramacionDia).toHaveBeenCalledWith(7, "2026-09-22", 123);
  });

  it("400: fecha ausente o con formato inválido (mismo criterio de forma que el resto de la API — no valida calendario), sin consultar disponibilidad", async () => {
    for (const qs of ["", "?fecha=22-09-2026", "?fecha=2026/09/22"]) {
      const res = await GET(url(qs), ctx());
      expect(res.status).toBe(400);
    }
    expect(listarDisponibilidadProgramacionDia).not.toHaveBeenCalled();
  });

  it("400: horaCarga o regresoEstimado con formato inválido", async () => {
    expect((await GET(url("?fecha=2026-09-22&horaCarga=8am"), ctx())).status).toBe(400);
    expect((await GET(url("?fecha=2026-09-22&regresoEstimado=2026-09-22"), ctx())).status).toBe(400);
  });

  it("sin permiso: devuelve el error del guard y no consulta nada", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: new Response("{}", { status: 403 }) } as never);
    const res = await GET(url("?fecha=2026-09-22"), ctx());
    expect(res.status).toBe(403);
    expect(listarDisponibilidadProgramacionDia).not.toHaveBeenCalled();
  });

  it("usa la empresa de la SESIÓN, nunca una que mande el cliente por querystring", async () => {
    await GET(url("?fecha=2026-09-22&empresaId=999"), ctx());
    expect(listarDisponibilidadProgramacionDia).toHaveBeenCalledWith(7, "2026-09-22", null);
  });
});
