import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/tms/disponibilidad-recursos-lista", () => ({
  listarConflictosPersonal: vi.fn(),
  listarConflictosUnidades: vi.fn(),
}));

import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarConflictosPersonal, listarConflictosUnidades } from "@/lib/tms/disponibilidad-recursos-lista";
import { GET } from "./route";

const ctx = () => ({ params: Promise.resolve({ slug: "kt-monaco" }) });
const url = (qs: string) => new Request(`http://x/api${qs}`);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: null, empresa: { id: 7 }, session: {} } as never);
  vi.mocked(listarConflictosPersonal).mockResolvedValue(new Map([[10, { planId: 1, planCodigo: "PLAN-000001", horaInicio: "2026-09-22 08:00:00", horaFin: "2026-09-22 11:00:00" }]]));
  vi.mocked(listarConflictosUnidades).mockResolvedValue(new Map([["P-123ABC", { planId: 2, planCodigo: "PLAN-000002", horaInicio: "2026-09-22 09:00:00", horaFin: null }]]));
});

describe("GET /tms/planes/disponibilidad-recursos", () => {
  it("200: arma el intervalo desde fecha+horaCarga+regresoEstimado y devuelve personal/unidades como objetos planos", async () => {
    const res = await GET(url("?fecha=2026-09-22&horaCarga=08:00&regresoEstimado=2026-09-22T11:00"), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.personal).toEqual({ 10: { planId: 1, planCodigo: "PLAN-000001", horaInicio: "2026-09-22 08:00:00", horaFin: "2026-09-22 11:00:00" } });
    expect(data.unidades).toEqual({ "P-123ABC": { planId: 2, planCodigo: "PLAN-000002", horaInicio: "2026-09-22 09:00:00", horaFin: null } });
    expect(listarConflictosPersonal).toHaveBeenCalledWith(7, { inicio: "2026-09-22 08:00:00", fin: "2026-09-22 11:00:00" }, null);
    expect(listarConflictosUnidades).toHaveBeenCalledWith(7, { inicio: "2026-09-22 08:00:00", fin: "2026-09-22 11:00:00" }, null);
  });

  it("sin horaCarga: inicio cae a 00:00:00 (mismo criterio que inicioViaje)", async () => {
    await GET(url("?fecha=2026-09-22"), ctx());
    expect(listarConflictosPersonal).toHaveBeenCalledWith(7, { inicio: "2026-09-22 00:00:00", fin: null }, null);
  });

  it("excluirPlanId: se pasa como número a ambas funciones (edición — el propio plan nunca choca consigo mismo)", async () => {
    await GET(url("?fecha=2026-09-22&excluirPlanId=123"), ctx());
    expect(listarConflictosPersonal).toHaveBeenCalledWith(7, expect.anything(), 123);
    expect(listarConflictosUnidades).toHaveBeenCalledWith(7, expect.anything(), 123);
  });

  it("400: fecha ausente o con formato inválido (mismo criterio de forma que el resto de la API — no valida calendario), sin consultar disponibilidad", async () => {
    for (const qs of ["", "?fecha=22-09-2026", "?fecha=2026/09/22"]) {
      const res = await GET(url(qs), ctx());
      expect(res.status).toBe(400);
    }
    expect(listarConflictosPersonal).not.toHaveBeenCalled();
  });

  it("400: horaCarga o regresoEstimado con formato inválido", async () => {
    expect((await GET(url("?fecha=2026-09-22&horaCarga=8am"), ctx())).status).toBe(400);
    expect((await GET(url("?fecha=2026-09-22&regresoEstimado=2026-09-22"), ctx())).status).toBe(400);
  });

  it("sin permiso: devuelve el error del guard y no consulta nada", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: new Response("{}", { status: 403 }) } as never);
    const res = await GET(url("?fecha=2026-09-22"), ctx());
    expect(res.status).toBe(403);
    expect(listarConflictosPersonal).not.toHaveBeenCalled();
  });

  it("usa la empresa de la SESIÓN, nunca una que mande el cliente por querystring", async () => {
    await GET(url("?fecha=2026-09-22&empresaId=999"), ctx());
    expect(listarConflictosPersonal).toHaveBeenCalledWith(7, expect.anything(), null);
  });
});
