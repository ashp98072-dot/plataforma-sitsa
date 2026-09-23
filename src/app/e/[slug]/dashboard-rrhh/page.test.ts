import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * RRHH-DASHBOARD-SITUACION-COLAPSADA-1 — "Situación del personal hoy" inicia
 * CONTRAÍDA (HTML nativo <details>/<summary>, sin estado React). No hay harness
 * de componentes en el repo, así que se verifica el JSX del archivo.
 */
const src = readFileSync("src/app/e/[slug]/dashboard-rrhh/page.tsx", "utf8");
const inicio = src.indexOf("{situacionHoy !== null ? (");
const fin = src.indexOf("{mesActual ? (", inicio);
const bloque = src.slice(inicio, fin);
const abre = bloque.match(/<details\b[^>]*>/)![0];
const summary = bloque.slice(bloque.indexOf("<summary"), bloque.indexOf("</summary>"));
const cuerpo = bloque.slice(bloque.indexOf("</summary>"), bloque.indexOf("</details>"));

describe("Situación del personal hoy — contraída por defecto", () => {
  it("usa <details> nativo, sin atributo open (inicia cerrado en cada carga)", () => {
    expect(bloque).toContain("<details");
    expect(bloque).toContain("</details>");
    expect(abre).not.toMatch(/\bopen\b/);
    expect(bloque).not.toMatch(/<section/); // ya no es una sección siempre abierta
  });

  it("el summary es clicable/usable con teclado (nativo), con el título y un resumen aun contraído", () => {
    expect(summary).toContain("cursor-pointer");
    expect(summary).toContain("Situación del personal hoy");
    expect(summary).toContain("Sin novedades");
    expect(summary).toContain("por revisar");
    expect(summary).toContain("situacionHoy.length");
    expect(summary).toContain("Mostrar detalle");
    expect(summary).toContain("Ocultar detalle");
  });

  it("no agrega estado React ni librerías solo para esto", () => {
    expect(bloque).not.toMatch(/useState|onClick|setOpen/);
    expect(src).not.toMatch(/from "(@headlessui|@radix-ui|framer-motion)/);
  });

  it("al abrir conserva la descripción, los enlaces, la tabla y el mensaje de sin novedades", () => {
    expect(cuerpo).toContain("Personal sin marcaje y ausencias justificadas vigentes.");
    expect(cuerpo).toContain("/rrhh/marcajes");
    expect(cuerpo).toContain("Revisar marcajes");
    expect(cuerpo).toContain("/rrhh/incidencias");
    expect(cuerpo).toContain("Gestionar incidencias");
    for (const th of ["Código", "Empleado", "Situación", "Detalle"]) expect(cuerpo).toContain(`>${th}</th>`);
    expect(cuerpo).toContain("situacionHoy.map((persona)");
    expect(cuerpo).toContain("Todo el personal activo tiene marcaje y no hay ausencias vigentes.");
  });

  it("solo se muestra cuando situacionHoy está disponible (mismo criterio de datos) y usa el mismo campo del API", () => {
    expect(bloque.trimStart().startsWith("{situacionHoy !== null ? (")).toBe(true);
    expect(src).toContain("setSituacionHoy(data.situacionHoy ?? null)");
  });

  it("no cambió la clasificación: los colores por situación siguen igual", () => {
    expect(cuerpo).toContain('persona.situacion === "Sin marcaje" ? "text-[#e08a8a]" : "text-[#e8c468]"');
  });

  it("el patrón coincide con 'Últimos X meses' de la misma pantalla (details/summary con cursor-pointer)", () => {
    expect(src).toMatch(/<details[^>]*>\s*<summary className="cursor-pointer text-sm font-medium">\s*Últimos/);
  });
});
