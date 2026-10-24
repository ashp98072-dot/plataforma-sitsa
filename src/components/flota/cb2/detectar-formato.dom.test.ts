// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImportarCB2 } from "./importar";
let host: HTMLDivElement, root: Root;
const requests: FormData[] = [];
let formato: string | undefined = "SHELL", fallo = false;
beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host); requests.length = 0; formato = "SHELL"; fallo = false;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
        requests.push(init.body);
        return new Response(JSON.stringify(fallo ? { error: "El Excel mezcla formatos HALEL y SHELL incompatibles" } : { perfilDetectado: formato, sha256: "a".repeat(64), token: "recibo", filas: [], nota: "fixture" }), { status: fallo ? 400 : 200, headers: { "Content-Type": "application/json" } });
    }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const boton = (texto: string) => [...host.querySelectorAll("button")].find(b => b.textContent === texto)!;
function control(texto: string) {
    const l = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(texto))!;
    return (l.querySelector("input,select") ?? document.getElementById(l.htmlFor)) as HTMLInputElement;
}
async function archivo(nombre: string) {
    await act(async () => {
        const el = control("Excel original"); Object.defineProperty(el, "files", { value: [new File(["sintético"], nombre)], configurable: true }); el.dispatchEvent(new Event("change", { bubbles: true }));
    });
}
async function montar() {
    await act(async () => root.render(createElement(ImportarCB2, { api: "/demo", cat: { proveedores: [{ id: 83, nombre: "Comercial independiente" }], vehiculos: [] }, run: async (_a, _d, f) => f("clave-sintetica-demo"), locked: false })));
}
it("no tiene selector Perfil, exige proveedor y limpia la detección al cambiar el archivo", async () => {
    await montar(); await archivo("HALEL.xlsx");
    expect(boton("Analizar Excel").disabled).toBe(true); expect(control("Proveedor de la empresa").value).toBe(""); expect(requests).toHaveLength(0);
    expect([...host.querySelectorAll("label")].some(l => l.textContent?.startsWith("Perfil"))).toBe(false);
    await act(async () => { const el = control("Proveedor de la empresa"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, "83"); el.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => boton("Analizar Excel").click()); expect(host.textContent).toContain("Formato detectado: SHELL");
    expect(requests[0].get("perfil")).toBeNull(); expect(requests[0].get("proveedorId")).toBe("83");
    await archivo("otro.xlsx"); expect(host.textContent).not.toContain("Formato detectado:"); expect(control("Proveedor de la empresa").value).toBe("83");
});
it("un error de detección no ofrece continuar ni supone un formato", async () => {
    await montar(); await archivo("mezcla.xlsx");
    await act(async () => { const el = control("Proveedor de la empresa"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, "83"); el.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => boton("Analizar Excel").click()); expect(host.textContent).toContain("Formato detectado: SHELL");
    fallo = true; await act(async () => boton("Analizar Excel").click());
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("mezcla formatos"); expect(host.textContent).not.toContain("Confirmar selección parcial");
    fallo = false; formato = undefined; await act(async () => boton("Analizar Excel").click());
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("El servidor no informó"); expect(host.textContent).not.toContain("Formato detectado:");
});
it("un cambio de formato entre preview y recibo impide enviar confirmar", async () => {
    await montar(); await archivo("ejemplo.xlsx");
    await act(async () => { const el = control("Proveedor de la empresa"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, "83"); el.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => boton("Analizar Excel").click());
    await act(async () => control("Confirmo el procesamiento parcial").click());
    formato = "HALEL"; await act(async () => boton("Confirmar selección parcial").click());
    expect(requests).toHaveLength(2); expect(requests.every(f => !f.has("clave"))).toBe(true);
});
