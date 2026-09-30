import { describe, expect, it } from "vitest";
import { claveAgrupacion, resolverPeriodoPlanes } from "./planes-periodo";

/**
 * PLANES-CIERRE-PERIODO — resolución PURA del período Día/Semana/Mes de Planes / Viajes. Referencia de
 * calendario 2026 (misma usada en viaticos-agrupacion.test.ts): 1/01/2026 y 24/09/2026 son jueves,
 * 31/12/2026 es jueves — por eso 2026 tiene 53 semanas ISO (semana 53 = lunes 28/12/2026 a domingo
 * 03/01/2027, cruzando el año calendario). `desde`/`hasta` son SIEMPRE inclusivos (fecha_plan es DATE).
 */
describe("DIA", () => {
  it("1. Día conserva comportamiento actual: clave/desde/hasta = la misma fecha, inclusive", () => {
    expect(resolverPeriodoPlanes("DIA", "2026-09-30")).toEqual({
      clave: "2026-09-30",
      etiqueta: "30/09/2026",
      desde: "2026-09-30",
      hasta: "2026-09-30",
    });
  });

  it("DIA inválido (fecha de calendario inexistente o formato incorrecto) -> null", () => {
    expect(resolverPeriodoPlanes("DIA", "2026-02-30")).toBeNull();
    expect(resolverPeriodoPlanes("DIA", "2026-13-01")).toBeNull();
    expect(resolverPeriodoPlanes("DIA", "")).toBeNull();
    expect(resolverPeriodoPlanes("DIA", "30/09/2026")).toBeNull();
  });

  it("DIA en año bisiesto: 2028-02-29 es válido", () => {
    expect(resolverPeriodoPlanes("DIA", "2028-02-29")).toEqual({
      clave: "2028-02-29",
      etiqueta: "29/02/2028",
      desde: "2028-02-29",
      hasta: "2028-02-29",
    });
  });
});

describe("SEMANA (lunes-domingo, ISO)", () => {
  it("2. Semana lunes-domingo dentro de un solo mes: 2026-W38 (lunes 14 a domingo 20 de septiembre)", () => {
    expect(resolverPeriodoPlanes("SEMANA", "2026-W38")).toEqual({
      clave: "2026-W38",
      etiqueta: "Semana 38 · 14/09/2026 al 20/09/2026",
      desde: "2026-09-14",
      hasta: "2026-09-20",
    });
  });

  it("3. semana cruza mes: 2026-W40 (lunes 28 de septiembre a domingo 4 de octubre)", () => {
    expect(resolverPeriodoPlanes("SEMANA", "2026-W40")).toEqual({
      clave: "2026-W40",
      etiqueta: "Semana 40 · 28/09/2026 al 04/10/2026",
      desde: "2026-09-28",
      hasta: "2026-10-04",
    });
  });

  it("4. semana cruza año: 2026-W53 (lunes 28 de diciembre de 2026 a domingo 3 de enero de 2027)", () => {
    expect(resolverPeriodoPlanes("SEMANA", "2026-W53")).toEqual({
      clave: "2026-W53",
      etiqueta: "Semana 53 · 28/12/2026 al 03/01/2027",
      desde: "2026-12-28",
      hasta: "2027-01-03",
    });
  });

  it("semana inexistente en el año ISO (2025 solo tiene 52 semanas) -> null", () => {
    expect(resolverPeriodoPlanes("SEMANA", "2025-W53")).toBeNull();
  });

  it("semana con formato inválido -> null", () => {
    expect(resolverPeriodoPlanes("SEMANA", "2026-40")).toBeNull();
    expect(resolverPeriodoPlanes("SEMANA", "2026-W00")).toBeNull();
    expect(resolverPeriodoPlanes("SEMANA", "2026-W54")).toBeNull();
    expect(resolverPeriodoPlanes("SEMANA", "")).toBeNull();
  });
});

describe("MES", () => {
  it("5. Mes agrupa correctamente: 2026-09 -> desde 2026-09-01, hasta 2026-09-30 (inclusive, DATE)", () => {
    expect(resolverPeriodoPlanes("MES", "2026-09")).toEqual({
      clave: "2026-09",
      etiqueta: "Septiembre 2026",
      desde: "2026-09-01",
      hasta: "2026-09-30",
    });
  });

  it("mes de 31 días y febrero (no bisiesto/bisiesto)", () => {
    expect(resolverPeriodoPlanes("MES", "2026-01")?.hasta).toBe("2026-01-31");
    expect(resolverPeriodoPlanes("MES", "2026-02")?.hasta).toBe("2026-02-28");
    expect(resolverPeriodoPlanes("MES", "2028-02")?.hasta).toBe("2028-02-29");
  });

  it("MES diciembre no se sale de año (sigue siendo diciembre, no rueda a enero como en un rango semiabierto)", () => {
    expect(resolverPeriodoPlanes("MES", "2026-12")).toEqual({
      clave: "2026-12",
      etiqueta: "Diciembre 2026",
      desde: "2026-12-01",
      hasta: "2026-12-31",
    });
  });

  it("MES inválido -> null", () => {
    expect(resolverPeriodoPlanes("MES", "2026-13")).toBeNull();
    expect(resolverPeriodoPlanes("MES", "2026-00")).toBeNull();
    expect(resolverPeriodoPlanes("MES", "2026-9")).toBeNull();
    expect(resolverPeriodoPlanes("MES", "")).toBeNull();
  });
});

describe("tipo de agrupación", () => {
  it("tipo desconocido -> null", () => {
    expect(resolverPeriodoPlanes("ANIO", "2026")).toBeNull();
    expect(resolverPeriodoPlanes("", "2026-09-30")).toBeNull();
  });
});

describe("claveAgrupacion — a qué grupo pertenece un fechaPlan dado", () => {
  it("DIA: la fecha tal cual (recortada a 10 caracteres si trae hora/offset)", () => {
    expect(claveAgrupacion("2026-09-30", "DIA")).toBe("2026-09-30");
    expect(claveAgrupacion("2026-09-30T00:00:00.000Z", "DIA")).toBe("2026-09-30");
  });

  it("MES: los primeros 7 caracteres", () => {
    expect(claveAgrupacion("2026-09-30", "MES")).toBe("2026-09");
  });

  it("SEMANA: la clave ISO de esa fecha, consistente con resolverPeriodoPlanes", () => {
    expect(claveAgrupacion("2026-09-28", "SEMANA")).toBe("2026-W40");
    expect(claveAgrupacion("2026-10-04", "SEMANA")).toBe("2026-W40"); // domingo de la MISMA semana
    expect(claveAgrupacion("2026-12-31", "SEMANA")).toBe("2026-W53"); // cruce de año
    const clave = claveAgrupacion("2026-09-30", "SEMANA");
    const p = resolverPeriodoPlanes("SEMANA", clave);
    expect(p?.desde).toBe("2026-09-28");
    expect(p?.hasta).toBe("2026-10-04");
  });
});
