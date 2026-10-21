import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HistorialVacaciones } from "@/lib/rrhh/vacaciones";
import { HistorialPeriodosVacaciones } from "./historial-periodos-vacaciones";
import { AvisoHistorialCompletoVacaciones, ModoCargaHistoricaVacaciones } from "./modo-carga-historica-vacaciones";

const fuenteCompleta = readFileSync(new URL("./modo-carga-historica-vacaciones.tsx", import.meta.url), "utf8");
/** El código sin comentarios (los comentarios explican por qué la interfaz no ofrece desactivar; no son texto visible). */
const fuente = fuenteCompleta.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const pagina = readFileSync(new URL("../../app/e/[slug]/rrhh/vacaciones/page.tsx", import.meta.url), "utf8");
const hist: HistorialVacaciones = { saldoActual: 52.38, periodos: [], fechaLaboral: "2023-04-13", fechaLaboralSospechosa: false, historialOculto: false, requiereReparacion: false, advertencias: [] };
/** Todo el texto visible que puede mostrar la pantalla en modo activo (aviso + componente + historial con el modo activo). */
const visible = [
  renderToStaticMarkup(createElement(AvisoHistorialCompletoVacaciones)),
  renderToStaticMarkup(createElement(ModoCargaHistoricaVacaciones, { slug: "empresa-sintetica", puedeCambiar: true, onCambio: () => {} })),
  renderToStaticMarkup(createElement(HistorialPeriodosVacaciones, { historial: hist, admin: true, modoCargaHistorica: true })),
].join("\n");

describe("Historial completo de vacaciones — solo textos de la interfaz (el motor no cambia)", () => {
  it("4) aparece «HISTORIAL COMPLETO DE VACACIONES ACTIVO» con el texto aprobado", () => {
    const aviso = renderToStaticMarkup(createElement(AvisoHistorialCompletoVacaciones));
    expect(aviso).toContain("HISTORIAL COMPLETO DE VACACIONES ACTIVO");
    expect(aviso).toContain("El saldo incluye todos los períodos acumulados desde la fecha de contratación, descontando las vacaciones registradas.");
    expect(fuente).toContain("{activo ? <AvisoHistorialCompletoVacaciones /> : null}");
  });

  it("1/2) con el modo activo NO hay botón «Desactivar» ni «Recalcular saldos» ni el texto «Modo de carga histórica de vacaciones: ACTIVO»", () => {
    expect(visible).not.toMatch(/Desactivar/i);
    expect(visible).not.toMatch(/Recalcular saldos/i);
    expect(visible).not.toContain("Modo de carga histórica de vacaciones");
    // y el código ya no contiene esas acciones: ni desactivar, ni resincronizar, ni su ruta
    expect(fuente).not.toMatch(/Desactivar|desactivar|Recalcular|resincronizar|Confirmar desactivación|ACTIVO<\/strong>/);
    expect(fuente.match(/method: "PUT"/g)).toHaveLength(1);
    expect(fuente).not.toContain('method: "POST"');
    expect(fuente).toContain("body: JSON.stringify({ activo: true, confirmar: true })");
  });

  it("3) no aparece «saldo TEMPORAL», «modo de carga», «límite suspendido» ni nada que sugiera desactivarlo después", () => {
    for (const prohibido of [/temporal/i, /MODO DE CARGA/i, /carga hist[oó]rica/i, /suspendid/i, /durante la carga/i, /posteriormente/i, /volver al modo normal/i]) {
      expect(visible).not.toMatch(prohibido);
    }
    expect(pagina).not.toMatch(/saldo TEMPORAL|MODO DE CARGA HISTÓRICA/);
    expect(pagina).not.toMatch(/sin el límite de 2 períodos \/ 30 días\./);
  });

  it("la sección del saldo y el historial de períodos usan el texto nuevo (los datos y estados no cambian)", () => {
    expect(pagina).toContain("El saldo se calcula desde la fecha de contratación / alta e incluye todos los períodos acumulados, descontando las vacaciones registradas.");
    const activo = renderToStaticMarkup(createElement(HistorialPeriodosVacaciones, { historial: hist, admin: true, modoCargaHistorica: true }));
    expect(activo).toContain("El saldo actual incluye todos los períodos acumulados desde la fecha de contratación, descontando las vacaciones registradas.");
    expect(activo).toContain("52.38"); // el dato mostrado es el mismo
    const normal = renderToStaticMarkup(createElement(HistorialPeriodosVacaciones, { historial: hist, admin: true }));
    expect(normal).toContain("máximo 2 períodos completos = 30 días"); // sin el modo, el texto normal queda igual
  });

  it("la página sigue cableada igual (mismas props y refrescos); el motor y las APIs no se tocan", () => {
    expect(pagina).toContain("<ModoCargaHistoricaVacaciones");
    expect(pagina).toContain("onModo={setModoHistorico}");
    expect(pagina).toContain("modoCargaHistorica={modoHistorico}");
    expect(pagina).toContain('const puedeCambiarModo = rol === "Admin" || tienePermiso(permisos, "configuracion", "editar");');
  });

  it("una empresa que aún no lo tiene conserva la activación con verificación previa y confirmación explícita (sin botón para ignorar bloqueos)", () => {
    for (const t of [
      "Verificación previa:", "colaboradores revisados", "aptos", "con consumo no verificable",
      "No se puede activar el modo histórico todavía. Hay {preflight.bloqueados} colaboradores con consumo que no puede reconstruirse de forma verificable.",
      "Confirmar activación", "{preflight?.puedeActivar ? (",
    ]) expect(fuente).toContain(t);
    expect(fuente).toContain("/preflight");
    expect(fuente).not.toMatch(/ignorar|omitir|forzar/i);
    expect(fuente).not.toMatch(/empresa_?id/i);
  });
});
