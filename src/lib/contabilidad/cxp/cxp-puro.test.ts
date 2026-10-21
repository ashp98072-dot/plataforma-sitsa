import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { calcularIsrProveedor, isrExacto, redondearIsr } from "./isr-proveedor";
import { calcularSaldo, desgloseFinanciero, estadoFinanciero } from "./saldo";
import { documentoNormalizado, fechaIso, idPositivo, importe, regimenValido } from "./validacion";
import { calcularFactura } from "./facturas";
import { ErrorCxp } from "./errores";

const isr = (baseNeto: string, regimenFiscal: "GENERAL" | "PEQUENO_CONTRIBUYENTE" = "GENERAL", sujetoIsr = true) => calcularIsrProveedor({ baseNeto, regimenFiscal, sujetoIsr });

describe("ISR de proveedores (M3B1_V1): rangos sobre el valor neto SIN IVA", () => {
  it("neto < Q2,800.00 → Q0.00 (sujeto a ISR, sin retención)", () => {
    for (const base of ["0.01", "100.00", "2799.00", "2799.99"]) expect(isr(base)).toMatchObject({ porcentaje: "0.00", monto: "0.00", tramo: "SIN_RETENCION", regla: "M3B1_V1:BAJO_MINIMO_SIN_RETENCION" });
  });
  it("Q2,800.00 <= neto < Q30,000.00 → 5 % del valor neto (con centavos conservados)", () => {
    expect(isr("2800.00")).toMatchObject({ porcentaje: "5.00", monto: "140.00", tramo: "CINCO_POR_CIENTO", regla: "M3B1_V1:TRAMO_5_PCT", fijo: "0.00", variable: "140.00" });
    expect(isr("10000.00").monto).toBe("500.00");
    expect(isr("2800.20").monto).toBe("140.01"); // centavos que se conservan, sin redondear a quetzales
    expect(isr("29999.00").monto).toBe("1499.95");
    expect(isr("29999.80").monto).toBe("1499.99");
  });
  it("neto >= Q30,000.00 → Q1,500.00 + 7 % del excedente sobre Q30,000.00", () => {
    expect(isr("30000.00")).toMatchObject({ porcentaje: "7.00", monto: "1500.00", tramo: "FIJO_MAS_SIETE_POR_CIENTO", regla: "M3B1_V1:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE", fijo: "1500.00", variable: "0.00" });
    expect(isr("31250.00")).toMatchObject({ monto: "1587.50", fijo: "1500.00", variable: "87.50" }); // ejemplo confirmado
    expect(isr("30001.00").monto).toBe("1500.07");
    expect(isr("40000.00").monto).toBe("2200.00");
    expect(isr("100000.00").monto).toBe("6400.00");
  });
  it("continuidad exacta en Q30,000.00: 5 % × 30,000 = 1,500 = 1,500 + 7 % × 0 (sin salto)", () => {
    expect(new Decimal("30000").times("0.05").toFixed(2)).toBe("1500.00");
    expect(isrExacto("30000.00").exacto.toFixed(2)).toBe("1500.00");
    // Justo antes (5 %) y en el límite (fijo + 7 %) difieren en menos de 1 centavo.
    const antes = isrExacto("29999.99");
    expect(antes.tramo).toBe("CINCO_POR_CIENTO");
    expect(new Decimal(1500).minus(antes.exacto).abs().lt("0.01")).toBe(true);
  });
  it("el IVA NO es parte de la base: el ISR depende solo del valor neto", () => {
    expect(calcularFactura("31250.00", "3750.00", "GENERAL", true)).toMatchObject({
      baseNeto: "31250.00", ivaMonto: "3750.00", totalDocumento: "35000.00", isrMonto: "1587.50", totalNetoPagar: "33412.50", advertencias: [],
    });
    // Mismo neto con otro IVA → misma retención (cambia solo el total y lo pagadero).
    expect(calcularFactura("31250.00", "0.00", "GENERAL", true).isrMonto).toBe("1587.50");
    // Un total de Q35,000 usado (erróneamente) como base daría otro monto: el cálculo nunca usa el total.
    expect(isr("35000.00").monto).toBe("1850.00");
  });
  it("REDONDEO confirmado: 2 decimales, mitad hacia arriba (aproximación; NUNCA truncar). Q140.005 → Q140.01; Q1,499.9995 → Q1,500.00", () => {
    expect(isrExacto("2800.10").exacto.toString()).toBe("140.005");
    expect(isr("2800.10").monto).toBe("140.01");
    expect(isrExacto("29999.99").exacto.toString()).toBe("1499.9995");
    expect(isr("29999.99")).toMatchObject({ monto: "1500.00", tramo: "CINCO_POR_CIENTO", porcentaje: "5.00" }); // sigue siendo del tramo 5 %
    // Casos con centavos: la fracción >= 0.005 sube, < 0.005 baja (truncar daría otro resultado en los que suben).
    const casos: [string, string, string][] = [
      ["2800.01", "140.0005", "140.00"], ["2800.09", "140.0045", "140.00"], ["2800.10", "140.005", "140.01"], ["2800.11", "140.0055", "140.01"],
      ["3333.33", "166.6665", "166.67"], ["10000.01", "500.0005", "500.00"], ["29999.50", "1499.975", "1499.98"],
      ["30000.01", "1500.0007", "1500.00"], ["30000.20", "1500.014", "1500.01"], ["30000.50", "1500.035", "1500.04"], ["31250.50", "1587.535", "1587.54"], ["31250.25", "1587.5175", "1587.52"],
    ];
    for (const [base, exacto, esperado] of casos) {
      expect(isrExacto(base).exacto.toString(), base).toBe(exacto);
      expect(isr(base).monto, base).toBe(esperado);
    }
    // Nunca trunca: ningún caso que sube coincide con el truncado.
    expect(isr("2800.10").monto).not.toBe(isrExacto("2800.10").exacto.toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2));
    expect(isr("29999.99").monto).not.toBe("1499.99");
  });
  it("redondearIsr: mitad hacia arriba exacta en decimal (sin errores de coma flotante)", () => {
    for (const [x, r] of [["140.005", "140.01"], ["140.0049999", "140.00"], ["1499.9995", "1500.00"], ["0.005", "0.01"], ["0.0049", "0.00"], ["1.005", "1.01"], ["2.675", "2.68"], ["87.50", "87.50"]]) expect(redondearIsr(x).toFixed(2), x).toBe(r);
  });
  it("el redondeo se aplica UNA vez sobre el ISR total del tramo (fijo + variable) y fijo + variable = monto", () => {
    const r = isr("30000.20");
    expect(r).toMatchObject({ monto: "1500.01", fijo: "1500.00", variable: "0.01" });
    expect(new Decimal(r.fijo).plus(r.variable).toFixed(2)).toBe(r.monto);
  });
  it("continuidad en Q30,000 con redondeo: Q29,999.99 → Q1,500.00 y Q30,000.00 → Q1,500.00", () => {
    expect(isr("29999.99").monto).toBe(isr("30000.00").monto);
  });
  it("pequeño contribuyente: no se retiene en ningún monto (regla confirmada en M-3A)", () => {
    for (const base of ["100.00", "10000.00", "50000.00"]) expect(isr(base, "PEQUENO_CONTRIBUYENTE", true)).toMatchObject({ monto: "0.00", regla: "M3B1_V1:PEQUENO_CONTRIBUYENTE_SIN_RETENCION" });
  });
  it("proveedor no sujeto a ISR (configuración explícita): sin retención en cualquier monto", () => {
    for (const base of ["500.00", "10000.00", "90000.00"]) expect(isr(base, "GENERAL", false)).toMatchObject({ monto: "0.00", regla: "M3B1_V1:NO_SUJETO_ISR" });
  });
  it("base inválida", () => {
    expect(() => isr("0")).toThrow(RangeError);
    expect(() => isr("-5")).toThrow(RangeError);
  });
  it("el redondeo es único y explícito (ROUND_HALF_UP): no hay truncado ni otros modos en el módulo", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/contabilidad/cxp/isr-proveedor.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).toContain("Decimal.ROUND_HALF_UP");
    expect(src).not.toMatch(/ROUND_DOWN|ROUND_FLOOR|ROUND_CEIL|ROUND_UP|ROUND_HALF_(DOWN|EVEN)|Math\.(round|floor|trunc)|toFixed\(0/);
  });
});

