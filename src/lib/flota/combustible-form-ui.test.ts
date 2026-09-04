import { describe, expect, it } from "vitest";
import {
  TOLERANCIA_DIFERENCIA_MONTO,
  calcularDiferenciaMonto,
  calcularTotalEstimado,
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
