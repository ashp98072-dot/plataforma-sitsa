// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ImportarCB2 } from "./importar";
import type { CatalogosCB2 } from "./client";

it("el catálogo tardío invalida aceptación y confirmar envía solo candidatos elegibles seleccionados, sin vincular pilotos aproximados", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const candidato = "a".repeat(64), otro = "c".repeat(64);
    const fila = { hoja: "Datos", fila: 2, candidato, bloqueada: false, documento: null, errores: [], estado: "ADVERTENCIA", motivos: ["Producto no informado"], vale: "0001", placa: "633 CBL", placaNormalizada: "633 CBL", fecha: "2026-10-01", galones: "10", precio: "20", monto: "200", moneda: "GTQ", origen: { piloto: "JOSE CHAY", producto: "DIESEL" } };
    const preview = { sha256: "b".repeat(64), token: "sintetico", nota: "", filas: [fila, { ...fila, candidato: otro, vale: "0002", fila: 3 }] };
    const requests: { url: string; body: FormData }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { requests.push({ url, body: init.body as FormData }); return new Response(JSON.stringify(url.endsWith("preview") ? preview : { eventos: [] }), { headers: { "Content-Type": "application/json" } }); }));
    const cat: CatalogosCB2 = { proveedores: [{ id: 1, nombre: "Demo" }], vehiculos: [], pilotos: [{ id: 5, nombre: "José Chay" }] };
    const run = vi.fn(async (_accion, _identidad, fn) => fn("clave-sintetica-513"));
    const render = async (catalogos: CatalogosCB2) => act(async () => root.render(createElement(ImportarCB2, { api: "/demo", cat: catalogos, run, locked: false })));
    const control = (label: string) => { const l = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(label))!; return (l.querySelector("input,select") ?? document.getElementById(l.htmlFor)) as HTMLInputElement; };
    const button = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent === label)!;
    const aceptar = () => control("Confirmo el procesamiento parcial");
    try {
        await render(cat);
        await act(async () => { const el = control("Proveedor de la empresa"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, "1"); el.dispatchEvent(new Event("change", { bubbles: true })); });
        await act(async () => { const el = control("Excel original"); Object.defineProperty(el, "files", { value: [new File(["solo sintético"], "demo.xlsx")] }); el.dispatchEvent(new Event("change", { bubbles: true })); });
        await act(async () => button("Analizar Excel").click());
        await act(async () => aceptar().click()); expect(aceptar().checked).toBe(true);
        await render({ ...cat, vehiculos: [{ id: 3, placa: "C-633CBL" }] });
        expect(aceptar().checked).toBe(false); expect(button("Confirmar selección parcial").disabled).toBe(true);
        expect(host.textContent).toContain("2 consumos seleccionados para confirmar");
        await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Seleccionar consumo vale 0002"]')!.click());
        expect(host.textContent).toContain("1 consumos seleccionados para confirmar");
        expect(requests).toHaveLength(1); expect(run).not.toHaveBeenCalled();
        await act(async () => aceptar().click()); await act(async () => button("Confirmar selección parcial").click());
        expect(requests.map(r => r.url)).toEqual(["/demo/preview", "/demo/preview", "/demo/confirmar"]);
        const body = requests[2].body;
        expect(JSON.parse(String(body.get("seleccion")))).toEqual([{ candidato, vehiculoId: 3, empleadoId: null, metodoEmpleado: "SIN_ASIGNACION", productoClasificado: "DIESEL" }]);
        expect([...body.keys()].some(k => /piloto/i.test(k))).toBe(false);
        expect(body.get("token")).toBe("sintetico"); expect(body.get("clave")).toBe("clave-sintetica-513");
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

