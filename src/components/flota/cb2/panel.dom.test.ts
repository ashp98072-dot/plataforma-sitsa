// @vitest-environment happy-dom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { CombustiblesCB2 } from "./panel";
let root: Root, host: HTMLDivElement;
const calls: {
    url: string;
    init?: RequestInit;
}[] = [];
const candidato = "a".repeat(64);
const preview = { sha256: "b".repeat(64), token: "firmado", nota: "Revalidar historial", filas: [{ hoja: "DEMO", fila: 2, candidato, bloqueada: false, documento: null, errores: [], estado: "ADVERTENCIA", motivos: ["Sin factura"], vale: "0001", placa: "C-001ABC", placaNormalizada: "C-001ABC", fecha: "2026-10-01", galones: "10", precio: "20", monto: "200", moneda: "GTQ" }] };
const original = { id: 10, proveedor_id: 1, importacion_id: 2, revision: 1, tipo: "ORIGEN", origen_fila_id: null, consumo_id: null, hoja_nombre: "DEMO", fila_excel: 2, resultado: "OMITIDA", datos_origen: JSON.stringify({ vale: "0001", placaOriginal: "C-001ABC", fechaConsumo: "2026-10-01" }), decision: JSON.stringify({ version: 1, moneda: "GTQ", candidato }), motivo: "Pendiente" };
const header = { id: 2, proveedor_id: 1, proveedor_nombre: "PROVEEDOR DEMO", archivo_nombre: "demo.xlsx", archivo_sha256: preview.sha256, revision: 1, estado: "PARCIAL", resumen_actual: '{"pendientes":1}' };
const consumo = { id: 3, proveedor_id: 1, importacion_origen_id: 2, moneda: "GTQ", numero_vale: "0001", placa_original: "C-001ABC", fecha_consumo: "2026-10-01", galones: "10", precio: "20", monto: "200", factura_id: null, estado_factura: "PENDIENTE_FACTURA" };
let eventosHistorial: Record<string, unknown>[] = [];
let failConfirm = false, failAsociar = false, revisionHeader = 1, paginado = false, consumoProveedor = 1;
const response = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("crypto", webcrypto);
    sessionStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    calls.length = 0;
    eventosHistorial = [];
    failConfirm = false;
    failAsociar = false;
    revisionHeader = 1;
    paginado = false;
    consumoProveedor = 1;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/catalogos"))
            return response({ proveedores: [{ id: 1, nombre: "PROVEEDOR DEMO" }], vehiculos: [{ id: 1, placa: "C-001ABC" }] });
        if (url.endsWith("/preview"))
            return response(preview);
        if (url.endsWith("/confirmar")) {
            if (failConfirm) {
                failConfirm = false;
                throw new TypeError("red");
            }
            return response({ eventos: [{ id: 10, importacionId: 2, revision: 1, resultado: "CREADA", consumoId: 3 }] });
        }
        if (url.endsWith("/asociar") && failAsociar) {
            failAsociar = false;
            revisionHeader = 2;
            throw new TypeError("respuesta perdida");
        }
        if (url.endsWith("/asociar") || url.endsWith("/reanudar"))
            return response({ eventos: [{ id: 11, importacionId: 2, revision: 2, resultado: "REUTILIZADA", consumoId: 3 }] });
        if (url.includes("/filas?"))
            return response([original, ...eventosHistorial]);
        if (url.includes("/importaciones?"))
            return response([{ ...header, revision: revisionHeader }]);
        if (url.includes("/consumos?"))
            return response(paginado ? (new URL(url, "http://localhost").searchParams.get("despues") === "0" ? Array.from({ length: 50 }, (_, i) => ({ ...consumo, id: i + 3 })) : [{ ...consumo, id: 53 }]) : [{ ...consumo, proveedor_id: consumoProveedor }]);
        if (url.includes("/facturas?"))
            return response([{ id: 5, proveedor_id: 1, serie: "S", numero: "000001", moneda: "GTQ", fecha_factura: null, total_documental: null }]);
        throw new Error(`URL inesperada ${url}`);
    }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 5)); }); }
