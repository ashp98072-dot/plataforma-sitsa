import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HistorialVacaciones } from "@/lib/rrhh/vacaciones";
import { HistorialPeriodosVacaciones } from "./historial-periodos-vacaciones";
import { ModoCargaHistoricaVacaciones } from "./modo-carga-historica-vacaciones";

const fuente = readFileSync(new URL("./modo-carga-historica-vacaciones.tsx", import.meta.url), "utf8");
const pagina = readFileSync(new URL("../../app/e/[slug]/rrhh/vacaciones/page.tsx", import.meta.url), "utf8");
const hist: HistorialVacaciones = { saldoActual: 52.38, periodos: [], fechaLaboral: "2023-04-13", fechaLaboralSospechosa: false, historialOculto: false, requiereReparacion: false, advertencias: [] };

describe("Modo de carga histórica — UI", () => {
  it("el aviso MUY visible y el texto aprobado existen; no se muestra hasta conocer el modo, y no ejecuta nada al renderizar", () => {
    expect(fuente).toContain("MODO DE CARGA HISTÓRICA ACTIVO");
    expect(fuente).toContain("Todos los períodos históricos no consumidos se consideran disponibles temporalmente. El límite normal de 2 períodos / 30 días está suspendido durante la carga histórica.");
    const m = renderToStaticMarkup(createElement(ModoCargaHistoricaVacaciones, { slug: "empresa-sintetica", puedeCambiar: true, onCambio: () => {} }));
    expect(m).not.toContain("MODO DE CARGA HISTÓRICA ACTIVO");
    expect(m).not.toContain("Confirmar activación");
  });
  it("activar, desactivar y recalcular exigen confirmación explícita con el texto aprobado; solo con permiso de administración", () => {
    expect(fuente).toContain("Al volver al modo normal se reaplicará el vencimiento y el límite de períodos vigentes. Los consumos históricos se conservarán.");
    expect(fuente).toContain("Confirmar activación");
    expect(fuente).toContain("Confirmar desactivación");
    expect(fuente).toContain("{puedeCambiar && activo !== null ? (");
    // los botones solo abren la confirmación; únicamente «Confirmar …» llama al servidor (PUT/POST con confirmar:true)
    expect(fuente).toContain("onClick={() => (activo ? setConfirmar(\"desactivar\") : void pedirActivar())}");
    expect(fuente.match(/method: "PUT"/g)).toHaveLength(1);
    expect(fuente.match(/method: "POST"/g)).toHaveLength(1);
    expect(fuente.match(/confirmar: true/g)).toHaveLength(2);
    expect(fuente).not.toMatch(/empresa_?id/i);
  });
  it("antes de confirmar la activación se muestra la verificación previa; sin bloqueados «Confirmar activación», con bloqueados NO hay botón para ignorarlos", () => {
    for (const t of [
      "Verificación previa:", "colaboradores revisados", "aptos", "con consumo no verificable",
      "No se puede activar el modo histórico todavía. Hay {preflight.bloqueados} colaboradores con consumo que no puede reconstruirse de forma verificable.",
      "{confirmar !== \"activar\" || preflight?.puedeActivar ? (", "m.nombre", "consumo no verificable (no recalculados)",
    ]) expect(fuente).toContain(t);
    expect(fuente).toContain("/preflight");
    expect(fuente).not.toMatch(/ignorar|omitir|forzar/i);
  });
  it("la página muestra el aviso, solo ofrece el cambio con RRHH · Configuración · editar y refresca todo al cambiar", () => {
    expect(pagina).toContain('const puedeCambiarModo = rol === "Admin" || tienePermiso(permisos, "configuracion", "editar");');
    expect(pagina).toContain("<ModoCargaHistoricaVacaciones");
    expect(pagina).toContain("onModo={setModoHistorico}");
    expect(pagina).toContain("modoCargaHistorica={modoHistorico}");
    expect(pagina).toContain("MODO DE CARGA HISTÓRICA: saldo TEMPORAL, sin el límite de 2 períodos / 30 días.");
  });
  it("el historial de períodos aclara que el saldo es TEMPORAL en modo histórico y conserva el texto normal en modo normal", () => {
    const normal = renderToStaticMarkup(createElement(HistorialPeriodosVacaciones, { historial: hist, admin: true }));
    expect(normal).toContain("máximo 2 períodos completos = 30 días");
    expect(normal).not.toContain("MODO DE CARGA HISTÓRICA");
    const temporal = renderToStaticMarkup(createElement(HistorialPeriodosVacaciones, { historial: hist, admin: true, modoCargaHistorica: true }));
    expect(temporal).toContain("MODO DE CARGA HISTÓRICA: el saldo actual es TEMPORAL");
    expect(temporal).toContain("No es el saldo normal.");
  });
});
