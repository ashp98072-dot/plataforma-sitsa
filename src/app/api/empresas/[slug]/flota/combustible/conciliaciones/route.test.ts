import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FLOTA-COMBUSTIBLE-4 — solo cubre el GET (historial) agregado en este
 * ticket. El POST (FLOTA-COMBUSTIBLE-3, importar/conciliar) no tenía un
 * route.test.ts previo y no se reescribe aquí (fuera de alcance).
 */

vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: vi.fn() }));
vi.mock("@/lib/flota/combustible-conciliacion-consultas", () => ({
  listarConciliacionesCombustible: vi.fn(),
}));

import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { listarConciliacionesCombustible } from "@/lib/flota/combustible-conciliacion-consultas";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFlotaCombustible).mockResolvedValue(
    { empresa: { id: 20 }, session: { id: 1, username: "op1" } } as Awaited<
      ReturnType<typeof requireTenantFlotaCombustible>
    >,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/empresas/[slug]/flota/combustible/conciliaciones (historial)", () => {
  it("exige flota_combustible:ver (no editar) antes de tocar la lib", async () => {
    vi.mocked(requireTenantFlotaCombustible).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantFlotaCombustible>>);

    const res = await GET(new Request("http://localhost/x"), ctx);

    expect(res.status).toBe(403);
    expect(requireTenantFlotaCombustible).toHaveBeenCalledWith("prueba", "ver");
    expect(listarConciliacionesCombustible).not.toHaveBeenCalled();
  });

  it("devuelve { items } acotado a la empresa de la sesión", async () => {
    vi.mocked(listarConciliacionesCombustible).mockResolvedValue([
      {
        id: 5,
        nombreOriginal: "reporte.xlsx",
        hoja: "2026",
        subidoPor: "ops",
        creadoEn: "2026-09-04 10:00:00",
        periodoDesde: "2026-08-01",
        periodoHasta: "2026-08-31",
        totalFilas: 10,
        descartadas: 0,
        coincide: 8,
        diferencia: 2,
        soloGasolinera: 0,
        soloSistema: 0,
        ambiguo: 0,
      },
    ]);

    const res = await GET(new Request("http://localhost/x"), ctx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(listarConciliacionesCombustible).toHaveBeenCalledWith(20);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].id).toBe(5);
  });

  it("un error de la capa de consultas responde 500 sin filtrar detalles internos", async () => {
    vi.mocked(listarConciliacionesCombustible).mockRejectedValue(
      new Error("boom"),
    );

    const res = await GET(new Request("http://localhost/x"), ctx);

    expect(res.status).toBe(500);
  });
});
