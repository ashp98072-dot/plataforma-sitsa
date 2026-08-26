import { describe, expect, it } from "vitest";
import { distribuirCuotas, statusParaMotivo } from "./descuentos";

describe("cuotas críticas de descuentos", () => {
  it("distribuye el total exacto y coloca el residuo en la última cuota", () => {
    const cuotas = distribuirCuotas(100, 3);
    expect(cuotas).toEqual([33.33, 33.33, 33.34]);
    expect(cuotas.reduce((total, cuota) => total + cuota, 0)).toBeCloseTo(100, 2);
  });

  it("nunca crea cero cuotas", () => {
    expect(distribuirCuotas(25, 0)).toEqual([25]);
  });

  it("conserva códigos HTTP de conflictos operativos", () => {
    expect(statusParaMotivo("estado_no_permite")).toBe(409);
    expect(statusParaMotivo("no_encontrado")).toBe(404);
  });
});
