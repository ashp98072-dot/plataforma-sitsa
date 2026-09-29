import { describe, expect, it } from "vitest";
import { porcentajeBarra } from "./grafica-barras";

describe("ATRACCION-TALENTO-2 (corrección pre-SQL, sección 4-5) — porcentajeBarra", () => {
  it("valor 0 produce 0% (nunca una barra visible de 2%)", () => {
    expect(porcentajeBarra(0, 10)).toBe(0);
  });

  it("valor negativo también produce 0%", () => {
    expect(porcentajeBarra(-3, 10)).toBe(0);
  });

  it("valor positivo produce una barra visible (mínimo 2%)", () => {
    expect(porcentajeBarra(1, 100)).toBeGreaterThanOrEqual(2);
  });

  it("el valor máximo del dataset produce 100%", () => {
    expect(porcentajeBarra(10, 10)).toBe(100);
  });

  it("dataset donde todos los valores son 0 (max=0) no rompe: 0%, no NaN/Infinity", () => {
    const r = porcentajeBarra(0, 0);
    expect(r).toBe(0);
    expect(Number.isFinite(r)).toBe(true);
  });

  it("valor intermedio escala proporcionalmente al máximo", () => {
    expect(porcentajeBarra(5, 10)).toBe(50);
  });
});
