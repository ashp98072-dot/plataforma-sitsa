import { describe, expect, it } from "vitest";
import {
  calcularEstadoEntrega,
  cantidadDisponibleParaAjuste,
  validarCantidadAjuste,
  validarCompatibilidadPrecioCambio,
} from "./inventario-ajustes";

describe("cantidadDisponibleParaAjuste", () => {
  it("sin ajustes previos, toda la cantidad original está disponible", () => {
    expect(cantidadDisponibleParaAjuste(3, [])).toBe(3);
  });
  it("resta ajustes previos (devoluciones y cambios por igual)", () => {
    expect(cantidadDisponibleParaAjuste(3, [{ cantidad: 1 }, { cantidad: 1 }])).toBe(1);
  });
  it("nunca negativo aunque los ajustes sumen más que el original", () => {
    expect(cantidadDisponibleParaAjuste(2, [{ cantidad: 5 }])).toBe(0);
  });
});

describe("calcularEstadoEntrega", () => {
  it("sin ajustes -> ENTREGADO", () => {
    expect(calcularEstadoEntrega(3, [])).toBe("ENTREGADO");
  });
  it("devolución total -> DEVUELTO", () => {
    expect(calcularEstadoEntrega(2, [{ tipo: "DEVOLUCION", cantidad: 2 }])).toBe("DEVUELTO");
  });
  it("devolución parcial -> PARCIALMENTE DEVUELTO", () => {
    expect(calcularEstadoEntrega(3, [{ tipo: "DEVOLUCION", cantidad: 1 }])).toBe("PARCIALMENTE DEVUELTO");
  });
  it("cambio total -> CAMBIADO", () => {
    expect(calcularEstadoEntrega(1, [{ tipo: "CAMBIO", cantidad: 1 }])).toBe("CAMBIADO");
  });
  it("cambio parcial -> CAMBIADO PARCIAL", () => {
    expect(calcularEstadoEntrega(3, [{ tipo: "CAMBIO", cantidad: 1 }])).toBe("CAMBIADO PARCIAL");
  });
  it("mezcla de devolución + cambio que agota la entrega -> CAMBIADO (prevalece sobre DEVUELTO)", () => {
    expect(
      calcularEstadoEntrega(3, [
        { tipo: "DEVOLUCION", cantidad: 1 },
        { tipo: "CAMBIO", cantidad: 2 },
      ]),
    ).toBe("CAMBIADO");
  });
});

describe("validarCantidadAjuste", () => {
  it("cantidad positiva dentro de lo disponible -> ok", () => {
    expect(validarCantidadAjuste(2, 3)).toEqual({ ok: true });
  });
  it("cantidad cero o negativa -> inválida", () => {
    expect(validarCantidadAjuste(0, 3)).toMatchObject({ ok: false, motivo: "cantidad_invalida" });
    expect(validarCantidadAjuste(-1, 3)).toMatchObject({ ok: false, motivo: "cantidad_invalida" });
  });
  it("cantidad mayor a lo disponible -> rechazada, nunca negativo el mensaje", () => {
    const r = validarCantidadAjuste(4, 3);
    expect(r).toMatchObject({ ok: false, motivo: "cantidad_excede_disponible" });
    if (!r.ok) expect(r.mensaje).toContain("3 disponible");
  });
});

describe("validarCompatibilidadPrecioCambio — sección 8 del ticket", () => {
  it("A) sin cobro -> siempre compatible, sin importar el precio del nuevo", () => {
    expect(
      validarCompatibilidadPrecioCambio({ huboCobro: false, costoUnitarioOriginal: 30, costoUnitarioNuevo: 999 }),
    ).toEqual({ ok: true });
  });
  it("B) con cobro y mismo precio -> compatible (no duplica descuento)", () => {
    expect(
      validarCompatibilidadPrecioCambio({ huboCobro: true, costoUnitarioOriginal: 30, costoUnitarioNuevo: 30 }),
    ).toEqual({ ok: true });
  });
  it("tolera diferencias de redondeo de medio centavo", () => {
    expect(
      validarCompatibilidadPrecioCambio({ huboCobro: true, costoUnitarioOriginal: 30, costoUnitarioNuevo: 30.004 }),
    ).toEqual({ ok: true });
  });
  it("C) con cobro y artículo nuevo más caro -> rechazado con mensaje claro", () => {
    const r = validarCompatibilidadPrecioCambio({ huboCobro: true, costoUnitarioOriginal: 30, costoUnitarioNuevo: 40 });
    expect(r).toMatchObject({ ok: false, motivo: "diferencia_precio_no_soportada" });
    if (!r.ok) expect(r.mensaje).toContain("ajustar");
  });
  it("D) con cobro y artículo nuevo más barato -> también rechazado (mismo mecanismo, sin asumir a favor del empleado)", () => {
    expect(
      validarCompatibilidadPrecioCambio({ huboCobro: true, costoUnitarioOriginal: 40, costoUnitarioNuevo: 30 }),
    ).toMatchObject({ ok: false, motivo: "diferencia_precio_no_soportada" });
  });
});
