// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidatosCB2, ResumenSeleccionCB2 } from "./preview-vista";
import { useRevisionCB2 } from "./use-revision";
import type { CatalogosCB2, FilaCB2 } from "./client";
let host: HTMLDivElement, root: Root;
const cat: CatalogosCB2 = { proveedores: [{ id: 1, nombre: "Demo" }], vehiculos: [{ id: 1, placa: "C-570BZT" }, { id: 2, placa: "C-147CCT" }, { id: 3, placa: "C-633CBL" }], pilotos: [{ id: 1, nombre: "José Chay" }] };
const fila: FilaCB2 = { hoja: "AGOSTO", fila: 2, candidato: "a", bloqueada: false, documento: null, errores: [], estado: "ADVERTENCIA", motivos: ["Producto no informado"], vale: "0001", placa: "C-570BZT", placaNormalizada: "C-570BZT", fecha: "2026-08-01", galones: "10", precio: "20", monto: "199", moneda: "GTQ", lote: "2054", origen: { piloto: "JOSE CHAY", producto: "", km: "", galones: "10", precio: "20", monto: "199" } };
function Revision({ filas, catalogos }: { filas: FilaCB2[]; catalogos: CatalogosCB2 }) {
    const r = useRevisionCB2(filas, catalogos);
    return createElement("div", null, createElement(CandidatosCB2, { filas, cat: catalogos, seleccion: r.asignaciones, manuales: r.manuales, omitidos: r.omitidos, revisados: r.revisados, onAsignar: r.asignar, onSeleccionar: r.seleccionar, onRevisar: r.revisar }), createElement(ResumenSeleccionCB2, { filas, cat: catalogos, seleccion: r.asignaciones, omitidos: r.omitidos, revisados: r.revisados }));
}
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(filas: FilaCB2[], catalogos = cat) { await act(async () => root.render(createElement(Revision, { filas, catalogos }))); }
async function click(text: string) { const b = [...host.querySelectorAll("button")].find(b => b.textContent === text); expect(b).toBeDefined(); await act(async () => b!.click()); }
function control(text: string) { const label = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(text))!; return (label.querySelector("input,select") ?? document.getElementById(label.htmlFor)) as HTMLInputElement | HTMLSelectElement; }
async function change(text: string, value: string) { const el = control(text); await act(async () => { Object.getOwnPropertyDescriptor(el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); }
async function check(label: string) { await act(async () => (host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement).click()); }
const rows = () => host.querySelectorAll("tr[data-candidato]");
function numero(label: string) { const dt = [...host.querySelectorAll("dt")].find(d => d.textContent === label)!; return Number(dt.nextElementSibling!.textContent); }

describe("revisión integral: contadores, filtros y resumen sobre los mismos candidatos", () => {
    it("tabla de once columnas: editar y cerrar con Escape conserva selección, unidad y foco", async () => {
        await render([fila]);
        const tabla = host.querySelector('table:has(tr[data-candidato])')!;
        expect([...tabla.querySelectorAll('thead th')].map(h => h.textContent)).toEqual(["Selección", "Vale", "Fecha", "Placa / unidad", "Piloto original", "Empleado identificado", "Combustible", "Galones", "Monto", "Estado", "Acciones"]);
        expect(tabla.querySelectorAll('th[scope="col"]')).toHaveLength(11);
        const boton = host.querySelector<HTMLButtonElement>('[aria-label="Editar consumo vale 0001"]')!;
        const detalle = document.getElementById(boton.getAttribute("aria-controls")!)!;
        expect(detalle.hidden).toBe(true); expect(boton.getAttribute("aria-expanded")).toBe("false");
        await act(async () => boton.click());
        expect(detalle.hidden).toBe(false); expect(boton.getAttribute("aria-expanded")).toBe("true");
        await change("Unidad para vale 0001", "");
        await act(async () => detalle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        expect(detalle.hidden).toBe(true); expect(document.activeElement).toBe(boton);
        await act(async () => boton.click()); expect(control("Unidad para vale 0001").value).toBe("");
        expect(numero("Seleccionados")).toBe(0);
    });
    it("filtros rápidos conservan exclusiones entre páginas y restauran la selección", async () => {
        const filas = Array.from({ length: 28 }, (_, i) => ({ ...fila, candidato: `c${i}`, fila: i + 2, vale: String(i + 1).padStart(4, "0") }));
        await render(filas); await check("Seleccionar consumo vale 0001");
        await click("Siguiente"); await click("Anterior"); await click("Excluidos");
        expect(rows()).toHaveLength(1); expect(rows()[0].getAttribute("data-excluded")).toBe("true");
        expect(numero("Excluidos")).toBe(1); expect(numero("Seleccionados")).toBe(27);
        await check("Seleccionar consumo vale 0001"); expect(rows()).toHaveLength(0);
        await click("Todos"); expect(rows()).toHaveLength(25); expect(numero("Seleccionados")).toBe(28);
        await click("Listos"); expect(rows()).toHaveLength(25);
        await click("Pendientes"); expect(rows()).toHaveLength(0);
    });
    it("20 consumos advertidos seleccionados se ven en LISTO y resumen, sin duplicar apariciones", async () => {
        const filas = Array.from({ length: 20 }, (_, i) => ({ ...fila, fila: i + 2, candidato: `c${i}`, vale: String(i + 1).padStart(4, "0"), motivos: ["Producto no informado", "Galones × precio difiere del monto; revisar redondeo o precio"] }));
        await render([...filas, { ...filas[0], hoja: "Consolidado", fila: 99 }]);
        expect(numero("Total de candidatos")).toBe(20); expect(numero("Seleccionados")).toBe(20); expect(numero("Elegibles · LISTO")).toBe(20); expect(numero("Con advertencias")).toBe(20);
        await change("Estado de vista previa", "LISTO"); await change("Advertencias", "CON");
        expect(rows()).toHaveLength(20); expect(host.textContent).toContain("20 consumos seleccionados para confirmar"); expect(host.textContent).toContain("GTQ 3980");
        await check("Seleccionar consumo vale 0001");
        expect(numero("Seleccionados")).toBe(19); expect(numero("Elegibles · LISTO")).toBe(20); expect(rows()).toHaveLength(20); expect(control("Unidad para vale 0001").value).toBe("1");
        await change("Selección para confirmar", "SI"); expect(rows()).toHaveLength(19); expect(host.textContent).toContain("19 consumos seleccionados para confirmar"); expect(host.textContent).toContain("GTQ 3781");
        expect(host.textContent).toContain("diferencia (calculado − Excel) GTQ 1");
    });
    it("catálogo asíncrono propone exactas y abreviadas; un borrado manual no se repone", async () => {
        const filas = [fila, { ...fila, candidato: "b", fila: 3, vale: "0002", placa: " c 147 cct ", placaNormalizada: "C 147 CCT" }, { ...fila, candidato: "c", fila: 4, vale: "0003", placa: "633 CBL", placaNormalizada: "633 CBL" }];
        await render(filas, { ...cat, vehiculos: [] }); expect(numero("Seleccionados")).toBe(0);
        await render(filas); expect(numero("Seleccionados")).toBe(3); expect(host.textContent).toContain("Identificada automáticamente · ABREVIADA");
        expect(control("Unidad para vale 0001").value).toBe("1"); expect(control("Unidad para vale 0002").value).toBe("2"); expect(control("Unidad para vale 0003").value).toBe("3");
        await change("Unidad para vale 0001", ""); await render(filas, { ...cat, vehiculos: [...cat.vehiculos, { id: 4, placa: "C-999XYZ" }] });
        expect(control("Unidad para vale 0001").value).toBe(""); expect(numero("Seleccionados")).toBe(2);
        await change("Unidad para vale 0001", "1"); expect(host.textContent).toContain("Elegida manualmente");
    });
    it("elección manual exacta ambigua y deselección se conservan al paginar, filtrar y recargar catálogo", async () => {
        const filas = Array.from({ length: 28 }, (_, i) => ({ ...fila, candidato: `c${i}`, fila: i + 2, vale: String(i + 1).padStart(4, "0") }));
        const ambiguous = { ...cat, vehiculos: [...cat.vehiculos, { id: 4, placa: "C 570 BZT" }] };
        await render(filas, ambiguous); expect(numero("Seleccionados")).toBe(0);
        await change("Unidad para vale 0001", "4"); await check("Seleccionar consumo vale 0001");
        await click("Siguiente"); await click("Anterior"); await change("Vale", "0001");
        await render(filas, { ...ambiguous, vehiculos: [...ambiguous.vehiculos] });
        expect(control("Unidad para vale 0001").value).toBe("4"); expect(numero("Seleccionados")).toBe(0); expect(numero("Elegibles · LISTO")).toBe(1);
        expect((host.querySelector('[aria-label="Seleccionar consumo vale 0001"]') as HTMLInputElement).checked).toBe(false);
        await change("Identificación de unidad", "MANUAL"); expect(rows()).toHaveLength(1);
    });
    it("revisar avisos no elimina bloqueos y el piloto informativo no se convierte en causa de bloqueo", async () => {
        await render([{ ...fila, bloqueada: true, motivos: ["Piloto sin determinar", "Fecha de consumo inválida"], errores: ["fecha"] }]);
        expect(numero("Bloqueados")).toBe(1); expect(numero("Seleccionados")).toBe(0);
        expect(host.textContent).toContain("INFORMATIVA"); expect(host.textContent).toContain("BLOQUEO");
        await act(async () => (control("Advertencias revisadas") as HTMLInputElement).click());
        expect(numero("Bloqueados")).toBe(1); expect(numero("Elegibles · LISTO")).toBe(0);
        expect((host.querySelector('[aria-label="Seleccionar consumo vale 0001"]') as HTMLInputElement).disabled).toBe(true);
    });
    it("revisión informativa de piloto aproximado requiere seleccionar y confirmar, sin afectar elegibilidad", async () => {
        await render([fila], { ...cat, pilotos: [{ id: 1, nombre: "José Carlos Chay" }, { id: 2, nombre: "José Luis Chay" }] });
        const boton = () => [...host.querySelectorAll("button")].find(b => b.textContent === "Confirmar revisión informativa de piloto para vale 0001")!;
        expect(boton().disabled).toBe(true); expect(host.textContent).not.toContain("Sugerencia revisada:");
        await change("Candidato de piloto", "2"); expect(host.textContent).not.toContain("Sugerencia revisada:");
        await click("Confirmar revisión informativa de piloto para vale 0001"); expect(host.textContent).toContain("Sugerencia revisada: José Luis Chay. Sin asociación persistida.");
        expect(numero("Elegibles · LISTO")).toBe(1); expect(numero("Seleccionados")).toBe(1);
    });
    it("el filtro de avisos pendientes usa la misma revisión que el resumen y conserva asignación", async () => {
        await render([fila, { ...fila, candidato: "b", fila: 3, vale: "0002" }]);
        await change("Advertencias", "PENDIENTES"); expect(rows()).toHaveLength(2);
        await act(async () => (control("Advertencias revisadas para vale 0001") as HTMLInputElement).click());
        expect(rows()).toHaveLength(1); expect(host.textContent).toContain("1 pendientes de revisión");
        await change("Advertencias", "REVISADAS"); expect(rows()).toHaveLength(1); expect(control("Unidad para vale 0001").value).toBe("1"); expect(numero("Seleccionados")).toBe(2);
    });
});
