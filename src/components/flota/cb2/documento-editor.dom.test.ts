// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { DocumentoEditorCB2 } from "./documento-editor";
let host: HTMLDivElement, root: Root;
const guardado = vi.fn();
let lectura: Record<string, unknown>, patches: string[], modo: string;
beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); patches = []; modo = "ok"; guardado.mockReset();
    lectura = { habilitado: true, actorId: 9, documento: { facturaId: 10, revision: 0, moneda: "GTQ", valores: { fecha: null, total: null } }, permisos: { completar: true, corregir: false } };
    vi.stubGlobal("fetch", vi.fn(async (_url, init?: RequestInit) => {
        if (init?.method !== "PATCH") return new Response(JSON.stringify(lectura));
        patches.push(String(init.body));
        if (modo === "perdido") throw new Error("Red interrumpida");
        if (modo === "conflicto") return new Response(JSON.stringify({ error: "Revision obsoleta" }), { status: 409 });
        return new Response(JSON.stringify({ facturaId: 10, revision: 1, moneda: "GTQ", valores: { fecha: null, total: "100.123456" }, tipo: "COMPLETAR" }));
    }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); sessionStorage.clear(); });
async function render(key = "uno") { await act(async () => root.render(createElement(DocumentoEditorCB2, { key, api: "/demo/10/documento", proveedorId: 3, onGuardado: guardado }))); }
async function change(label: string, value: string) {
    const el = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(label))!.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea")!;
    await act(async () => { Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function click(text: string) { const b = [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!; await act(async () => b.click()); }
async function preparar() {
    await change("Total documental", "100.123456"); await change("Motivo obligatorio", "Documento contrastado con original");
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
}
it("exige confirmacion, muestra antes/despues y envia solo campos permitidos", async () => {
    await render(); expect(host.textContent).toContain("Total anterior: Sin declarar");
    expect([...host.querySelectorAll("button")].find(b => b.textContent === "Guardar documento confirmado")!.disabled).toBe(true);
    await preparar(); await click("Guardar documento confirmado");
    expect(JSON.parse(patches[0])).toEqual(expect.objectContaining({ proveedorId: 3, revision: 0, total: "100.123456", motivo: "Documento contrastado con original" }));
    expect(JSON.parse(patches[0])).not.toHaveProperty("tipo"); expect(JSON.parse(patches[0])).not.toHaveProperty("moneda");
    expect(guardado).toHaveBeenCalledOnce(); expect(sessionStorage.length).toBe(0);
});
it("respuesta perdida conserva misma solicitud y clave incluso al remontar", async () => {
    modo = "perdido"; await render(); await preparar(); await click("Guardar documento confirmado");
    expect(host.textContent).toContain("Solicitud pendiente conservada"); expect(sessionStorage.length).toBe(1);
    await render("dos"); expect(host.textContent).toContain("Reintentar misma solicitud");
    modo = "ok"; await click("Reintentar misma solicitud");
    expect(patches).toHaveLength(2); expect(patches[1]).toBe(patches[0]); expect(guardado).toHaveBeenCalledOnce();
});
it("conflicto definitivo permite actualizar revision y no reintenta automáticamente", async () => {
    modo = "conflicto"; await render(); await preparar(); await click("Guardar documento confirmado");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Revision obsoleta");
    expect(sessionStorage.length).toBe(0); expect(patches).toHaveLength(1); expect(guardado).not.toHaveBeenCalled();
    await click("Actualizar revisión"); expect(patches).toHaveLength(1);
});
it("lectores y fase deshabilitada no ofrecen escritura", async () => {
    lectura.permisos = { completar: false, corregir: false }; await render(); expect(host.textContent).toContain("solo lectura"); expect(host.querySelector("textarea")).toBeNull();
    lectura = { habilitado: false }; await render("dos"); expect(host.textContent).toBe(""); expect(patches).toEqual([]);
});
it("completar no habilita editar valores declarados", async () => {
    lectura.documento = { facturaId: 10, revision: 2, moneda: "USD", valores: { fecha: "2026-10-01", total: "99" } };
    await render(); expect([...host.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])')].every(i => i.disabled)).toBe(true); expect(host.textContent).toContain("USD");
});
