// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConsumosCB2, documentoVacio } from "./consumos";
import { TablaConsumosCB2 } from "./tabla-consumos";
import type { CatalogosCB2, Registro } from "./client";

const cat: CatalogosCB2 = { proveedores: [{ id: 1, nombre: "Proveedor demo" }], vehiculos: [{ id: 1, placa: "C-001ABC" }], empleados: [{ id: 77, nombre: "Marta López" }] };
const original = Object.freeze({ id: 3, proveedor_id: 1, importacion_origen_id: 2, vehiculo_id: 1, unidad_placa: "C-001ABC", placa_original: "001 ABC", numero_vale: "0001", fecha_consumo: "2026-10-01", moneda: "GTQ", galones: "9.999900", precio: "40.123456", monto: "400.004300", factura_id: null, estado_factura: "PENDIENTE_FACTURA", empleado_id: 77, empleado_nombre: "Marta López", producto_clasificado: "DIESEL", origenes: '[{"hoja":"DEMO","fila":2,"piloto":"M LOPEZ","motivos":["Aviso original"]}]', correcciones: '[{"anterior":{"vehiculo_id":1},"nuevo":{"vehiculoId":1,"empleadoId":77,"productoClasificado":"DIESEL"},"motivo":"Asignación verificada","usuario":9,"fecha":"2026-10-02"}]' });
let host: HTMLDivElement, root: Root;
const run = vi.fn(async (_accion, _datos, ejecutar) => ejecutar("clave-exacta-demo"));
const requests: { url: string; init?: RequestInit }[] = [];
beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host); requests.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input); requests.push({ url, init });
        const data = url.includes("/consumos?") ? new URL(url, "http://localhost").searchParams.get("despues") === "0" ? Array.from({ length: 50 }, (_, i) => ({ ...original, id: i + 3 })) : [{ ...original, id: 53 }]
            : url.includes("/importaciones?") ? [{ id: 2, revision: 4 }]
            : url.endsWith("/asociar") ? { eventos: [] } : [];
        return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function click(text: string) {
    const b = [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text && !b.closest("[hidden]"))!;
    expect(b).toBeDefined(); await act(async () => b.click());
}
function control(text: string) {
    const l = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(text))!;
    return (l.querySelector("input,select,textarea") ?? document.getElementById(l.htmlFor)) as HTMLInputElement;
}
async function change(text: string, value: string) {
    const el = control(text), proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}
async function table(rows: Registro[], canWrite = true, admin = true, api = "/demo") {
    await act(async () => root.render(createElement(TablaConsumosCB2, { rows, canWrite, admin, locked: false, preparando: false, seleccion: {}, onSeleccionar: vi.fn(), api, cat, run })));
}

