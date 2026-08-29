import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosAny: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("fs", () => ({ existsSync: vi.fn(), statSync: vi.fn(), createReadStream: vi.fn() }));
vi.mock("stream", () => ({ Readable: { toWeb: vi.fn(() => new ReadableStream()) } }));

import { requireTenantViaticosAny } from "@/lib/tenant";
import { query } from "@/lib/db";
import { existsSync, statSync } from "fs";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", firmaId: "55" }) };

/**
 * VIATICOS-FIRMA-VISUAL — lectura segura de la imagen de firma: sesión +
 * empresa + acceso al módulo (mismo permiso que ya ve el listado de
 * control) + aislamiento estricto por empresa_id en el WHERE — nunca una
 * ruta pública directa.
 */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantViaticosAny).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3 } } as Awaited<ReturnType<typeof requireTenantViaticosAny>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tms/viaticos/firmas/[firmaId]/imagen", () => {
  it("exige requireTenantViaticosAny(slug, 'ver') ANTES de consultar la firma", async () => {
    vi.mocked(requireTenantViaticosAny).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantViaticosAny>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("filtra la consulta por empresa_id, modulo='VIATICOS' y entidad_tipo='VIATICO' (aislamiento multiempresa + defensa en profundidad)", async () => {
    vi.mocked(query).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof query>>);
    await GET(new Request("http://localhost/x"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("empresa_id = ?");
    expect(String(sql)).toContain("modulo = 'VIATICOS'");
    expect(String(sql)).toContain("entidad_tipo = 'VIATICO'");
    expect(params).toEqual([55, 7]);
  });

  it("404 si la firma no existe o no tiene imagen (imagen_ruta NULL)", async () => {
    vi.mocked(query).mockResolvedValue([{ imagen_ruta: null, imagen_mime: null }] as unknown as Awaited<ReturnType<typeof query>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(404);
  });

  it("404 si el archivo ya no existe en disco (fila apunta a una ruta ausente)", async () => {
    vi.mocked(query).mockResolvedValue([{ imagen_ruta: "empresas/7/firmas/x.png", imagen_mime: "image/png" }] as unknown as Awaited<ReturnType<typeof query>>);
    vi.mocked(existsSync).mockReturnValue(false);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(404);
  });

  it("400 con firmaId no numérico", async () => {
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ slug: "prueba", firmaId: "abc" }) });
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("sirve el archivo con Content-Type privado (no cacheable) cuando existe", async () => {
    vi.mocked(query).mockResolvedValue([{ imagen_ruta: "empresas/7/firmas/x.png", imagen_mime: "image/png" }] as unknown as Awaited<ReturnType<typeof query>>);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue({ size: 123 } as ReturnType<typeof statSync>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
