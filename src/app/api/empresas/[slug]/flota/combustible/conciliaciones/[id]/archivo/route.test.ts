import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: vi.fn() }));
vi.mock("@/lib/flota/combustible-conciliacion-consultas", () => ({
  obtenerArchivoConciliacionCombustible: vi.fn(),
}));
vi.mock("@/lib/uploads", () => ({
  absPathFromRelative: vi.fn((p: string) => p),
  contentTypeFor: vi.fn(() => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
}));
vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => Buffer.from("xlsx-bytes")),
}));

import { existsSync } from "fs";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { obtenerArchivoConciliacionCombustible } from "@/lib/flota/combustible-conciliacion-consultas";
import { absPathFromRelative } from "@/lib/uploads";
import { GET } from "./route";

const ctx = (id: string) => ({
  params: Promise.resolve({ slug: "prueba", id }),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFlotaCombustible).mockResolvedValue(
    { empresa: { id: 20 }, session: { id: 1, username: "op1" } } as Awaited<
      ReturnType<typeof requireTenantFlotaCombustible>
    >,
  );
  vi.mocked(existsSync).mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/empresas/[slug]/flota/combustible/conciliaciones/[id]/archivo (descarga protegida)", () => {
  it("sin permiso (flota_combustible:ver) -> error del guard, sin tocar la lib", async () => {
    vi.mocked(requireTenantFlotaCombustible).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantFlotaCombustible>>);

    const res = await GET(new Request("http://localhost/x"), ctx("5"));

    expect(res.status).toBe(403);
    expect(requireTenantFlotaCombustible).toHaveBeenCalledWith("prueba", "ver");
    expect(obtenerArchivoConciliacionCombustible).not.toHaveBeenCalled();
  });

  it("id inválido -> 400, sin tocar la lib", async () => {
    const res = await GET(new Request("http://localhost/x"), ctx("abc"));

    expect(res.status).toBe(400);
    expect(obtenerArchivoConciliacionCombustible).not.toHaveBeenCalled();
  });

  it("conciliación inexistente o de otra empresa (aislamiento tenant) -> 404", async () => {
    vi.mocked(obtenerArchivoConciliacionCombustible).mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/x"), ctx("999"));

    expect(res.status).toBe(404);
    // Siempre empresa de la SESIÓN (20), nunca algo del cliente.
    expect(obtenerArchivoConciliacionCombustible).toHaveBeenCalledWith(20, 999);
  });

  it("archivo ya no existe en disco -> 404", async () => {
    vi.mocked(obtenerArchivoConciliacionCombustible).mockResolvedValue({
      rutaRelativa: "empresas/20/flota/conciliacion_combustible_x.xlsx",
      nombreOriginal: "reporte.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    vi.mocked(existsSync).mockReturnValue(false);

    const res = await GET(new Request("http://localhost/x"), ctx("5"));

    expect(res.status).toBe(404);
  });

  it("descarga correcta: resuelve la ruta vía absPathFromRelative() (nunca acepta ruta del cliente) y sirve attachment", async () => {
    vi.mocked(obtenerArchivoConciliacionCombustible).mockResolvedValue({
      rutaRelativa: "empresas/20/flota/conciliacion_combustible_x.xlsx",
      nombreOriginal: "reporte.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const res = await GET(new Request("http://localhost/x"), ctx("5"));

    expect(res.status).toBe(200);
    expect(absPathFromRelative).toHaveBeenCalledWith(
      "empresas/20/flota/conciliacion_combustible_x.xlsx",
    );
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("reporte.xlsx");
  });

  it("AJUSTE PRE-MERGE PR #194 — nunca confía en archivo.mime (pudo venir de file.type del cliente en FLOTA-COMBUSTIBLE-3): siempre responde el Content-Type fijo del .xlsx, incluso si la DB devuelve otro valor", async () => {
    vi.mocked(obtenerArchivoConciliacionCombustible).mockResolvedValue({
      rutaRelativa: "empresas/20/flota/conciliacion_combustible_x.xlsx",
      nombreOriginal: "reporte.xlsx",
      mime: "text/html",
    });

    const res = await GET(new Request("http://localhost/x"), ctx("5"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("un query param 'rutaRelativa' arbitrario del cliente se ignora — la ruta siempre sale de la DB", async () => {
    vi.mocked(obtenerArchivoConciliacionCombustible).mockResolvedValue({
      rutaRelativa: "empresas/20/flota/conciliacion_combustible_x.xlsx",
      nombreOriginal: "reporte.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    await GET(
      new Request(
        "http://localhost/x?rutaRelativa=../../../../etc/passwd",
      ),
      ctx("5"),
    );

    expect(absPathFromRelative).toHaveBeenCalledWith(
      "empresas/20/flota/conciliacion_combustible_x.xlsx",
    );
    expect(absPathFromRelative).not.toHaveBeenCalledWith(
      expect.stringContaining("passwd"),
    );
  });
});
