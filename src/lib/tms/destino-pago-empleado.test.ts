import { describe, expect, it } from "vitest";
import { destinoPagoEmpleado } from "./destino-pago-empleado";
import { aplicarEmpleadoSeleccionado, aplicarPlanSeleccionado } from "./fondos-selectores";

const empleado = { id: 1, nombre: "Empleado", puesto: "Piloto", cuentaBancaria: "001234", telefono: "55551234" };
const linea = { planId: "", clienteId: "", fechaViaje: "", vehiculoId: "", empleadoId: "1", empleadoNombre: "Empleado", cuenta: "snapshot", cargo: "Piloto", metodoPago: "Transferencia móvil" };

describe("destino compartido RRHH de Gastos y Fondos", () => {
  it("Transferencia toma cuenta bancaria preservando ceros", () => {
    expect(destinoPagoEmpleado("Transferencia", empleado)).toBe("001234");
  });
  it("Transferencia móvil toma teléfono, nunca cuenta", () => {
    expect(destinoPagoEmpleado("Transferencia móvil", empleado)).toBe("55551234");
  });
  it("sin teléfono deja destino vacío", () => {
    expect(destinoPagoEmpleado("Transferencia móvil", { cuentaBancaria: "123" })).toBe("");
  });
  it("sin cuenta deja destino vacío", () => {
    expect(destinoPagoEmpleado("Transferencia", { telefono: "55551234" })).toBe("");
  });
  it.each(["", "Efectivo", "Cheque", "Tarjeta", "Otro"])("%s no arrastra destino", (metodo) => {
    expect(destinoPagoEmpleado(metodo, empleado)).toBe("");
  });
  it("cambiar empleado sustituye teléfono anterior", () => {
    expect(aplicarEmpleadoSeleccionado(linea, { ...empleado, id: 2, telefono: "55559876" }, "2").cuenta).toBe("55559876");
  });
  it("cambiar a empleado sin teléfono borra el anterior", () => {
    expect(aplicarEmpleadoSeleccionado(linea, { ...empleado, telefono: null }, "1").cuenta).toBe("");
  });
  it("plan respeta el método móvil con el teléfono real", () => {
    expect(aplicarPlanSeleccionado(linea, { id: 4, clienteId: null, fechaPlan: "2026-09-16", vehiculoId: null, empleadoId: 1, empleadoNombre: "Empleado", empleadoPuesto: "Piloto", empleadoTelefono: "55551234", empleadoCuenta: "001234" }, "4", empleado).cuenta).toBe("55551234");
  });
  it("regla pura no muta snapshot ni impide override manual", () => {
    destinoPagoEmpleado("Transferencia móvil", empleado);
    expect(linea.cuenta).toBe("snapshot");
    expect({ ...aplicarEmpleadoSeleccionado(linea, empleado, "1"), cuenta: "55550000" }.cuenta).toBe("55550000");
  });
});
