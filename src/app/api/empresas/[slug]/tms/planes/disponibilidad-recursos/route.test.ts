import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/tms/disponibilidad-programacion-intervalos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/disponibilidad-programacion-intervalos")>();
  return { ...actual, listarOcupacionProgramacionIntervalo: vi.fn() };
});

import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarOcupacionProgramacionIntervalo } from "@/lib/tms/disponibilidad-programacion-intervalos";
import { GET } from "./route";

const ctx = () => ({ params: Promise.resolve({ slug: "kt-monaco" }) });
const url = (qs: string) => new Request(`http://x/api${qs}`);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: null, empresa: { id: 7 }, session: {} } as never);
  vi.mocked(listarOcupacionProgramacionIntervalo).mockResolvedValue({
    personal: new Map([[10, { planId: 1, planCodigo: "PLAN-000001", horaInicio: "", horaFin: null }]]),
    unidades: new Map([["P-123ABC", { planId: 2, planCodigo: "PLAN-000002", horaInicio: "", horaFin: null }]]),
    tcs: new Map([["TC-045", { planId: 3, planCodigo: "PLAN-000125", horaInicio: "", horaFin: null }]]),
  });
});

describe("GET /tms/planes/disponibilidad-recursos (A2.2: ventana = fecha + horaCarga + regresoEstimado)", () => {
  it("200: con hora y regreso consulta el intervalo; devuelve los mapas como objetos (contrato sin cambios)", async () => {
    const res = await GET(url("?fecha=2026-09-22&horaCarga=08:00&regresoEstimado=2026-09-22T11:00"), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.personal[10].planCodigo).toBe("PLAN-000001");
    expect(data.unidades["P-123ABC"].planCodigo).toBe("PLAN-000002");
    // PROGRAMACION-TC-CAJA-REMOLQUE-1: el TC viaja en su propio mapa, nunca mezclado con unidades.
    expect(data.tcs["TC-045"].planCodigo).toBe("PLAN-000125");
    expect(data.unidades["TC-045"]).toBeUndefined();
    expect(listarOcupacionProgramacionIntervalo).toHaveBeenCalledWith(7, { fechaPlan: "2026-09-22", horaCarga: "08:00", regresoEstimado: "2026-09-22T11:00" }, []);
  });

  it("sin horaCarga ni regreso: ventana sin extremos (el motor reserva todo el día)", async () => {
    await GET(url("?fecha=2026-09-22"), ctx());
    expect(listarOcupacionProgramacionIntervalo).toHaveBeenCalledWith(7, { fechaPlan: "2026-09-22", horaCarga: null, regresoEstimado: null }, []);
  });

  it("horaCarga SIN regreso: no se inventa una duración (regreso = null => reserva diaria en el motor)", async () => {
    await GET(url("?fecha=2026-09-22&horaCarga=08:00"), ctx());
    expect(listarOcupacionProgramacionIntervalo).toHaveBeenCalledWith(7, { fechaPlan: "2026-09-22", horaCarga: "08:00", regresoEstimado: null }, []);
  });

  it("regreso sin hora: se pasa tal cual; el motor lo trata como ventana incompleta (reserva diaria)", async () => {
    await GET(url("?fecha=2026-09-22&regresoEstimado=2026-09-22T11:00"), ctx());
    expect(listarOcupacionProgramacionIntervalo).toHaveBeenCalledWith(7, { fechaPlan: "2026-09-22", horaCarga: null, regresoEstimado: "2026-09-22T11:00" }, []);
  });

  it("excluirPlanId: se pasa como lista (edición — el propio plan no choca consigo mismo)", async () => {
    await GET(url("?fecha=2026-09-22&excluirPlanId=123"), ctx());
    expect(listarOcupacionProgramacionIntervalo).toHaveBeenCalledWith(7, expect.anything(), [123]);
  });

  it("400: fecha ausente, con formato inválido o inexistente en el calendario, sin consultar disponibilidad", async () => {
    for (const qs of ["", "?fecha=22-09-2026", "?fecha=2026/09/22", "?fecha=2026-13-40"]) {
      const res = await GET(url(qs), ctx());
      expect(res.status).toBe(400);
    }
    expect(listarOcupacionProgramacionIntervalo).not.toHaveBeenCalled();
  });

  it("400: horaCarga o regresoEstimado con formato inválido", async () => {
    expect((await GET(url("?fecha=2026-09-22&horaCarga=8am"), ctx())).status).toBe(400);
    expect((await GET(url("?fecha=2026-09-22&regresoEstimado=2026-09-22"), ctx())).status).toBe(400);
  });

  it("hora/regreso incoherentes (regreso <= carga): reserva diaria, nunca error 500", async () => {
    const res = await GET(url("?fecha=2026-09-22&horaCarga=08:00&regresoEstimado=2026-09-22T07:00"), ctx());
    expect(res.status).toBe(200);
    expect(listarOcupacionProgramacionIntervalo).toHaveBeenCalledWith(7, { fechaPlan: "2026-09-22", horaCarga: null, regresoEstimado: null }, []);
  });

  it("sin permiso: devuelve el error del guard y no consulta nada", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: new Response("{}", { status: 403 }) } as never);
    const res = await GET(url("?fecha=2026-09-22"), ctx());
    expect(res.status).toBe(403);
    expect(listarOcupacionProgramacionIntervalo).not.toHaveBeenCalled();
  });

  it("usa la empresa de la SESIÓN, nunca una que mande el cliente por querystring", async () => {
    await GET(url("?fecha=2026-09-22&empresaId=999"), ctx());
    expect(vi.mocked(listarOcupacionProgramacionIntervalo).mock.calls[0][0]).toBe(7);
  });
});
