import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosAutorizar: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({ autorizarViatico: vi.fn() }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn() }));

import { requireTenantViaticosAutorizar } from "@/lib/tenant";
import { autorizarViatico } from "@/lib/tms/viaticos";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

// PNG mínimo válido (firma real 89 50 4E 47 0D 0A 1A 0A + relleno).
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

/**
 * CORRECCIÓN URGENTE — autorizar YA NO acepta/exige `password` en el
 * FormData. `fields` solo transporta `firmaLote` en estas pruebas.
 */
function formData(fields: Record<string, string> = {}, opts: { conFirma?: boolean; bytes?: Uint8Array; size?: number } = {}) {
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
  it("3) sin permiso viaticos_autorizar:editar -> rechazo (403) ANTES de tocar la lib — la ausencia de password NUNCA reemplaza el permiso", async () => {
    vi.mocked(requireTenantViaticosAutorizar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantViaticosAutorizar>>);
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData() }), ctx);
    expect(res.status).toBe(403);
    expect(autorizarViatico).not.toHaveBeenCalled();
  });

  it("4) sin firmaImagen (sin trazo) -> 400 'Dibuja tu firma antes de continuar.', sin llamar a la lib", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData({}, { conFirma: false }) }), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Dibuja tu firma antes de continuar.");
    expect(autorizarViatico).not.toHaveBeenCalled();
  });

  it("6) PNG supera el tamaño permitido -> 400, sin llamar a la lib", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: formData({}, { size: 2 * 1024 * 1024 }) }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(autorizarViatico).not.toHaveBeenCalled();
  });

  it("5) archivo con magic bytes de JPEG (no PNG real) -> 400, sin llamar a la lib", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: formData({}, { bytes: JPEG_BYTES }) }),
      ctx,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("PNG");
    expect(autorizarViatico).not.toHaveBeenCalled();
  });

  it("CORRECCIÓN URGENTE: no lee ni exige `password` del FormData — un request con password vacío/ausente y firma válida SÍ delega a la lib", async () => {
    vi.mocked(autorizarViatico).mockResolvedValue({
      ok: true,
      firma: { id: 1, codigoFirma: "SIG-1", fechaHoraServidor: new Date("2026-08-28T15:00:00Z"), hashPayload: "h", nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones", tieneImagen: true },
    });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData() }), ctx);
    expect(res.status).toBe(200);
    expect(autorizarViatico).toHaveBeenCalledTimes(1);
    // El objeto delegado a la lib NUNCA incluye la clave "password".
    const args = vi.mocked(autorizarViatico).mock.calls[0][3];
    expect(Object.prototype.hasOwnProperty.call(args, "password")).toBe(false);
  });

  it("delega en autorizarViatico con la identidad de la SESIÓN del servidor (nombre/rol nunca del cliente) e incluye la imagen validada, sin password", async () => {
    vi.mocked(autorizarViatico).mockResolvedValue({
      ok: true,
      firma: { id: 1, codigoFirma: "SIG-1", fechaHoraServidor: new Date("2026-08-28T15:00:00Z"), hashPayload: "h", nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones", tieneImagen: true },
    });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData() }), ctx);
    expect(res.status).toBe(200);
    expect(autorizarViatico).toHaveBeenCalledWith(7, 10, "jefe1", {
      usuarioId: 3, nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones",
      imagen: { bytes: expect.any(ArrayBuffer), original: "firma.png" },
      firmaLote: false,
      origenFirma: "DIBUJADA",
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

  it("hotfix PR #124: firmaLote='true' en el FormData (bandeja masiva) -> se delega con firmaLote: true", async () => {
    vi.mocked(autorizarViatico).mockResolvedValue({
      ok: true,
      firma: { id: 1, codigoFirma: "SIG-1", fechaHoraServidor: new Date("2026-08-28T15:00:00Z"), hashPayload: "h", nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones", tieneImagen: true },
    });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData({ firmaLote: "true" }) }), ctx);
    expect(res.status).toBe(200);
    expect(autorizarViatico).toHaveBeenCalledWith(7, 10, "jefe1", expect.objectContaining({ firmaLote: true }));
  });

  it("propaga el status de error de la lib (p.ej. 409 estado inválido)", async () => {
    vi.mocked(autorizarViatico).mockResolvedValue({ ok: false, error: "Este viático ya fue autorizado.", status: 409 });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData() }), ctx);
    expect(res.status).toBe(409);
  });

  it("CORRECCIÓN URGENTE — 500 real: una excepción no controlada de autorizarViatico se captura y responde JSON {error}, nunca un 500 sin cuerpo", async () => {
    vi.mocked(autorizarViatico).mockRejectedValue(new Error("fallo real de DB"));
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData() }), ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  describe("MI-FIRMA-1 — usarFirmaGuardada", () => {
    it("11) usarFirmaGuardada=true -> lee la plantilla del usuario de la SESIÓN (nunca del cliente) y delega con origenFirma: GUARDADA", async () => {
      vi.mocked(leerBytesFirmaGuardada).mockResolvedValue({ bytes: PNG_BYTES.buffer as ArrayBuffer, original: "mi-firma.png" });
      vi.mocked(autorizarViatico).mockResolvedValue({
        ok: true,
        firma: { id: 2, codigoFirma: "SIG-2", fechaHoraServidor: new Date("2026-08-29T10:00:00Z"), hashPayload: "h", nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones", tieneImagen: true },
      });
      const res = await POST(
        new Request("http://localhost/x", { method: "POST", body: formData({ usarFirmaGuardada: "true" }, { conFirma: false }) }),
        ctx,
      );
      expect(res.status).toBe(200);
      expect(leerBytesFirmaGuardada).toHaveBeenCalledWith(3); // guard.session.id, no un valor del cliente
      expect(autorizarViatico).toHaveBeenCalledWith(7, 10, "jefe1", expect.objectContaining({
        origenFirma: "GUARDADA",
        imagen: { bytes: expect.any(ArrayBuffer), original: "mi-firma.png" },
      }));
    });

    it("si el usuario no tiene firma guardada (ya no disponible) -> 400, sin llamar a la lib de autorización", async () => {
      vi.mocked(leerBytesFirmaGuardada).mockResolvedValue(null);
      const res = await POST(
        new Request("http://localhost/x", { method: "POST", body: formData({ usarFirmaGuardada: "true" }, { conFirma: false }) }),
        ctx,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("firma guardada");
      expect(autorizarViatico).not.toHaveBeenCalled();
    });

    it("17) sin usarFirmaGuardada (dibujar otra) sigue funcionando exactamente igual, con origenFirma: DIBUJADA", async () => {
      vi.mocked(autorizarViatico).mockResolvedValue({
        ok: true,
        firma: { id: 3, codigoFirma: "SIG-3", fechaHoraServidor: new Date("2026-08-29T10:00:00Z"), hashPayload: "h", nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones", tieneImagen: true },
      });
      const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData() }), ctx);
      expect(res.status).toBe(200);
      expect(leerBytesFirmaGuardada).not.toHaveBeenCalled();
      expect(autorizarViatico).toHaveBeenCalledWith(7, 10, "jefe1", expect.objectContaining({ origenFirma: "DIBUJADA" }));
    });

    it("18/19) firma masiva (firmaLote=true) con firma guardada -> se delega igual para cada viático (N llamadas independientes en N requests)", async () => {
      vi.mocked(leerBytesFirmaGuardada).mockResolvedValue({ bytes: PNG_BYTES.buffer as ArrayBuffer, original: "mi-firma.png" });
      vi.mocked(autorizarViatico).mockResolvedValue({
        ok: true,
        firma: { id: 4, codigoFirma: "SIG-4", fechaHoraServidor: new Date("2026-08-29T10:00:00Z"), hashPayload: "h", nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones", tieneImagen: true },
      });
      const body = formData({ usarFirmaGuardada: "true", firmaLote: "true" }, { conFirma: false });
      await POST(new Request("http://localhost/x", { method: "POST", body }), ctx);
      await POST(new Request("http://localhost/x", { method: "POST", body: formData({ usarFirmaGuardada: "true", firmaLote: "true" }, { conFirma: false }) }), { params: Promise.resolve({ slug: "prueba", id: "11" }) });
      // 21) cada llamada de autorizarViatico lleva firmaLote:true + origenFirma:GUARDADA de forma independiente.
      expect(autorizarViatico).toHaveBeenCalledTimes(2);
      for (const call of vi.mocked(autorizarViatico).mock.calls) {
        expect(call[3]).toEqual(expect.objectContaining({ firmaLote: true, origenFirma: "GUARDADA" }));
      }
    });
  });
});
