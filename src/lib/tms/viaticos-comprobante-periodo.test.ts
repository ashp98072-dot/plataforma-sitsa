import { describe, expect, it } from "vitest";
import { resolverPeriodoComprobante, valorPeriodoHoy } from "./viaticos-comprobante-periodo";

/**
 * VIATICOS-COMPROBANTE-PERIODO — resolución PURA (sin BD) del rango de fechas de un comprobante de autorización
 * por Día/Semana/Mes. Referencia de calendario 2026 (misma usada en viaticos-agrupacion.test.ts): 1/01/2026 y
 * 24/09/2026 son jueves, 31/12/2026 es jueves — por eso 2026 tiene 53 semanas ISO (semana 53 = lunes 28/12/2026 a
 * domingo 03/01/2027, cruzando el año calendario).
 */
describe("DIA", () => {
  it("1. DIA válido: 2026-09-30 -> rango [2026-09-30 00:00:00, 2026-10-01 00:00:00)", () => {
    expect(resolverPeriodoComprobante("DIA", "2026-09-30")).toEqual({
      inicio: "2026-09-30 00:00:00",
      finExclusivo: "2026-10-01 00:00:00",
      etiqueta: "30 de septiembre de 2026",
      archivo: "viaticos-autorizados-2026-09-30.pdf",
      archivoExcel: "viaticos-autorizados-2026-09-30.xlsx",
    });
  });

  it("2. DIA inválido (fecha de calendario inexistente) -> null", () => {
    expect(resolverPeriodoComprobante("DIA", "2026-02-30")).toBeNull();
    expect(resolverPeriodoComprobante("DIA", "2026-13-01")).toBeNull();
    expect(resolverPeriodoComprobante("DIA", "")).toBeNull();
    expect(resolverPeriodoComprobante("DIA", "no-es-fecha")).toBeNull();
  });

  it("DIA cruzando de mes: 2026-09-30 -> finExclusivo cae en octubre", () => {
    const p = resolverPeriodoComprobante("DIA", "2026-09-30");
    expect(p?.finExclusivo).toBe("2026-10-01 00:00:00");
  });

  it("DIA en año bisiesto: 2028-02-29 es válido", () => {
    const p = resolverPeriodoComprobante("DIA", "2028-02-29");
    expect(p).toEqual({
      inicio: "2028-02-29 00:00:00",
      finExclusivo: "2028-03-01 00:00:00",
      etiqueta: "29 de febrero de 2028",
      archivo: "viaticos-autorizados-2028-02-29.pdf",
      archivoExcel: "viaticos-autorizados-2028-02-29.xlsx",
    });
  });
});

describe("SEMANA", () => {
  it("3. SEMANA ISO válida dentro de un solo mes: 2026-W38 (lunes 14 a domingo 20 de septiembre)", () => {
    expect(resolverPeriodoComprobante("SEMANA", "2026-W38")).toEqual({
      inicio: "2026-09-14 00:00:00",
      finExclusivo: "2026-09-21 00:00:00",
      etiqueta: "14 de septiembre al 20 de septiembre de 2026",
      archivo: "viaticos-autorizados-2026-W38.pdf",
      archivoExcel: "viaticos-autorizados-2026-W38.xlsx",
    });
  });

  it("4. semana cruzando mes: 2026-W40 (lunes 28 de septiembre a domingo 4 de octubre)", () => {
    expect(resolverPeriodoComprobante("SEMANA", "2026-W40")).toEqual({
      inicio: "2026-09-28 00:00:00",
      finExclusivo: "2026-10-05 00:00:00",
      etiqueta: "28 de septiembre al 4 de octubre de 2026",
      archivo: "viaticos-autorizados-2026-W40.pdf",
      archivoExcel: "viaticos-autorizados-2026-W40.xlsx",
    });
  });

  it("5. semana cruzando año: 2026-W53 (lunes 28 de diciembre de 2026 a domingo 3 de enero de 2027)", () => {
    expect(resolverPeriodoComprobante("SEMANA", "2026-W53")).toEqual({
      inicio: "2026-12-28 00:00:00",
      finExclusivo: "2027-01-04 00:00:00",
      etiqueta: "28 de diciembre de 2026 al 3 de enero de 2027",
      archivo: "viaticos-autorizados-2026-W53.pdf",
      archivoExcel: "viaticos-autorizados-2026-W53.xlsx",
    });
  });

  it("semana inválida: 2025-W53 no existe (2025 solo tiene 52 semanas ISO) -> null", () => {
    expect(resolverPeriodoComprobante("SEMANA", "2025-W53")).toBeNull();
  });

  it("semana con formato inválido -> null", () => {
    expect(resolverPeriodoComprobante("SEMANA", "2026-40")).toBeNull();
    expect(resolverPeriodoComprobante("SEMANA", "2026-W00")).toBeNull();
    expect(resolverPeriodoComprobante("SEMANA", "2026-W54")).toBeNull();
    expect(resolverPeriodoComprobante("SEMANA", "")).toBeNull();
  });
});