describe("calcularFactura", () => {
  it("total = base + IVA; monto pagadero = total − ISR; ISR sobre la base (sin IVA)", () => {
    const c = calcularFactura("10000.00", "1200.00", "GENERAL", true);
    expect(c).toMatchObject({ totalDocumento: "11200.00", isrMonto: "500.00", totalNetoPagar: "10700.00", advertencias: [] });
  });
  it("neto bajo el mínimo (Q2,000 + IVA): sin retención; se paga el total", () => {
    expect(calcularFactura("2000.00", "240.00", "GENERAL", true)).toMatchObject({ isrMonto: "0.00", totalNetoPagar: "2240.00", isrTramo: "SIN_RETENCION" });
  });
  it("advierte (sin bloquear) si el IVA no es 12 % de la base", () => {
    expect(calcularFactura("1000.00", "100.00", "GENERAL", false).advertencias).toHaveLength(1);
    expect(calcularFactura("1000.00", "0.00", "PEQUENO_CONTRIBUYENTE", false).totalNetoPagar).toBe("1000.00");
  });
  it("una fracción de centavo se aproxima y el monto pagadero queda coherente: neto 2,800.10 + IVA 336.01 − ISR 140.01", () => {
    expect(calcularFactura("2800.10", "336.01", "GENERAL", true)).toMatchObject({ isrMonto: "140.01", totalDocumento: "3136.11", totalNetoPagar: "2996.10" });
    expect(calcularFactura("29999.99", "3600.00", "GENERAL", true)).toMatchObject({ isrMonto: "1500.00", totalNetoPagar: "32099.99" });
  });
});

