import { describe, expect, it } from "vitest";
import { aplicarPlanSeleccionado } from "./fondos-selectores";

describe("selectores de Solicitud de Fondo", () => {
  it("seleccionar plan completa cliente y fecha vacía", () => {
    expect(aplicarPlanSeleccionado({ planId: "", clienteId: "", fechaViaje: "" }, { id: 9, clienteId: 4, fechaPlan: "2026-09-12" }, "9"))
      .toEqual({ planId: "9", clienteId: "4", fechaViaje: "2026-09-12" });
  });
  it("seleccionar plan conserva una fecha escrita manualmente", () => {
    expect(aplicarPlanSeleccionado({ planId: "", clienteId: "2", fechaViaje: "2026-09-10" }, { id: 9, clienteId: 4, fechaPlan: "2026-09-12" }, "9"))
      .toEqual({ planId: "9", clienteId: "4", fechaViaje: "2026-09-10" });
  });
});
