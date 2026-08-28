import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn() }));
vi.mock("@/lib/facturacion/facturas", () => ({ anularFactura: vi.fn() }));

import { requireTenantFacturacion } from "@/lib/tenant";
import { anularFactura } from "@/lib/facturacion/facturas";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFacturacion).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "facturador1" } } as Awaited<ReturnType<typeof requireTenantFacturacion>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("POST /facturacion/facturas/[id]/anular — 21) rechaza si hay pagos (vía la lib)", () => {
  it("exige facturacion:editar antes de tocar la lib", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>);
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), ctx);
    expect(res.status).toBe(403);
    expect(anularFactura).not.toHaveBeenCalled();
  });

  it("20) éxito: delega en anularFactura con el actor del guard", async () => {
    vi.mocked(anularFactura).mockResolvedValue({ ok: true });
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), ctx);
    expect(res.status).toBe(200);
    expect(anularFactura).toHaveBeenCalledWith({ empresaId: 7, usuarioId: 3, usuario: "facturador1" }, 10);
  });

  it("propaga 409 cuando la lib rechaza por pagos existentes", async () => {
    vi.mocked(anularFactura).mockResolvedValue({ ok: false, error: "No se puede anular una factura con pagos registrados; requiere nota de crédito/reversa (no implementado en esta fase).", status: 409 });
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), ctx);
    expect(res.status).toBe(409);
  });
});
