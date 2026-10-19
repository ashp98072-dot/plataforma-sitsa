import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { calcularIsrProveedor, isrExacto, ReglaIsrPendiente } from "./isr-proveedor";
import { calcularSaldo, desgloseFinanciero, estadoFinanciero } from "./saldo";
import { documentoNormalizado, fechaIso, idPositivo, importe, regimenValido } from "./validacion";
import { calcularFactura } from "./facturas";
import { ErrorCxp } from "./errores";

const isr = (baseNeto: string, regimenFiscal: "GENERAL" | "PEQUENO_CONTRIBUYENTE" = "GENERAL", sujetoIsr = true) => calcularIsrProveedor({ baseNeto, regimenFiscal, sujetoIsr });
const bloquea = (base: string) => { try { isr(base); } catch (e) { return e as ReglaIsrPendiente; } throw new Error(`debió bloquear ${base}`); };

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
  it("fracciones de centavo: NO confirmadas → se bloquean (ni arriba, ni abajo, ni truncar)", () => {
    for (const base of ["2800.10", "3333.33", "29999.99", "30000.01", "31250.50", "30000.20"]) {
      const e = bloquea(base);
      expect(e).toBeInstanceOf(ReglaIsrPendiente); expect(e.motivo).toBe("REDONDEO"); expect(e.status).toBe(422);
    }
    expect(isrExacto("2800.10").exacto.toString()).toBe("140.005");
    expect(isrExacto("29999.99").exacto.toString()).toBe("1499.9995");
    expect(isrExacto("30000.01").exacto.toString()).toBe("1500.0007");
  });
  it("el modo de redondeo solo existe si se pasa EXPLÍCITO (herramienta para cuando Contabilidad lo confirme; ningún flujo lo usa)", () => {
    const e = { baseNeto: "2800.10", regimenFiscal: "GENERAL" as const, sujetoIsr: true };
    expect(calcularIsrProveedor(e, Decimal.ROUND_HALF_UP).monto).toBe("140.01");
    expect(calcularIsrProveedor(e, Decimal.ROUND_DOWN).monto).toBe("140.00");
    expect(calcularIsrProveedor({ ...e, baseNeto: "30000.01" }, Decimal.ROUND_HALF_UP).monto).toBe("1500.00");
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
  it("sin modo de redondeo por defecto: el código no nombra ninguna modalidad", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/contabilidad/cxp/isr-proveedor.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/ROUND_|Math\.round|toFixed\(0/);
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
  it("una fracción de centavo propaga ReglaIsrPendiente", () => {
    expect(() => calcularFactura("2800.10", "336.01", "GENERAL", true)).toThrow(ReglaIsrPendiente);
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
