import { describe, expect, it } from "vitest";
import {
  ETIQUETA_TRAMO,
  TRAMOS_ANTIGUEDAD,
  diasEntre,
  filaExportacionAnt,
  filtrosAntiguedadDesdeParams,
  hoyGuatemala,
  paginacionAntiguedad,
  saldoExacto,
  tramoDe,
  type FilaAntiguedad,
} from "./antiguedad-cxc-shared";

describe("MIL-CXC-ANT-01 · tramos y días (puro)", () => {
  it("fronteras inclusivas: 0/15 · 16/30 · 31/60 · 61/90 · 91+", () => {
    const casos: [number, string][] = [[0, "0-15"], [15, "0-15"], [16, "16-30"], [30, "16-30"], [31, "31-60"], [60, "31-60"], [61, "61-90"], [90, "61-90"], [91, "90+"], [4000, "90+"]];
    for (const [d, t] of casos) expect(tramoDe(d), `${d} días`).toBe(t);
  });
  it("días negativos (emisión posterior al corte) se tratan como 0", () => {
    expect(tramoDe(-5)).toBe("0-15");
  });
  it("hay una etiqueta por tramo y ninguna dice «vencido»", () => {
    for (const t of TRAMOS_ANTIGUEDAD) expect(ETIQUETA_TRAMO[t]).toBeTruthy();
    expect(Object.values(ETIQUETA_TRAMO).join(" ")).not.toMatch(/venc/i);
  });
  it("diasEntre: calendario, cruce de mes/año bisiesto y entradas inválidas", () => {
    expect(diasEntre("2026-11-01", "2026-11-30")).toBe(29);
    expect(diasEntre("2027-12-31", "2028-03-01")).toBe(61); // 2028 es bisiesto
    expect(diasEntre("no-fecha", "2026-11-30")).toBe(0);
    expect(diasEntre("2026-02-30", "2026-03-30")).toBe(0);
  });
  it("hoyGuatemala usa la fecha de Guatemala (UTC-6) y no la de UTC", () => {
    expect(hoyGuatemala(new Date("2026-11-30T03:00:00Z"))).toBe("2026-11-29");
    expect(hoyGuatemala(new Date("2026-11-30T07:00:00Z"))).toBe("2026-11-30");
  });
  it("saldoExacto usa Decimal: 0.1 + 0.2 no deriva", () => {
    expect(saldoExacto("100.30", "0.10")).toBe("100.20");
    expect(saldoExacto("0.30", "0.10")).toBe("0.20");
    expect(saldoExacto("1000000000.01", "0.02")).toBe("999999999.99");
  });
});

describe("MIL-CXC-ANT-01 · filtros de la query string", () => {
  it("acepta cliente, entidad, moneda, tramo y página válidos", () => {
    const f = filtrosAntiguedadDesdeParams(new URLSearchParams("clienteId=5&entidad=9&moneda=usd&tramo=31-60&page=2&pageSize=500"));
    expect(f).toEqual({ clienteId: 5, entidad: 9, moneda: "USD", tramo: "31-60", page: 2, pageSize: 100 });
  });
  it("«sin» = Sin entidad; valores inválidos se ignoran (no llegan al SQL)", () => {
    expect(filtrosAntiguedadDesdeParams(new URLSearchParams("entidad=sin")).entidad).toBe("sin");
    const f = filtrosAntiguedadDesdeParams(new URLSearchParams("clienteId=-1&entidad=x&moneda=Q'; DROP&tramo=100-200&page=0&empresaId=999"));
    expect(f).toEqual({});
  });
  it("la empresa nunca se toma de la query string", () => {
    expect(Object.keys(filtrosAntiguedadDesdeParams(new URLSearchParams("empresaId=3&empresa_id=3")))).toEqual([]);
  });
  it("paginación acotada", () => {
    expect(paginacionAntiguedad({})).toEqual({ page: 1, pageSize: 25, offset: 0 });
    expect(paginacionAntiguedad({ page: 3, pageSize: 1000 })).toEqual({ page: 3, pageSize: 100, offset: 200 });
  });
});

describe("MIL-CXC-ANT-01 · exportación", () => {
  it("fila de exportación: columnas y orden", () => {
    const f: FilaAntiguedad = {
      facturaId: 1, clienteId: 2, cliente: "Cli", numeroFactura: "F-1", fechaEmision: "2026-10-01", diasDesdeEmision: 20, montoOriginal: "100.00",
      montoCobrado: "40.00", saldoPendiente: "60.00", moneda: "GTQ", entidadId: null, entidad: "Sin entidad", tramo: "16-30",
    };
    expect(filaExportacionAnt(f)).toEqual(["Cli", "F-1", "2026-10-01", "20", "16–30 días", "100.00", "40.00", "60.00", "GTQ", "Sin entidad"]);
  });
});
