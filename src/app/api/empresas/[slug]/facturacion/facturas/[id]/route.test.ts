import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn() }));
vi.mock("@/lib/facturacion/facturas", () => ({
  obtenerFactura: vi.fn(),
  actualizarFacturaBorrador: vi.fn(),
}));

import { requireTenantFacturacion } from "@/lib/tenant";
import { actualizarFacturaBorrador, obtenerFactura } from "@/lib/facturacion/facturas";
import { GET, PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFacturacion).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "facturador1" } } as Awaited<ReturnType<typeof requireTenantFacturacion>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /facturacion/facturas/[id]", () => {
  it("exige facturacion:ver, 404 si no existe", async () => {
    vi.mocked(obtenerFactura).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "ver");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /facturacion/facturas/[id] — 9/10) solo Borrador editable", () => {
  it("exige facturacion:editar", async () => {
    vi.mocked(actualizarFacturaBorrador).mockResolvedValue({ ok: true, facturaId: 10 });
    await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 1 }] }) }), ctx);
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "editar");
  });

  it("propaga 409 cuando la lib rechaza (factura ya no está en Borrador)", async () => {
    vi.mocked(actualizarFacturaBorrador).mockResolvedValue({ ok: false, error: "Solo se puede editar una factura en Borrador.", status: 409 });
    const res = await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 1 }] }) }), ctx);
    expect(res.status).toBe(409);
  });
});
