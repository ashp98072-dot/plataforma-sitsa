// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { AsignacionCB2, type DecisionAsignacion } from "./asignacion";
import type { CatalogosCB2, FilaCB2 } from "./client";

it("Shell ofrece alta y elección de piloto externo; cambiar tipo elimina la decisión de nombre anterior", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"), root = createRoot(host);
    document.body.append(host);
    const fila = { perfil: "SHELL", vale: "LAB", placa: "M884LAB", placaNormalizada: "M884LAB", origen: { piloto: "Nombre original", producto: "Diesel" } } as FilaCB2;
    const cat: CatalogosCB2 = { proveedores: [], vehiculos: [], empleados: [], tercerosHabilitados: true,
        tercerosDirectos: true, identidadesIndependientes: true, pilotosExternos: [{ id: 5, nombre: "Piloto Externo", referencia: "R5" }], unidadesExternas: [] };
    let actual: DecisionAsignacion = {};
    function Pantalla() {
        const [decision, cambiar] = useState<DecisionAsignacion>({ decisionNombre: { tipo: "REPORTADO", confirmado: true } });
        actual = decision;
        return createElement(AsignacionCB2, { fila, cat, value: decision, onChange: cambiar, disabled: false,
            api: "/lab", actualizarCatalogos: async () => {} });
    }
    try {
        await act(async () => root.render(createElement(Pantalla)));
        expect(host.querySelector('form[aria-label="Alta directa de piloto"]')).not.toBeNull();
        expect(host.querySelector('form[aria-label="Alta directa de unidad"]')).not.toBeNull();
        expect(host.textContent).toContain("Piloto tercerizado para vale LAB");
        // Regla única: en Shell el tipo de piloto NO se elige con un select aparte (contradecía a «Piloto del Excel»); solo el piloto tercerizado reemplaza la decisión de nombre.
        expect([...host.querySelectorAll("label")].some(l => l.textContent?.startsWith("Tipo de piloto"))).toBe(false);
        const selector = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith("Piloto tercerizado para vale LAB"))!.parentElement!.querySelector("select")!;
        await act(async () => { selector.value = "5"; selector.dispatchEvent(new Event("change", { bubbles: true })); });
        expect(actual.pilotoTipo).toBe("EXTERNO"); expect(actual.pilotoExternoId).toBe(5);
        expect(actual.decisionNombre).toBeUndefined();
        expect(host.textContent).toContain("Nombre original");
    } finally { await act(async () => root.unmount()); host.remove(); }
});
