import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosAutorizar: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({ autorizarViatico: vi.fn() }));

import { requireTenantViaticosAutorizar } from "@/lib/tenant";
import { autorizarViatico } from "@/lib/tms/viaticos";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

// PNG mínimo válido (firma real 89 50 4E 47 0D 0A 1A 0A + relleno).
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
  vi.mocked(requireTenantViaticosAutorizar).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "jefe1", nombre: "Ana López", rol: "JefeOperaciones" } } as Awaited<ReturnType<typeof requireTenantViaticosAutorizar>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("POST /tms/viaticos/[id]/autorizar", () => {
  it("exige viaticos_autorizar:editar ANTES de tocar la lib", async () => {
    vi.mocked(requireTenantViaticosAutorizar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantViaticosAutorizar>>);
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData({ password: "x" }) }), ctx);
    expect(res.status).toBe(403);
    expect(autorizarViatico).not.toHaveBeenCalled();
  });

  it("rechaza sin contraseña antes de llamar a la lib", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData({}) }), ctx);
    expect(res.status).toBe(400);
    expect(autorizarViatico).not.toHaveBeenCalled();
  });

  it("1) sin firmaImagen (sin trazo) -> 400 'Dibuja tu firma antes de continuar.', sin llamar a la lib", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData({ password: "clave123" }, { conFirma: false }) }), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Dibuja tu firma antes de continuar.");
    expect(autorizarViatico).not.toHaveBeenCalled();
  });

  it("PNG supera el tamaño permitido -> 400, sin llamar a la lib", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: formData({ password: "clave123" }, { size: 2 * 1024 * 1024 }) }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(autorizarViatico).not.toHaveBeenCalled();
  });

  it("archivo con magic bytes de JPEG (no PNG real) -> 400, sin llamar a la lib", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: formData({ password: "clave123" }, { bytes: JPEG_BYTES }) }),
      ctx,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("PNG");
    expect(autorizarViatico).not.toHaveBeenCalled();
  });

  it("delega en autorizarViatico con la identidad de la SESIÓN del servidor (nombre/rol nunca del cliente) e incluye la imagen validada", async () => {
    vi.mocked(autorizarViatico).mockResolvedValue({
      ok: true,
      firma: { id: 1, codigoFirma: "SIG-1", fechaHoraServidor: new Date("2026-08-28T15:00:00Z"), hashPayload: "h", nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones", tieneImagen: true },
    });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData({ password: "clave123" }) }), ctx);
    expect(res.status).toBe(200);
    expect(autorizarViatico).toHaveBeenCalledWith(7, 10, "jefe1", {
      usuarioId: 3, nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones", password: "clave123",
      imagen: { bytes: expect.any(ArrayBuffer), original: "firma.png" },
      ip: null, userAgent: null,
    });
    const body = await res.json();
    expect(body.firma.codigoFirma).toBe("SIG-1");
    expect(body.firma.firmaId).toBe(1);
    expect(body.firma.tieneImagen).toBe(true);
    // NO se devuelve la ruta física interna, solo firmaId/tieneImagen.
    expect(body.firma.imagenRuta).toBeUndefined();
    expect(body.firma.rutaImagen).toBeUndefined();
  });

  it("propaga el status de error de la lib (p.ej. 401 contraseña incorrecta, 409 estado)", async () => {
    vi.mocked(autorizarViatico).mockResolvedValue({ ok: false, error: "Contraseña incorrecta.", status: 401 });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData({ password: "mala" }) }), ctx);
    expect(res.status).toBe(401);
  });
});
