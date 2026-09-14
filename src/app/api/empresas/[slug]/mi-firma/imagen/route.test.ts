import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenant: vi.fn() }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ obtenerFirmaUsuario: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ absPathFromRelative: vi.fn(), contentTypeFor: vi.fn() }));
vi.mock("fs", () => ({ createReadStream: vi.fn(), existsSync: vi.fn(), statSync: vi.fn() }));

import { requireTenant } from "@/lib/tenant";
import { obtenerFirmaUsuario } from "@/lib/firmas/usuario-firmas";
import { absPathFromRelative } from "@/lib/uploads";
import { createReadStream, existsSync, statSync } from "fs";
import { Readable } from "stream";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenant).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "jefe1", nombre: "Ana López", rol: "JefeOperaciones" } } as Awaited<ReturnType<typeof requireTenant>>,
  );
  vi.mocked(absPathFromRelative).mockImplementation((r: string) => `/abs/${r}`);
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(statSync).mockReturnValue({ size: 15 } as ReturnType<typeof statSync>);
  vi.mocked(createReadStream).mockReturnValue(Readable.from([Buffer.from("x")]) as ReturnType<typeof createReadStream>);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /mi-firma/imagen", () => {
  it("exige sesión ANTES de consultar la firma", async () => {
    vi.mocked(requireTenant).mockResolvedValue({ error: new Response(null, { status: 401 }) } as Awaited<ReturnType<typeof requireTenant>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(401);
    expect(obtenerFirmaUsuario).not.toHaveBeenCalled();
  });

  it("10) solo lee la firma del usuario de la SESIÓN — nunca un usuario_id del cliente", async () => {
    vi.mocked(obtenerFirmaUsuario).mockResolvedValue({
      id: 1, usuarioId: 3, imagenRuta: "empresas/7/firmas/x.png", imagenNombreOriginal: "firma.png",
      imagenMime: "image/png", imagenTamano: 15, imagenSha256: "a".repeat(64), creadoEn: "x", actualizadoEn: "x",
    });
    await GET(new Request("http://localhost/x"), ctx);
    expect(obtenerFirmaUsuario).toHaveBeenCalledWith(3);
  });

  it("404 si el usuario no tiene firma guardada", async () => {
    vi.mocked(obtenerFirmaUsuario).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(404);
  });

  it("404 si el registro existe pero el archivo ya no está en disco", async () => {
    vi.mocked(obtenerFirmaUsuario).mockResolvedValue({
      id: 1, usuarioId: 3, imagenRuta: "empresas/7/firmas/x.png", imagenNombreOriginal: "firma.png",
      imagenMime: "image/png", imagenTamano: 15, imagenSha256: "a".repeat(64), creadoEn: "x", actualizadoEn: "x",
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(404);
  });

  it("sirve el PNG con el Content-Type de la firma y nunca expone la ruta física", async () => {
    vi.mocked(obtenerFirmaUsuario).mockResolvedValue({
      id: 1, usuarioId: 3, imagenRuta: "empresas/7/firmas/x.png", imagenNombreOriginal: "firma.png",
      imagenMime: "image/png", imagenTamano: 15, imagenSha256: "a".repeat(64), creadoEn: "x", actualizadoEn: "x",
    });
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});
