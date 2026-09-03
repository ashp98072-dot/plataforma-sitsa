import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlotaLectura: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/flota/combustible", () => ({ listarCargasCombustibleRevision: vi.fn() }));

import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { listarCargasCombustibleRevision } from "@/lib/flota/combustible";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFlotaCombustible).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 1, username: "op1" } } as Awaited<ReturnType<typeof requireTenantFlotaCombustible>>,
  );
  vi.mocked(listarCargasCombustibleRevision).mockResolvedValue({
    items: [],
    resumen: { PENDIENTE: 0, APROBADO: 0, RECHAZADO: 0 },
  });
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/empresas/[slug]/flota/combustible", () => {
  it("exige flota_combustible:ver antes de tocar la lib", async () => {
    vi.mocked(requireTenantFlotaCombustible).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantFlotaCombustible>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(listarCargasCombustibleRevision).not.toHaveBeenCalled();
    expect(requireTenantFlotaCombustible).toHaveBeenCalledWith("prueba", "ver");
  });

  it("sin filtros: llama a la lib con {} (nunca inventa un estado por defecto)", async () => {
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    expect(listarCargasCombustibleRevision).toHaveBeenCalledWith(7, {
      estado: undefined, desde: undefined, hasta: undefined, vehiculoId: undefined,
    });
  });

  it("pasa estado/desde/hasta/vehiculoId al filtrar", async () => {
    const url = "http://localhost/x?estado=APROBADO&desde=2026-09-01&hasta=2026-09-30&vehiculoId=3";
    const res = await GET(new Request(url), ctx);
    expect(res.status).toBe(200);
    expect(listarCargasCombustibleRevision).toHaveBeenCalledWith(7, {
      estado: "APROBADO", desde: "2026-09-01", hasta: "2026-09-30", vehiculoId: 3,
    });
  });

  it("un estado inválido en la query se ignora (no se pasa a la lib)", async () => {
    const res = await GET(new Request("http://localhost/x?estado=INVALIDO"), ctx);
    expect(res.status).toBe(200);
    expect(listarCargasCombustibleRevision).toHaveBeenCalledWith(7, expect.objectContaining({ estado: undefined }));
  });

  it("arma la url del vale para cada item", async () => {
    vi.mocked(listarCargasCombustibleRevision).mockResolvedValue({
      items: [{ id: 5 } as never],
      resumen: { PENDIENTE: 1, APROBADO: 0, RECHAZADO: 0 },
    });
    const res = await GET(new Request("http://localhost/x"), ctx);
    const data = await res.json();
    expect(data.items[0].url).toBe("/api/empresas/prueba/flota/combustible/5/vale");
  });
});