describe("MES", () => {
  it("6. MES válido: 2026-09 -> [2026-09-01 00:00:00, 2026-10-01 00:00:00)", () => {
    expect(resolverPeriodoComprobante("MES", "2026-09")).toEqual({
      inicio: "2026-09-01 00:00:00",
      finExclusivo: "2026-10-01 00:00:00",
      etiqueta: "septiembre de 2026",
      archivo: "viaticos-autorizados-2026-09.pdf",
      archivoExcel: "viaticos-autorizados-2026-09.xlsx",
    });
  });

  it("7. MES diciembre -> enero del año siguiente", () => {
    expect(resolverPeriodoComprobante("MES", "2026-12")).toEqual({
      inicio: "2026-12-01 00:00:00",
      finExclusivo: "2027-01-01 00:00:00",
      etiqueta: "diciembre de 2026",
      archivo: "viaticos-autorizados-2026-12.pdf",
      archivoExcel: "viaticos-autorizados-2026-12.xlsx",
    });
  });

  it("MES inválido (mes fuera de rango o formato incorrecto) -> null", () => {
    expect(resolverPeriodoComprobante("MES", "2026-13")).toBeNull();
    expect(resolverPeriodoComprobante("MES", "2026-00")).toBeNull();
    expect(resolverPeriodoComprobante("MES", "2026-9")).toBeNull();
    expect(resolverPeriodoComprobante("MES", "")).toBeNull();
  });
});

describe("tipo de período", () => {
  it("8. valor inválido para un tipo reconocido -> null (el caller/route.ts decide el 400)", () => {
    expect(resolverPeriodoComprobante("DIA", "")).toBeNull();
    expect(resolverPeriodoComprobante("SEMANA", "")).toBeNull();
    expect(resolverPeriodoComprobante("MES", "")).toBeNull();
  });

  it("tipo de período desconocido -> null", () => {
    expect(resolverPeriodoComprobante("ANIO", "2026")).toBeNull();
    expect(resolverPeriodoComprobante("", "2026-09-30")).toBeNull();
  });
});

describe("valorPeriodoHoy — valor por defecto del selector de UI", () => {
  it("DIA: devuelve la misma fecha de hoy tal cual", () => {
    expect(valorPeriodoHoy("DIA", "2026-09-30")).toBe("2026-09-30");
  });

  it("MES: recorta la fecha de hoy a 'YYYY-MM'", () => {
    expect(valorPeriodoHoy("MES", "2026-09-30")).toBe("2026-09");
  });

  it("SEMANA: calcula la semana ISO real que contiene la fecha de hoy (2026-09-30 cae en la semana 2026-W40)", () => {
    expect(valorPeriodoHoy("SEMANA", "2026-09-30")).toBe("2026-W40");
    // Consistencia: resolver esa misma semana debe incluir el 30/09/2026 en su rango.
    const p = resolverPeriodoComprobante("SEMANA", valorPeriodoHoy("SEMANA", "2026-09-30"));
    expect(p?.inicio).toBe("2026-09-28 00:00:00");
    expect(p?.finExclusivo).toBe("2026-10-05 00:00:00");
  });

  it("SEMANA cruzando año: 2026-12-31 cae en la semana ISO 2026-W53", () => {
    expect(valorPeriodoHoy("SEMANA", "2026-12-31")).toBe("2026-W53");
  });

  it("fecha inválida -> string vacío", () => {
    expect(valorPeriodoHoy("DIA", "no-es-fecha")).toBe("");
    expect(valorPeriodoHoy("SEMANA", "")).toBe("");
  });
});
