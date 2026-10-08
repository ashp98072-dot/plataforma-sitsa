import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HistorialVacaciones } from "@/lib/rrhh/vacaciones";
import { HistorialPeriodosVacaciones } from "./historial-periodos-vacaciones";
import { ReparacionSerieVacaciones } from "./reparacion-serie-vacaciones";

const hist = (over: Partial<HistorialVacaciones> = {}): HistorialVacaciones => ({
  saldoActual: 0, periodos: [], fechaLaboral: "2023-04-13", fechaLaboralSospechosa: false, historialOculto: false, requiereReparacion: true, advertencias: [], ...over,
});
const reparacion = { slug: "empresa-sintetica", empleadoId: 3, onReparado: () => {} };
const html = (props: Parameters<typeof HistorialPeriodosVacaciones>[0]) => renderToStaticMarkup(createElement(HistorialPeriodosVacaciones, props));

describe("«Reparar períodos» en el historial de períodos (RRHH → Vacaciones)", () => {
  it("se mantiene el aviso actual y se agrega la acción SOLO para RRHH (admin) con serie congelada y permiso de edición", () => {
    const m = html({ historial: hist(), admin: true, reparacion });
    expect(m).toContain("Sincronización congelada para este colaborador");
    expect(m).toContain("Reparar períodos");
  });
  it("sin permiso (no se pasa `reparacion`), en el portal (no admin) o sin serie congelada NO aparece la acción", () => {
    expect(html({ historial: hist(), admin: true })).not.toContain("Reparar períodos");
    expect(html({ historial: hist(), admin: false, reparacion })).not.toContain("Reparar períodos");
    expect(html({ historial: hist({ requiereReparacion: false }), admin: true, reparacion })).not.toContain("Reparar períodos");
  });
  it("con fecha de alta sospechosa no se ofrece reparar (RRHH debe confirmar primero la fecha real)", () => {
    expect(html({ historial: hist({ fechaLaboralSospechosa: true }), admin: true, reparacion })).not.toContain("Reparar períodos");
  });
});

describe("ReparacionSerieVacaciones: no ejecuta nada al mostrarse", () => {
  it("el render inicial solo muestra el botón: ni modal, ni confirmación, ni llamadas", () => {
    const m = renderToStaticMarkup(createElement(ReparacionSerieVacaciones, { slug: "empresa-sintetica", empleadoId: 3, onReparado: () => {} }));
    expect(m).toContain("Reparar períodos");
    expect(m).not.toContain("Confirmar reparación");
    expect(m).not.toContain("role=\"dialog\"");
  });
  const fuente = readFileSync(new URL("./reparacion-serie-vacaciones.tsx", import.meta.url), "utf8");
  it("contiene el texto aprobado, la confirmación explícita y deshabilita confirmar con bloqueos o sin nada que reparar", () => {
    expect(fuente).toContain("Esta reparación reconstruirá los períodos de vacaciones usando la fecha de contratación actual. No modifica la fecha de contratación,");
    expect(fuente).toContain("Confirmar reparación");
    expect(fuente).toMatch(/disabled=\{!previa\.puedeReparar \|\| confirmando \|\| cargando\}/);
    for (const t of ["Fecha de contratación actual", "Períodos actuales", "Períodos resultantes", "Consumo que se conservará", "Saldo utilizable antes", "No se puede reparar:"]) expect(fuente).toContain(t);
  });
  it("la vista previa es GET y solo el botón de confirmar hace POST, enviando únicamente la huella (nada de empresa ni fechas del cliente)", () => {
    expect(fuente.match(/method: "POST"/g)).toHaveLength(1);
    expect(fuente).toContain("JSON.stringify({ huella: previa.huella })");
    expect(fuente).not.toMatch(/empresa_?id/i);
    expect(fuente.match(/body: /g)).toHaveLength(1); // un único cuerpo enviado: la huella
    // la vista previa solo se pide al abrir (abrir) o al detectar un cambio desde el preview; nunca en un efecto de montaje
    const efectos = fuente.match(/useEffect\([\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
    expect(efectos.every((e) => !e.includes("cargarPrevia()") && !e.includes("fetch("))).toBe(true);
  });
  it("la página solo pasa la acción con permiso RRHH · Vacaciones · editar y refresca el historial y el saldo tras reparar", () => {
    const pagina = readFileSync(new URL("../../app/e/[slug]/rrhh/vacaciones/page.tsx", import.meta.url), "utf8");
    expect(pagina).toContain('const puedeReparar = rol === "Admin" || tienePermiso(permisos, "vacaciones", "editar");');
    expect(pagina).toMatch(/reparacion=\{puedeReparar && empleadoId \? \{ slug, empleadoId, onReparado: async \(\) => \{ await cargar\(\);/);
    expect(pagina).toContain("<PendientesReparacionVacaciones");
  });
});
