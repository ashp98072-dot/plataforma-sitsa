import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/e/[slug]/rrhh/marcajes/asistencia/page.tsx", "utf8");
const marcajes = readFileSync("src/app/e/[slug]/rrhh/marcajes/page.tsx", "utf8");

describe("Tomar asistencia — pantalla", () => {
  it("bloquea al rol Marcaje y no reemplaza el kiosco (enlaces de ida y vuelta)", () => {
    expect(page).toContain('rol === "Marcaje"');
    expect(page).toContain("/rrhh/marcajes`");
    const i = marcajes.indexOf("Tomar asistencia");
    expect(i).toBeGreaterThan(-1);
    expect(marcajes.lastIndexOf('rolSesion !== "Marcaje"', i)).toBeGreaterThan(-1);
    expect(marcajes).toContain("Corrección manual RRHH");
  });

  it("no guarda por cada clic: el único POST está en cerrarDia, tras window.confirm", () => {
    expect(page.match(/method: "POST"/g)).toHaveLength(1);
    const alternar = page.slice(page.indexOf("function alternar"), page.indexOf("async function cerrarDia"));
    expect(alternar).not.toContain("fetch");
    const cerrar = page.slice(page.indexOf("async function cerrarDia"));
    expect(cerrar.indexOf("window.confirm")).toBeLessThan(cerrar.indexOf("fetch("));
  });

  it("confirmación con presentes/ausencias y aviso de vacaciones/permisos", () => {
    expect(page).toContain("Se registrarán ${seleccionados} presentes y ${pendientes} ausencias");
    expect(page).toContain("vacaciones/permisos/en ruta no serán marcados como falta");
  });

  it("Marcar todos solo selecciona elegibles; no seleccionables tienen checkbox deshabilitado", () => {
    expect(page).toContain("setSeleccion(new Set(elegibles.map((e) => e.id)))");
    expect(page).toContain("disabled={!e.seleccionable}");
    expect(page).toContain("Desmarcar todos");
  });

  it("fecha: no permite futuro, no manda empresa_id, recarga tras cerrar y muestra resumen", () => {
    expect(page).toContain("max={dia?.hoy}");
    expect(page).not.toMatch(/empresa_?id/i);
    expect(page).toContain("await cargar(dia.fecha)");
    expect(page).toContain("Presentes: {cierre.resumen.presentes}");
    expect(page).toContain("Ausentes: {cierre.resumen.ausentes}");
  });
});
