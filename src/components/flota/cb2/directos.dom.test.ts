// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AsignacionCB2, type DecisionAsignacion } from "./asignacion";
import { useRevisionCB2 } from "./use-revision";
import { seleccionSegura } from "./preview-model";
import type { CatalogosCB2, FilaCB2 } from "./client";
const fila: FilaCB2 = { hoja: "LAB", fila: 2, candidato: "a".repeat(64), bloqueada: false, documento: null, errores: [], estado: "ADVERTENCIA", motivos: [], vale: "19955", placa: "060 KHK", placaNormalizada: "060KHK", fecha: "2026-10-01", galones: "10", precio: "20", monto: "200", moneda: "GTQ", origen: { piloto: "Luis Escobar", producto: "DIESEL", km: "", galones: "10", precio: "20", monto: "200" } };
const cat: CatalogosCB2 = { tercerosDirectos: true, tercerosHabilitados: true, proveedores: [], vehiculos: [{ id: -21, placa: "M060KHK" }, { id: 1, placa: "M060KHK" }], pilotosExternos: [{ id: 11, nombre: "Luis Escobar", referencia: "lab-p" }], unidadesExternas: [{ id: 21, placa: "M060KHK", referencia: "lab-u", tipo: "MOTOCICLETA", descripcion: "Sintética" }], terceros: [] };
it("selección directa válida no exige asociación; ambigüedad, datos incompatibles y compuerta apagada bloquean", () => {
  const seleccion = { [fila.candidato!]: "-21" };
  expect(seleccionSegura([fila], cat, seleccion)).toEqual(seleccion);
  expect(seleccionSegura([fila], { ...cat, tercerosDirectos: false }, seleccion)).toEqual({});
  expect(seleccionSegura([fila], { ...cat, tercerosHabilitados: false }, seleccion)).toEqual({});
  expect(seleccionSegura([fila], { ...cat, pilotosExternos: [...cat.pilotosExternos!, { id: 12, nombre: "LUIS  ESCOBAR", referencia: "lab-homonimo" }] }, seleccion)).toEqual({});
  expect(seleccionSegura([fila], cat, seleccion, {}, { [fila.candidato!]: { pilotoExternoId: 99 } })).toEqual({});
  const ambigua = { ...cat, unidadesExternas: [...cat.unidadesExternas!, { ...cat.unidadesExternas![0], id: 22, placa: "C060KHK" }] };
  expect(seleccionSegura([fila], ambigua, seleccion)).toEqual({});
  expect(seleccionSegura([fila], ambigua, seleccion, {}, { [fila.candidato!]: { pilotoExternoId: 11, motivoUnidad: "Revisé la referencia estable real" } })).toEqual(seleccion);
});
it("DOM directo: alta independiente desde importación, sin asociación, y B no se sobrescribe", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const recargar = vi.fn(async () => cat), fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ id: 13 }), { headers: { "Content-Type": "application/json" } })); vi.stubGlobal("fetch", fetch);
  function Pantalla() {
    const [ds, setDs] = useState<Record<string, DecisionAsignacion>>({}); const r = useRevisionCB2([fila], cat, ds, setDs);
    return createElement("div", null, createElement("button", { onClick: () => r.asignar(fila.candidato!, "1") }, "Elegir B"), createElement("output", null, r.asignaciones[fila.candidato!] ?? ""), createElement(AsignacionCB2, { fila, cat, api: "/lab", actualizarCatalogos: recargar, value: ds[fila.candidato!] ?? {}, onChange: v => r.cambiarDecision(fila.candidato!, v), disabled: false }));
  }
  async function cambiar(label: string, value: string) { const l = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(label))!; const el = (l.querySelector("select") ?? document.getElementById(l.htmlFor)) as HTMLSelectElement; await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("change", { bubbles: true })); }); }
  try {
    await act(async () => root.render(createElement(Pantalla)));
    expect(host.textContent).not.toContain("Asociación tercerizada verificada");
    await cambiar("Unidad tercerizada para vale 19955", "21"); expect(host.querySelector("output")!.textContent).toBe("-21");
    await act(async () => host.querySelector("button")!.click()); await cambiar("Combustible para vale 19955", "GASOLINA_REGULAR"); expect(host.querySelector("output")!.textContent).toBe("1");
    const f = host.querySelector<HTMLFormElement>('form[aria-label="Alta directa de piloto"]')!;
    (f.elements.namedItem("referencia") as HTMLInputElement).value = "referencia-real-lab"; (f.elements.namedItem("nombre") as HTMLInputElement).value = "Otro Piloto Sintético";
    await act(async () => f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(JSON.parse(String(fetch.mock.calls[0][1]!.body))).toEqual({ recurso: "PILOTO", referencia: "referencia-real-lab", nombre: "Otro Piloto Sintético" }); expect(recargar).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
