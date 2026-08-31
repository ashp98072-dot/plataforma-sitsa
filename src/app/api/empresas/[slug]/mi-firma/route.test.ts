import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenant: vi.fn() }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({
  obtenerFirmaUsuario: vi.fn(),
  guardarFirmaUsuario: vi.fn(),
  eliminarFirmaUsuario: vi.fn(),
}));

import { requireTenant } from "@/lib/tenant";
import { eliminarFirmaUsuario, guardarFirmaUsuario, obtenerFirmaUsuario } from "@/lib/firmas/usuario-firmas";
import { DELETE, GET, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

function formData(opts: { conFirma?: boolean; bytes?: Uint8Array; size?: number } = {}) {
  const fd = new FormData();
  if (opts.conFirma !== false) {
    const bytes = opts.bytes ?? PNG_BYTES;
    const blob = opts.size != null ? new Blob([Buffer.alloc(opts.size)]) : new Blob([Buffer.from(bytes)]);
    fd.set("firmaImagen", new File([blob], "firma.png", { type: "image/png" }));
  }
  return fd;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenant).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "jefe1", nombre: "Ana López", rol: "JefeOperaciones" } } as Awaited<ReturnType<typeof requireTenant>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /mi-firma", () => {
  it("exige sesión (requireTenant) ANTES de consultar", async () => {
    vi.mocked(requireTenant).mockResolvedValue({ error: new Response(null, { status: 401 }) } as Awaited<ReturnType<typeof requireTenant>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(401);
    expect(obtenerFirmaUsuario).not.toHaveBeenCalled();
  });

  it("10) el usuario SIEMPRE viene de la sesión — obtenerFirmaUsuario se llama con guard.session.id, nunca un valor del cliente", async () => {
    vi.mocked(obtenerFirmaUsuario).mockResolvedValue(null);
    await GET(new Request("http://localhost/x"), ctx);
    expect(obtenerFirmaUsuario).toHaveBeenCalledWith(3);
  });

  it("1) usuario sin firma -> tieneFirma:false", async () => {
    vi.mocked(obtenerFirmaUsuario).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x"), ctx);
    const body = await res.json();
    expect(body.tieneFirma).toBe(false);
    expect(body.actualizadoEn).toBeNull();
  });

  it("usuario con firma -> tieneFirma:true + actualizadoEn, sin exponer la ruta física", async () => {
    vi.mocked(obtenerFirmaUsuario).mockResolvedValue({
      id: 1, usuarioId: 3, imagenRuta: "empresas/7/firmas/x.png", imagenNombreOriginal: "firma.png",
      imagenMime: "image/png", imagenTamano: 15, imagenSha256: "a".repeat(64),
      creadoEn: "2026-08-29 10:00:00", actualizadoEn: "2026-08-29 10:00:00",
    });
    const res = await GET(new Request("http://localhost/x"), ctx);
    const body = await res.json();
    expect(body.tieneFirma).toBe(true);
    expect(body.actualizadoEn).toBe("2026-08-29 10:00:00");
    expect(body.imagenRuta).toBeUndefined();
  });
});

describe("POST /mi-firma", () => {
  it("2) guarda la firma con formato válido", async () => {
    vi.mocked(guardarFirmaUsuario).mockResolvedValue({
      id: 1, usuarioId: 3, imagenRuta: "x", imagenNombreOriginal: "firma.png", imagenMime: "image/png",
      imagenTamano: 15, imagenSha256: "a".repeat(64), creadoEn: "x", actualizadoEn: "2026-08-29 10:00:00",
    });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData() }), ctx);
    expect(res.status).toBe(200);
    expect(guardarFirmaUsuario).toHaveBeenCalledWith(7, 3, { bytes: expect.any(ArrayBuffer), original: "firma.png" });
  });

  it("sin firmaImagen -> 400, sin llamar a la lib", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData({ conFirma: false }) }), ctx);
    expect(res.status).toBe(400);
    expect(guardarFirmaUsuario).not.toHaveBeenCalled();
  });

  it("3) PNG inválido (magic bytes falsos) -> 400", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData({ bytes: JPEG_BYTES }) }), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("PNG");
    expect(guardarFirmaUsuario).not.toHaveBeenCalled();
  });

  it("4) archivo > 1MB -> 400", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: formData({ size: 2 * 1024 * 1024 }) }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(guardarFirmaUsuario).not.toHaveBeenCalled();
  });

  it("exige sesión antes de tocar el body", async () => {
    vi.mocked(requireTenant).mockResolvedValue({ error: new Response(null, { status: 401 }) } as Awaited<ReturnType<typeof requireTenant>>);
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: formData() }), ctx);
    expect(res.status).toBe(401);
    expect(guardarFirmaUsuario).not.toHaveBeenCalled();
  });
});

describe("DELETE /mi-firma", () => {
  it("8) elimina la firma existente", async () => {
    vi.mocked(eliminarFirmaUsuario).mockResolvedValue({ ok: true });
    const res = await DELETE(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    expect(eliminarFirmaUsuario).toHaveBeenCalledWith(3);
  });

  it("404 si no tiene firma guardada", async () => {
    vi.mocked(eliminarFirmaUsuario).mockResolvedValue({ ok: false });
    const res = await DELETE(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(404);
  });

  it("exige sesión antes de eliminar", async () => {
    vi.mocked(requireTenant).mockResolvedValue({ error: new Response(null, { status: 401 }) } as Awaited<ReturnType<typeof requireTenant>>);
    const res = await DELETE(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(401);
    expect(eliminarFirmaUsuario).not.toHaveBeenCalled();
  });
});
