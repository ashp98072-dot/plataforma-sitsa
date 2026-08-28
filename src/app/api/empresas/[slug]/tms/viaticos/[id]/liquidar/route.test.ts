import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosLiquidar: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({ liquidarViatico: vi.fn() }));

import { requireTenantViaticosLiquidar } from "@/lib/tenant";
import { liquidarViatico } from "@/lib/tms/viaticos";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantViaticosLiquidar).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 8, username: "fact1", nombre: "Marta Ruiz", rol: "Facturador" } } as Awaited<ReturnType<typeof requireTenantViaticosLiquidar>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("POST /tms/viaticos/[id]/liquidar", () => {
  it("exige viaticos_liquidar:editar (nunca viaticos:editar genérico) ANTES de tocar la lib", async () => {
    vi.mocked(requireTenantViaticosLiquidar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantViaticosLiquidar>>);
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ password: "x" }) }), ctx);
    expect(res.status).toBe(403);
    expect(liquidarViatico).not.toHaveBeenCalled();
    expect(requireTenantViaticosLiquidar).toHaveBeenCalledWith("prueba", "editar");
  });

  it("rechaza sin contraseña antes de llamar a la lib", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ gastosComprobados: "900", reintegro: "100" }) }), ctx);
    expect(res.status).toBe(400);
    expect(liquidarViatico).not.toHaveBeenCalled();
  });

  it("delega en liquidarViatico con gastos/reintegro/observaciones + la identidad de la sesión", async () => {
    vi.mocked(liquidarViatico).mockResolvedValue({
      ok: true,
      firma: { id: 2, codigoFirma: "SIG-2", fechaHoraServidor: new Date("2026-08-28T16:00:00Z"), hashPayload: "h", nombreFirmante: "Marta Ruiz", rolFirmante: "Facturador" },
    });
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ gastosComprobados: "900.00", reintegro: "100.00", observaciones: "ok", password: "clave456" }) }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(liquidarViatico).toHaveBeenCalledWith(
      7, 10,
      { gastosComprobados: "900.00", reintegro: "100.00", observaciones: "ok" },
      "fact1",
      { usuarioId: 8, nombreFirmante: "Marta Ruiz", rolFirmante: "Facturador", password: "clave456", ip: null, userAgent: null },
    );
  });

  it("propaga 409 cuando la lib rechaza por diferencia distinta de 0", async () => {
    vi.mocked(liquidarViatico).mockResolvedValue({ ok: false, error: "Pendiente por comprobar o reintegrar: Q50.00", status: 409 });
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ gastosComprobados: "950", reintegro: "0", password: "clave456" }) }),
      ctx,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Pendiente por comprobar");
  });
});
