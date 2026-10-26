// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConciliacionDocumentalCB2 } from "./conciliacion-documental";
let host: HTMLDivElement, root: Root;
const requests: string[] = [];
const factura = { id: 10, proveedorId: 3, proveedor: "HALEL", serie: "A", numero: "001", fecha: null, moneda: "GTQ", totalDocumental: "100.010001", cantidad: 2, galones: "3.123456", montoConsumos: "100", diferencia: "0.010001", estado: "CON_DIFERENCIA" };
beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host); requests.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        requests.push(String(url));
        if (String(url).includes("/documento?")) return new Response(JSON.stringify({ habilitado: false }));
        const detalle = String(url).includes("/10/consumos");
        return new Response(JSON.stringify({ filas: detalle ? [{ id: 20, importacionId: 5, vale: "0001", placa: "001ABC", fecha: "2026-08-01", moneda: "GTQ", galones: "3.123456", monto: "100" }] : [factura], siguiente: String(url).includes("despues=0") ? detalle ? 20 : 10 : null }));
    }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(activo = true) { await act(async () => root.render(createElement(ConciliacionDocumentalCB2, { api: "/demo", cat: { proveedores: [{ id: 3, nombre: "HALEL" }], vehiculos: [] }, activo, refresh: 0 }))); }
async function click(text: string, last = false) {
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")].filter(b => b.textContent === text);
    await act(async () => (last ? buttons.at(-1)! : buttons[0]).click());
}
it("lectura con diferencia textual, precisión y detalle perezoso paginado", async () => {
    await render(); expect(requests).toHaveLength(1);
    expect(host.textContent).toContain("GTQ 0.010001"); expect(host.textContent).toContain("Documento mayor"); expect(host.textContent).toContain("CON DIFERENCIA"); expect(host.textContent).toContain("Sin fecha");
    expect(host.querySelectorAll('th[scope="col"]')).toHaveLength(11);
    await click("Ver detalle"); expect(requests).toHaveLength(3);
    expect(requests[1]).toContain("/10/consumos?proveedorId=3&limite=25&despues=0");
    expect(host.textContent).toContain("0001"); expect(host.textContent).toContain("3.123456");
    await click("Siguiente"); expect(requests.at(-1)).toContain("/10/consumos?proveedorId=3&limite=25&despues=20");
    await click("Cerrar"); await click("Siguiente"); expect(requests.at(-1)).toContain("despues=10");
    expect(requests.filter(u => !u.includes("/documento?")).every(u => u.includes("limite=25"))).toBe(true);
    expect(host.querySelector('button[type="submit"]')?.textContent).not.toBe("Asociar");
});
it("los filtros se envían al servidor, reinician cursor y permiten sin fecha", async () => {
    await render(); await click("Siguiente");
    const select = host.querySelector<HTMLSelectElement>('select[name="fecha"]')!;
    await act(async () => { select.value = "SIN_FECHA"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelector<HTMLInputElement>('input[name="desde"]')!.disabled).toBe(true);
    const proveedor = host.querySelector<HTMLSelectElement>('select[name="proveedorId"]')!; proveedor.value = "3";
    const estado = host.querySelector<HTMLSelectElement>('select[name="estado"]')!; estado.value = "CON_DIFERENCIA";
    host.querySelector<HTMLInputElement>('input[name="buscar"]')!.value = "001";
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const url = requests.at(-1)!;
    for (const q of ["proveedorId=3", "fecha=SIN_FECHA", "estado=CON_DIFERENCIA", "buscar=001", "despues=0"]) expect(url).toContain(q);
    expect(url).not.toContain("desde=");
});
it("no consulta una pestaña inactiva", async () => { await render(false); expect(requests).toEqual([]); });
it("muestra fallo de lectura sin inventar totales vacíos", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "Sin permiso" }), { status: 403 }));
    await render(); expect(host.querySelector('[role="alert"]')?.textContent).toContain("Sin permiso"); expect(host.textContent).not.toContain("No hay facturas");
});
