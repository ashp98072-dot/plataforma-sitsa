import { describe, expect, it } from "vitest";
import { etiquetaMes, mesCompletoDeRango, rangoDelMes } from "./reportes-mes";

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

/**
 * REPORTES-MENSUALES-CONSOLIDADOS-1 — `mesCompletoDeRango` valida que el
 * PDF mensual consolidado de fondos reciba EXACTAMENTE un mes calendario
 * completo; nunca infiere el mes desde una sola fecha.
 */
describe("mesCompletoDeRango", () => {
  it("un mes calendario completo devuelve { anio, mes }", () => {
    expect(mesCompletoDeRango("2026-09-01", "2026-09-30")).toEqual({ anio: 2026, mes: 9 });
    expect(mesCompletoDeRango("2026-01-01", "2026-01-31")).toEqual({ anio: 2026, mes: 1 });
    expect(mesCompletoDeRango("2026-02-01", "2026-02-28")).toEqual({ anio: 2026, mes: 2 });
    expect(mesCompletoDeRango("2024-02-01", "2024-02-29")).toEqual({ anio: 2024, mes: 2 }); // bisiesto
    expect(mesCompletoDeRango("2026-12-01", "2026-12-31")).toEqual({ anio: 2026, mes: 12 });
  });

  it("rango parcial -> null", () => {
    expect(mesCompletoDeRango("2026-09-10", "2026-09-30")).toBeNull();
    expect(mesCompletoDeRango("2026-09-01", "2026-09-15")).toBeNull();
    expect(mesCompletoDeRango("2026-09-02", "2026-09-29")).toBeNull();
  });

  it("rango que cruza meses -> null", () => {
    expect(mesCompletoDeRango("2026-08-15", "2026-09-15")).toBeNull();
    expect(mesCompletoDeRango("2026-08-01", "2026-09-30")).toBeNull();
  });

  it("febrero de año bisiesto pedido como 28 días -> null (no es el mes completo)", () => {
    expect(mesCompletoDeRango("2024-02-01", "2024-02-28")).toBeNull();
  });

  it("sin fechas o formato inválido -> null", () => {
    expect(mesCompletoDeRango(undefined, undefined)).toBeNull();
    expect(mesCompletoDeRango("2026-09-01", undefined)).toBeNull();
    expect(mesCompletoDeRango(undefined, "2026-09-30")).toBeNull();
    expect(mesCompletoDeRango("01/09/2026", "30/09/2026")).toBeNull();
    expect(mesCompletoDeRango("2026-13-01", "2026-13-31")).toBeNull();
  });
});
