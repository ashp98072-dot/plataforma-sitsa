import { describe, expect, it } from "vitest";
import {
  ETIQUETA_TRAMO,
  TRAMOS_ANTIGUEDAD,
  diasEntre,
  filaExportacionAnt,
  filtrosAntiguedadDesdeParams,
  formatearImporte,
  hoyGuatemala,
  paginacionAntiguedad,
  saldoExacto,
  tramoDe,
  validarCorte,
  valorCeldaImporte,
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

const AHORA = new Date("2026-11-30T18:00:00Z"); // 2026-11-30 en Guatemala
const parse = (qs: string, permitirCorte = false) => filtrosAntiguedadDesdeParams(new URLSearchParams(qs), { permitirCorte, ahora: AHORA });

describe("MIL-CXC-ANT-01 · filtros de la query string (estrictos)", () => {
  it("acepta cliente, entidad, moneda, tramo y paginación válidos", () => {
    expect(parse("clienteId=5&entidad=9&moneda=usd&tramo=31-60&page=2&pageSize=100")).toEqual({
      ok: true, filtros: { clienteId: 5, entidad: 9, moneda: "USD", tramo: "31-60", page: 2, pageSize: 100 },
    });
    expect(parse("entidad=sin")).toEqual({ ok: true, filtros: { entidad: "sin" } });
    expect(parse("")).toEqual({ ok: true, filtros: {} });
  });
  it("RECHAZA valores explícitos inválidos: nunca los convierte en «todos»", () => {
    const malos = [
      "clienteId=-1", "clienteId=0", "clienteId=abc", "clienteId=1.5", "clienteId=1e3", "clienteId=99999999999", "clienteId=",
      "entidad=x", "entidad=0", "entidad=SIN", "entidad=",
      "moneda=Q'; DROP", "moneda=GT", "moneda=GTQQ", "moneda=G1Q", "moneda=",
      "tramo=100-200", "tramo=0-15x", "tramo=VENCIDO", "tramo=",
      "page=0", "page=-2", "page=x", "page=1.2", "page=1000001", "page=",
      "pageSize=0", "pageSize=101", "pageSize=500", "pageSize=x", "pageSize=",
    ];
    for (const qs of malos) {
      const r = parse(qs);
      expect(r.ok, qs).toBe(false);
      if (!r.ok) expect(r.error).toBeTruthy();
    }
  });
  it("rechaza parámetros repetidos (ambiguos) y espacios solos", () => {
    expect(parse("clienteId=1&clienteId=2").ok).toBe(false);
    expect(parse("moneda=GTQ&moneda=USD").ok).toBe(false);
    expect(parse("tramo=%20").ok).toBe(false);
  });
  it("un filtro inválido junto a uno válido tampoco pasa a medias", () => {
    expect(parse("moneda=GTQ&clienteId=abc").ok).toBe(false);
  });
  it("la empresa nunca se toma de la query string (parámetros ajenos se ignoran)", () => {
    expect(parse("empresaId=3&empresa_id=3")).toEqual({ ok: true, filtros: {} });
  });
  it("«corte» solo se admite al exportar", () => {
    expect(parse("corte=2026-11-30").ok).toBe(false);
    expect(parse("corte=2026-11-30", true)).toEqual({ ok: true, filtros: {}, corte: "2026-11-30" });
  });
  it("paginación acotada", () => {
    expect(paginacionAntiguedad({})).toEqual({ page: 1, pageSize: 25, offset: 0 });
    expect(paginacionAntiguedad({ page: 3, pageSize: 1000 })).toEqual({ page: 3, pageSize: 100, offset: 200 });
  });
});

describe("MIL-CXC-ANT-01 · fecha de corte conservada (solo hoy/ayer, sin históricos)", () => {
  it("hoy y ayer (Guatemala) son válidos", () => {
    expect(validarCorte("2026-11-30", AHORA)).toEqual({ ok: true, corte: "2026-11-30" });
    expect(validarCorte("2026-11-29", AHORA)).toEqual({ ok: true, corte: "2026-11-29" });
  });
  it("cruce de medianoche: a las 00:30 de Guatemala la pantalla de 'ayer' sigue siendo exportable", () => {
    const despuesDeMedianoche = new Date("2026-12-01T06:30:00Z"); // 2026-12-01 00:30 en Guatemala
    expect(validarCorte("2026-11-30", despuesDeMedianoche)).toEqual({ ok: true, corte: "2026-11-30" });
    expect(validarCorte("2026-11-29", despuesDeMedianoche).ok).toBe(false);
  });
  it("rechaza históricos, futuros y formatos/fechas inexistentes", () => {
    for (const v of ["2026-11-28", "2025-01-01", "2026-12-01", "2026-11-31", "2026-02-30", "30/11/2026", "2026-1-5", "", "hoy", "2026-11-30T00:00:00", "2026-11-30'; DROP TABLE x;--"]) {
      expect(validarCorte(v, AHORA).ok, v).toBe(false);
    }
  });
});

describe("MIL-CXC-ANT-01 · importes sin pérdida de centavos", () => {
  it("formatearImporte opera sobre la cadena (sin Number): máximo DECIMAL(14,2) y sumas gigantes", () => {
    expect(formatearImporte("GTQ", "999999999999.99")).toBe("GTQ 999,999,999,999.99");
    expect(formatearImporte("GTQ", "0.01")).toBe("GTQ 0.01");
    expect(formatearImporte("USD", "1234.5")).toBe("USD 1,234.50");
    expect(formatearImporte("GTQ", "19999999999999.80")).toBe("GTQ 19,999,999,999,999.80"); // 16 dígitos: Number lo perdería
    expect(formatearImporte("GTQ", "123456789012345678.99")).toBe("GTQ 123,456,789,012,345,678.99");
    expect(formatearImporte("GTQ", "-1000.05")).toBe("GTQ -1,000.05");
    expect(formatearImporte("GTQ", null)).toBe("GTQ 0.00");
  });
  it("valorCeldaImporte: número exacto hasta 15 dígitos; texto exacto si no", () => {
    expect(valorCeldaImporte("999999999999.99")).toBe(999999999999.99);
    expect(valorCeldaImporte("0.01")).toBe(0.01);
    expect(valorCeldaImporte("100.20")).toBe(100.2);
    expect(valorCeldaImporte("1999999999999.96")).toBe(1999999999999.96); // 15 dígitos
    expect(valorCeldaImporte("19999999999999.80")).toBe("19999999999999.80"); // 16 dígitos → texto exacto
    expect(valorCeldaImporte("9007199254740993.01")).toBe("9007199254740993.01");
    for (const n of [0.01, 0.1, 0.29, 1.005, 123456789.12, 999999999999.99]) {
      const v = valorCeldaImporte(n.toFixed(2));
      expect(typeof v === "number" ? v.toFixed(2) : v).toBe(n.toFixed(2));
    }
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
