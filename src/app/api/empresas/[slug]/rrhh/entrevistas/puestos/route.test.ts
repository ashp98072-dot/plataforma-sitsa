import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireTenantRrhh: vi.fn(),
  listarPuestosDisponibles: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/entrevistas", () => ({
  listarPuestosDisponibles: m.listarPuestosDisponibles,
}));

import { GET } from "./route";

const ctx = (slug = "sitsa") => ({ params: Promise.resolve({ slug }) });
const req = () => new Request("http://x");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ATRACCION-TALENTO-2 — GET /rrhh/entrevistas/puestos", () => {
  it("200 con entrevistas:ver, devuelve el catálogo tal cual lo arma la capa de datos", async () => {
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 1 }, session: {} });
    m.listarPuestosDisponibles.mockResolvedValue(["Auxiliar", "Piloto"]);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ puestos: ["Auxiliar", "Piloto"] });
  });

  it("guard con submódulo 'entrevistas' acción 'ver'", async () => {
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 1 }, session: {} });
    m.listarPuestosDisponibles.mockResolvedValue([]);
    await GET(req(), ctx("acme"));
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("acme", "entrevistas", "ver");
  });

  it("sin permiso => 403 y no consulta el catálogo", async () => {
    m.requireTenantRrhh.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Sin permiso" }), { status: 403 }),
    });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(403);
    expect(m.listarPuestosDisponibles).not.toHaveBeenCalled();
  });

  it("tenant siempre desde guard.empresa.id", async () => {
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 42 }, session: {} });
    m.listarPuestosDisponibles.mockResolvedValue([]);
    await GET(req(), ctx("otra-empresa"));
    expect(m.listarPuestosDisponibles).toHaveBeenCalledWith(42);
  });
});
