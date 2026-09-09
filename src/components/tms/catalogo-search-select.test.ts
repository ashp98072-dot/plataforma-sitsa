import { describe, expect, it } from "vitest";
import { debeMostrarNombreManual, filtrarOpcionesBusqueda, textoInicialBusqueda } from "./catalogo-search-select";

const opciones = [
  { value: "1", label: "Ana Pérez", detail: "EMP-01 · Piloto", searchText: "P123ABC Toyota Hilux CLI-01 NIT 123 Cliente Uno PLAN-001 09/09/2026" },
  { value: "2", label: "Mario López", detail: "EMP-02 · Auxiliar", searchText: "C456DEF Cliente Dos PLAN-002 10/09/2026" },
];

describe("filtrarOpcionesBusqueda", () => {
  it.each([
    ["requirente por nombre", "Ana"], ["solicitante por nombre", "Mario"],
    ["unidad por placa", "P123ABC"], ["unidad por marca/modelo", "Toyota Hilux"],
    ["cliente por nombre", "Cliente Uno"], ["cliente por código/NIT", "NIT 123"],
    ["plan por código", "PLAN-002"], ["plan por cliente", "Cliente Dos"], ["plan por fecha", "09/09/2026"],
  ])("encuentra %s", (_caso, q) => expect(filtrarOpcionesBusqueda(opciones, q).length).toBeGreaterThan(0));

  it("con búsqueda vacía conserva visible el catálogo completo", () => expect(filtrarOpcionesBusqueda(opciones, "")).toEqual(opciones));
  it("limita resultados filtrados razonablemente", () => expect(filtrarOpcionesBusqueda(Array.from({ length: 40 }, (_, i) => ({ value: String(i), label: `Opción ${i}` })), "Opción", 20)).toHaveLength(20));
  it("precarga una selección existente al editar", () => expect(textoInicialBusqueda(opciones, "2")).toBe("Mario López"));
  it("Requirente conserva texto manual sin usuario", () => expect(textoInicialBusqueda(opciones, "", "Gestora manual")).toBe("Gestora manual"));
  it("Requirente con usuario real no muestra input manual", () => expect(debeMostrarNombreManual("2", true, "Anterior")).toBe(false));
  it("Requirente muestra input manual solo al elegir Nombre manual", () => {
    expect(debeMostrarNombreManual("", false)).toBe(false);
    expect(debeMostrarNombreManual("", true)).toBe(true);
  });

  it("empleado encuentra coincidencia parcial por nombre y apellido", () => {
    const empleados = [
      { value: "1", label: "Carlos Abel Pineda Santos", detail: "EMP-1 · Piloto", searchText: "Carlos Abel Pineda Santos" },
      { value: "2", label: "Mario López", detail: "EMP-2", searchText: "Mario López" },
    ];
    expect(filtrarOpcionesBusqueda(empleados, "carlos").map((o) => o.value)).toEqual(["1"]);
    expect(filtrarOpcionesBusqueda(empleados, "pineda").map((o) => o.value)).toEqual(["1"]);
    expect(filtrarOpcionesBusqueda(empleados, "carlos abel").map((o) => o.value)).toEqual(["1"]);
  });

  it("código queda visible como detalle, pero no domina la búsqueda de empleado", () => {
    const empleados = [{ value: "1", label: "Carlos Pineda", detail: "EMP-001 · Piloto", searchText: "Carlos Pineda" }];
    expect(filtrarOpcionesBusqueda(empleados, "EMP-001")).toEqual([]);
  });
});
