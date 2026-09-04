import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: vi.fn() }));
vi.mock("@/lib/flota/combustible-conciliacion-consultas", () => ({
  obtenerConciliacionCombustible: vi.fn(),
}));

import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { obtenerConciliacionCombustible } from "@/lib/flota/combustible-conciliacion-consultas";
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
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/empresas/[slug]/flota/combustible/conciliaciones/[id] (detalle)", () => {
  it("exige flota_combustible:ver antes de tocar la lib", async () => {
    vi.mocked(requireTenantFlotaCombustible).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantFlotaCombustible>>);

    const res = await GET(new Request("http://localhost/x"), ctx("5"));

    expect(res.status).toBe(403);
    expect(requireTenantFlotaCombustible).toHaveBeenCalledWith("prueba", "ver");
    expect(obtenerConciliacionCombustible).not.toHaveBeenCalled();
  });

  it("id no numérico -> 400, sin tocar la lib", async () => {
    const res = await GET(new Request("http://localhost/x"), ctx("abc"));

    expect(res.status).toBe(400);
    expect(obtenerConciliacionCombustible).not.toHaveBeenCalled();
  });

  it("id <= 0 -> 400, sin tocar la lib", async () => {
    const res = await GET(new Request("http://localhost/x"), ctx("0"));

    expect(res.status).toBe(400);
    expect(obtenerConciliacionCombustible).not.toHaveBeenCalled();
  });

  it("conciliación inexistente o de otra empresa (capa devuelve null) -> 404", async () => {
    vi.mocked(obtenerConciliacionCombustible).mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/x"), ctx("999"));

    expect(res.status).toBe(404);
    expect(obtenerConciliacionCombustible).toHaveBeenCalledWith(20, 999);
  });

  it("devuelve el detalle acotado a la empresa de la sesión (aislamiento tenant)", async () => {
    vi.mocked(obtenerConciliacionCombustible).mockResolvedValue({
      id: 5,
      nombreOriginal: "reporte.xlsx",
      hoja: "2026",
      subidoPor: "ops",
      creadoEn: "2026-09-04 10:00:00",
      periodoDesde: "2026-08-01",
      periodoHasta: "2026-08-31",
      filas: [],
    });

    const res = await GET(new Request("http://localhost/x"), ctx("5"));
    const data = await res.json();

    expect(res.status).toBe(200);
    // Siempre empresa de la SESIÓN (20), nunca algo que pudiera venir
    // del cliente.
    expect(obtenerConciliacionCombustible).toHaveBeenCalledWith(20, 5);
    expect(data.item.id).toBe(5);
  });

  it("un error de la capa de consultas responde 500", async () => {
    vi.mocked(obtenerConciliacionCombustible).mockRejectedValue(
      new Error("boom"),
    );

    const res = await GET(new Request("http://localhost/x"), ctx("5"));

    expect(res.status).toBe(500);
  });
});
