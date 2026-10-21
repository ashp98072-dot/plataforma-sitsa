import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * TMS-PROGRAMACION-HABILITACIONES-1 — plan-form.tsx ya NO decide elegibilidad de Piloto/Auxiliar con el
 * `match()` inline de siempre (categoriaOps/puesto únicamente, con fallback "si no hay match, mostrar
 * todos"): ahora delega en filtrarElegibles()/elegibilidadRol() (personal-elegibilidad.ts, ya probado por
 * separado con tests unitarios puros). Aquí solo se confirma el WIRING — que el componente realmente llama
 * a la función nueva, que el fallback viejo desapareció, y que Cuadrilla sigue recibiendo la lista COMPLETA
 * sin filtrar (independencia ya probada en cuadrilla-integracion.test.ts, no se repite aquí).
 */
const src = readFileSync("src/app/e/[slug]/programacion/plan-form.tsx", "utf8").replace(/\r\n/g, "\n");

describe("TMS-PROGRAMACION-HABILITACIONES-1 — plan-form delega elegibilidad en personal-elegibilidad.ts", () => {
  it("importa filtrarElegibles desde @/lib/tms/personal-elegibilidad", () => {
    expect(src).toContain('import { filtrarElegibles, type HabilitacionOp } from "@/lib/tms/personal-elegibilidad";');
  });

  it("llama a filtrarElegibles para PILOTO y para AUXILIAR", () => {
    expect(src).toContain('filtrarElegibles(list, habilitacionesPorEmpleado, "PILOTO", (p) => p.id)');
    expect(src).toContain('filtrarElegibles(list, habilitacionesPorEmpleado, "AUXILIAR", (p) => p.id)');
  });

  it("el fallback viejo 'si no hay match, mostrar a todos' ya NO existe", () => {
    expect(src).not.toMatch(/pilotosFil\.length \? pilotosFil : list/);
    expect(src).not.toMatch(/auxFil\.length \? auxFil : list/);
    expect(src).not.toContain("const match = (p: EmpOps");
  });

  it("Cuadrilla sigue recibiendo la lista COMPLETA sin filtrar (independiente de la elegibilidad de Piloto/Auxiliar)", () => {
    expect(src).toContain("setEmpleadosCuadrilla(list);");
    // setEmpleadosCuadrilla debe ir ANTES del cálculo de elegibilidad, con `list` (no con `pilotos`/`auxiliares`).
    const idxCuadrilla = src.indexOf("setEmpleadosCuadrilla(list);");
    const idxFiltrarPiloto = src.indexOf('filtrarElegibles(list, habilitacionesPorEmpleado, "PILOTO"');
    expect(idxCuadrilla).toBeGreaterThan(-1);
    expect(idxFiltrarPiloto).toBeGreaterThan(idxCuadrilla);
  });

  it("el mapa de habilitaciones por empleado sale de habilitacionesOps (campo aditivo de personal-ops), nunca inventado", () => {
    expect(src).toContain("p.habilitacionesOps ?? []");
  });

  it("EmpOps declara habilitacionesOps como campo opcional aditivo", () => {
    const inicio = src.indexOf("type EmpOps = {");
    const bloque = src.slice(inicio, src.indexOf("};", inicio));
    expect(bloque).toContain("habilitacionesOps?: HabilitacionOp[];");
    // Los campos legacy no cambiaron de tipo/significado.
    expect(bloque).toContain("categoriaOps: string;");
  });
});
