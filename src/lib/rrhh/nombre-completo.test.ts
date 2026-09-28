import { describe, expect, it } from "vitest";
import { componerNombreCompleto, tieneIdentidadEstructurada } from "./nombre-completo";

const partes = (over: Partial<Parameters<typeof componerNombreCompleto>[0]> = {}) => ({
  primerNombre: "", segundoNombre: "", tercerNombre: "", cuartoNombre: "",
  primerApellido: "", segundoApellido: "", apellidoCasada: "", ...over,
});

describe("IDENTIDAD — componerNombreCompleto", () => {
  it("1) primer nombre + primer apellido", () => {
    expect(componerNombreCompleto(partes({ primerNombre: "Juan", primerApellido: "Pérez" }))).toBe("Juan Pérez");
  });
  it("2) segundo nombre opcional", () => {
    expect(componerNombreCompleto(partes({ primerNombre: "Juan", segundoNombre: "Carlos", primerApellido: "Pérez" }))).toBe("Juan Carlos Pérez");
  });
  it("3) múltiples nombres (primer/segundo/tercer/cuarto)", () => {
    expect(componerNombreCompleto(partes({ primerNombre: "Juan", segundoNombre: "Carlos", tercerNombre: "Antonio", cuartoNombre: "José", primerApellido: "Pérez" })))
      .toBe("Juan Carlos Antonio José Pérez");
  });
  it("4) segundo apellido", () => {
    expect(componerNombreCompleto(partes({ primerNombre: "Juan", primerApellido: "Pérez", segundoApellido: "López" }))).toBe("Juan Pérez López");
  });
  it("5) apellido de casada", () => {
    expect(componerNombreCompleto(partes({ primerNombre: "María", primerApellido: "Gómez", apellidoCasada: "de Ramírez" }))).toBe("María Gómez de Ramírez");
  });
  it("6) nombre completo derivado correctamente (ejemplo del ticket)", () => {
    expect(componerNombreCompleto(partes({ primerNombre: "Juan", segundoNombre: "Carlos", tercerNombre: "Antonio", primerApellido: "Pérez", segundoApellido: "López" })))
      .toBe("Juan Carlos Antonio Pérez López");
  });
  it("7) trim y espacios repetidos", () => {
    expect(componerNombreCompleto(partes({ primerNombre: "  Juan  ", primerApellido: "  Pérez   López  " }))).toBe("Juan Pérez López");
  });
  it("campos vacíos se ignoran (no dejan huecos)", () => {
    expect(componerNombreCompleto(partes({ primerNombre: "Juan", segundoNombre: "  ", primerApellido: "Pérez" }))).toBe("Juan Pérez");
  });
  it("todo vacío -> cadena vacía (el caller decide el fallback)", () => {
    expect(componerNombreCompleto(partes())).toBe("");
  });
});

describe("tieneIdentidadEstructurada", () => {
  it("false cuando todo está vacío o es null/undefined", () => {
    expect(tieneIdentidadEstructurada(partes())).toBe(false);
    expect(tieneIdentidadEstructurada(null)).toBe(false);
    expect(tieneIdentidadEstructurada(undefined)).toBe(false);
  });
  it("true si al menos un campo tiene contenido", () => {
    expect(tieneIdentidadEstructurada(partes({ primerNombre: "Juan" }))).toBe(true);
  });
});
