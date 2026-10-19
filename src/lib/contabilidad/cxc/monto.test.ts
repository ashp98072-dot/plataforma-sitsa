import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsearMontoCobro } from "./monto";

describe("parsearMontoCobro", () => {
  it("acepta 2000, 2000.00 y 2,000.00 y entrega el mismo número decimal correcto", () => {
    for (const t of ["2000", "2000.00", "2,000.00", " 2,000.00 ", "2,000"]) expect(parsearMontoCobro(t), t).toBe(2000);
  });
  it("conserva los centavos y admite millones con separadores", () => {
    expect(parsearMontoCobro("600.01")).toBe(600.01);
    expect(parsearMontoCobro("1,234.5")).toBe(1234.5);
    expect(parsearMontoCobro("1,234,567.89")).toBe(1234567.89);
    expect(parsearMontoCobro("0.01")).toBe(0.01);
    expect(parsearMontoCobro("999")).toBe(999);
    expect(parsearMontoCobro("1000000")).toBe(1000000);
  });
  it("rechaza lo inválido o ambiguo (nunca adivina)", () => {
    for (const t of ["", "  ", "abc", "0", "0.00", "-5", "+5", "2,00", "1,23", "2.000,00", "1.234", "1,2345", "12,34,567", ",500", "500,", "2,000,", "2 000", "1e3", "Q2000", "2,000.000", "2,,000", "..5", "1.2.3", "NaN", "Infinity", "1,0000,000"]) {
      expect(parsearMontoCobro(t), JSON.stringify(t)).toBeNull();
    }
  });
});

describe("UI de cobro usa el helper (bug: Registrar cobro deshabilitado con 2,000.00)", () => {
  const src = readFileSync("src/components/contabilidad/cxc-client.tsx", "utf8");
  it("el botón y el cuerpo enviado usan parsearMontoCobro; ya no se usa replace(\",\", \".\") sobre el monto", () => {
    expect(src).toContain('import { parsearMontoCobro } from "@/lib/contabilidad/cxc/monto"');
    expect(src).not.toMatch(/c\.monto\.replace\(/);
    expect(src).toContain("monto: parsearMontoCobro(c.monto)");
    expect(src).toMatch(/disabled=\{busy \|\| parsearMontoCobro\(c\.monto\) === null \|\| !c\.fechaPago\}/);
  });
  it("no se envía un monto inválido: cobrar() corta antes del POST", () => {
    expect(src).toMatch(/const monto = parsearMontoCobro\(c\.monto\);\s*if \(monto === null\)/);
  });
});
