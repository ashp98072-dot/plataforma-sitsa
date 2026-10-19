import { describe, expect, it } from "vitest";
import { errorRangoProgramacion, rangoProgramacionDesdeParams, urlRangoProgramacion } from "./programacion-rango";
import { rangoFechas } from "@/app/e/[slug]/programacion/programacion-client";

describe("Programación — intervalo inclusivo y validación compartida", () => {
  it.each([
    ["2026-10-17", "2026-10-17"],
    ["2026-10-17", "2026-10-24"],
    ["2026-09-30", "2026-10-02"],
    ["2026-12-31", "2027-01-02"],
    ["2024-02-29", "2024-03-01"],
  ])("acepta %s a %s sin imponer duración máxima", (desde, hasta) => {
    expect(errorRangoProgramacion(desde, hasta)).toBeNull();
    expect(rangoFechas("2026-10-17", "rango", "2020-01-01", { desde, hasta })).toEqual({ desde, hasta });
  });
  it.each([["", ""], ["2026-10-17", ""], ["", "2026-10-17"]])("ambos extremos obligatorios: %s / %s", (desde, hasta) => {
    expect(errorRangoProgramacion(desde, hasta)).toBe("Selecciona ambas fechas: Desde y Hasta.");
  });
  it("rechaza el orden invertido", () => {
    expect(errorRangoProgramacion("2026-10-18", "2026-10-17")).toContain("posterior");
  });
  it.each(["2026-02-30", "2026-13-01", "2026-2-01", "Thu Sep 24"]) ("rechaza calendario inválido %s", (fecha) => {
    expect(errorRangoProgramacion(fecha, "2026-12-31")).toContain("válidas");
  });
  it("sin intervalo no inventa fechas para el modo Rango", () => {
    expect(rangoFechas("2026-10-17", "rango")).toEqual({ desde: "", hasta: "" });
  });
  it("Rango → Hoy/Semana/Fecha/Mañana deja de aplicar el intervalo", () => {
    const intervalo = { desde: "2020-01-01", hasta: "2027-12-31" };
    expect(rangoFechas("2026-10-17", "hoy", "2026-01-02", intervalo)).toEqual({ desde: "2026-10-17", hasta: "2026-10-17" });
    expect(rangoFechas("2026-10-17", "semana", "2026-01-02", intervalo)).toEqual({ desde: "2026-10-17", hasta: "2026-10-23" });
    expect(rangoFechas("2026-10-17", "manana", "2026-01-02", intervalo)).toEqual({ desde: "2026-10-18", hasta: "2026-10-18" });
    expect(rangoFechas("2026-10-17", "fecha", "2026-01-02", intervalo)).toEqual({ desde: "2026-01-02", hasta: "2026-01-02" });
  });
});

describe("Programación — URL y recarga", () => {
  it("sin parámetros conserva el modo inicial anterior", () => {
    expect(rangoProgramacionDesdeParams({})).toBeUndefined();
  });
  it("persiste y restaura exactamente los extremos conservando plan y hash", () => {
    const intervalo = { desde: "2026-12-31", hasta: "2027-01-02" };
    const path = urlRangoProgramacion("http://local/e/empresa/programacion?plan=31#viaje", intervalo);
    const url = new URL(path, "http://local");
    expect(url.searchParams.get("plan")).toBe("31");
    expect(url.hash).toBe("#viaje");
    expect(rangoProgramacionDesdeParams(Object.fromEntries(url.searchParams))).toEqual(intervalo);
    const fuera = new URL(urlRangoProgramacion(url.href, null), "http://local");
    expect(fuera.searchParams.has("desde")).toBe(false);
    expect(fuera.searchParams.has("hasta")).toBe(false);
    expect(fuera.searchParams.get("plan")).toBe("31");
  });
  it("una URL incompleta queda inválida, nunca consulta todas las fechas", () => {
    const rango = rangoProgramacionDesdeParams({ desde: "2026-10-17" })!;
    expect(rango).toEqual({ desde: "2026-10-17", hasta: "" });
    expect(errorRangoProgramacion(rango.desde, rango.hasta)).not.toBeNull();
  });
  it("parámetros repetidos usan el primero", () => {
    expect(rangoProgramacionDesdeParams({ desde: ["2026-10-17", "2020-01-01"], hasta: "2026-10-18" })).toEqual({ desde: "2026-10-17", hasta: "2026-10-18" });
  });
});
