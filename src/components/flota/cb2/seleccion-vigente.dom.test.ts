// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ImportarCB2 } from "./importar";
import { HistorialCB2 } from "./historial";
import type { CatalogosCB2 } from "./client";

it.each(["importar", "historial"] as const)("%s: una edición auxiliar conserva el vehículo general posterior", async modo => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const candidato = "a".repeat(64);
  const origen = { piloto: "Luis Escobar", producto: "DIESEL", km: "", galones: "10", precio: "20", monto: "200" };
  const fila = { hoja: "Lab", fila: 2, candidato, bloqueada: false, documento: null, errores: [], estado: "ADVERTENCIA", motivos: [], vale: "19955", placa: "060 KHK", placaNormalizada: "060KHK", fecha: "2026-10-01", galones: "10", precio: "20", monto: "200", moneda: "GTQ", origen };
  const a = { id: 31, piloto_id: 11, unidad_id: 21, nombre: "Luis Escobar", placa: "M-060KHK", tipo: "MOTOCICLETA", descripcion: "Lab", relacion: "CONTRATISTA", estado: "VERIFICADA", revision: 1, piloto_referencia: "lab-p", unidad_referencia: "lab-u" };
  const cat: CatalogosCB2 = { tercerosHabilitados: true, proveedores: [{ id: 1, nombre: "Lab" }], vehiculos: [{ id: 1, placa: "M-060KHK", descripcion: "General B" }, { id: -21, placa: "M-060KHK", descripcion: "Externa A" }, { id: -22, placa: "M-061KHK", descripcion: "Externa pendiente" }], terceros: [a, { ...a, id: 32, piloto_id: 12, unidad_id: 22, nombre: "Otro Piloto", placa: "M-061KHK", estado: "PENDIENTE" }] };
  const peticiones: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    peticiones.push({ url, init });
    const body = url.includes("/filas?") ? [{ id: 10, tipo: "ORIGEN", revision: 0, resultado: "OMITIDA", hoja_nombre: "Lab", fila_excel: 2, decision: { candidato, moneda: "GTQ" }, datos_origen: { textos: origen, vale: "19955", placaOriginal: "060 KHK", placaNormalizada: "060KHK", galones: "10", precio: "20", monto: "200" } }]
      : url.includes("/importaciones?") ? [{ id: 2, proveedor_id: 1, revision: 1, archivo_nombre: "lab.xlsx" }]
      : url.endsWith("preview") ? { perfilDetectado: "HALEL", sha256: "b".repeat(64), token: "lab", nota: "", filas: [fila] } : { eventos: [] };
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }));
  const run = vi.fn(async (_accion, _identidad, fn) => fn("lab-key"));
  const control = (label: string) => { const l = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(label))!; return (l.querySelector("input,select,textarea") ?? document.getElementById(l.htmlFor)) as HTMLInputElement; };
  async function cambiar(label: string, value: string) { const el = control(label); await act(async () => { const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); }
  async function click(label: string) { await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label)!.click()); }
  try {
    await act(async () => root.render(modo === "importar" ? createElement(ImportarCB2, { api: "/lab", cat, run, locked: false }) : createElement(HistorialCB2, { api: "/lab", cat, run, locked: false, admin: true, canWrite: true, refresh: 0, activo: true })));
    if (modo === "importar") {
      await cambiar("Proveedor de la empresa", "1");
      await act(async () => { const el = control("Excel original"); Object.defineProperty(el, "files", { value: [new File(["ficticio"], "lab.xlsx")] }); el.dispatchEvent(new Event("change", { bubbles: true })); });
      await click("Analizar Excel");
    } else await click("Ver trazabilidad #2");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Editar consumo vale 19955"]')!.click());
    await cambiar("Piloto tercerizado para vale 19955", "11");
    await cambiar("Unidad tercerizada para vale 19955", "21");
    expect(control("Unidad para vale 19955").value).toBe("-21");
    await cambiar("Unidad para vale 19955", "1");
    await cambiar("Combustible para vale 19955", "GASOLINA_REGULAR");
    expect(control("Unidad para vale 19955").value).toBe("1");
    await cambiar("Justificación de unidad manual", "Revisión de unidad vigente B");
    expect(control("Unidad para vale 19955").value).toBe("1");
    expect(control("Asociación tercerizada verificada").value).toBe("");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
