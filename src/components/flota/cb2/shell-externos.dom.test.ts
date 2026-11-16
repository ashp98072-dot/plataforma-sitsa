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
        tercerosDirectos: true, identidadesIndependientes: true, pilotosExternos: [], unidadesExternas: [] };
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
        const selector = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith("Tipo de piloto"))!.querySelector("select")!;
        await act(async () => { selector.value = "EXTERNO"; selector.dispatchEvent(new Event("change", { bubbles: true })); });
        expect(actual.pilotoTipo).toBe("EXTERNO");
        expect(actual.decisionNombre).toBeUndefined();
        expect(host.textContent).toContain("Nombre original");
    } finally { await act(async () => root.unmount()); host.remove(); }
});
