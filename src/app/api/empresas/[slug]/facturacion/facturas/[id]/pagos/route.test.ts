import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn() }));
vi.mock("@/lib/facturacion/facturas", () => ({
  listarPagos: vi.fn(() => Promise.resolve([])),
  registrarPago: vi.fn(),
}));

import { requireTenantFacturacion } from "@/lib/tenant";
import { listarPagos, registrarPago } from "@/lib/facturacion/facturas";
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };
const cuerpoPago = { fechaPago: "2026-08-27", monto: 100 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFacturacion).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "facturador1" } } as Awaited<ReturnType<typeof requireTenantFacturacion>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /facturacion/facturas/[id]/pagos", () => {
  it("exige facturacion:ver", async () => {
    await GET(new Request("http://localhost/x"), ctx);
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "ver");
    expect(listarPagos).toHaveBeenCalledWith(7, 10);
  });
});

describe("POST /facturacion/facturas/[id]/pagos — 14/17) solo Emitida, sobrepago rechazado", () => {
  it("exige facturacion:crear antes de tocar la lib", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>);
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(cuerpoPago) }), ctx);
    expect(res.status).toBe(403);
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it("delega en registrarPago con el actor del guard", async () => {
    vi.mocked(registrarPago).mockResolvedValue({ ok: true });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(cuerpoPago) }), ctx);
    expect(res.status).toBe(201);
    expect(registrarPago).toHaveBeenCalledWith({ empresaId: 7, usuarioId: 3, usuario: "facturador1" }, 10, expect.objectContaining({ monto: 100 }));
  });

  it("propaga 409 cuando la lib rechaza (sobrepago o factura no Emitida)", async () => {
    vi.mocked(registrarPago).mockResolvedValue({ ok: false, error: "El pago excede el saldo pendiente.", status: 409 });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(cuerpoPago) }), ctx);
    expect(res.status).toBe(409);
  });

  it("rechaza monto negativo/cero antes de llamar a la lib", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ fechaPago: "2026-08-27", monto: 0 }) }), ctx);
    expect(res.status).toBe(400);
    expect(registrarPago).not.toHaveBeenCalled();
  });
});
