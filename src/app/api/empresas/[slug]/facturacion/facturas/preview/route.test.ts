import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn() }));
vi.mock("@/lib/facturacion/facturas", () => ({ previsualizarFactura: vi.fn() }));

import { requireTenantFacturacion } from "@/lib/tenant";
import { previsualizarFactura } from "@/lib/facturacion/facturas";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const guardOk = { empresa: { id: 7 }, session: { id: 3, username: "facturador1" } } as Awaited<ReturnType<typeof requireTenantFacturacion>>;

function post(body: unknown) {
  return POST(
    new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    ctx,
  );
}

const PREVIEW = {
  cliente: { id: 20, nombre: "Cliente X", nit: null, direccion: null },
  cantidadViajes: 1,
  borrador: { moneda: "GTQ", politica: { porcentajeIva: 12, precioIncluyeIva: true }, lineas: [], subtotal: 892.86, iva: 107.14, total: 1000 },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFacturacion).mockResolvedValue(guardOk);
  vi.mocked(previsualizarFactura).mockResolvedValue({ ok: true, preview: PREVIEW } as Awaited<ReturnType<typeof previsualizarFactura>>);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /facturacion/facturas/preview — permisos", () => {
  it("15) exige el permiso de CREAR borrador (facturacion:crear) y lo exige ANTES de leer nada", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>);
    const res = await post({ clienteId: 20, planes: [{ planId: 1 }] });
    expect(res.status).toBe(403);
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "crear");
    expect(previsualizarFactura).not.toHaveBeenCalled();
  });

  it("solo «ver» NO alcanza: el guard se pide con «crear», nunca con «ver» ni con permisos de TMS", async () => {
    await post({ clienteId: 20, planes: [{ planId: 1 }] });
    expect(requireTenantFacturacion).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requireTenantFacturacion).mock.calls[0][1]).toBe("crear");
  });
});

describe("POST /facturacion/facturas/preview — contrato", () => {
  it("16) la empresa y el usuario salen de la SESIÓN, nunca del cuerpo (un empresaId ajeno enviado se ignora)", async () => {
    const res = await post({ clienteId: 20, planes: [{ planId: 1 }], empresaId: 999, usuario: "otro" });
    expect(res.status).toBe(200);
    expect(previsualizarFactura).toHaveBeenCalledWith(
      { empresaId: 7, usuarioId: 3, usuario: "facturador1" },
      { clienteId: 20, planes: [{ planId: 1 }] },
    );
  });

  it("responde 200 con la vista previa calculada por el servidor y sin caché", async () => {
    const res = await post({ clienteId: 20, planes: [{ planId: 1, montoAsignado: 1000 }] });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual(PREVIEW);
  });

  it("propaga el rechazo de negocio con su código (p. ej. 409 viaje ya facturado)", async () => {
    vi.mocked(previsualizarFactura).mockResolvedValue({ ok: false, error: "El viaje PLAN-1 ya está vinculado a otra factura.", status: 409 });
    const res = await post({ clienteId: 20, planes: [{ planId: 1 }] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("ya está vinculado");
  });

  it("valida el cuerpo: sin viajes, ids inválidos, montos negativos o JSON roto → 400 sin llamar al servicio", async () => {
    for (const body of [
      { clienteId: 20, planes: [] },
      { clienteId: 0, planes: [{ planId: 1 }] },
      { clienteId: 20, planes: [{ planId: -1 }] },
      { clienteId: 20, planes: [{ planId: 1, montoAsignado: -5 }] },
      { clienteId: "20", planes: [{ planId: 1 }] },
      null,
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
    }
    const rota = await POST(new Request("http://localhost/x", { method: "POST", body: "{no-json" }), ctx);
    expect(rota.status).toBe(400);
    expect(previsualizarFactura).not.toHaveBeenCalled();
  });
});
