import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: vi.fn() }));
vi.mock("@/lib/flota/combustible", () => ({ obtenerArchivoCargaCombustiblePorEmpresa: vi.fn() }));
vi.mock("@/lib/uploads", () => ({
  absPathFromRelative: vi.fn((p: string) => p),
  contentTypeFor: vi.fn(() => "image/jpeg"),
}));
vi.mock("fs", () => ({ readFileSync: vi.fn(() => Buffer.from("img")) }));

import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { obtenerArchivoCargaCombustiblePorEmpresa } from "@/lib/flota/combustible";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "5" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFlotaCombustible).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 1, username: "op1" } } as Awaited<ReturnType<typeof requireTenantFlotaCombustible>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/empresas/[slug]/flota/combustible/[id]/vale", () => {
  it("exige flota_combustible:ver antes de tocar la lib", async () => {
    vi.mocked(requireTenantFlotaCombustible).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantFlotaCombustible>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(obtenerArchivoCargaCombustiblePorEmpresa).not.toHaveBeenCalled();
  });

  it("vale no encontrado -> 404", async () => {
    vi.mocked(obtenerArchivoCargaCombustiblePorEmpresa).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(404);
  });

  it("sirve el archivo acotado a empresa (7) + id (5)", async () => {
    vi.mocked(obtenerArchivoCargaCombustiblePorEmpresa).mockResolvedValue({
      rutaRelativa: "empresas/7/flota/vale.jpg", nombreOriginal: "vale.jpg", mime: "image/jpeg",
    });
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    expect(obtenerArchivoCargaCombustiblePorEmpresa).toHaveBeenCalledWith(7, 5);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });
});
