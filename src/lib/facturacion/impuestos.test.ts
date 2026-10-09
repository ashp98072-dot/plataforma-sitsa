import { describe, expect, it } from "vitest";
import {
  calcularTotalesFactura,
  calcularTotalesLinea,
  PORCENTAJE_IVA_FASE1,
  politicaIva,
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

const PCT = 12;
const lin = (montoLinea: number | string, precioIncluyeIva: boolean) => ({ montoLinea, precioIncluyeIva });

describe("calcularTotalesFactura — varias líneas, cada una con SU política", () => {
  it("todas con IVA incluido: 3 × 100.00 → subtotal 267.87 + IVA 32.13 = 300.00 (suma de líneas redondeadas)", () => {
    const t = calcularTotalesFactura({ porcentajeIva: PCT, lineas: [lin(100, true), lin(100, true), lin(100, true)] });
    expect({ subtotal: t.subtotal, iva: t.iva, total: t.total }).toEqual({ subtotal: 267.87, iva: 32.13, total: 300 });
    expect(Number((t.subtotal + t.iva).toFixed(2))).toBe(t.total);
  });

  it("3) MEZCLA: Q100 incluido + Q100 agregado → subtotal 189.29, IVA 22.71, total 212.00", () => {
    const t = calcularTotalesFactura({ porcentajeIva: PCT, lineas: [lin(100, true), lin(100, false)] });
    expect(t.lineas).toEqual([{ base: 89.29, iva: 10.71, total: 100 }, { base: 100, iva: 12, total: 112 }]);
    expect({ subtotal: t.subtotal, iva: t.iva, total: t.total }).toEqual({ subtotal: 189.29, iva: 22.71, total: 212 });
  });

  it("el IVA NUNCA se recalcula globalmente sobre el total agregado (distinto de aplicar una sola política a la suma)", () => {
    const mezcla = calcularTotalesFactura({ porcentajeIva: PCT, lineas: [lin(100, true), lin(100, false)] });
    const global = calcularTotalesFactura({ porcentajeIva: PCT, lineas: [lin(200, true)] });
    expect(mezcla.total).not.toBe(global.total);
    expect(mezcla.total).toBe(Number((mezcla.lineas[0].total + mezcla.lineas[1].total).toFixed(2)));
  });

  it("todas con IVA agregado: 2 × 100.00 → subtotal 200.00 + IVA 24.00 = 224.00", () => {
    expect(calcularTotalesFactura({ porcentajeIva: PCT, lineas: [lin(100, false), lin(100, false)] })).toMatchObject({ subtotal: 200, iva: 24, total: 224 });
  });

  it("el total exacto con IVA incluido = suma exacta de los montos capturados", () => {
    const t = calcularTotalesFactura({ porcentajeIva: PCT, lineas: [1500, 2750.5, 980.25, 0.01].map((m) => lin(m, true)) });
    expect(t.total).toBe(5230.76);
  });

  it("aritmética decimal, no float: 0.1 + 0.2 = 0.30 exacto", () => {
    expect(calcularTotalesFactura({ porcentajeIva: PCT, lineas: [lin(0.1, true), lin(0.2, true)] }).total).toBe(0.3);
  });

  it("sin líneas → ceros", () => {
    expect(calcularTotalesFactura({ porcentajeIva: PCT, lineas: [] })).toEqual({ subtotal: 0, iva: 0, total: 0, lineas: [] });
  });

  it("11) en cualquier combinación de modos subtotal + IVA = total exacto (miles de casos)", () => {
    let semilla = 4242;
    for (let i = 0; i < 2000; i++) {
      const lineas = [] as { montoLinea: number; precioIncluyeIva: boolean }[];
      for (let k = 0; k < 4; k++) {
        semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
        lineas.push({ montoLinea: (semilla % 3_000_000) / 100, precioIncluyeIva: (semilla >> 8) % 2 === 0 });
      }
      const t = calcularTotalesFactura({ porcentajeIva: PCT, lineas });
      expect(Number((t.subtotal + t.iva).toFixed(2)), `caso ${i}`).toBe(t.total);
      expect(t.total).toBe(Number(t.lineas.reduce((s, l) => s + l.total, 0).toFixed(2)));
    }
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

describe("tratamiento de IVA: se elige por LÍNEA, no es una constante global", () => {
  it("politicaIva(true|false) = 12 % + el tratamiento recibido (sin valor por defecto)", () => {
    expect(PORCENTAJE_IVA_FASE1).toBe(12);
    expect(politicaIva(true)).toEqual({ porcentajeIva: 12, precioIncluyeIva: true });
    expect(politicaIva(false)).toEqual({ porcentajeIva: 12, precioIncluyeIva: false });
  });

  it("los DOS modos con la misma función: 112 incluido → 100 + 12 = 112; 112 agregado → 112 + 13.44 = 125.44", () => {
    expect(calcularTotalesLinea({ montoLinea: 112, ...politicaIva(true) })).toEqual({ base: 100, iva: 12, total: 112 });
    expect(calcularTotalesLinea({ montoLinea: 112, ...politicaIva(false) })).toEqual({ base: 112, iva: 13.44, total: 125.44 });
  });

  it("ambos modos mantienen base + IVA = total exacto para miles de montos", () => {
    let semilla = 777;
    for (let i = 0; i < 3000; i++) {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      const monto = (semilla % 5_000_000) / 100;
      for (const incluye of [true, false]) {
        const t = calcularTotalesLinea({ montoLinea: monto, ...politicaIva(incluye) });
        expect(Number((t.base + t.iva).toFixed(2)), `${monto} ${incluye}`).toBe(t.total);
      }
    }
  });
});
