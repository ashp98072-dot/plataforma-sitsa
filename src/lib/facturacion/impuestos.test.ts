import { describe, expect, it } from "vitest";
import {
  calcularTotalesFactura,
  calcularTotalesLinea,
  POLITICA_IVA_FACTURACION,
} from "./impuestos";

const CON_IVA = { porcentajeIva: 12, precioIncluyeIva: true };
const SIN_IVA = { porcentajeIva: 12, precioIncluyeIva: false };

describe("calcularTotalesLinea — precio CON IVA incluido", () => {
  it("112.00 → base 100.00 + IVA 12.00", () => {
    expect(calcularTotalesLinea({ montoLinea: 112, ...CON_IVA })).toEqual({ base: 100, iva: 12, total: 112 });
  });

  it("redondeo half-up a 2 decimales: 100.00 → base 89.29 + IVA 10.71 (89.2857… sube)", () => {
    expect(calcularTotalesLinea({ montoLinea: 100, ...CON_IVA })).toEqual({ base: 89.29, iva: 10.71, total: 100 });
  });

  it("1000.00 → base 892.86 + IVA 107.14", () => {
    expect(calcularTotalesLinea({ montoLinea: 1000, ...CON_IVA })).toEqual({ base: 892.86, iva: 107.14, total: 1000 });
  });

  it("montos mínimos no pierden céntimos: 0.01 → 0.01 + 0.00; 0.05 → 0.04 + 0.01", () => {
    expect(calcularTotalesLinea({ montoLinea: 0.01, ...CON_IVA })).toEqual({ base: 0.01, iva: 0, total: 0.01 });
    expect(calcularTotalesLinea({ montoLinea: 0.05, ...CON_IVA })).toEqual({ base: 0.04, iva: 0.01, total: 0.05 });
  });

  it("monto cero → todo cero", () => {
    expect(calcularTotalesLinea({ montoLinea: 0, ...CON_IVA })).toEqual({ base: 0, iva: 0, total: 0 });
  });

  it("acepta texto decimal y lo redondea al capturar (112.004 → 112.00)", () => {
    expect(calcularTotalesLinea({ montoLinea: "112.004", ...CON_IVA })).toEqual({ base: 100, iva: 12, total: 112 });
  });

  it("base + IVA == total EXACTAMENTE para miles de montos (sin céntimos perdidos)", () => {
    let semilla = 12345;
    for (let i = 0; i < 3000; i++) {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      const centavos = semilla % 5_000_000; // hasta Q50,000.00
      const monto = centavos / 100;
      const t = calcularTotalesLinea({ montoLinea: monto, ...CON_IVA });
      expect(Number((t.base + t.iva).toFixed(2))).toBe(t.total);
      expect(t.total).toBe(monto);
    }
  });
});

describe("calcularTotalesLinea — precio SIN IVA (el IVA se suma)", () => {
  it("100.00 → base 100.00 + IVA 12.00 = 112.00", () => {
    expect(calcularTotalesLinea({ montoLinea: 100, ...SIN_IVA })).toEqual({ base: 100, iva: 12, total: 112 });
  });

  it("33.33 → IVA 4.00 (3.9996 redondea) y total 37.33", () => {
    expect(calcularTotalesLinea({ montoLinea: 33.33, ...SIN_IVA })).toEqual({ base: 33.33, iva: 4, total: 37.33 });
  });
});

describe("calcularTotalesFactura — varias líneas", () => {
  it("el total es la SUMA de líneas ya redondeadas: 3 × 100.00 → subtotal 267.87 + IVA 32.13 = 300.00", () => {
    const t = calcularTotalesFactura({ montosLinea: [100, 100, 100], ...CON_IVA });
    expect(t).toEqual({ subtotal: 267.87, iva: 32.13, total: 300 });
    expect(Number((t.subtotal + t.iva).toFixed(2))).toBe(t.total);
  });

  it("el total exacto de la factura = suma exacta de los montos capturados (con IVA incluido)", () => {
    const montos = [1500, 2750.5, 980.25, 0.01];
    const t = calcularTotalesFactura({ montosLinea: montos, ...CON_IVA });
    expect(t.total).toBe(5230.76);
  });

  it("aritmética decimal, no float: 0.1 + 0.2 = 0.30 exacto", () => {
    expect(calcularTotalesFactura({ montosLinea: [0.1, 0.2], ...CON_IVA }).total).toBe(0.3);
  });

  it("sin líneas → ceros", () => {
    expect(calcularTotalesFactura({ montosLinea: [], ...CON_IVA })).toEqual({ subtotal: 0, iva: 0, total: 0 });
  });

  it("sin IVA incluido: 2 líneas de 100.00 → subtotal 200.00 + IVA 24.00 = 224.00", () => {
    expect(calcularTotalesFactura({ montosLinea: [100, 100], ...SIN_IVA })).toEqual({ subtotal: 200, iva: 24, total: 224 });
  });
});

describe("validación de entradas", () => {
  it("rechaza montos negativos, NaN e Infinity", () => {
    expect(() => calcularTotalesLinea({ montoLinea: -1, ...CON_IVA })).toThrow(RangeError);
    expect(() => calcularTotalesLinea({ montoLinea: Number.NaN, ...CON_IVA })).toThrow(RangeError);
    expect(() => calcularTotalesLinea({ montoLinea: Number.POSITIVE_INFINITY, ...CON_IVA })).toThrow(RangeError);
    expect(() => calcularTotalesLinea({ montoLinea: "abc", ...CON_IVA })).toThrow(RangeError);
  });

  it("rechaza un porcentaje de IVA fuera de 0–100", () => {
    expect(() => calcularTotalesLinea({ montoLinea: 100, porcentajeIva: -1, precioIncluyeIva: true })).toThrow(RangeError);
    expect(() => calcularTotalesLinea({ montoLinea: 100, porcentajeIva: 101, precioIncluyeIva: true })).toThrow(RangeError);
  });

  it("IVA 0 %: base == total, IVA 0", () => {
    expect(calcularTotalesLinea({ montoLinea: 250, porcentajeIva: 0, precioIncluyeIva: true })).toEqual({ base: 250, iva: 0, total: 250 });
  });
});

describe("política de IVA vigente (decisión pendiente de Contabilidad)", () => {
  it("está encapsulada en UN solo valor: 12 % y precio con IVA incluido, inmutable", () => {
    expect(POLITICA_IVA_FACTURACION).toEqual({ porcentajeIva: 12, precioIncluyeIva: true });
    expect(Object.isFrozen(POLITICA_IVA_FACTURACION)).toBe(true);
  });

  it("cambiar la política cambia el resultado SIN tocar el cálculo (misma función, otro parámetro)", () => {
    const con = calcularTotalesFactura({ montosLinea: [112], ...CON_IVA });
    const sin = calcularTotalesFactura({ montosLinea: [112], ...SIN_IVA });
    expect(con.total).toBe(112);
    expect(sin.total).toBe(125.44);
  });
});
