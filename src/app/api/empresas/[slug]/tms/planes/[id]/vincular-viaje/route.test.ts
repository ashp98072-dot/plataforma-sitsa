import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/tms/vincular-viaje-plan", () => ({
  listarViajesCandidatosParaPlan: vi.fn(),
  vincularViajeAPlan: vi.fn(),
}));

import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarViajesCandidatosParaPlan, vincularViajeAPlan } from "@/lib/tms/vincular-viaje-plan";
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "30" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("PORTAL-HARDENING-2 (corrección final) — endpoint administrativo de vínculo manual", () => {
  it("GET exige programacion:editar O tms:editar antes de tocar la DB", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(requireTenantProgramacionOTms).toHaveBeenCalledWith("prueba", "editar");
    expect(listarViajesCandidatosParaPlan).not.toHaveBeenCalled();
  });

  it("GET devuelve los candidatos del plan del tenant del guard", async () => {
    vi.mocked(listarViajesCandidatosParaPlan).mockResolvedValue([{ viajeId: 5, horaSalida: "2026-08-27 07:00:00", placa: "C-034BXR" }]);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.candidatos).toHaveLength(1);
    expect(listarViajesCandidatosParaPlan).toHaveBeenCalledWith(7, 30);
  });

  it("POST exige permiso antes de tocar la DB", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>);
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ viajeId: 5 }) }),
      ctx,
    );
    expect(res.status).toBe(403);
    expect(vincularViajeAPlan).not.toHaveBeenCalled();
  });

  it("POST delega en vincularViajeAPlan con el usuario del guard y responde según su resultado", async () => {
    vi.mocked(vincularViajeAPlan).mockResolvedValue({ ok: true, planCodigo: "PLAN-1", evidenciasSincronizadas: 2 });
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ viajeId: 5 }) }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(vincularViajeAPlan).toHaveBeenCalledWith(7, 30, 5, "ops1");
    const data = await res.json();
    expect(data.mensaje).toContain("PLAN-1");
    expect(data.mensaje).toContain("2 evidencia");
  });

  it("POST propaga el status de error de vincularViajeAPlan (p.ej. 409)", async () => {
    vi.mocked(vincularViajeAPlan).mockResolvedValue({ ok: false, error: "Este viaje ya está vinculado a un plan.", status: 409 });
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ viajeId: 5 }) }),
      ctx,
    );
    expect(res.status).toBe(409);
  });

  it("POST rechaza payload sin viajeId antes de llamar a vincularViajeAPlan", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({}) }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(vincularViajeAPlan).not.toHaveBeenCalled();
  });
});
