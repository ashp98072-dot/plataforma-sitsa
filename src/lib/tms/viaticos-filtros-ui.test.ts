import { describe, expect, it } from "vitest";
import {
  coincideCuentaBancaria,
  coincideMetodoPago,
  itemsSeleccionadosVisibles,
  puedeRegistrarPagoMasivo,
  tieneCuentaBancariaValida,
  totalSeleccionado,
} from "./viaticos-filtros-ui";

/**
 * VIATICOS-BANDEJAS-1 — pruebas de la lógica pura de filtros/totales de
 * las bandejas (ver JSDoc de viaticos-filtros-ui.ts sobre por qué está
 * fuera del componente React).
 */

describe("coincideMetodoPago", () => {
  it("5) filtro TRANSFERENCIA solo coincide con TRANSFERENCIA", () => {
    expect(coincideMetodoPago("TRANSFERENCIA", "TRANSFERENCIA")).toBe(true);
    expect(coincideMetodoPago("CHEQUE", "TRANSFERENCIA")).toBe(false);
    expect(coincideMetodoPago("EFECTIVO", "TRANSFERENCIA")).toBe(false);
    expect(coincideMetodoPago(null, "TRANSFERENCIA")).toBe(false);
  });

  it("6) filtro CHEQUE solo coincide con CHEQUE", () => {
    expect(coincideMetodoPago("CHEQUE", "CHEQUE")).toBe(true);
    expect(coincideMetodoPago("TRANSFERENCIA", "CHEQUE")).toBe(false);
    expect(coincideMetodoPago("EFECTIVO", "CHEQUE")).toBe(false);
  });

  it("7) filtro EFECTIVO solo coincide con EFECTIVO", () => {
    expect(coincideMetodoPago("EFECTIVO", "EFECTIVO")).toBe(true);
    expect(coincideMetodoPago("TRANSFERENCIA", "EFECTIVO")).toBe(false);
    expect(coincideMetodoPago("CHEQUE", "EFECTIVO")).toBe(false);
  });

  it("filtro '' (Todos) coincide con cualquier método, incluido null (AUTORIZADO sin entregar aún)", () => {
    expect(coincideMetodoPago("TRANSFERENCIA", "")).toBe(true);
    expect(coincideMetodoPago(null, "")).toBe(true);
  });
});

describe("tieneCuentaBancariaValida / coincideCuentaBancaria", () => {
  it("8) 'Con cuenta' filtra correctamente: solo cuentaBancaria no vacía", () => {
    expect(tieneCuentaBancariaValida("1234567890")).toBe(true);
    expect(tieneCuentaBancariaValida("  ")).toBe(false);
    expect(tieneCuentaBancariaValida("")).toBe(false);
    expect(tieneCuentaBancariaValida(null)).toBe(false);
    expect(tieneCuentaBancariaValida(undefined)).toBe(false);

    expect(coincideCuentaBancaria("1234567890", "CON")).toBe(true);
    expect(coincideCuentaBancaria(null, "CON")).toBe(false);
    expect(coincideCuentaBancaria("  ", "CON")).toBe(false);
  });

  it("9) 'Sin cuenta' filtra correctamente: exactamente el complemento de 'Con cuenta'", () => {
    expect(coincideCuentaBancaria(null, "SIN")).toBe(true);
    expect(coincideCuentaBancaria("", "SIN")).toBe(true);
    expect(coincideCuentaBancaria("1234567890", "SIN")).toBe(false);
  });

  it("filtro '' (Todos) coincide sin importar si tiene cuenta o no", () => {
    expect(coincideCuentaBancaria(null, "")).toBe(true);
    expect(coincideCuentaBancaria("1234567890", "")).toBe(true);
  });
});

describe("combinación método + cuenta (10)", () => {
  type Fila = { metodoPago: string | null; cuentaBancaria: string | null };
  function pasaAmbos(fila: Fila, metodo: Parameters<typeof coincideMetodoPago>[1], cuenta: Parameters<typeof coincideCuentaBancaria>[1]) {
    return coincideMetodoPago(fila.metodoPago, metodo) && coincideCuentaBancaria(fila.cuentaBancaria, cuenta);
  }

  it("Estado=AUTORIZADO (fuera del alcance de esta función, ya filtrado server-side) + Método=TRANSFERENCIA + Cuenta=CON -> solo filas que cumplen TODO", () => {
    const filas: Fila[] = [
      { metodoPago: "TRANSFERENCIA", cuentaBancaria: "111" }, // cumple ambos
      { metodoPago: "TRANSFERENCIA", cuentaBancaria: "" }, // método sí, cuenta no
      { metodoPago: "CHEQUE", cuentaBancaria: "222" }, // cuenta sí, método no
      { metodoPago: "EFECTIVO", cuentaBancaria: null }, // ninguno
    ];
    const resultado = filas.filter((f) => pasaAmbos(f, "TRANSFERENCIA", "CON"));
    expect(resultado).toEqual([{ metodoPago: "TRANSFERENCIA", cuentaBancaria: "111" }]);
  });
});

describe("totalSeleccionado", () => {
  const filas = [
    { id: 1, montoAsignado: 100 },
    { id: 2, montoAsignado: 250.5 },
    { id: 3, montoAsignado: 50 },
  ];

  it("12) suma cantidad y monto solo de los seleccionados presentes en `filtrados`", () => {
    const r = totalSeleccionado(filas, new Set([1, 3]));
    expect(r).toEqual({ cantidad: 2, monto: 150 });
  });

  it("13) un id seleccionado que ya NO está en `filtrados` (filtro cambió) no cuenta ni suma — nunca 'selección peligrosa'", () => {
    const r = totalSeleccionado(filas, new Set([1, 999]));
    expect(r).toEqual({ cantidad: 1, monto: 100 });
  });

  it("sin selección -> cero", () => {
    expect(totalSeleccionado(filas, new Set())).toEqual({ cantidad: 0, monto: 0 });
  });

  it("selección vacía si `filtrados` está vacío (todo fue filtrado)", () => {
    expect(totalSeleccionado([], new Set([1, 2, 3]))).toEqual({ cantidad: 0, monto: 0 });
  });
});

describe("itemsSeleccionadosVisibles (VIATICOS-PAGO-MASIVO-1, item 22 — selección visible respetada)", () => {
  const filas = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it("devuelve solo las filas de `filtrados` que están seleccionadas", () => {
    expect(itemsSeleccionadosVisibles(filas, new Set([1, 3]))).toEqual([{ id: 1 }, { id: 3 }]);
  });

  it("un id seleccionado fuera de `filtrados` nunca aparece en el resultado", () => {
    expect(itemsSeleccionadosVisibles(filas, new Set([1, 999]))).toEqual([{ id: 1 }]);
  });

  it("sin selección -> []", () => {
    expect(itemsSeleccionadosVisibles(filas, new Set())).toEqual([]);
  });
});

describe("puedeRegistrarPagoMasivo (VIATICOS-PAGO-MASIVO-1, item 21 — método 'Todos' no permite masivo)", () => {
  it("'' (Todos) -> false", () => {
    expect(puedeRegistrarPagoMasivo("")).toBe(false);
  });

  it("TRANSFERENCIA/CHEQUE/EFECTIVO -> true", () => {
    expect(puedeRegistrarPagoMasivo("TRANSFERENCIA")).toBe(true);
    expect(puedeRegistrarPagoMasivo("CHEQUE")).toBe(true);
    expect(puedeRegistrarPagoMasivo("EFECTIVO")).toBe(true);
  });
});
