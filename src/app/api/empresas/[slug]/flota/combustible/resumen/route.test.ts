import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlotaLectura: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/flota/combustible", () => ({ resumenCombustibleMensual: vi.fn() }));
vi.mock("@/lib/flota/cb2/resumen-mensual", () => ({ resumenIntegrado: vi.fn() }));

import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { resumenCombustibleMensual } from "@/lib/flota/combustible";
import { resumenIntegrado } from "@/lib/flota/cb2/resumen-mensual";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

const RESUMEN_VACIO = {
  porVehiculo: [],
  total: { dieselGalones: 0, dieselMonto: 0, gasolinaGalones: 0, gasolinaMonto: 0, totalGalones: 0, totalMonto: 0, cargas: 0 },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFlotaCombustible).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 1, username: "op1" } } as Awaited<ReturnType<typeof requireTenantFlotaCombustible>>,
  );
  vi.mocked(resumenCombustibleMensual).mockResolvedValue(RESUMEN_VACIO);
  vi.mocked(resumenIntegrado).mockResolvedValue({ grupos: [], subtotales: {}, totalGTQ: { galones: "0", monto: "0" }, excluidas: [], ambiguas: [], provisional: false });
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/empresas/[slug]/flota/combustible/resumen", () => {
  it("exige flota_combustible:ver (no :editar — es un reporte de lectura) antes de tocar la lib", async () => {
    vi.mocked(requireTenantFlotaCombustible).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantFlotaCombustible>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(resumenCombustibleMensual).not.toHaveBeenCalled();
    expect(requireTenantFlotaCombustible).toHaveBeenCalledWith("prueba", "ver");
  });

  it("con ?mes= válido, lo pasa tal cual a la lib", async () => {
    const res = await GET(new Request("http://localhost/x?mes=2026-09"), ctx);
    expect(res.status).toBe(200);
    expect(resumenCombustibleMensual).toHaveBeenCalledWith(7, "2026-09");
    const data = await res.json();
    expect(data.mes).toBe("2026-09");
  });

  it("sin ?mes=, usa el mes actual (no lo deja undefined)", async () => {
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    const [, mesUsado] = vi.mocked(resumenCombustibleMensual).mock.calls[0];
    expect(mesUsado).toMatch(/^\d{4}-\d{2}$/);
  });

  it.each(["", "no-es-un-mes", "2026-00", "2026-13", "0001-05", "1999-12", "9999-12"])("mes inválido %s responde 400 sin consultas", async mes => {
    const res = await GET(new Request(`http://localhost/x?mes=${mes}`), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Mes inválido. Usa AAAA-MM desde 2000-01 hasta 9999-11." });
    expect(resumenCombustibleMensual).not.toHaveBeenCalled();
    expect(resumenIntegrado).not.toHaveBeenCalled();
  });

  it("si falla el resumen, responde 500 con mensaje genérico", async () => {
    vi.mocked(resumenCombustibleMensual).mockRejectedValue(new Error("Mes inválido"));
    const res = await GET(new Request("http://localhost/x?mes=2026-05"), ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "No se pudo cargar el resumen completo. Vuelve a intentar o contacta a soporte." });
  });
});