describe("saldo derivado: monto pagadero = total − retención; la retención NO es un pago", () => {
  const f = { totalDocumento: "35000.00", isrMonto: "1587.50", totalNetoPagar: "33412.50" };
  it("desglose: total, retención, monto pagadero, pagado y saldo (la retención no se descuenta como pagado)", () => {
    expect(desgloseFinanciero("REGISTRADA", f)).toEqual({ totalDocumento: "35000.00", retencionIsr: "1587.50", montoPagadero: "33412.50", pagado: "0.00", saldo: "33412.50", estadoFinanciero: "PENDIENTE" });
    expect(desgloseFinanciero("REGISTRADA", f, "10000.00")).toMatchObject({ pagado: "10000.00", saldo: "23412.50", estadoFinanciero: "PARCIAL" });
  });
  it("pagos parciales y total: «pagada» = saldo en cero con el monto pagadero (no con el total)", () => {
    expect(estadoFinanciero("REGISTRADA", f)).toBe("PENDIENTE");
    expect(estadoFinanciero("REGISTRADA", f, "0.01")).toBe("PARCIAL");
    expect(estadoFinanciero("REGISTRADA", f, "33412.49")).toBe("PARCIAL");
    expect(estadoFinanciero("REGISTRADA", f, "33412.50")).toBe("PAGADA");
    expect(calcularSaldo(f, "33412.50")).toBe("0.00");
  });
  it("varios pagos suman exactamente (sin errores de coma flotante)", () => {
    const pagos = ["0.10", "0.20", "33412.20"].reduce((a, p) => a.plus(p), new Decimal(0)).toFixed(2);
    expect(pagos).toBe("33412.50");
    expect(estadoFinanciero("REGISTRADA", f, pagos)).toBe("PAGADA");
  });
  it("anulada manda sobre todo y no adeuda; aplicar de más es imposible (error)", () => {
    expect(estadoFinanciero("ANULADA", f)).toBe("ANULADA");
    expect(desgloseFinanciero("ANULADA", f).saldo).toBe("0.00");
    expect(() => calcularSaldo(f, "33412.51")).toThrow(RangeError);
  });
  it("reversar un pago devuelve el saldo (el pagado vigente baja)", () => {
    expect(calcularSaldo(f, "33412.50")).toBe("0.00");
    expect(calcularSaldo(f, "0.00")).toBe("33412.50");
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
