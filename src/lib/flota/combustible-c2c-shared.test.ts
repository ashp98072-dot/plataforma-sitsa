import { describe, expect, it } from "vitest";
import { normalizarPlacaImportada as delParser } from "./combustible-importacion-parser";
import { clasificarFila, normalizarPlacaImportada, compararFilaConVale, etiquetaDiferencia, hayDiferencias, normalizarVale, type DatosProveedor, type DatosVale } from "./combustible-c2c-shared";

const prov: DatosProveedor = { placaNormalizada: "C-001ABC", galones: "10", precio: "25.5", total: "255", fechaReporte: "2026-10-10" };
const vale: DatosVale = { placa: "c-001abc", galones: "10.000", monto: "255.00", precio: "25.50", fechaConsumo: "2026-10-10" };

describe("normalizarVale", () => {
  it("trim, NFC, espacios y mayúsculas; conserva ceros a la izquierda y guiones", () => {
    expect(normalizarVale("  ab-001  x ")).toBe("AB-001 X");
    expect(normalizarVale("00157301")).toBe("00157301");
    expect(normalizarVale("157301")).not.toBe(normalizarVale("00157301"));
    expect(normalizarVale("a-1")).not.toBe(normalizarVale("a1"));
    expect(normalizarVale("Ñ̃".normalize("NFD"))).toBe("Ñ̃".normalize("NFC").toUpperCase());
    expect(normalizarVale(null)).toBe("");
  });
});

describe("compararFilaConVale", () => {
  it("todo igual → sin diferencias (placa normalizada, importes con escala distinta)", () => {
    expect(compararFilaConVale(prov, vale)).toEqual([]);
  });
  it("tolerancias: monto Q0.01 y galones 0.001 pasan; más allá es DISTINTA con delta", () => {
    expect(compararFilaConVale(prov, { ...vale, monto: "255.01", galones: "10.001" })).toEqual([]);
    const d = compararFilaConVale(prov, { ...vale, monto: "255.02", galones: "10.002" });
    expect(d.map(x => [x.campo, x.tipo])).toEqual([["MONTO", "DISTINTA"], ["GALONES", "DISTINTA"]]);
    expect(d[0]).toMatchObject({ proveedor: "255", interno: "255.02", delta: "0.02" });
  });
  it("placa distinta, fecha distinta y precio distinto se reportan por campo", () => {
    const d = compararFilaConVale(prov, { ...vale, placa: "P-999XYZ", fechaConsumo: "2026-10-12", precio: "26.00" });
    expect(d.map(x => x.campo)).toEqual(["PLACA", "PRECIO", "FECHA"]);
    expect(hayDiferencias(d)).toBe(true);
  });
  it("dato faltante es FALTANTE y NO cuenta como diferencia", () => {
    const d = compararFilaConVale(prov, { ...vale, placa: null, precio: null });
    expect(d.map(x => [x.campo, x.tipo])).toEqual([["PLACA", "FALTANTE"], ["PRECIO", "FALTANTE"]]);
    expect(hayDiferencias(d)).toBe(false);
  });
});

describe("clasificarFila", () => {
  it("0 candidatos → SIN_VALE_INTERNO", () => expect(clasificarFila(prov, [])).toMatchObject({ estado: "SIN_VALE_INTERNO", candidatos: 0 }));
  it("1 candidato igual → EXACTA; con diferencia → CON_DIFERENCIAS", () => {
    expect(clasificarFila(prov, [vale]).estado).toBe("COINCIDENCIA_EXACTA");
    expect(clasificarFila(prov, [{ ...vale, monto: "300" }]).estado).toBe("COINCIDENCIA_CON_DIFERENCIAS");
  });
  it("fecha distinta sigue siendo coincidencia (por vale), solo con diferencia visible; piloto no participa", () => {
    const r = clasificarFila(prov, [{ ...vale, fechaConsumo: "2026-09-01" }]);
    expect(r.estado).toBe("COINCIDENCIA_CON_DIFERENCIAS");
    expect(r.diferencias.map(d => d.campo)).toEqual(["FECHA"]);
    expect(Object.keys(vale)).not.toContain("piloto");
  });
  it("varios candidatos o filas competidoras → AMBIGUA, nunca se elige", () => {
    expect(clasificarFila(prov, [vale, vale])).toMatchObject({ estado: "AMBIGUA", motivo: "VARIOS_VALES_MISMA_CLAVE" });
    expect(clasificarFila(prov, [vale], 1)).toMatchObject({ estado: "AMBIGUA", motivo: "VARIAS_FILAS_MISMO_VALE" });
  });
});

it("etiquetaDiferencia", () => {
  expect(etiquetaDiferencia({ campo: "MONTO", tipo: "DISTINTA", proveedor: "255", interno: "255.5", delta: "0.5" })).toBe("MONTO Q0.50");
  expect(etiquetaDiferencia({ campo: "PLACA", tipo: "DISTINTA", proveedor: "A", interno: "B", delta: null })).toBe("PLACA");
  expect(etiquetaDiferencia({ campo: "GALONES", tipo: "FALTANTE", proveedor: null, interno: "1", delta: null })).toBe("GALONES faltante");
});

it("la normalización de placa es idéntica a la del parser C-2B", () => {
  for (const p of [" c-001abc ", "C 001 ABC", "p–123  abc", "P - 123", "ñ-1̃"]) expect(normalizarPlacaImportada(p)).toBe(delParser(p));
});
