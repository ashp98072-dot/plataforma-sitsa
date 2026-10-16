import { describe, expect, it } from "vitest";
import { calcularIsrProveedor, ReglaIsrPendiente } from "./isr-proveedor";
import { calcularSaldo, estadoFinanciero } from "./saldo";
import { documentoNormalizado, fechaIso, idPositivo, importe, regimenValido } from "./validacion";
import { calcularFactura } from "./facturas";
import { ErrorCxp } from "./errores";

const isr = (baseNeto: string, regimenFiscal: "GENERAL" | "PEQUENO_CONTRIBUYENTE" = "GENERAL", sujetoIsr = true) => calcularIsrProveedor({ baseNeto, regimenFiscal, sujetoIsr });

describe("ISR de proveedores: solo lo confirmado se calcula", () => {
  it("5 % sobre el valor neto de Q2,800.00 a Q29,999.00 cuando el importe es exacto en centavos", () => {
    expect(isr("2800.00")).toMatchObject({ porcentaje: "5.00", monto: "140.00", regla: "M3A_V2:TRAMO_5_PCT_EXACTO" });
    expect(isr("10000.00").monto).toBe("500.00");
    expect(isr("29999.00").monto).toBe("1499.95");
    expect(isr("2800.20").monto).toBe("140.01");
  });
  it("redondeo NO confirmado: si el 5 % no es exacto en centavos se bloquea (ni arriba, ni abajo, ni truncar)", () => {
    for (const base of ["2800.10", "3333.33", "10000.01", "2800.19"]) {
      try { isr(base); throw new Error("debió bloquear"); } catch (e) { expect(e).toBeInstanceOf(ReglaIsrPendiente); expect((e as ReglaIsrPendiente).motivo).toBe("REDONDEO"); }
    }
  });
  it("base menor a Q2,800.00 de un sujeto de ISR: NO se asume «sin retención», se bloquea", () => {
    for (const base of ["2799.99", "100.00", "0.01"]) {
      try { isr(base); throw new Error("debió bloquear"); } catch (e) { expect(e).toBeInstanceOf(ReglaIsrPendiente); expect((e as ReglaIsrPendiente).motivo).toBe("BASE_BAJO_MINIMO"); }
    }
  });
  it("pequeño contribuyente: no se retiene, aun con sujeto_isr y con cualquier monto (incluso bajo el mínimo)", () => {
    expect(isr("10000.00", "PEQUENO_CONTRIBUYENTE", true).monto).toBe("0.00");
    expect(isr("50000.00", "PEQUENO_CONTRIBUYENTE").regla).toBe("M3A_V2:PEQUENO_CONTRIBUYENTE_SIN_RETENCION");
    expect(isr("100.00", "PEQUENO_CONTRIBUYENTE").monto).toBe("0.00");
  });
  it("proveedor no sujeto a ISR (configuración explícita): sin retención en cualquier monto", () => {
    expect(isr("10000.00", "GENERAL", false)).toMatchObject({ monto: "0.00", regla: "M3A_V2:NO_SUJETO_ISR" });
    expect(isr("90000.00", "GENERAL", false).monto).toBe("0.00");
    expect(isr("500.00", "GENERAL", false).monto).toBe("0.00");
  });
  it("NO se codifica la fórmula desde Q30,000.00 ni el hueco 29,999.00–30,000.00: se rechaza (422)", () => {
    for (const base of ["29999.01", "29999.99", "30000.00", "30000.01", "100000.00"]) {
      try { isr(base); throw new Error("debió bloquear"); } catch (e) { expect(e).toBeInstanceOf(ReglaIsrPendiente); expect((e as ReglaIsrPendiente).motivo).toBe("BASE_SOBRE_TRAMO"); expect((e as ReglaIsrPendiente).status).toBe(422); }
    }
  });
  it("base inválida", () => {
    expect(() => isr("0")).toThrow(RangeError);
    expect(() => isr("-5")).toThrow(RangeError);
  });
  it("el módulo no contiene ninguna modalidad de redondeo", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/contabilidad/cxp/isr-proveedor.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/ROUND_|toDecimalPlaces|Math\.round|toFixed\(0/);
  });
});

