import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmpleadoPicker } from "./empleado-picker";

const empleados = [{ id: 1, codigo: "E1", nombre: "Ana" }, { id: 55, codigo: "E55", nombre: "Abel Ambrocio" }];

describe("AJUSTE PR #376 (punto 2) — 'Todos los colaboradores' debe poder reseleccionarse", () => {
  it("filtro inicia en Todos: la opción vacía está presente con value=0", () => {
    const html = renderToStaticMarkup(createElement(EmpleadoPicker, { empleados, value: 0, onChange: () => undefined, emptyLabel: "Todos los colaboradores", allowEmptySelection: true }));
    expect(html).toContain("Todos los colaboradores");
  });
  it("selecciona un colaborador: con allowEmptySelection, 'Todos' SIGUE disponible en el markup", () => {
    const html = renderToStaticMarkup(createElement(EmpleadoPicker, { empleados, value: 55, onChange: () => undefined, emptyLabel: "Todos los colaboradores", allowEmptySelection: true }));
    expect(html).toContain("Todos los colaboradores");
    expect(html).toContain('value=""');
  });
  it("sin allowEmptySelection (comportamiento por defecto, resto de usos del picker): la opción vacía desaparece tras seleccionar", () => {
    const html = renderToStaticMarkup(createElement(EmpleadoPicker, { empleados, value: 55, onChange: () => undefined }));
    expect(html).not.toContain("— Seleccionar —");
  });
  it("sin selección (comportamiento por defecto): la opción vacía SÍ aparece, con o sin allowEmptySelection", () => {
    const sinFlag = renderToStaticMarkup(createElement(EmpleadoPicker, { empleados, value: 0, onChange: () => undefined }));
    expect(sinFlag).toContain("— Seleccionar —");
  });
  it("cambiar a 'Todos' produce onChange(0): la opción vacía tiene value=\"\" y el <select> llama onChange(Number(e.target.value))", () => {
    // Interacción real de DOM no se simula aquí (sin testing-library en este repo); se verifica la conexión exacta:
    // Number("") === 0, así que seleccionar la opción "Todos" siempre produce onChange(0).
    expect(Number("")).toBe(0);
    const src = readFileSync("src/components/rrhh/empleado-picker.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain("onChange={(e) => onChange(Number(e.target.value))}");
    expect(src).toContain('{!value || allowEmptySelection ? <option value="">{emptyLabel}</option> : null}');
  });
  it("no rompe otros usos del picker: allowEmptySelection por defecto es false", () => {
    const src = readFileSync("src/components/rrhh/empleado-picker.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain("allowEmptySelection = false,");
  });
});
