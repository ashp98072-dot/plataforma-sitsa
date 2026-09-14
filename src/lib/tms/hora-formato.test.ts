import { describe, expect, it } from "vitest";
import { combinarHora12, formatearFechaHora12, formatearHora12, parsearHora12 } from "./hora-formato";

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

/**
 * OPERACIONES-HORA-12H-1 (Grupo C) — `formatearFechaHora12` reutiliza
 * `fmtTs` (rrhh/dates.ts) para la normalización, así que se prueba contra
 * las 4 formas reales en que puede llegar un valor de fecha+hora:
 * el string `YYYY-MM-DDTHH:mm` que ya devuelve
 * `DATE_FORMAT(..., '%Y-%m-%dT%H:%i')` en reportes-viajes.ts (salida/
 * llegada/regreso/cierre, todas la MISMA consulta), un string MySQL con
 * espacio y segundos, un objeto `Date`, e ISO con `Z`/offset — validando
 * que TODAS conserven la hora de pared de Guatemala (sin conversión de
 * zona en el caso "sin Z/offset", con conversión correcta cuando sí la
 * llevan).
 */
describe("formatearFechaHora12 (fecha+hora completa -> 'YYYY-MM-DD hh:mm AM/PM')", () => {
  it("salida real en AM", () => {
    expect(formatearFechaHora12("2026-09-14T08:00")).toBe("2026-09-14 08:00 AM");
  });

  it("llegada real en PM", () => {
    expect(formatearFechaHora12("2026-09-14T15:30")).toBe("2026-09-14 03:30 PM");
  });

  it("12:00 AM (medianoche)", () => {
    expect(formatearFechaHora12("2026-09-14T00:00")).toBe("2026-09-14 12:00 AM");
  });

  it("12:00 PM (mediodía)", () => {
    expect(formatearFechaHora12("2026-09-14T12:00")).toBe("2026-09-14 12:00 PM");
  });

  it("conserva la FECHA cuando llegada real cae al día siguiente (viaje de varios días) — nunca se descarta", () => {
    expect(formatearFechaHora12("2026-09-16T15:30")).toBe("2026-09-16 03:30 PM");
  });

  it("null/undefined/vacío -> '—', nunca revienta", () => {
    expect(formatearFechaHora12(null)).toBe("—");
    expect(formatearFechaHora12(undefined)).toBe("—");
    expect(formatearFechaHora12("")).toBe("—");
  });

  it("acepta un string MySQL con espacio y segundos (mismo criterio defensivo que fmtTs)", () => {
    expect(formatearFechaHora12("2026-09-14 08:05:30")).toBe("2026-09-14 08:05 AM");
  });

  it("acepta un objeto Date (mysql2 sin dateStrings) — vía fmtTs, sin reimplementar el manejo de Date", () => {
    expect(formatearFechaHora12(new Date(2026, 8, 14, 8, 0, 0))).toBe("2026-09-14 08:00 AM"); // mes 8 = septiembre (0-indexado)
  });

  it("acepta ISO con 'Z' (UTC), convirtiendo a la hora de pared de Guatemala (UTC-6, sin horario de verano)", () => {
    expect(formatearFechaHora12("2026-09-14T14:00:00Z")).toBe("2026-09-14 08:00 AM"); // 14:00 UTC -> 08:00 Guatemala
  });

  it("acepta ISO con offset explícito, respetándolo al convertir a Guatemala", () => {
    expect(formatearFechaHora12("2026-09-14T08:00:00-06:00")).toBe("2026-09-14 08:00 AM"); // ya es el offset de Guatemala
  });
});
