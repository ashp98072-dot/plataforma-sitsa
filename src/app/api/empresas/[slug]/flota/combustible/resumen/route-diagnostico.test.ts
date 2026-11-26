import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ historico: vi.fn(), integrado: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: async () => ({ empresa: { id: 1 } }) }));
vi.mock("@/lib/flota/combustible", () => ({ resumenCombustibleMensual: mocks.historico }));
vi.mock("@/lib/flota/cb2/resumen-mensual", () => ({ resumenIntegrado: mocks.integrado }));
import { GET } from "./route";
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
it.each(["historico", "integrado"] as const)("registra etapa %s y código sin exponer el detalle SQL", async etapa => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const error = Object.assign(new Error("consulta y datos sensibles"), { code: "ER_BAD_FIELD_ERROR" });
  mocks.historico.mockResolvedValue({ total: 1 });
  if (etapa === "historico") mocks.historico.mockRejectedValue(error); else mocks.integrado.mockRejectedValue(error);
  const r = await GET(new Request("http://localhost/resumen?mes=2026-11"), { params: Promise.resolve({ slug: "empresa" }) });
  expect(r.status).toBe(500);
  expect(await r.json()).toEqual({ error: "No se pudo cargar el resumen completo. Vuelve a intentar o contacta a soporte." });
  expect(log).toHaveBeenCalledWith("[combustible-resumen]", expect.objectContaining({ etapa, codigo: "ER_BAD_FIELD_ERROR", duracionMs: expect.any(Number) }));
  expect(JSON.stringify(log.mock.calls)).not.toContain("sensibles");
});
it("descarta códigos arbitrarios que podrían contener datos", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.historico.mockRejectedValue(Object.assign(new Error("privado"), { code: "DATO_PRIVADO" }));
  const r = await GET(new Request("http://localhost/resumen?mes=2026-11"), { params: Promise.resolve({ slug: "empresa" }) });
  expect(r.status).toBe(500);
  expect(log).toHaveBeenCalledWith("[combustible-resumen]", expect.objectContaining({ codigo: "DESCONOCIDO" }));
  expect(JSON.stringify(log.mock.calls)).not.toContain("DATO_PRIVADO");
});
