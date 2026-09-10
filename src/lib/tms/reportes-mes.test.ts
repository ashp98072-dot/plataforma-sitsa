import { describe, expect, it } from "vitest";
import { etiquetaMes, rangoDelMes } from "./reportes-mes";

/**
 * REPORTES-MENSUALES-CONSOLIDADOS-1 — `rangoDelMes` traduce Mes + Año al
 * rango [primer día, último día] en YYYY-MM-DD, para mapear el filtro
 * mensual a los `fechaDesde/fechaHasta` que los reportes ya aceptan.
 */
describe("rangoDelMes", () => {
  it("meses de 31, 30 y 28/29 días", () => {
    expect(rangoDelMes(2026, 1)).toEqual({ desde: "2026-01-01", hasta: "2026-01-31" });
    expect(rangoDelMes(2026, 4)).toEqual({ desde: "2026-04-01", hasta: "2026-04-30" });
    expect(rangoDelMes(2026, 2)).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoDelMes(2024, 2)).toEqual({ desde: "2024-02-01", hasta: "2024-02-29" }); // bisiesto
    expect(rangoDelMes(2026, 12)).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
  });

  it("rellena el mes a dos dígitos", () => {
    expect(rangoDelMes(2026, 3).desde).toBe("2026-03-01");
    expect(rangoDelMes(2026, 9).hasta).toBe("2026-09-30");
  });

  it("acepta strings numéricos (vienen de un <select>)", () => {
    expect(rangoDelMes(Number("2026"), Number("07"))).toEqual({ desde: "2026-07-01", hasta: "2026-07-31" });
  });

  it("mes/año inválido revienta (nunca produce un rango silenciosamente incorrecto)", () => {
    expect(() => rangoDelMes(2026, 0)).toThrow();
    expect(() => rangoDelMes(2026, 13)).toThrow();
    expect(() => rangoDelMes(NaN, 5)).toThrow();
  });
});

describe("etiquetaMes", () => {
  it("nombre del mes en español + año", () => {
    expect(etiquetaMes(2026, 1)).toBe("Enero 2026");
    expect(etiquetaMes(2026, 9)).toBe("Septiembre 2026");
    expect(etiquetaMes(2026, 12)).toBe("Diciembre 2026");
  });
});