it("doce columnas compactas, empleado y combustible visibles, números formateados y originales intactos", async () => {
    const antes = JSON.stringify(original);
    await table([original]);
    expect([...host.querySelectorAll("th[scope=col]")].map(h => h.textContent)).toEqual(["Selección", "Vale", "Fecha", "Placa / unidad", "Proveedor", "Galones", "Precio unitario", "Monto", "Factura", "Empleado", "Combustible", "Acciones"]);
    const fila = host.querySelector('[data-consumo="3"]')!;
    expect(fila.textContent).toContain("Marta López"); expect(fila.textContent).toContain("DIÉSEL");
    expect(fila.children[5].querySelector("span")!.textContent).toBe("10"); expect(fila.children[6].textContent).toBe("Q 40.123456"); expect(fila.children[7].textContent).toBe("Q 400.00");
    expect(fila.children[5].getAttribute("title")).toContain("9.999900");
    const boton = host.querySelector<HTMLButtonElement>('[aria-label="Detalles del consumo 3"]')!, detalle = document.getElementById(boton.getAttribute("aria-controls")!)!;
    expect(detalle.hidden).toBe(true); await click("Detalles"); expect(detalle.hidden).toBe(false);
    expect(detalle.textContent).toContain("9.999900"); expect(detalle.textContent).toContain("400.004300"); expect(detalle.textContent).toContain("Asignación verificada"); expect(detalle.textContent).toContain("Aviso original");
    await change("Justificacion de correccion", "Borrador conservado al cerrar");
    await click("Cerrar"); await click("Detalles"); expect(control("Justificacion de correccion").value).toBe("Borrador conservado al cerrar");
    await act(async () => detalle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(detalle.hidden).toBe(true); expect(document.activeElement).toBe(boton); expect(JSON.stringify(original)).toBe(antes);
});

it("el galonaje redondeado ofrece un summary accesible con el original sin abrir la procedencia", async () => {
    await table([original, { ...original, id: 4, galones: "10.100000" }]);
    const resumen = host.querySelector<HTMLElement>('summary[aria-label="Consultar galones originales del consumo 3"]')!;
    expect(resumen.textContent).toBe("Redondeado · ver original");
    const desplegable = resumen.parentElement as HTMLDetailsElement;
    expect(desplegable.open).toBe(false);
    await act(async () => resumen.click());
    expect(desplegable.open).toBe(true); expect(desplegable.textContent).toContain("Valor original: 9.999900 galones");
    expect(host.querySelector('[data-consumo="4"]')!.querySelector('summary')).toBeNull();
    expect(host.querySelector('[aria-label="Detalles del consumo 3"]')!.getAttribute("aria-expanded")).toBe("false");
    expect(original.galones).toBe("9.999900");
});

it("conserva borradores independientes al paginar y filtrar, sin conservar la aceptación", async () => {
    function Vista() {
        const [documento, setDocumento] = useState(documentoVacio);
        return createElement(ConsumosCB2, { api: "/demo", cat, run, canWrite: true, admin: true, locked: false, refresh: 0, activo: true, documento, setDocumento });
    }
    await act(async () => root.render(createElement(Vista)));
    await click("Detalles");
    await change("Empleado corregido #3", ""); await change("Combustible corregido", "NO_DETERMINADO"); await change("Justificacion de correccion", "Borrador del consumo tres");
    await act(async () => control("Confirmo esta corrección").click());
    await click("Siguiente"); await click("Detalles");
    expect(control("Justificacion de correccion").value).toBe(""); expect(control("Empleado corregido #53").value).toBe("77");
    await change("Justificacion de correccion", "Borrador del consumo cincuenta y tres");
    await click("Anterior");
    expect(control("Justificacion de correccion").value).toBe("Borrador del consumo tres");
    expect(control("Empleado corregido #3").value).toBe(""); expect(control("Combustible corregido").value).toBe("NO_DETERMINADO");
    expect(control("Confirmo esta corrección").checked).toBe(false);
    await change("Buscar vale o placa", "0001");
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(control("Justificacion de correccion").value).toBe("Borrador del consumo tres");
    expect(control("Confirmo esta corrección").checked).toBe(false);
    await click("Siguiente"); expect(control("Justificacion de correccion").value).toBe("Borrador del consumo cincuenta y tres");
    expect(requests.some(r => r.url.endsWith("/corregir"))).toBe(false);
});

it("mantiene la revisión original del borrador y lo elimina solo tras guardar o descartar", async () => {
    await table([{ ...original, revision_asignacion: 4 }]); await click("Detalles");
    await change("Justificacion de correccion", "Revisado contra el original");
    await table([]); await table([{ ...original, revision_asignacion: 5 }]);
    expect(control("Justificacion de correccion").value).toBe("Revisado contra el original");
    expect(host.textContent).toContain("Este borrador conserva la revisión 4");
    run.mockRejectedValueOnce(new Error("Revision obsoleta"));
    await act(async () => control("Confirmo esta corrección").click()); await click("Guardar corrección #3");
    expect(run.mock.calls.at(-1)![1]).toMatchObject({ consumoId: 3, revision: 4, motivo: "Revisado contra el original" });
    await table([]); await table([{ ...original, revision_asignacion: 5 }]);
    expect(control("Justificacion de correccion").value).toBe("Revisado contra el original");
    await click("Descartar borrador #3"); expect(control("Justificacion de correccion").value).toBe("");
    await change("Justificacion de correccion", "Corrección de la revisión actual");
    await act(async () => control("Confirmo esta corrección").click()); await click("Guardar corrección #3");
    expect(run.mock.calls.at(-1)![1]).toMatchObject({ consumoId: 3, revision: 5 });
    await table([]); await table([{ ...original, revision_asignacion: 5 }]);
    expect(control("Justificacion de correccion").value).toBe(""); expect(control("Confirmo esta corrección").checked).toBe(false);
});

it("no comparte borradores de un mismo ID entre empresas ni proveedores", async () => {
    await table([original]); await change("Justificacion de correccion", "Borrador empresa y proveedor originales");
    await table([{ ...original, proveedor_id: 2 }]); expect(control("Justificacion de correccion").value).toBe("");
    await change("Justificacion de correccion", "Borrador del proveedor dos");
    await table([original], true, true, "/otra-empresa"); expect(control("Justificacion de correccion").value).toBe("");
    await table([original]); expect(control("Justificacion de correccion").value).toBe("Borrador empresa y proveedor originales");
});

it("no inventa vínculo/clasificación ni ofrece corrección sin permisos; mantiene factura con ceros", async () => {
    await table([{ ...original, empleado_id: null, empleado_nombre: null, producto_clasificado: null, factura_id: 7, factura_serie: "S", factura_numero: "000001", estado_factura: "FACTURADO" }], false, false);
    const fila = host.querySelector('[data-consumo="3"]')!;
    expect(fila.textContent).toContain("Sin vínculo"); expect(fila.textContent).toContain("Sin clasificación"); expect(fila.textContent).toContain("S / 000001");
    expect(host.querySelector('input[type="checkbox"]')).toBeNull(); await click("Detalles");
    expect(host.textContent).not.toContain("Corregir asignación registrada #3"); expect(host.textContent).toContain("clasificación histórica pendiente");
});

it("selección entre páginas y filtros mantiene el lote y asocia factura con payload exacto sin cifras redondeadas", async () => {
    function Vista() {
        const [documento, setDocumento] = useState(documentoVacio);
        return createElement(ConsumosCB2, { api: "/demo", cat, run, canWrite: true, admin: true, locked: false, refresh: 0, activo: true, documento, setDocumento });
    }
    await act(async () => root.render(createElement(Vista)));
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Seleccionar consumo 3"]')!.click());
    await click("Siguiente"); await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Seleccionar consumo 53"]')!.click());
    await change("Buscar vale o placa", "0001"); await change("Empleado", "77"); await change("Combustible", "DIESEL");
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const ultima = requests.filter(r => r.url.includes("/consumos?")).at(-1)!.url;
    expect(ultima).toContain("buscar=0001"); expect(ultima).toContain("empleadoId=77"); expect(ultima).toContain("producto=DIESEL"); expect(ultima).toContain("despues=0");
    expect(host.querySelector<HTMLInputElement>('[aria-label="Seleccionar consumo 3"]')!.checked).toBe(true);
    expect(host.textContent).toContain("2 consumos seleccionados entre páginas");
    await change("Serie (texto)", "S"); await change("Número (texto", "000001"); await change("Total documental", "400.004300"); await change("Motivo", "Documento verificado");
    await click("Asociar factura al lote");
    expect(JSON.parse(String(requests.find(r => r.url.endsWith("/asociar"))!.init!.body))).toEqual({ proveedorId: 1, documento: { serie: "S", numero: "000001", moneda: "GTQ", fecha: null, total: "400.004300" }, consumos: [3, 53], revisiones: [{ id: 2, revision: 4 }], motivo: "Documento verificado", clave: "clave-exacta-demo" });
    expect(original.monto).toBe("400.004300");
});
