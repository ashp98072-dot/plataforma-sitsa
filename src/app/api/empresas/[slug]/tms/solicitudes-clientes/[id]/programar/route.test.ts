import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn() }));
vi.mock("@/lib/tms/solicitudes-cliente-operaciones", () => ({ programarSolicitud: vi.fn() }));

import { requireTenantProgramacion } from "@/lib/tenant";
import { programarSolicitud } from "@/lib/tms/solicitudes-cliente-operaciones";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco", id: "500" }) };

function req(body: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacion).mockResolvedValue({
    empresa: { id: 7 },
    session: { username: "operador1" },
  } as Awaited<ReturnType<typeof requireTenantProgramacion>>);
});

describe("POST /api/empresas/[slug]/tms/solicitudes-clientes/[id]/programar", () => {
  it("exige requireTenantProgramacion('crear')", async () => {
    vi.mocked(requireTenantProgramacion).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantProgramacion>>);
    const res = await POST(req({ version: 3 }), ctx);
    expect(res.status).toBe(403);
    expect(programarSolicitud).not.toHaveBeenCalled();
  });

  it("delega con empresaId del guard, solicitudId de la URL y usuario de sesión", async () => {
    vi.mocked(programarSolicitud).mockResolvedValue({ ok: true, planId: 900, planCodigo: "PLAN-1" });
    const res = await POST(req({ version: 3, vehiculoSolicitadoPerfilId: 11, empresaId: 99 }), ctx);
    expect(res.status).toBe(200);
    expect(programarSolicitud).toHaveBeenCalledWith(7, 500, 3, "operador1", 11);
    const data = await res.json();
    expect(data.planId).toBe(900);
    expect(data.planCodigo).toBe("PLAN-1");
  });

  it("VEHÍCULO SOLICITADO: sin él el dominio responde 400 con el mensaje (la ruta lo traduce tal cual)", async () => {
    vi.mocked(programarSolicitud).mockResolvedValue({ ok: false, status: 400, mensaje: "Selecciona el vehículo solicitado por el cliente." });
    const res = await POST(req({ version: 3 }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Selecciona el vehículo solicitado por el cliente.");
    expect(programarSolicitud).toHaveBeenCalledWith(7, 500, 3, "operador1", undefined);
  });

  it("VEHÍCULO SOLICITADO: un valor no numérico/negativo se rechaza en el esquema", async () => {
    for (const v of ["11", -1, 0, 1.5]) expect((await POST(req({ version: 3, vehiculoSolicitadoPerfilId: v }), ctx)).status).toBe(400);
    expect(programarSolicitud).not.toHaveBeenCalled();
  });

  it("solicitud ya programada (doble clic) → 409 mapeado desde el dominio, mensaje exacto", async () => {
    vi.mocked(programarSolicitud).mockResolvedValue({
      ok: false,
      status: 409,
      mensaje: "La solicitud ya fue programada.",
    });
    const res = await POST(req({ version: 3 }), ctx);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("La solicitud ya fue programada.");
  });

  it("solicitud ajena → 404", async () => {
    vi.mocked(programarSolicitud).mockResolvedValue({
      ok: false,
      status: 404,
      mensaje: "Solicitud no encontrada.",
    });
    const res = await POST(req({ version: 3 }), ctx);
    expect(res.status).toBe(404);
  });
});
