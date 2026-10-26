// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CandidatosCB2 } from "./preview-vista";
import type { CatalogosCB2, FilaCB2 } from "./client";
let root: Root, host: HTMLDivElement, selected: Record<string, string>;
const f: FilaCB2 = { hoja: "DEMO", fila: 2, candidato: "a", bloqueada: false, documento: null, errores: [], estado: "VALIDA", motivos: [], vale: "0001", placa: "C-570BZT", placaNormalizada: "C-570BZT", fecha: "2026-10-01", galones: "10", precio: "20", monto: "200", moneda: "GTQ", lote: "007" };
const cat: CatalogosCB2 = { proveedores: [], vehiculos: [{ id: 1, placa: "C-570BZT" }, { id: 2, placa: "C-474BVD" }] };
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); selected = {}; });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount(filas: FilaCB2[], catalogos = cat) {
    function Wrapper() { const [sel, setSel] = useState<Record<string, string>>({}); return createElement(CandidatosCB2, { filas, cat: catalogos, seleccion: sel, onChange: (s: Record<string, string>) => { selected = s; setSel(s); } }); }
    await act(async () => root.render(createElement(Wrapper)));
}
async function click(text: string) { const btn = Array.from(host.querySelectorAll("button")).find(b => b.textContent === text); expect(btn).toBeDefined(); await act(async () => btn!.click()); }
function control(text: string): HTMLInputElement | HTMLSelectElement { const label = Array.from(host.querySelectorAll("label")).find(l => l.textContent?.startsWith(text)); return (label?.querySelector("input,select") ?? document.getElementById(label!.htmlFor)) as HTMLInputElement | HTMLSelectElement; }
async function change(text: string, value: string) { const el = control(text); await act(async () => { Object.getOwnPropertyDescriptor(el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); }
describe("vista previa: asignación, filtros y trazabilidad", () => {
    it("vale 15094 distingue registros de C-035BXR y no repite el mismo ID", async () => {
        await mount([{ ...f, vale: "15094", placa: "C-035BXR", placaNormalizada: "C-035BXR" }], { ...cat, vehiculos: [{ id: 7, placa: "C-035BXR" }, { id: 7, placa: "C-035BXR" }, { id: 9, placa: "C-035BXR" }] });
        const select = control("Unidad para vale 15094") as HTMLSelectElement;
        expect(Array.from(select.options).map(o => o.value)).toEqual(["", "7", "9"]);
        expect(select.options[1].textContent).toContain("Registro #7"); expect(select.options[2].textContent).toContain("Registro #9");
        expect(host.textContent).toContain("Varias unidades coinciden"); expect(selected).toEqual({});
        await change("Unidad para vale 15094", "9"); expect(selected).toEqual({ a: "9" });
    });
    it("muestra piloto original, sugerencia y límite de asociación", async () => {
        await mount([{ ...f, origen: { piloto: " JOSE  CHAY ", producto: "", km: "", galones: "10", precio: "20", monto: "200" } }], { ...cat, pilotos: [{ id: 1, nombre: "José Chay" }] });
        expect(host.textContent).toContain("Piloto leído:  JOSE  CHAY "); expect(host.textContent).toContain("Piloto sugerido: EXACTA"); expect(host.textContent).toContain("José Chay");
        expect(host.textContent).toContain("sin vínculo al catálogo"); expect(selected).toEqual({});
    });
    it("escapa nombres del Excel y de catálogos", async () => {
        const nombre = '<img src=x onerror="alert(1)">';
        await mount([{ ...f, origen: { piloto: nombre, producto: "", km: "", galones: "10", precio: "20", monto: "200" } }], { ...cat, pilotos: [{ id: 1, nombre }] });
        expect(host.textContent).toContain(nombre); expect(host.querySelector("img")).toBeNull();
    });
    it("aproximadas nunca ofrecen usar sugerencia como identidad exacta", async () => {
        await mount([{ ...f, placa: "C-570BZ7", placaNormalizada: "C-570BZ7" }]);
        expect(host.textContent).toContain("APROXIMADA"); expect(host.textContent).toContain("selección manual");
        expect(host.textContent).not.toContain("Usar sugerencia para vale"); expect(selected).toEqual({});
    });
    it("sugiere sin seleccionar y permite corregir manualmente", async () => {
        await mount([f]); expect(host.textContent).toContain("Unidad sugerida: C-570BZT"); expect(selected).toEqual({});
        await click("Usar sugerencia para vale 0001"); expect(selected).toEqual({ a: "1" }); expect(host.textContent).toContain("LISTO");
        await change("Unidad para vale", "2"); expect(selected).toEqual({ a: "2" });
        await change("Unidad para vale", ""); expect(control("Unidad para vale").value).toBe("");
    });
    it("ambiguas o inexistentes nunca ofrecen uso automático ni opciones ajenas", async () => {
        await mount([f, { ...f, fila: 3, candidato: "b", placa: "C-147CCT", placaNormalizada: "C-147CCT" }], { ...cat, vehiculos: [...cat.vehiculos, { id: 3, placa: "C–570BZT" }] });
        expect(host.textContent).toContain("Varias unidades coinciden"); expect(host.textContent).toContain("Vehículo no encontrado");
        expect(host.textContent).not.toContain("Usar sugerencia para vale"); expect(selected).toEqual({});
        expect(host.querySelector('option[value="99"]')).toBeNull();
    });
    it("pagina operativas e ignoradas por separado sin perder selección al filtrar", async () => {
        const rows = Array.from({ length: 28 }, (_, i) => ({ ...f, fila: i + 2, vale: String(i + 1).padStart(4, "0"), candidato: `c${i}` }));
        const ignored = Array.from({ length: 30 }, (_, i) => ({ ...f, fila: i + 40, candidato: null, estado: "IGNORADA", bloqueada: true }));
        await mount([...ignored, ...rows]);
        const disclosure = Array.from(host.querySelectorAll("details")).find(d => d.querySelector("summary")?.textContent?.startsWith("Ver filas ignoradas"))!;
        expect(disclosure.open).toBe(false); expect(disclosure.textContent).toContain("Ver filas ignoradas (30)");
        expect(disclosure.querySelectorAll("select")).toHaveLength(0); expect(disclosure.querySelectorAll("tbody tr")).toHaveLength(25);
        await click("Usar sugerencia para vale 0001"); await click("Siguiente"); expect(selected.c0).toBe("1");
        await change("Lote", "007"); await change("Vale", "0001"); expect(host.textContent).toContain("1 candidatos filtrados");
        expect(control("Unidad para vale").value).toBe("1");
        await change("Estado de vista previa", "LISTO"); expect(host.textContent).toContain("1 candidatos filtrados");
        await change("Placa", "INEXISTENTE"); expect(host.textContent).toContain("No hay consumos para estos filtros"); expect(selected.c0).toBe("1");
    });
    it("mantiene errores bloqueantes visibles y excluye bloqueados de asignación", async () => {
        await mount([{ ...f, bloqueada: true, errores: ["fecha"], motivos: ["Fecha inválida"] }]);
        expect(host.textContent).toContain("BLOQUEADO"); expect(host.textContent).toContain("Fecha inválida");
        expect(host.querySelector('details[open]')).not.toBeNull();
        expect(host.textContent).not.toContain("Usar sugerencia para vale"); expect(host.querySelector('select[id$="-select"]')).toBeNull();
    });
});
