import { expect, it } from "vitest";
import { cifraConsumo, combustibleConsumo, galonesRedondeados, importeConsumo } from "./formatos-consumos";

it.each([
    ["400", "GTQ", false, "Q 400.00"], ["400.0043", "GTQ", false, "Q 400.00"],
    ["999999999999.995", "GTQ", false, "Q 1,000,000,000,000.00"],
    ["24.123456", "GTQ", true, "Q 24.123456"], ["24.100000", "GTQ", true, "Q 24.10"],
    ["400", "USD", false, "US$ 400.00"], ["400", "EUR", false, "400.00 · EUR"],
    [null, "GTQ", false, "No informado"], ["NaN", "GTQ", false, "No disponible"],
] as const)("importe %s %s sin modificar precisión original", (original, moneda, precio, esperado) => {
    expect(importeConsumo(original, moneda, precio)).toBe(esperado);
});
it.each([["10.123456", "10.123"], ["9.9999", "10"], ["10.100000", "10.1"], ["0", "0"], [null, "No informado"], ["", "No informado"], ["Infinity", "No disponible"], [false, "No disponible"]])("galones %s hasta tres decimales", (original, esperado) => {
    expect(cifraConsumo(original, 0, 3)).toBe(esperado);
});
it("no infiere clasificación de un dato ausente o desconocido", () => {
    expect(combustibleConsumo(null)).toBe("Sin clasificación");
    expect(combustibleConsumo("NO_DETERMINADO")).toBe("NO DETERMINADO");
    expect(combustibleConsumo("DIESEL")).toBe("DIÉSEL");
    expect(combustibleConsumo("OTRO")).toBe("Clasificación no reconocida: OTRO");
});
it.each([["9.999900", true], ["10.123456", true], ["1000.000001", true], ["1000.123000", false], ["10.100000", false], ["0", false], [null, false], ["NaN", false]])("indica redondeo real de %s sin confundirlo con quitar ceros finales", (original, esperado) => {
    expect(galonesRedondeados(original)).toBe(esperado);
});
