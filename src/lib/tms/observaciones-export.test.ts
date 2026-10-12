import { describe, expect, it } from "vitest";
import { alturaFilaExcel, lineasEstimadas, observacionesVisibles } from "./observaciones-export";

describe("observacionesVisibles", () => {
  it("vacío / null / solo espacios o saltos => null (no se inventa texto)", () => {
    for (const v of [null, undefined, "", "   ", "\n \r\n"]) expect(observacionesVisibles(v)).toBeNull();
  });

  it("conserva el texto y sus saltos de línea; normaliza CRLF a LF y recorta los extremos", () => {
    expect(observacionesVisibles("  Línea 1\r\nLínea 2\rLínea 3  ")).toBe("Línea 1\nLínea 2\nLínea 3");
  });
});

describe("lineasEstimadas / alturaFilaExcel", () => {
  it("respeta los saltos de línea explícitos y estima el ajuste de cada tramo", () => {
    expect(lineasEstimadas("corto", 40)).toBe(1);
    expect(lineasEstimadas("a\nb\nc", 40)).toBe(3);
    expect(lineasEstimadas("x".repeat(100), 40)).toBe(3);
    expect(lineasEstimadas("x".repeat(41) + "\n" + "y".repeat(10), 40)).toBe(3);
    expect(lineasEstimadas("a\n\nb", 40)).toBe(3); // una línea en blanco también ocupa su espacio
  });

  it("una sola línea no fija altura (queda la de por defecto); varias líneas => 15 pt por línea", () => {
    expect(alturaFilaExcel("corto", 40)).toBeUndefined();
    expect(alturaFilaExcel(null, 40)).toBeUndefined();
    expect(alturaFilaExcel("a\nb\nc", 40)).toBe(45);
  });

  it("nunca supera el máximo de Excel (409 pt)", () => {
    expect(alturaFilaExcel("x\n".repeat(200), 40)).toBe(409);
  });
});
