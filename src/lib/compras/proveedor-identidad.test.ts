import { describe, expect, it } from "vitest";
import { normalizarNitProveedor, normalizarNombreProveedor } from "./proveedor-identidad";

describe("ANTI-DUPLICADOS (secciones 7-8 del ticket) — normalizarNombreProveedor", () => {
  it("1) recorta espacios en los extremos", () => {
    expect(normalizarNombreProveedor(" Repuestos López ")).toBe(normalizarNombreProveedor("Repuestos López"));
  });
  it("2) colapsa espacios internos repetidos a uno", () => {
    expect(normalizarNombreProveedor("Repuestos   López")).toBe(normalizarNombreProveedor("Repuestos López"));
  });
  it("3) mayúsculas/minúsculas se tratan igual", () => {
    expect(normalizarNombreProveedor("REPUESTOS LÓPEZ")).toBe(normalizarNombreProveedor("repuestos lópez"));
  });
  it("4) los cuatro ejemplos del ticket son la misma identidad", () => {
    const variantes = ["Repuestos López", " repuestos lópez ", "REPUESTOS LÓPEZ", "Repuestos   López"];
    const normalizados = variantes.map(normalizarNombreProveedor);
    expect(new Set(normalizados).size).toBe(1);
  });
  it("nunca modifica el valor original que se muestra (la normalización es solo para comparar)", () => {
    const original = "  Repuestos   López  ";
    normalizarNombreProveedor(original);
    expect(original).toBe("  Repuestos   López  ");
  });
  it("nombres distintos siguen siendo distintos (no fusiona proveedores realmente diferentes)", () => {
    expect(normalizarNombreProveedor("Repuestos López")).not.toBe(normalizarNombreProveedor("Repuestos García"));
  });
});

describe("ANTI-DUPLICADOS (sección 8 del ticket) — normalizarNitProveedor", () => {
  it("5) NIT con guiones y espacios es la misma identidad que sin ellos", () => {
    const variantes = ["1234-56789-0101", "1234567890101", " 1234 56789 0101 "];
    const normalizados = variantes.map(normalizarNitProveedor);
    expect(new Set(normalizados).size).toBe(1);
  });
  it("6) NIT null -> null (nunca participa en unicidad)", () => {
    expect(normalizarNitProveedor(null)).toBeNull();
    expect(normalizarNitProveedor(undefined)).toBeNull();
  });
  it("6) NIT vacío/solo espacios -> null", () => {
    expect(normalizarNitProveedor("")).toBeNull();
    expect(normalizarNitProveedor("   ")).toBeNull();
  });
  it("uppercase + quita puntos también", () => {
    expect(normalizarNitProveedor("abc.123-456")).toBe("ABC123456");
  });
  it("nunca modifica el NIT original que se muestra", () => {
    const original = " 1234-56789-0101 ";
    normalizarNitProveedor(original);
    expect(original).toBe(" 1234-56789-0101 ");
  });
});
