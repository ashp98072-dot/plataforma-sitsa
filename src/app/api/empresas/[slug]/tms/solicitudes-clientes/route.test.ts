import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/tms/solicitudes-cliente-operaciones", () => ({
  listarSolicitudesClienteInterno: vi.fn(),
}));

import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarSolicitudesClienteInterno } from "@/lib/tms/solicitudes-cliente-operaciones";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({
    empresa: { id: 7 },
  } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>);
});

describe("GET /api/empresas/[slug]/tms/solicitudes-clientes", () => {
  it("exige acceso (programacion:ver O tms:ver) antes de consultar", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>);
    const res = await GET(new Request("http://localhost"), ctx);
    expect(res.status).toBe(403);
    expect(listarSolicitudesClienteInterno).not.toHaveBeenCalled();
  });

  it("lista con el empresaId del guard, nunca de un query param", async () => {
    vi.mocked(listarSolicitudesClienteInterno).mockResolvedValue([]);
    await GET(
      new Request("http://localhost?empresaId=999&estado=EN_REVISION&clienteId=30"),
      ctx,
    );
    expect(listarSolicitudesClienteInterno).toHaveBeenCalledWith(7, {
      estado: "EN_REVISION",
      clienteId: 30,
      fechaDesde: undefined,
      fechaHasta: undefined,
    });
  });
});
