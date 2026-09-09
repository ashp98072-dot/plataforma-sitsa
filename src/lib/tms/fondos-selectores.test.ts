import { describe, expect, it } from "vitest";
import { aplicarEmpleadoSeleccionado, aplicarPlanSeleccionado, type EmpleadoSeleccionFondo, type LineaSeleccionFondo, type PlanSeleccionFondo } from "./fondos-selectores";

const linea = (overrides: Partial<LineaSeleccionFondo> = {}): LineaSeleccionFondo => ({
  planId: "", clienteId: "", fechaViaje: "", vehiculoId: "", empleadoId: "",
  empleadoNombre: "", cuenta: "", cargo: "", ...overrides,
});
const plan = (overrides: Partial<PlanSeleccionFondo> = {}): PlanSeleccionFondo => ({
  id: 9, clienteId: 4, fechaPlan: "2026-09-12", vehiculoId: 8, empleadoId: 3,
  empleadoNombre: "Jaime Sagüí", empleadoCuenta: "123456", empleadoPuesto: "Piloto", ...overrides,
});
const empleado = (overrides: Partial<EmpleadoSeleccionFondo> = {}): EmpleadoSeleccionFondo => ({
  id: 3, nombre: "Jaime Sagüí", cuentaBancaria: "123456", puesto: "Piloto", ...overrides,
});

describe("autocompletado de Plan en Solicitud de Fondo", () => {
  it("completa cliente, unidad, piloto y fecha con las asignaciones del plan", () => {
    expect(aplicarPlanSeleccionado(linea(), plan(), "9", empleado())).toEqual({
      planId: "9", clienteId: "4", fechaViaje: "2026-09-12", vehiculoId: "8", empleadoId: "3",
      empleadoNombre: "Jaime Sagüí", cuenta: "123456", cargo: "Piloto",
    });
  });

  it("piloto completa Nombre, Cuenta y Cargo desde el dato server-side", () => {
    const result = aplicarPlanSeleccionado(linea(), plan(), "9", empleado());
    expect([result.empleadoNombre, result.cuenta, result.cargo]).toEqual(["Jaime Sagüí", "123456", "Piloto"]);
  });

  it("plan sin piloto deja empleado editable y vacío", () => {
    const result = aplicarPlanSeleccionado(linea({ empleadoId: "2", empleadoNombre: "Anterior" }), plan({ empleadoId: null, empleadoNombre: null, empleadoCuenta: null, empleadoPuesto: null }), "9", undefined);
    expect(result).toMatchObject({ empleadoId: "", empleadoNombre: "", cuenta: "", cargo: "" });
  });

  it("plan sin unidad deja la selección manual disponible y vacía", () => {
    expect(aplicarPlanSeleccionado(linea({ vehiculoId: "2" }), plan({ vehiculoId: null }), "9", empleado()).vehiculoId).toBe("");
  });

  it("plan sin cliente deja la selección manual disponible y vacía", () => {
    expect(aplicarPlanSeleccionado(linea({ clienteId: "2" }), plan({ clienteId: null }), "9", empleado()).clienteId).toBe("");
  });

  it("el resultado sigue siendo un formulario editable sin mutar la línea original", () => {
    const original = linea();
    const sugerida = aplicarPlanSeleccionado(original, plan(), "9", empleado());
    const editada = { ...sugerida, empleadoNombre: "Nombre administrativo", cuenta: "999", cargo: "Auxiliar", fechaViaje: "2026-09-13", clienteId: "7", vehiculoId: "6" };
    expect(editada).toMatchObject({ empleadoNombre: "Nombre administrativo", cuenta: "999", cargo: "Auxiliar", clienteId: "7", vehiculoId: "6" });
    expect(original).toEqual(linea());
  });

  it("Plan toma la cuenta bancaria real del empleado RRHH vinculado", () => {
    const result = aplicarPlanSeleccionado(linea(), plan({ empleadoCuenta: null }), "9", empleado({ cuentaBancaria: "998877" }));
    expect(result.cuenta).toBe("998877");
  });

  it("Plan con empleado sin cuenta bancaria deja Cuenta vacía", () => {
    const result = aplicarPlanSeleccionado(linea({ cuenta: "anterior" }), plan({ empleadoCuenta: null }), "9", empleado({ cuentaBancaria: null }));
    expect(result.cuenta).toBe("");
  });

  it("cambiar Empleado vuelve a sugerir Nombre, Cuenta y Cargo desde RRHH", () => {
    const result = aplicarEmpleadoSeleccionado(linea({ cuenta: "snapshot anterior" }), empleado({ id: 7, nombre: "Carlos Pineda", cuentaBancaria: "445566", puesto: "Auxiliar" }), "7");
    expect(result).toMatchObject({ empleadoId: "7", empleadoNombre: "Carlos Pineda", cuenta: "445566", cargo: "Auxiliar" });
  });

  it("la sugerencia es editable y no modifica el objeto RRHH", () => {
    const registroRrhh = empleado();
    const sugerida = aplicarEmpleadoSeleccionado(linea(), registroRrhh, "3");
    const editada = { ...sugerida, cuenta: "override manual" };
    expect(editada.cuenta).toBe("override manual");
    expect(registroRrhh.cuentaBancaria).toBe("123456");
  });

  it("conserva ceros iniciales y guiones porque Cuenta siempre es string", () => {
    const result = aplicarEmpleadoSeleccionado(linea(), empleado({ cuentaBancaria: "001-002-0003" }), "3");
    expect(result.cuenta).toBe("001-002-0003");
  });
});
