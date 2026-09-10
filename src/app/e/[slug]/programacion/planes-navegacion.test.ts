import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  destinoTrasCerrarPlan,
  perteneceAlTableroProgramacion,
} from "./programacion-client";

/**
 * OPERACIONES-UX-PLANES-SIMPLIFICADO-1 — Programación se enfoca en trabajo
 * activo/próximo; el historial (Cerrados) y el expediente viven en
 * Operaciones → Planes / Viajes. Tras CERRAR un viaje, Programación
 * redirige a esa pantalla enfocando el plan recién cerrado.
 *
 * Este proyecto no tiene harness de componentes React — se prueba la
 * lógica pura extraíble y, como guarda de regresión, el código fuente.
 */
describe("destinoTrasCerrarPlan — a dónde va Programación después de cerrar un viaje", () => {
  it("apunta a /e/<slug>/planes con el plan enfocado y el aviso de cierre", () => {
    expect(destinoTrasCerrarPlan("sitsa", 42)).toBe("/e/sitsa/planes?plan=42&cerrado=1");
  });
});

describe("perteneceAlTableroProgramacion — Cerrados dejan de ser protagonistas", () => {
  it("un plan Cerrado NO pertenece al tablero de Programación", () => {
    expect(perteneceAlTableroProgramacion("Cerrado")).toBe(false);
  });
  it("los planes todavía operativos sí pertenecen al tablero", () => {
    for (const e of ["Programado", "Cargado", "En ruta", "Descargado", "Cancelado"]) {
      expect(perteneceAlTableroProgramacion(e)).toBe(true);
    }
  });
});

const src = readFileSync(join(__dirname, "programacion-client.tsx"), "utf-8");

describe("programacion-client.tsx — código fuente", () => {
  it("al cerrar un viaje redirige a Planes / Viajes (nunca se queda en el plan cerrado)", () => {
    expect(src).toMatch(/if \(info\.cerrado\)/);
    expect(src).toMatch(/router\.push\(destinoTrasCerrarPlan\(slug, info\.id\)\)/);
  });

  it("el tablero excluye los planes Cerrados vía perteneceAlTableroProgramacion", () => {
    expect(src).toMatch(/perteneceAlTableroProgramacion\(p\.estado\)/);
  });

  it("ya no existe el filtro rápido 'Cerrado' (ni opción de <select> ni predicado)", () => {
    expect(src).not.toMatch(/<option value="Cerrado">/);
    expect(src).not.toMatch(/filtroRapido === "Cerrado"/);
  });

  it("enlaza a Planes / Viajes desde el encabezado (para consultar el historial)", () => {
    expect(src).toMatch(/\/e\/\$\{slug\}\/planes/);
  });
});

const planForm = readFileSync(join(__dirname, "plan-form.tsx"), "utf-8");

describe("plan-form.tsx — solo el cierre marca `cerrado: true`", () => {
  it("confirmarCierre pasa cerrado:true a onSaved", () => {
    expect(planForm).toMatch(/onSaved\(\{ id: plan!\.id, fechaPlan: form\.fechaPlan, cerrado: true \}\)/);
  });
  it("marcarCargado / cancelarViaje NO marcan cerrado (siguen el flujo normal en Programación)", () => {
    const conCerrado = planForm.match(/onSaved\([^)]*cerrado: true[^)]*\)/g) ?? [];
    expect(conCerrado).toHaveLength(1);
  });
});
