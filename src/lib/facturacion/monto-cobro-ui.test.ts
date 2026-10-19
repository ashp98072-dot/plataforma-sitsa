import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsearMontoCobro } from "@/lib/contabilidad/cxc/monto";

const src = readFileSync("src/components/facturacion/facturas-panel.tsx", "utf8");

describe("cobro en detalle de Facturación: formato de monto (mismo helper que CxC)", () => {
  it("acepta 2000, 2000.00, 2,000.00 y 1,234,567.89 y entrega el número que recibe el backend", () => {
    expect(parsearMontoCobro("2000")).toBe(2000);
    expect(parsearMontoCobro("2000.00")).toBe(2000);
    expect(parsearMontoCobro("2,000.00")).toBe(2000);
    expect(parsearMontoCobro("1,234,567.89")).toBe(1234567.89);
  });
  it("rechaza formatos ambiguos o inválidos", () => {
    for (const t of ["2,5", "2.000,00", "1.234", "", "0", "-5", "abc"]) expect(parsearMontoCobro(t), t).toBeNull();
  });
  it("registrarPago() usa el helper, ya no Number(), y corta antes del POST si el monto es inválido", () => {
    expect(src).toContain('import { parsearMontoCobro } from "@/lib/contabilidad/cxc/monto"');
    expect(src).not.toContain("Number(pagoMonto)");
    expect(src).toMatch(/const monto = parsearMontoCobro\(pagoMonto\);\s*if \(!pagoFecha \|\| monto === null\) \{[^}]*return; \}\s*setRegistrandoPago\(true\)/);
    expect(src).toMatch(/fechaPago: pagoFecha, monto,/);
  });
  it("el campo es de texto (type=number rechazaba las comas) y el botón se habilita con monto válido y fecha", () => {
    expect(src).not.toMatch(/Monto<input[^>]*type="number"/);
    expect(src).toMatch(/Monto<input[^>]*type="text" inputMode="decimal"/);
    expect(src).toMatch(/disabled=\{registrandoPago \|\| parsearMontoCobro\(pagoMonto\) === null \|\| !pagoFecha\}/);
  });
});
