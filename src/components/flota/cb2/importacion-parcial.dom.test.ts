// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImportarCB2 } from "./importar";
let host: HTMLDivElement, root: Root; const requests: FormData[] = [];
const fila = (candidato: string, placa: string, extra: Record<string, unknown> = {}) => ({ candidato, perfil: "HALEL", estado: "LISTA", bloqueada: false, placa, placaNormalizada: placa, vale: candidato, hoja: "H", fila: 2, motivos: [], errores: [], moneda: "GTQ", origen: { producto: "Diesel", piloto: "" }, ...extra });
const FILAS = [fila("1", "C-111AAA"), fila("2", "C-222BBB"), fila("3", "C-999ZZZ")];
const cat = { proveedores: [{ id: 83, nombre: "Proveedor" }], vehiculos: [{ id: 1, placa: "C-111AAA", estado: "Activo" }, { id: 2, placa: "C-222BBB", estado: "En taller" }] };
beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; requests.length = 0;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: FormData }) => { requests.push(init.body); return new Response(JSON.stringify(String(url).endsWith("/confirmar") ? { ok: true } : { perfilDetectado: "HALEL", sha256: "a".repeat(64), token: "recibo", filas: FILAS, nota: "fixture" }), { status: 200, headers: { "Content-Type": "application/json" } }); }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const boton = (t: string) => [...host.querySelectorAll("button")].find(b => b.textContent === t)!;
const control = (t: string) => { const l = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(t))!; return (l.querySelector("input,select") ?? document.getElementById(l.htmlFor)) as HTMLInputElement; };

it("unidad «En taller»: no es elegible ni se ofrece como sugerencia, se explica y la fila queda pendiente; se importan solo las listas y el resumen cuadra", async () => {
    await act(async () => root.render(createElement(ImportarCB2, { api: "/demo", cat: cat as never, run: async (_a, _d, f) => f("clave-sintetica-demo"), locked: false })));
    await act(async () => { const el = control("Excel original"); Object.defineProperty(el, "files", { value: [new File(["x"], "a.xlsx")], configurable: true }); el.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { const el = control("Proveedor de la empresa"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, "83"); el.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => boton("Analizar Excel").click());
    const texto = host.textContent ?? "";
    expect(texto).toContain("Resumen antes de confirmar"); expect(texto).toContain("Listas + pendientes = válidas (1 + 2 = 3)"); expect(texto).toContain("= 3 filas");
    expect(texto).toContain("La unidad C-222BBB está «En taller» en Flota"); expect(texto).toContain("No se ofrece como opción elegible");
    expect(texto).toContain("unidad no operable 1"); expect(texto).not.toContain("Usar sugerencia para vale 2");
    await act(async () => control("Confirmo el procesamiento parcial").click());
    await act(async () => boton("Confirmar selección parcial").click());
    const confirmar = requests.filter(f => f.has("clave")), sel = JSON.parse(String(confirmar[0].get("seleccion")));
    expect(confirmar).toHaveLength(1); expect(sel.map((s: { candidato: string }) => s.candidato)).toEqual(["1"]);   // 2 (En taller) y 3 (sin unidad) siguen pendientes
});
