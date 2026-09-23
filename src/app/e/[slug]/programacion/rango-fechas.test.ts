import { describe, expect, it } from "vitest";
import { rangoFechas } from "./programacion-client";

/**
 * PROGRAMACION-FILTRO-FECHA-ESPECIFICA-1 — núcleo puro del nuevo modo
 * "Fecha": un cuarto valor de `Rango`, junto a Hoy/Mañana/Semana, que usa
 * `fechaSeleccionada` tal cual (desde == hasta, un solo día) sin
 * restricción de pasado/futuro. Mismo criterio de prueba ya usado en
 * rango-que-contiene.test.ts: función pura, sin infraestructura de
 * testing de componentes (no hay @testing-library/react en este
 * proyecto).
 */
describe("rangoFechas — Hoy/Mañana/Semana sin cambios (regresión)", () => {
  const HOY = "2026-09-23";

  it("hoy -> un solo día, el de hoy", () => {
    expect(rangoFechas(HOY, "hoy")).toEqual({ desde: HOY, hasta: HOY });
  });

  it("manana -> un solo día, el siguiente", () => {
    expect(rangoFechas(HOY, "manana")).toEqual({ desde: "2026-09-24", hasta: "2026-09-24" });
  });

  it("semana -> desde hoy hasta hoy+6 (7 días inclusive)", () => {
    expect(rangoFechas(HOY, "semana")).toEqual({ desde: HOY, hasta: "2026-09-29" });
  });

  it("un fechaSeleccionada de más (parámetro extra) nunca afecta hoy/manana/semana", () => {
    expect(rangoFechas(HOY, "hoy", "2020-01-01")).toEqual({ desde: HOY, hasta: HOY });
    expect(rangoFechas(HOY, "semana", "2099-12-31")).toEqual({ desde: HOY, hasta: "2026-09-29" });
  });
});

describe("rangoFechas — modo 'fecha': un día puntual, sin restricción de pasado/futuro", () => {
  const HOY = "2026-09-23";

  it("fecha histórica (antes de hoy) -> desde == hasta == esa fecha, sin importar cuán antigua", () => {
    expect(rangoFechas(HOY, "fecha", "2026-09-20")).toEqual({ desde: "2026-09-20", hasta: "2026-09-20" });
    expect(rangoFechas(HOY, "fecha", "2020-01-15")).toEqual({ desde: "2020-01-15", hasta: "2020-01-15" });
  });

  it("fecha futura (más allá de la 'semana' de 7 días) -> desde == hasta == esa fecha, sin límite", () => {
    expect(rangoFechas(HOY, "fecha", "2026-10-15")).toEqual({ desde: "2026-10-15", hasta: "2026-10-15" });
    expect(rangoFechas(HOY, "fecha", "2027-01-01")).toEqual({ desde: "2027-01-01", hasta: "2027-01-01" });
  });

  it("fecha == hoy sigue funcionando igual que el botón Hoy (mismo resultado)", () => {
    expect(rangoFechas(HOY, "fecha", HOY)).toEqual(rangoFechas(HOY, "hoy"));
  });

  it("sin fechaSeleccionada (undefined) cae a hoy — nunca un rango vacío que rompa la consulta", () => {
    expect(rangoFechas(HOY, "fecha")).toEqual({ desde: HOY, hasta: HOY });
  });

  it("fechaSeleccionada vacía ('') cae a hoy — mismo criterio (input date limpiado por el usuario)", () => {
    expect(rangoFechas(HOY, "fecha", "")).toEqual({ desde: HOY, hasta: HOY });
  });
});
