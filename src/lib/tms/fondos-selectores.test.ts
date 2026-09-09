import { describe, expect, it } from "vitest";
import { aplicarPlanSeleccionado, type LineaSeleccionFondo, type PlanSeleccionFondo } from "./fondos-selectores";

const linea = (overrides: Partial<LineaSeleccionFondo> = {}): LineaSeleccionFondo => ({
  planId: "", clienteId: "", fechaViaje: "", vehiculoId: "", empleadoId: "",
  empleadoNombre: "", cuenta: "", cargo: "", ...overrides,
});
const plan = (overrides: Partial<PlanSeleccionFondo> = {}): PlanSeleccionFondo => ({
  id: 9, clienteId: 4, fechaPlan: "2026-09-12", vehiculoId: 8, empleadoId: 3,
  empleadoNombre: "Jaime Sagüí", empleadoCuenta: "123456", empleadoPuesto: "Piloto", ...overrides,
});

describe("autocompletado de Plan en Solicitud de Fondo", () => {
  it("completa cliente, unidad, piloto y fecha con las asignaciones del plan", () => {
    expect(aplicarPlanSeleccionado(linea(), plan(), "9")).toEqual({
      planId: "9", clienteId: "4", fechaViaje: "2026-09-12", vehiculoId: "8", empleadoId: "3",
      empleadoNombre: "Jaime Sagüí", cuenta: "123456", cargo: "Piloto",
    });
  });

  it("piloto completa Nombre, Cuenta y Cargo desde el dato server-side", () => {
    const result = aplicarPlanSeleccionado(linea(), plan(), "9");
    expect([result.empleadoNombre, result.cuenta, result.cargo]).toEqual(["Jaime Sagüí", "123456", "Piloto"]);
  });

  it("plan sin piloto deja empleado editable y vacío", () => {
    const result = aplicarPlanSeleccionado(linea({ empleadoId: "2", empleadoNombre: "Anterior" }), plan({ empleadoId: null, empleadoNombre: null, empleadoCuenta: null, empleadoPuesto: null }), "9");
    expect(result).toMatchObject({ empleadoId: "", empleadoNombre: "", cuenta: "", cargo: "" });
  });

  it("plan sin unidad deja la selección manual disponible y vacía", () => {
    expect(aplicarPlanSeleccionado(linea({ vehiculoId: "2" }), plan({ vehiculoId: null }), "9").vehiculoId).toBe("");
  });

  it("plan sin cliente deja la selección manual disponible y vacía", () => {
    expect(aplicarPlanSeleccionado(linea({ clienteId: "2" }), plan({ clienteId: null }), "9").clienteId).toBe("");
  });

  it("el resultado sigue siendo un formulario editable sin mutar la línea original", () => {
    const original = linea();
    const sugerida = aplicarPlanSeleccionado(original, plan(), "9");
    const editada = { ...sugerida, empleadoNombre: "Nombre administrativo", cuenta: "999", cargo: "Auxiliar", fechaViaje: "2026-09-13", clienteId: "7", vehiculoId: "6" };
    expect(editada).toMatchObject({ empleadoNombre: "Nombre administrativo", cuenta: "999", cargo: "Auxiliar", clienteId: "7", vehiculoId: "6" });
    expect(original).toEqual(linea());
  });
});