async function mount(admin = true, canWrite = true) { await act(async () => { root.render(createElement(CombustiblesCB2, { slug: "demo", actorId: 1, admin, canWrite })); }); await flush(); }
function btn(text: string) {
    const b = Array.from(host.querySelectorAll("button")).find(e => e.textContent === text && !e.closest("[hidden]"));
    if (!b)
        throw new Error(`Boton ausente ${text}`);
    return b;
}
async function click(text: string) { await act(async () => btn(text).click()); await flush(); }
function control(text: string) {
    const l = Array.from(host.querySelectorAll("label")).find(e => e.textContent?.startsWith(text) && !e.closest("[hidden]"));
    const e = l?.querySelector("input,select,textarea") ?? (l?.htmlFor ? document.getElementById(l.htmlFor) : null);
    if (!e)
        throw new Error(`Control ausente ${text}`);
    return e as HTMLInputElement;
}
async function change(text: string, value: string) { const el = control(text); await act(async () => { const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); }
async function seleccionarConsumo() { await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Seleccionar consumo 3"]')!.click()); }
async function prepararAsociacion() { await click("Facturas"); await click("Usar documento #5"); await seleccionarConsumo(); await change("Motivo", "Documento verificado"); }
describe("interfaz CB2 montada: flujos funcionales", () => {
    it("guía la importación en cuatro pasos sin perder la selección", async () => {
        await mount(); await click("Importar Excel");
        const current = () => host.querySelector('[aria-current="step"]')?.textContent;
        expect(current()).toContain("Seleccionar archivo");
        expect(btn("Analizar Excel").disabled).toBe(true);
        await change("Proveedor de la empresa", "1");
        await act(async () => {
            const f = control("Excel original");
            Object.defineProperty(f, "files", { value: [new File(["sintetico"], "demo.xlsx")], configurable: true });
            f.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(current()).toContain("Analizar Excel");
        await click("Analizar Excel"); expect(current()).toContain("Revisar coincidencias");
        await change("Unidad para vale", "1");
        expect(btn("Confirmar selección parcial").disabled).toBe(true);
        await act(async () => control("Confirmo el procesamiento").click());
        expect(current()).toContain("Confirmar selección");
        expect(btn("Confirmar selección parcial").disabled).toBe(false);
        expect(calls.filter(c => c.url.endsWith("/confirmar"))).toHaveLength(0);
    });
    it("muestra el rechazo de origen comprensible sin intentar confirmar", async () => {
        const originalFetch = globalThis.fetch;
        vi.stubGlobal("fetch", vi.fn((url, init) => String(url).endsWith("/preview")
            ? Promise.resolve(response({ error: "No pudimos verificar el origen de la solicitud. Abre Combustibles desde la plataforma e inténtalo de nuevo." }, 403))
            : originalFetch(url, init)));
        await mount(); await click("Importar Excel"); await change("Proveedor de la empresa", "1");
        await act(async () => {
            const f = control("Excel original"); Object.defineProperty(f, "files", { value: [new File(["sintetico"], "demo.xlsx")], configurable: true });
            f.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await click("Analizar Excel");
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("desde la plataforma");
        expect(calls.some(c => c.url.endsWith("/confirmar"))).toBe(false);
        expect(btn("Analizar Excel").disabled).toBe(false);
    });
    it("importa parcialmente y reintenta sin cambiar clave", async () => { await mount(); await click("Importar Excel"); await change("Proveedor de la empresa", "1"); await act(async () => { const f = control("Excel original"); Object.defineProperty(f, "files", { value: [new File(["sintetico"], "demo.xlsx")], configurable: true }); f.dispatchEvent(new Event("change", { bubbles: true })); }); await click("Analizar Excel"); expect(host.textContent).toContain("0001"); await change("Unidad para vale", "1"); await act(async () => control("Confirmo el procesamiento").click()); failConfirm = true; await click("Confirmar selección parcial"); expect(host.textContent).toContain("solicitud pendiente"); expect(control("Perfil").closest("fieldset")?.disabled).toBe(true); await click("Reintentar exactamente la solicitud"); const posts = calls.filter(c => c.url.endsWith("/confirmar")); expect(posts).toHaveLength(2); expect((posts[0].init!.body as FormData).get("clave")).toBe((posts[1].init!.body as FormData).get("clave")); expect(JSON.parse(String((posts[0].init!.body as FormData).get("seleccion")))).toEqual([{ candidato, vehiculoId: 1 }]); expect(host.textContent).toContain("Operación confirmada"); });
    it("asocia factura con ceros y revisiones exactas", async () => { await mount(); await prepararAsociacion(); await click("Asociar factura al lote"); const p = calls.find(c => c.url.endsWith("/asociar")); expect(p).toBeDefined(); expect(JSON.parse(String(p!.init!.body))).toMatchObject({ documento: { serie: "S", numero: "000001", moneda: "GTQ" }, consumos: [3], revisiones: [{ id: 2, revision: 1 }] }); });
    it("Admin reanuda desde historial y ofrece descarga privada", async () => { await mount(); await click("Historial"); await click("Ver trazabilidad #2"); expect(host.querySelector('a[download]')?.getAttribute("href")).toBe("/api/empresas/demo/flota/combustible/cb2/importaciones/2/archivo"); await change("Unidad para vale", "1"); await change("Motivo de reanudación", "Unidad verificada"); await click("Reanudar selección"); expect(JSON.parse(String(calls.find(c => c.url.endsWith("/reanudar"))!.init!.body))).toMatchObject({ importacionId: 2, revision: 1, seleccion: [{ candidato, vehiculoId: 1 }] }); });
    it("solo lectura no presenta escrituras", async () => { await mount(false, false); expect(host.textContent).not.toContain("Importar Excel"); expect(host.textContent).not.toContain("Asociar factura al lote"); await click("Historial"); await click("Ver trazabilidad #2"); expect(host.textContent).not.toContain("Reanudar selección"); expect(calls.every(c => !c.init?.method || c.init.method === "GET")).toBe(true); });
    it("filtra en servidor", async () => { await mount(); await change("Buscar vale o placa", "0001"); await click("Aplicar filtros"); expect(calls.some(c => c.url.includes("/consumos?") && c.url.includes("buscar=0001") && c.url.includes("despues=0"))).toBe(true); });
    it("conciliar no concede reanudacion Admin", async () => { await mount(false, true); expect(btn("Importar Excel")).toBeDefined(); await click("Historial"); await click("Ver trazabilidad #2"); expect(host.textContent).toContain("requiere autorización Admin"); expect(host.textContent).not.toContain("Reanudar selección"); });
    it("recarga conserva clave y revision original de asociacion incierta", async () => { await mount(); await prepararAsociacion(); failAsociar = true; await click("Asociar factura al lote"); const first = calls.find(c => c.url.endsWith("/asociar"))!; await act(async () => root.unmount()); root = createRoot(host); await mount(); await click("Reintentar exactamente la solicitud"); const posts = calls.filter(c => c.url.endsWith("/asociar")); expect(posts).toHaveLength(2); expect(posts[1].init!.body).toBe(first.init!.body); expect(JSON.parse(String(posts[1].init!.body)).revisiones).toEqual([{ id: 2, revision: 1 }]); });
    it("pagina con cursor y conserva seleccion al filtrar", async () => { paginado = true; await mount(); await seleccionarConsumo(); await click("Siguiente"); expect(calls.some(c => c.url.includes("/consumos?") && c.url.includes("despues=52"))).toBe(true); expect(host.textContent).toContain("1 consumos seleccionados"); await change("Buscar vale o placa", "0001"); await click("Aplicar filtros"); expect(calls.at(-1)!.url).toContain("despues=0"); expect(calls.at(-1)!.url).toContain("buscar=0001"); });
    it("rechaza factura elegida de otro proveedor antes de enviar", async () => { consumoProveedor = 2; await mount(); await prepararAsociacion(); await click("Asociar factura al lote"); expect(host.textContent).toContain("pertenece a otro proveedor"); expect(calls.some(c => c.url.endsWith("/asociar"))).toBe(false); });
    it("no ofrece reanudar candidatos resueltos en revisiones previas aunque luego se bloqueen", async () => {
        revisionHeader = 4;
        eventosHistorial = [{ ...original, id: 11, tipo: "RESOLUCION", revision: 2, origen_fila_id: 10, resultado: "CREADA", consumo_id: 3 }, { ...original, id: 12, tipo: "RESOLUCION", revision: 4, origen_fila_id: 10, resultado: "BLOQUEADA", consumo_id: null }];
        await mount();
        await click("Historial");
        await click("Ver trazabilidad #2");
        expect(host.textContent).toContain("No quedan candidatos pendientes");
        expect(host.textContent).toContain("Diario completo (3 eventos)");
        expect(btn("Reanudar selección").disabled).toBe(true);
        expect(Array.from(host.querySelectorAll("label")).some(l => l.textContent?.startsWith("Unidad para vale"))).toBe(false);
        await click("Reanudar selección");
        expect(calls.some(c => c.url.endsWith("/reanudar"))).toBe(false);
    });
    it("resolucion parcial de apariciones mantiene solo las pendientes seleccionables", async () => {
        revisionHeader = 2;
        eventosHistorial = [{ ...original, id: 11, fila_excel: 3, datos_origen: JSON.stringify({ vale: "0001", placaOriginal: "C-001ABC" }) }, { ...original, id: 12, tipo: "RESOLUCION", revision: 2, origen_fila_id: 10, resultado: "CREADA", consumo_id: 3 }];
        await mount();
        await click("Historial");
        await click("Ver trazabilidad #2");
        expect(host.textContent).toContain("1 candidatos pendientes");
        const labels = Array.from(host.querySelectorAll("label")).filter(l => l.textContent?.startsWith("Unidad para vale"));
        expect(labels).toHaveLength(1);
        expect(labels[0].textContent).toContain("DEMO:3");
        await change("Unidad para vale", "1");
        await change("Motivo de reanudación", "Completar apariciones pendientes");
        await click("Reanudar selección");
        expect(JSON.parse(String(calls.find(c => c.url.endsWith("/reanudar"))!.init!.body)).seleccion).toEqual([{ candidato, vehiculoId: 1 }]);
    });
});
