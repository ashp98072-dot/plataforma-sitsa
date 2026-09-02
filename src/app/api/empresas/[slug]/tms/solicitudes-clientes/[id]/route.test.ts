import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({
  requireTenantProgramacion: vi.fn(),
  requireTenantProgramacionOTms: vi.fn(),
}));
vi.mock("@/lib/tms/solicitudes-cliente-operaciones", () => ({
  obtenerSolicitudClienteInterno: vi.fn(),
  rechazarSolicitud: vi.fn(),
  tomarEnRevisionSolicitud: vi.fn(),
}));

import { requireTenantProgramacion, requireTenantProgramacionOTms } from "@/lib/tenant";
import {
  obtenerSolicitudClienteInterno,
  rechazarSolicitud,
  tomarEnRevisionSolicitud,
} from "@/lib/tms/solicitudes-cliente-operaciones";
import { GET, PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco", id: "500" }) };

function patchReq(body: unknown) {
  return new Request("http://localhost", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({
    empresa: { id: 7 },
  } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>);
  vi.mocked(requireTenantProgramacion).mockResolvedValue({
    empresa: { id: 7 },
    session: { username: "operador1" },
  } as Awaited<ReturnType<typeof requireTenantProgramacion>>);
});

describe("GET /api/empresas/[slug]/tms/solicitudes-clientes/[id]", () => {
  it("IDOR: solicitud de otro tenant (dominio devuelve null) → 404", async () => {
    vi.mocked(obtenerSolicitudClienteInterno).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost"), ctx);
    expect(res.status).toBe(404);
    expect(obtenerSolicitudClienteInterno).toHaveBeenCalledWith(7, 500);
  });

  it("propia empresa → 200", async () => {
    vi.mocked(obtenerSolicitudClienteInterno).mockResolvedValue({ id: 500 } as never);
    const res = await GET(new Request("http://localhost"), ctx);
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/empresas/[slug]/tms/solicitudes-clientes/[id]", () => {
  it("exige requireTenantProgramacion('editar') antes de mutar", async () => {
    vi.mocked(requireTenantProgramacion).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantProgramacion>>);
    const res = await PATCH(patchReq({ accion: "revisar", version: 1 }), ctx);
    expect(res.status).toBe(403);
    expect(tomarEnRevisionSolicitud).not.toHaveBeenCalled();
  });

  it("accion=revisar delega con empresaId del guard + usuario de sesión", async () => {
    vi.mocked(tomarEnRevisionSolicitud).mockResolvedValue({ ok: true });
    const res = await PATCH(patchReq({ accion: "revisar", version: 3 }), ctx);
    expect(res.status).toBe(200);
    expect(tomarEnRevisionSolicitud).toHaveBeenCalledWith(7, 500, 3, "operador1");
  });

  it("accion=revisar conflicto → status mapeado desde el dominio (409)", async () => {
    vi.mocked(tomarEnRevisionSolicitud).mockResolvedValue({
      ok: false,
      status: 409,
      mensaje: "conflicto",
    });
    const res = await PATCH(patchReq({ accion: "revisar", version: 1 }), ctx);
    expect(res.status).toBe(409);
  });

  it("accion=rechazar sin motivo → 400 (zod), no llega al dominio", async () => {
    const res = await PATCH(patchReq({ accion: "rechazar", version: 1, motivo: "" }), ctx);
    expect(res.status).toBe(400);
    expect(rechazarSolicitud).not.toHaveBeenCalled();
  });

  it("accion=rechazar solicitud ajena → 404 (mapeado desde el dominio)", async () => {
    vi.mocked(rechazarSolicitud).mockResolvedValue({
      ok: false,
      status: 404,
      mensaje: "Solicitud no encontrada.",
    });
    const res = await PATCH(
      patchReq({ accion: "rechazar", version: 1, motivo: "Motivo suficientemente largo" }),
      ctx,
    );
    expect(res.status).toBe(404);
  });
});
