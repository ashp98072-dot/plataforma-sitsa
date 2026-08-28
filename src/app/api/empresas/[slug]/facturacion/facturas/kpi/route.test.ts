import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn() }));
vi.mock("@/lib/facturacion/facturas", () => ({ obtenerKpisFacturacion: vi.fn() }));

import { requireTenantFacturacion } from "@/lib/tenant";
import { obtenerKpisFacturacion } from "@/lib/facturacion/facturas";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const KPI = {
  viajesPendientes: 3, valorPendiente: 1500, facturasEmitidas: 2,
  valorFacturado: 5000, pendienteCobro: 1200, cobrado: 3800,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFacturacion).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "facturador1" } } as Awaited<ReturnType<typeof requireTenantFacturacion>>,
  );
  vi.mocked(obtenerKpisFacturacion).mockResolvedValue(KPI);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /facturacion/facturas/kpi", () => {
  it("exige facturacion:ver ANTES de tocar la DB — nunca tms", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(obtenerKpisFacturacion).not.toHaveBeenCalled();
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "ver");
    expect(requireTenantFacturacion).toHaveBeenCalledTimes(1);
  });

  it("responde 200 con el KPI del tenant del guard, agregado (no paginado)", async () => {
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ kpi: KPI });
    expect(obtenerKpisFacturacion).toHaveBeenCalledWith(7);
  });
});
