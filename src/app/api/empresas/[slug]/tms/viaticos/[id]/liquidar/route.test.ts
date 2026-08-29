import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosLiquidar: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({ liquidarViatico: vi.fn() }));

import { requireTenantViaticosLiquidar } from "@/lib/tenant";
import { liquidarViatico } from "@/lib/tms/viaticos";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

function formData(fields: Record<string, string>, opts: { conFirma?: boolean; bytes?: Uint8Array; size?: number } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (opts.conFirma !== false) {
    const bytes = opts.bytes ?? PNG_BYTES;
    const blob = opts.size != null ? new Blob([Buffer.alloc(opts.size)]) : new Blob([Buffer.from(bytes)]);
    fd.set("firmaImagen", new File([blob], "firma.png", { type: "image/png" }));
  }
  return fd;
}

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
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData({ password: "x" }) }), ctx);
    expect(res.status).toBe(403);
    expect(liquidarViatico).not.toHaveBeenCalled();
    expect(requireTenantViaticosLiquidar).toHaveBeenCalledWith("prueba", "editar");
  });

  it("rechaza sin contraseña antes de llamar a la lib", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData({ gastosComprobados: "900", reintegro: "100" }) }), ctx);
    expect(res.status).toBe(400);
    expect(liquidarViatico).not.toHaveBeenCalled();
  });

  it("1) sin firmaImagen (sin trazo) -> 400 'Dibuja tu firma antes de continuar.', sin llamar a la lib", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: formData({ password: "clave456" }, { conFirma: false }) }),
      ctx,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Dibuja tu firma antes de continuar.");
    expect(liquidarViatico).not.toHaveBeenCalled();
  });

  it("4) PNG supera el límite de tamaño -> 400, sin llamar a la lib", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: formData({ password: "clave456" }, { size: 2 * 1024 * 1024 }) }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(liquidarViatico).not.toHaveBeenCalled();
  });

  it("5) archivo no-PNG (magic bytes falsos) -> 400, sin llamar a la lib", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: formData({ password: "clave456" }, { bytes: JPEG_BYTES }) }),
      ctx,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("PNG");
    expect(liquidarViatico).not.toHaveBeenCalled();
  });

  it("delega en liquidarViatico con gastos/reintegro/observaciones + la identidad de la sesión + la imagen validada", async () => {
    vi.mocked(liquidarViatico).mockResolvedValue({
      ok: true,
      firma: { id: 2, codigoFirma: "SIG-2", fechaHoraServidor: new Date("2026-08-28T16:00:00Z"), hashPayload: "h", nombreFirmante: "Marta Ruiz", rolFirmante: "Facturador", tieneImagen: true },
    });
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: formData({ gastosComprobados: "900.00", reintegro: "100.00", observaciones: "ok", password: "clave456" }) }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(liquidarViatico).toHaveBeenCalledWith(
      7, 10,
      { gastosComprobados: "900.00", reintegro: "100.00", observaciones: "ok" },
      "fact1",
      {
        usuarioId: 8, nombreFirmante: "Marta Ruiz", rolFirmante: "Facturador", password: "clave456",
        imagen: { bytes: expect.any(ArrayBuffer), original: "firma.png" },
        ip: null, userAgent: null,
      },
    );
    const body = await res.json();
    expect(body.firma.firmaId).toBe(2);
    expect(body.firma.tieneImagen).toBe(true);
  });

  it("propaga 409 cuando la lib rechaza por diferencia distinta de 0", async () => {
    vi.mocked(liquidarViatico).mockResolvedValue({ ok: false, error: "Pendiente por comprobar o reintegrar: Q50.00", status: 409 });
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: formData({ gastosComprobados: "950", reintegro: "0", password: "clave456" }) }),
      ctx,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Pendiente por comprobar");
  });
});
