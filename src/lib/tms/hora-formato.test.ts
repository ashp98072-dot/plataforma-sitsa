import { describe, expect, it } from "vitest";
import { combinarHora12, formatearHora12, parsearHora12 } from "./hora-formato";

/**
 * OPERACIONES-HORA-12H-1 — los 5 casos exactos pedidos, probados en AMBAS
 * direcciones (24h -> 12h con formatearHora12, y 12h -> 24h con
 * combinarHora12), más HH:mm:ss, null/vacío y valores inválidos.
 */
describe("formatearHora12 (24h -> 12h)", () => {
  it.each([
    ["00:00", "12:00 AM"],
    ["08:00", "08:00 AM"],
    ["12:00", "12:00 PM"],
    ["13:00", "01:00 PM"],
    ["23:59", "11:59 PM"],
  ])("%s -> %s", (entrada, esperado) => {
    expect(formatearHora12(entrada)).toBe(esperado);
  });

  it("acepta HH:mm:ss, ignorando los segundos", () => {
    expect(formatearHora12("13:05:30")).toBe("01:05 PM");
    expect(formatearHora12("00:00:00")).toBe("12:00 AM");
    expect(formatearHora12("23:59:59")).toBe("11:59 PM");
  });

  it("null/undefined/vacío -> '—', nunca revienta ni inventa un valor", () => {
    expect(formatearHora12(null)).toBe("—");
    expect(formatearHora12(undefined)).toBe("—");
    expect(formatearHora12("")).toBe("—");
    expect(formatearHora12("   ")).toBe("—");
  });

  it("valores inválidos -> '—', nunca revienta", () => {
    expect(formatearHora12("25:00")).toBe("—");
    expect(formatearHora12("12:60")).toBe("—");
    expect(formatearHora12("no es una hora")).toBe("—");
    expect(formatearHora12("8:5")).toBe("—"); // minuto de un solo dígito, no es HH:mm válido
    expect(formatearHora12("-1:00")).toBe("—");
  });

  it("acepta hora de un solo dígito con minuto de dos (formato tolerante del input nativo)", () => {
    expect(formatearHora12("8:05")).toBe("08:05 AM");
  });
});

describe("combinarHora12 (12h -> 24h)", () => {
  it.each([
    [12, 0, "AM", "00:00"],
    [8, 0, "AM", "08:00"],
    [12, 0, "PM", "12:00"],
    [1, 0, "PM", "13:00"],
    [11, 59, "PM", "23:59"],
  ] as const)("(%s, %s, %s) -> %s", (hora, minuto, ampm, esperado) => {
    expect(combinarHora12(hora, minuto, ampm)).toBe(esperado);
  });

  it("acota hora fuera de 1-12 y minuto fuera de 0-59 en vez de producir un HH:mm inválido", () => {
    expect(combinarHora12(13, 0, "AM")).toBe(combinarHora12(12, 0, "AM")); // hora acotada a 12
    expect(combinarHora12(0, 0, "AM")).toBe(combinarHora12(1, 0, "AM")); // hora acotada a 1
    expect(combinarHora12(8, 75, "AM")).toBe(combinarHora12(8, 59, "AM")); // minuto acotado a 59
    expect(combinarHora12(8, -5, "AM")).toBe(combinarHora12(8, 0, "AM")); // minuto acotado a 0
  });

  it("redondea valores no enteros en vez de producir un HH:mm con decimales", () => {
    expect(combinarHora12(8, 30.6, "AM")).toBe("08:31");
  });
});

describe("parsearHora12 (precarga del selector al editar un registro existente)", () => {
  it.each([
    ["00:00", { hora: 12, minuto: 0, ampm: "AM" }],
    ["08:00", { hora: 8, minuto: 0, ampm: "AM" }],
    ["12:00", { hora: 12, minuto: 0, ampm: "PM" }],
    ["13:00", { hora: 1, minuto: 0, ampm: "PM" }],
    ["23:59", { hora: 11, minuto: 59, ampm: "PM" }],
  ] as const)("%s -> %o", (entrada, esperado) => {
    expect(parsearHora12(entrada)).toEqual(esperado);
  });

  it("acepta HH:mm:ss, ignorando los segundos", () => {
    expect(parsearHora12("13:05:30")).toEqual({ hora: 1, minuto: 5, ampm: "PM" });
  });

  it("null/undefined/vacío/inválido -> null (el llamador decide el valor por defecto, nunca se inventa aquí)", () => {
    expect(parsearHora12(null)).toBeNull();
    expect(parsearHora12(undefined)).toBeNull();
    expect(parsearHora12("")).toBeNull();
    expect(parsearHora12("25:00")).toBeNull();
    expect(parsearHora12("no es una hora")).toBeNull();
  });
});

/**
 * Round-trip: formatearHora12(combinarHora12(...)) y
 * combinarHora12(...parsearHora12(hora24)) deben ser consistentes entre
 * sí para los mismos 5 casos — la garantía real de que "editar un viaje
 * existente carga el valor correcto en el selector de 12 horas" (ver
 * §4 del ticket original).
 */
describe("round-trip 24h -> selector 12h -> 24h", () => {
  it.each(["00:00", "08:00", "12:00", "13:00", "23:59", "07:03"])(
    "%s se conserva exacto tras parsearHora12 + combinarHora12",
    (hora24) => {
      const partes = parsearHora12(hora24)!;
      expect(combinarHora12(partes.hora, partes.minuto, partes.ampm)).toBe(hora24);
    },
  );
});
