import { expect, it } from "vitest";
import { importeCentavos, mostrarCentavos, prepararCaptura, resumirCaptura } from "./captura";

const lineas = () => [
  { cuentaId: "1", debe: "0.30", haber: "" },
  { cuentaId: "2", debe: "", haber: "0,10" },
  { cuentaId: "2", debe: "", haber: "0.20" },
];
const preparar = (ls = lineas()) => prepararCaptura(" P-001 ", "2026-08-31", " Motivo ", ls, [1, 2]);
it("prepara un payload compatible y cuadra décimas sin punto flotante", () => {
  expect(preparar()).toEqual({ numero: "P-001", fecha: "2026-08-31", glosa: "Motivo", lineas: [
    { cuentaId: 1, debe: 0.3, haber: 0 }, { cuentaId: 2, debe: 0, haber: 0.1 }, { cuentaId: 2, debe: 0, haber: 0.2 },
  ] });
  expect(resumirCaptura(lineas()).diferencia).toBe(BigInt(0));
});
it.each(["-1", "1e3", "NaN", "1.001", "1,000.00", "1.000,00", "1000000000000", "Infinity"])("rechaza importe %s sin redondearlo", (n) => {
  expect(importeCentavos(n)).toBeNull();
  expect(() => preparar([{ cuentaId: "1", debe: n, haber: "" }, { cuentaId: "2", debe: "", haber: n }])).toThrow();
});
it("rechaza descuadre de un centavo", () => {
  const ls = lineas(); ls[0].debe = "0.31";
  expect(() => preparar(ls)).toThrow("no cuadra");
});
it.each(["", "3", "1e0", "-1"])("rechaza cuenta vacía, no activa o ajena a la selección: %s", (id) => {
  const ls = lineas(); ls[0].cuentaId = id;
  expect(() => preparar(ls)).toThrow("cuenta activa");
});
it.each([
  { debe: "1", haber: "1" }, { debe: "", haber: "" }, { debe: "0", haber: "0" },
])("no acepta líneas de ambos lados o sin movimiento", (importes) => {
  const ls = lineas(); ls[0] = { cuentaId: "1", ...importes };
  expect(() => preparar(ls)).toThrow("importe positivo");
});
it.each(["2026-02-30", "2026-13-01", "2026-8-1", "", "0000-01-01"])("valida fecha real %s", (fecha) => {
  expect(() => prepararCaptura("P-1", fecha, "Motivo", lineas(), [1, 2])).toThrow("fecha válida");
});
it("exige número y descripción sin superar límites", () => {
  for (const numero of ["", " ", "x".repeat(41)]) expect(() => prepararCaptura(numero, "2026-08-31", "Motivo", lineas(), [1, 2])).toThrow("número");
  for (const glosa of ["", " ", "x".repeat(501)]) expect(() => prepararCaptura("P-1", "2026-08-31", glosa, lineas(), [1, 2])).toThrow("motivo");
});
it("limita líneas y conserva totales que superan Number.MAX_SAFE_INTEGER", () => {
  expect(() => preparar([])).toThrow("2 y 500");
  const ls = Array.from({ length: 250 }, () => [
    { cuentaId: "1", debe: "999999999999.99", haber: "" }, { cuentaId: "2", debe: "", haber: "999999999999.99" },
  ]).flat();
  expect(mostrarCentavos(resumirCaptura(ls).debe)).toBe("249999999999997.50");
  expect(preparar(ls).lineas).toHaveLength(500);
  expect(() => preparar([...ls, ls[0]])).toThrow("2 y 500");
  expect(mostrarCentavos(BigInt(-1))).toBe("-0.01");
});
