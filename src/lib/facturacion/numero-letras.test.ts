import { describe, expect, it } from "vitest";
import { totalEnLetras } from "./numero-letras";

describe("totalEnLetras — quetzales con centavos, determinista", () => {
  it("el ejemplo de la factura actual: Q1,239.44", () => {
    expect(totalEnLetras(1239.44)).toBe("UN MIL DOSCIENTOS TREINTA Y NUEVE CON 44/100");
  });

  it("los importes del ejemplo de IVA: 100, 112, 189.29, 22.71 y 212", () => {
    expect(totalEnLetras(100)).toBe("CIEN CON 00/100");
    expect(totalEnLetras(112)).toBe("CIENTO DOCE CON 00/100");
    expect(totalEnLetras(189.29)).toBe("CIENTO OCHENTA Y NUEVE CON 29/100");
    expect(totalEnLetras(22.71)).toBe("VEINTIDÓS CON 71/100");
    expect(totalEnLetras(212)).toBe("DOSCIENTOS DOCE CON 00/100");
  });

  it("cero y centavos con dos cifras", () => {
    expect(totalEnLetras(0)).toBe("CERO CON 00/100");
    expect(totalEnLetras(0.05)).toBe("CERO CON 05/100");
    expect(totalEnLetras(0.99)).toBe("CERO CON 99/100");
    expect(totalEnLetras(7.5)).toBe("SIETE CON 50/100");
  });

  it("del 1 al 29 (incluye las formas con tilde)", () => {
    const esperado: Record<number, string> = {
      1: "UNO", 10: "DIEZ", 11: "ONCE", 15: "QUINCE", 16: "DIECISÉIS", 20: "VEINTE", 21: "VEINTIUNO",
      22: "VEINTIDÓS", 23: "VEINTITRÉS", 26: "VEINTISÉIS", 29: "VEINTINUEVE",
    };
    for (const [n, texto] of Object.entries(esperado)) expect(totalEnLetras(Number(n)), n).toBe(`${texto} CON 00/100`);
  });

  it("decenas y centenas: «Y» solo entre decena y unidad; CIEN / CIENTO", () => {
    expect(totalEnLetras(30)).toBe("TREINTA CON 00/100");
    expect(totalEnLetras(31)).toBe("TREINTA Y UNO CON 00/100");
    expect(totalEnLetras(99)).toBe("NOVENTA Y NUEVE CON 00/100");
    expect(totalEnLetras(101)).toBe("CIENTO UNO CON 00/100");
    expect(totalEnLetras(500)).toBe("QUINIENTOS CON 00/100");
    expect(totalEnLetras(999)).toBe("NOVECIENTOS NOVENTA Y NUEVE CON 00/100");
  });

  it("miles: «UN MIL», «VEINTIÚN MIL», «CIENTO UN MIL» (el uno se apocopa antes de MIL)", () => {
    expect(totalEnLetras(1000)).toBe("UN MIL CON 00/100");
    expect(totalEnLetras(1001)).toBe("UN MIL UNO CON 00/100");
    expect(totalEnLetras(2000)).toBe("DOS MIL CON 00/100");
    expect(totalEnLetras(21000)).toBe("VEINTIÚN MIL CON 00/100");
    expect(totalEnLetras(31000)).toBe("TREINTA Y UN MIL CON 00/100");
    expect(totalEnLetras(101000)).toBe("CIENTO UN MIL CON 00/100");
    expect(totalEnLetras(100000)).toBe("CIEN MIL CON 00/100");
    expect(totalEnLetras(999999.99)).toBe("NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE CON 99/100");
  });

  it("millones", () => {
    expect(totalEnLetras(1_000_000)).toBe("UN MILLÓN CON 00/100");
    expect(totalEnLetras(1_000_001)).toBe("UN MILLÓN UNO CON 00/100");
    expect(totalEnLetras(2_500_000.5)).toBe("DOS MILLONES QUINIENTOS MIL CON 50/100");
    expect(totalEnLetras(21_000_000)).toBe("VEINTIÚN MILLONES CON 00/100");
    expect(totalEnLetras(100_000_000)).toBe("CIEN MILLONES CON 00/100");
    expect(totalEnLetras(1_000_000_000)).toBe("UN MIL MILLONES CON 00/100");
    expect(totalEnLetras(999_999_999_999.99)).toBe(
      "NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE MILLONES NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE CON 99/100",
    );
  });

  it("redondea a centavos sin arrastrar error de coma flotante", () => {
    expect(totalEnLetras(0.1 + 0.2)).toBe("CERO CON 30/100");
    expect(totalEnLetras(89.29 + 10.71)).toBe("CIEN CON 00/100");
    expect(totalEnLetras(1.005 * 100)).toBe("CIEN CON 50/100");
  });

  it("un monto inválido nunca se convierte en letras", () => {
    for (const malo of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000_000]) {
      expect(() => totalEnLetras(malo), String(malo)).toThrow(RangeError);
    }
    expect(() => totalEnLetras("12" as unknown as number)).toThrow(RangeError);
  });
});
