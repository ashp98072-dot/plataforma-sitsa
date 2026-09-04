import { describe, expect, it } from "vitest";
import {
  TOLERANCIA_DIFERENCIA_MONTO,
  calcularDiferenciaMonto,
  calcularTotalEstimado,
  esFechaCalendarioValida,
  excedeTolerancia,
} from "./combustible-form-ui";

describe("calcularTotalEstimado (galones × precio por galón)", () => {
  it("multiplica galones por precio y redondea a centavos", () => {
    expect(calcularTotalEstimado(35.2, 24.15)).toBeCloseTo(850.08, 2);
  });

  it("galones o precio <= 0 -> null (no hay total que mostrar)", () => {
    expect(calcularTotalEstimado(0, 24.15)).toBeNull();
    expect(calcularTotalEstimado(35.2, 0)).toBeNull();
    expect(calcularTotalEstimado(-1, 24.15)).toBeNull();
  });

  it("valores no finitos (NaN) -> null", () => {
    expect(calcularTotalEstimado(NaN, 24.15)).toBeNull();
    expect(calcularTotalEstimado(35.2, NaN)).toBeNull();
  });

  // AJUSTE PRE-MERGE (PR #192, sección 1) — datos REALES del reporte de
  // la gasolinera ("CONTROL DE VALES MONACO S.A.-196.xlsx", columna GLS
  // con 3 decimales): 5.098, 7.150, 13.248. Se confirma que el cálculo
  // usa los galones con toda su precisión (3 decimales) ANTES de
  // multiplicar — solo el TOTAL se redondea a centavos al final, nunca
  // los galones de entrada.
  describe("con galones de 3 decimales (datos reales del reporte de la gasolinera)", () => {
    it("5.098 gal × Q21.26 = Q108.38 (si los galones se redondearan primero a 5.10, daría Q108.43 — un resultado distinto e incorrecto)", () => {
      expect(calcularTotalEstimado(5.098, 21.26)).toBeCloseTo(108.38, 2);
    });

    it("7.150 gal × Q21.26 = Q152.01", () => {
      expect(calcularTotalEstimado(7.15, 21.26)).toBeCloseTo(152.01, 2);
    });

    it("13.248 gal × Q21.26 = Q281.65 (si los galones se redondearan primero a 13.25, daría Q281.70 — un resultado distinto e incorrecto)", () => {
      expect(calcularTotalEstimado(13.248, 21.26)).toBeCloseTo(281.65, 2);
    });
  });
});

describe("calcularDiferenciaMonto (monto del vale vs. total calculado)", () => {
  it("ejemplo del ticket: galones 35.20, precio Q24.15 -> calculado Q850.08, vale Q850.00 -> diferencia Q0.08", () => {
    const calculado = calcularTotalEstimado(35.2, 24.15);
    expect(calculado).toBeCloseTo(850.08, 2);
    const diferencia = calcularDiferenciaMonto(850, calculado);
    expect(diferencia).toBeCloseTo(-0.08, 2);
  });

  it("monto exactamente igual al calculado -> diferencia 0", () => {
    expect(calcularDiferenciaMonto(850, 850)).toBe(0);
  });

  it("total calculado null (galones/precio incompletos) -> diferencia null", () => {
    expect(calcularDiferenciaMonto(850, null)).toBeNull();
  });
});

describe("excedeTolerancia", () => {
  it("Q0.08 de diferencia SÍ excede la tolerancia por defecto (Q0.05) — ejemplo del ticket", () => {
    expect(excedeTolerancia(-0.08)).toBe(true);
    expect(TOLERANCIA_DIFERENCIA_MONTO).toBe(0.05);
  });

  it("una diferencia pequeña (redondeo de centavos) NO excede la tolerancia por defecto", () => {
    expect(excedeTolerancia(0.01)).toBe(false);
    expect(excedeTolerancia(0.05)).toBe(false); // límite inclusive: no excede
  });

  it("diferencia null (nada que comparar todavía) -> false, nunca advierte de más", () => {
    expect(excedeTolerancia(null)).toBe(false);
  });

  it("acepta una tolerancia distinta a la de por defecto", () => {
    expect(excedeTolerancia(0.3, 0.5)).toBe(false);
    expect(excedeTolerancia(0.6, 0.5)).toBe(true);
  });

  it("la diferencia con signo negativo también se evalúa por magnitud (abs)", () => {
    expect(excedeTolerancia(-10)).toBe(true);
  });
});

// AJUSTE PRE-MERGE (PR #192, sección 2) — bug real: un chequeo ingenuo
// con `!Number.isNaN(new Date(valor).getTime())` deja pasar fechas
// calendario imposibles ("2026-02-31") porque el constructor de Date
// normaliza el desbordamiento en vez de fallar. Matriz de casos exacta
// pedida en la revisión.
describe("esFechaCalendarioValida", () => {
  it("2026-02-28 -> válida", () => {
    expect(esFechaCalendarioValida("2026-02-28")).toBe(true);
  });

  it("2026-02-29 -> inválida (2026 NO es bisiesto)", () => {
    expect(esFechaCalendarioValida("2026-02-29")).toBe(false);
  });

  it("2028-02-29 -> válida (2028 SÍ es bisiesto)", () => {
    expect(esFechaCalendarioValida("2028-02-29")).toBe(true);
  });

  it("2026-02-31 -> inválida (bug real: Date la normalizaba silenciosamente a marzo)", () => {
    expect(esFechaCalendarioValida("2026-02-31")).toBe(false);
  });

  it("2026-04-31 -> inválida (abril tiene 30 días)", () => {
    expect(esFechaCalendarioValida("2026-04-31")).toBe(false);
  });

  it("formato incorrecto ('02/09/2026', vacío, mes/día fuera de rango) -> inválida", () => {
    expect(esFechaCalendarioValida("02/09/2026")).toBe(false);
    expect(esFechaCalendarioValida("")).toBe(false);
    expect(esFechaCalendarioValida("2026-13-01")).toBe(false);
    expect(esFechaCalendarioValida("2026-00-10")).toBe(false);
    expect(esFechaCalendarioValida("2026-01-00")).toBe(false);
  });

  it("fecha real y válida del reporte (formato YYYY-MM-DD estándar) -> válida", () => {
    expect(esFechaCalendarioValida("2026-09-02")).toBe(true);
  });
});
