import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn() }));
vi.mock("@/lib/facturacion/facturas", () => ({ listarViajesPendientes: vi.fn(() => Promise.resolve([])) }));

import { requireTenantFacturacion } from "@/lib/tenant";
import { listarViajesPendientes } from "@/lib/facturacion/facturas";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFacturacion).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "facturador1" } } as Awaited<ReturnType<typeof requireTenantFacturacion>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /facturacion/viajes-pendientes — 27) Facturador no necesita permiso TMS", () => {
  it("usa EXCLUSIVAMENTE requireTenantFacturacion(slug, 'ver') — nunca un guard de tms", async () => {
    await GET(new Request("http://localhost/x"), ctx);
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "ver");
    expect(requireTenantFacturacion).toHaveBeenCalledTimes(1);
  });

  it("exige el permiso ANTES de tocar la DB", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(listarViajesPendientes).not.toHaveBeenCalled();
  });

  it("responde 200 con los viajes del tenant del guard, con los filtros parseados", async () => {
    const res = await GET(new Request("http://localhost/x?clienteId=5&fechaDesde=2026-08-01"), ctx);
    expect(res.status).toBe(200);
    expect(listarViajesPendientes).toHaveBeenCalledWith(7, { clienteId: 5, fechaDesde: "2026-08-01", fechaHasta: undefined });
  });
});
