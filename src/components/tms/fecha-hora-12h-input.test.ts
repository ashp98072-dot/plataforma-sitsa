import { describe, expect, it } from "vitest";
import { separarFechaHora, siguienteValorFechaHora12 } from "./fecha-hora-12h-input";

/**
 * OPERACIONES-HORA-12H-1 ("Regreso estimado") — mismo criterio de prueba
 * que hora-input-12h.test.ts: se prueba la lógica PURA extraída, nunca se
 * renderiza el DOM. `separarFechaHora`/`siguienteValorFechaHora12` son
 * funciones inversas entre sí sobre el MISMO contrato que ya exige la
 * API (`"YYYY-MM-DDTHH:mm"`, regex en .../tms/planes/route.ts).
 */
describe("separarFechaHora", () => {
  it("valor vacío -> fecha y hora vacías", () => {
    expect(separarFechaHora("")).toEqual({ fecha: "", hora24: "" });
  });

  it("edición de un valor existente: separa correctamente fecha y hora", () => {
    expect(separarFechaHora("2026-09-14T08:00")).toEqual({ fecha: "2026-09-14", hora24: "08:00" });
    expect(separarFechaHora("2026-12-25T17:30")).toEqual({ fecha: "2026-12-25", hora24: "17:30" });
  });
});

describe("siguienteValorFechaHora12", () => {
  it("fecha + hora AM -> 'YYYY-MM-DDTHH:mm' reconstruido exacto", () => {
    expect(siguienteValorFechaHora12("2026-09-14", "08:00")).toBe("2026-09-14T08:00");
  });

  it("fecha + hora PM -> 'YYYY-MM-DDTHH:mm' reconstruido exacto", () => {
    expect(siguienteValorFechaHora12("2026-09-14", "17:30")).toBe("2026-09-14T17:30");
  });

  it("12:00 AM (medianoche, HH:mm=00:00) se reconstruye tal cual", () => {
    expect(siguienteValorFechaHora12("2026-09-14", "00:00")).toBe("2026-09-14T00:00");
  });

  it("12:00 PM (mediodía, HH:mm=12:00) se reconstruye tal cual", () => {
    expect(siguienteValorFechaHora12("2026-09-14", "12:00")).toBe("2026-09-14T12:00");
  });

  it("colapsa a '' si falta la fecha", () => {
    expect(siguienteValorFechaHora12("", "08:00")).toBe("");
  });

  it("colapsa a '' si falta la hora", () => {
    expect(siguienteValorFechaHora12("2026-09-14", "")).toBe("");
  });

  it("colapsa a '' si faltan ambas", () => {
    expect(siguienteValorFechaHora12("", "")).toBe("");
  });
});

/**
 * Round-trip: separarFechaHora + siguienteValorFechaHora12 deben ser
 * consistentes entre sí — la garantía real de que "al editar un valor
 * existente, separar correctamente fecha y hora" y "al guardar,
 * reconstruir exactamente YYYY-MM-DDTHH:mm" (§4/§5 del ticket original).
 */
describe("round-trip 'YYYY-MM-DDTHH:mm' -> separado -> reconstruido", () => {
  it.each(["2026-09-14T08:00", "2026-09-14T00:00", "2026-09-14T12:00", "2026-12-31T23:59"])(
    "%s se conserva exacto tras separarFechaHora + siguienteValorFechaHora12",
    (value) => {
      const { fecha, hora24 } = separarFechaHora(value);
      expect(siguienteValorFechaHora12(fecha, hora24)).toBe(value);
    },
  );

  it("'' se conserva '' (nunca se inventa una fecha/hora)", () => {
    const { fecha, hora24 } = separarFechaHora("");
    expect(siguienteValorFechaHora12(fecha, hora24)).toBe("");
  });
});
