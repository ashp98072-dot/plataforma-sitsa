import { describe, expect, it } from "vitest";
import { calcularIsrProveedor, ReglaIsrPendiente } from "./isr-proveedor";
import { calcularSaldo, estadoFinanciero } from "./saldo";
import { documentoNormalizado, fechaIso, idPositivo, importe, regimenValido } from "./validacion";
import { calcularFactura } from "./facturas";
import { ErrorCxp } from "./errores";

const isr = (baseNeto: string, regimenFiscal: "GENERAL" | "PEQUENO_CONTRIBUYENTE" = "GENERAL", sujetoIsr = true) => calcularIsrProveedor({ baseNeto, regimenFiscal, sujetoIsr });

describe("ISR de proveedores (reglas confirmadas)", () => {
  it("5 % sobre el valor neto de Q2,800.00 a Q29,999.00", () => {
    expect(isr("2800.00")).toMatchObject({ porcentaje: "5.00", monto: "140.00", regla: "M3A_V1:TRAMO_5_PCT" });
    expect(isr("10000.00").monto).toBe("500.00");
    expect(isr("29999.00").monto).toBe("1499.95");
  });
  it("redondea a 2 decimales (mitad hacia arriba)", () => {
    expect(isr("2800.10").monto).toBe("140.01"); // 140.005
    expect(isr("3333.33").monto).toBe("166.67"); // 166.6665
  });
  it("por debajo de Q2,800.00: sin retención", () => {
    expect(isr("2799.99")).toMatchObject({ porcentaje: "0.00", monto: "0.00", regla: "M3A_V1:BAJO_MINIMO_SIN_RETENCION" });
  });
  it("pequeño contribuyente: no se retiene, aun con sujeto_isr y montos altos", () => {
    expect(isr("10000.00", "PEQUENO_CONTRIBUYENTE", true).monto).toBe("0.00");
    expect(isr("50000.00", "PEQUENO_CONTRIBUYENTE").regla).toBe("M3A_V1:PEQUENO_CONTRIBUYENTE_SIN_RETENCION");
  });
  it("proveedor no sujeto a ISR: sin retención", () => {
    expect(isr("10000.00", "GENERAL", false)).toMatchObject({ monto: "0.00", regla: "M3A_V1:NO_SUJETO_ISR" });
  });
  it("NO se codifica la fórmula desde Q30,000.00 ni el hueco 29,999.00–30,000.00: se rechaza", () => {
    for (const base of ["29999.01", "29999.99", "30000.00", "30000.01", "100000.00"]) {
      expect(() => isr(base)).toThrow(ReglaIsrPendiente);
    }
    try { isr("30000.00"); } catch (e) { expect((e as ReglaIsrPendiente).status).toBe(422); expect((e as Error).message).toMatch(/pendiente/i); }
  });
  it("no sujeto / pequeño contribuyente NO se bloquean por montos altos (la regla pendiente solo afecta a sujetos de ISR)", () => {
    expect(() => isr("90000.00", "GENERAL", false)).not.toThrow();
    expect(() => isr("90000.00", "PEQUENO_CONTRIBUYENTE")).not.toThrow();
  });
  it("base inválida", () => {
    expect(() => isr("0")).toThrow(RangeError);
    expect(() => isr("-5")).toThrow(RangeError);
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
});

describe("saldo y estado derivados", () => {
  it("sin pagos: saldo = neto a pagar y PENDIENTE", () => {
    expect(calcularSaldo("10700.00")).toBe("10700.00");
    expect(estadoFinanciero("REGISTRADA", "10700.00")).toBe("PENDIENTE");
  });
  it("pagos parciales y total (preparado para el módulo de pagos)", () => {
    expect(estadoFinanciero("REGISTRADA", "10700.00", "2000.00")).toBe("PARCIAL");
    expect(calcularSaldo("10700.00", "2000.00")).toBe("8700.00");
    expect(estadoFinanciero("REGISTRADA", "10700.00", "10700.00")).toBe("PAGADA");
  });
  it("anulada manda sobre todo; aplicar de más es un error", () => {
    expect(estadoFinanciero("ANULADA", "10700.00", "0.00")).toBe("ANULADA");
    expect(() => calcularSaldo("100.00", "100.01")).toThrow(RangeError);
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
