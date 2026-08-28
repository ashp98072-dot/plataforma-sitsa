import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn() }));
vi.mock("@/lib/facturacion/facturas", () => ({ emitirFactura: vi.fn() }));

import { requireTenantFacturacion } from "@/lib/tenant";
import { emitirFactura } from "@/lib/facturacion/facturas";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFacturacion).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "facturador1" } } as Awaited<ReturnType<typeof requireTenantFacturacion>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("POST /facturacion/facturas/[id]/emitir — 26) permisos: facturacion:editar", () => {
  it("exige el permiso antes de tocar la lib", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>);
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: "{}" }), ctx);
    expect(res.status).toBe(403);
    expect(emitirFactura).not.toHaveBeenCalled();
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "editar");
  });

  it("delega en emitirFactura con el actor del guard", async () => {
    vi.mocked(emitirFactura).mockResolvedValue({ ok: true });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: "{}" }), ctx);
    expect(res.status).toBe(200);
    expect(emitirFactura).toHaveBeenCalledWith({ empresaId: 7, usuarioId: 3, usuario: "facturador1" }, 10, expect.anything());
  });

  it("11/12/13) propaga los rechazos de la lib (número/fecha/viajes) como 400", async () => {
    vi.mocked(emitirFactura).mockResolvedValue({ ok: false, error: "El número de factura es obligatorio para emitir.", status: 400 });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: "{}" }), ctx);
    expect(res.status).toBe(400);
  });
});