describe("calcularFactura", () => {
  it("total = base + IVA; neto a pagar = total − ISR; ISR sobre la base (sin IVA)", () => {
    const c = calcularFactura("10000.00", "1200.00", "GENERAL", true);
    expect(c).toMatchObject({ totalDocumento: "11200.00", isrMonto: "500.00", totalNetoPagar: "10700.00", advertencias: [] });
  });
  it("advierte (sin bloquear) si el IVA no es 12 % de la base", () => {
    expect(calcularFactura("1000.00", "100.00", "GENERAL", false).advertencias).toHaveLength(1);
    expect(calcularFactura("1000.00", "0.00", "PEQUENO_CONTRIBUYENTE", false).totalNetoPagar).toBe("1000.00");
  });
  it("un caso bloqueado por la regla pendiente propaga ReglaIsrPendiente", () => {
    expect(() => calcularFactura("2800.10", "336.01", "GENERAL", true)).toThrow(ReglaIsrPendiente);
  });
});

describe("saldo derivado: la base es un parámetro explícito (pendiente de Contabilidad)", () => {
  const f = { totalDocumento: "11200.00", totalNetoPagar: "10700.00" };
  it("la misma factura da saldos distintos según la base: por eso no se fija ninguna en la API", () => {
    expect(calcularSaldo(f, "TOTAL_NETO_PAGAR")).toBe("10700.00");
    expect(calcularSaldo(f, "TOTAL_DOCUMENTO")).toBe("11200.00");
  });
  it("pagos parciales y total (preparado para el módulo de pagos) bajo cada base", () => {
    expect(estadoFinanciero("REGISTRADA", f, "TOTAL_NETO_PAGAR")).toBe("PENDIENTE");
    expect(estadoFinanciero("REGISTRADA", f, "TOTAL_NETO_PAGAR", "2000.00")).toBe("PARCIAL");
    expect(estadoFinanciero("REGISTRADA", f, "TOTAL_NETO_PAGAR", "10700.00")).toBe("PAGADA");
    expect(estadoFinanciero("REGISTRADA", f, "TOTAL_DOCUMENTO", "10700.00")).toBe("PARCIAL"); // la retención aún no aplicada
    expect(estadoFinanciero("REGISTRADA", f, "TOTAL_DOCUMENTO", "11200.00")).toBe("PAGADA");
  });
  it("anulada manda sobre todo; aplicar de más es un error", () => {
    expect(estadoFinanciero("ANULADA", f, "TOTAL_DOCUMENTO")).toBe("ANULADA");
    expect(() => calcularSaldo(f, "TOTAL_NETO_PAGAR", "10700.01")).toThrow(RangeError);
  });
  it("saldo no está conectado a la API ni a la UI de M-3A", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f2 of ["facturas.ts", "http.ts"]) expect(readFileSync(`src/lib/contabilidad/cxp/${f2}`, "utf8")).not.toMatch(/calcularSaldo|estadoFinanciero\(/);
    expect(readFileSync("src/components/contabilidad/cxp-client.tsx", "utf8")).not.toMatch(/\.saldo\b|saldo:/i);
  });
});

describe("validación de entradas", () => {
  it("importes: máximo 2 decimales, > 0, sin redondeo silencioso", () => {
    expect(importe(10, "x")).toBe("10.00");
    expect(importe("1234.5", "x")).toBe("1234.50");
    for (const malo of ["1.234", "-1", "0", "abc", "", NaN, 1e15, "1e3"]) expect(() => importe(malo as never, "x")).toThrow(ErrorCxp);
    expect(importe("0", "IVA", { permitirCero: true })).toBe("0.00");
  });
  it("fechas reales AAAA-MM-DD", () => {
    expect(fechaIso("2026-02-28", "f")).toBe("2026-02-28");
    for (const mala of ["2026-02-30", "26-01-01", "2026-13-01", "", null]) expect(() => fechaIso(mala, "f")).toThrow(ErrorCxp);
  });
  it("documento: serie opcional, número obligatorio; ceros y guiones significativos (misma regla que Compras)", () => {
    expect(documentoNormalizado(" a-1 ", " 000458 ")).toMatchObject({ serie: "a-1", numero: "000458", serieNorm: "A-1", numeroNorm: "000458" });
    expect(documentoNormalizado("", "458").numeroNorm).not.toBe(documentoNormalizado("", "000458").numeroNorm);
    expect(() => documentoNormalizado("A", "  ")).toThrow(ErrorCxp);
  });
  it("ids y régimen", () => {
    expect(idPositivo("12", "p")).toBe(12);
    for (const malo of [0, -1, "1.5", "x", 2147483648, null]) expect(() => idPositivo(malo, "p")).toThrow(ErrorCxp);
    expect(regimenValido("GENERAL")).toBe("GENERAL");
    expect(() => regimenValido("OTRO")).toThrow(ErrorCxp);
  });
});
