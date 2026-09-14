import { describe, expect, it } from "vitest";
import { siguienteValorHora12 } from "./hora-input-12h";

/**
 * OPERACIONES-HORA-12H-1 — prueba la lógica PURA extraída del componente
 * (mismo criterio que catalogo-search-select.test.ts: nunca se renderiza
 * el DOM del selector).
 */
describe("siguienteValorHora12", () => {
  it("cambia la hora conservando minuto/AM-PM existentes", () => {
    expect(siguienteValorHora12("08:30", "hora", "1")).toBe("01:30"); // sigue AM (no se tocó el AM/PM), minuto 30 se conserva
  });

  it("cambia el minuto conservando hora/AM-PM existentes", () => {
    expect(siguienteValorHora12("08:30", "minuto", "45")).toBe("08:45");
  });

  it("cambia AM/PM conservando hora/minuto existentes — 08:30 AM -> 08:30 PM = 20:30", () => {
    expect(siguienteValorHora12("08:30", "ampm", "PM")).toBe("20:30");
  });

  it("sin valor previo (campo vacío/inválido): usa 12:00 AM como base antes de aplicar el cambio", () => {
    expect(siguienteValorHora12("", "hora", "8")).toBe("08:00"); // 8 AM
    expect(siguienteValorHora12("", "minuto", "15")).toBe("00:15"); // 12:15 AM
    expect(siguienteValorHora12("", "ampm", "PM")).toBe("12:00"); // 12:00 PM
  });

  it("vaciar CUALQUIERA de los 3 selects colapsa el valor completo a '' (todo o nada, igual que el input nativo al borrarse)", () => {
    expect(siguienteValorHora12("08:30", "hora", "")).toBe("");
    expect(siguienteValorHora12("08:30", "minuto", "")).toBe("");
    expect(siguienteValorHora12("08:30", "ampm", "")).toBe("");
  });

  it.each([
    ["00:00", "hora", "12", "00:00"], // ya era 12 AM (00:00), reelegir 12 en el select de hora no cambia nada
    ["13:00", "hora", "1", "13:00"], // ya era 1 PM (13:00), reelegir 1 en el select de hora no cambia nada
  ] as const)("caso límite: %s + hora=%s -> %s", (actual, campo, valor, esperado) => {
    expect(siguienteValorHora12(actual, campo, valor)).toBe(esperado);
  });
});
