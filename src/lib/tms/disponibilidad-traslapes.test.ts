import { describe, expect, it } from "vitest";
import {
  ESTADOS_QUE_RESERVAN_RECURSOS,
  finViajeDesdeInput,
  inicioViaje,
  mensajeConflicto,
} from "./disponibilidad-traslapes";

describe("reglas críticas de programación TMS", () => {
  it("construye el intervalo real del viaje", () => {
    expect(inicioViaje("2026-08-26", "08:30")).toBe("2026-08-26 08:30:00");
    expect(inicioViaje("2026-08-26", null)).toBe("2026-08-26 00:00:00");
    expect(finViajeDesdeInput("2026-08-27T17:15")).toBe("2026-08-27 17:15:00");
  });

  it("solo reserva recursos en estados operativos activos", () => {
    expect(ESTADOS_QUE_RESERVAN_RECURSOS).toEqual([
      "Programado",
      "En ruta",
      "Cargado",
    ]);
    expect(ESTADOS_QUE_RESERVAN_RECURSOS).not.toContain("Cerrado");
  });

  it("explica el conflicto con unidad y horario", () => {
    expect(
      mensajeConflicto({
        tipo: "unidad",
        id: 4,
        nombre: "C-001ABC",
        planIdConflicto: 10,
        codigoConflicto: "PLAN-010",
        inicioConflicto: "2026-08-26 08:00",
        finConflicto: "2026-08-26 12:00",
      }),
    ).toContain("C-001ABC");
  });
});
