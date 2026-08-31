import { expect, it } from "vitest";
import { filtrarSaldos, resumenNotificacionesVacaciones, type SaldoAlerta } from "./vacaciones-alertas-ui";
const filas: SaldoAlerta[] = [
  { empleadoId: 1, codigo: "A1", nombre: "Álvaro", dpi: "123", fechaContratacion: "2020-01-01", diasDisponibles: 30 },
  { empleadoId: 2, codigo: "B2", nombre: "Beatriz", dpi: null, fechaContratacion: "2025-01-01", diasDisponibles: 15 },
  { empleadoId: 3, codigo: "C3", nombre: "Carlos", dpi: null, fechaContratacion: null, diasDisponibles: 20 },
];
const filtro = { nombre: "", desde: "", hasta: "", orden: "saldo" };
it.each(["alvaro", " A1 ", "123"])("busca sin acentos por nombre/código/DPI: %s", (nombre) => {
  expect(filtrarSaldos(filas, { ...filtro, nombre }).map((s) => s.empleadoId)).toEqual([1]);
});
it("filtra rango inclusivo de contratación y excluye fechas desconocidas", () => {
  expect(filtrarSaldos(filas, { ...filtro, desde: "2025-01-01", hasta: "2025-01-01" }).map((s) => s.empleadoId)).toEqual([2]);
});
it("ordena antigüedad en ambos sentidos con desconocidos al final sin mutar", () => {
  expect(filtrarSaldos(filas, { ...filtro, orden: "antiguedad" }).map((s) => s.empleadoId)).toEqual([1, 2, 3]);
  expect(filtrarSaldos(filas, { ...filtro, orden: "reciente" }).map((s) => s.empleadoId)).toEqual([2, 1, 3]);
  expect(filas.map((s) => s.empleadoId)).toEqual([1, 2, 3]);
});
it("ordena por saldo sin cambiar los días y no encuentra rango invertido", () => {
  expect(filtrarSaldos(filas, filtro).map((s) => s.diasDisponibles)).toEqual([30, 20, 15]);
  expect(filtrarSaldos(filas, { ...filtro, desde: "2025-01-01", hasta: "2020-01-01" })).toEqual([]);
});
it("genera dos resúmenes, no una notificación por persona", () => {
  const items = resumenNotificacionesVacaciones("prueba", 15, 63);
  expect(items).toHaveLength(2);
  expect(items[0].titulo).toContain("15 solicitud");
  expect(items[1].titulo).toContain("63 colaborador");
  expect(items[1].detalle).toContain("No equivale a solicitudes pendientes");
  expect(items.every((i) => i.enlace === "/e/prueba/rrhh/vacaciones")).toBe(true);
  expect(resumenNotificacionesVacaciones("prueba", 2, 1).map((i) => i.id)).toEqual(items.map((i) => i.id));
});
it("no crea resúmenes vacíos", () => {
  expect(resumenNotificacionesVacaciones("prueba", 0, 0)).toEqual([]);
  expect(resumenNotificacionesVacaciones("prueba", 0, 10)).toHaveLength(1);
});
