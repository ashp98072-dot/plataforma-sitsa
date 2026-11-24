// @vitest-environment happy-dom
// El panel informa los montos vigentes (los escritos en pantalla, sin RECHAZADOS) para el resumen visual de Programación; no persiste nada por sí mismo al escribir.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ViaticosPanel from "./viaticos-panel";

const fila = (id: number, rol: string, montoAsignado: number, estado = "PROGRAMADO") => ({ id, personalNombre: `P${id}`, rol, puesto: rol, montoSugerido: montoAsignado, montoAsignado, motivoCambio: null, modificadoPor: null, estado,
  metodoPago: null, autorizadoPor: null, autorizadoEn: null, entregadoPor: null, entregadoEn: null, referenciaPago: null, liquidadoPor: null, liquidadoEn: null, rechazadoPor: null, rechazadoEn: null, motivoRechazo: null });
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("ViaticosPanel → onMontosChange", () => {
  it("informa los montos cargados, excluye RECHAZADOS y sigue lo que se escribe antes de guardar", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ viaticos: [fila(1, "Piloto", 50), fila(2, "Auxiliar", 100), fila(3, "Auxiliar", 30, "RECHAZADO"), fila(4, "Auxiliar", 0)] })));
    vi.stubGlobal("fetch", fetchMock);
    const alCambiar = vi.fn();
    await act(async () => { root.render(createElement(ViaticosPanel, { slug: "x", planId: 9, onMontosChange: alCambiar })); });
    await act(async () => { await Promise.resolve(); });
    expect(alCambiar).toHaveBeenLastCalledWith([50, 100, 0]);
    const entrada = host.querySelectorAll<HTMLInputElement>("input[type=number]")[1];
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(entrada, "120"); entrada.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(alCambiar).toHaveBeenLastCalledWith([50, 120, 0]);
    expect(fetchMock).toHaveBeenCalledTimes(1);   // escribir no guarda: solo la lectura inicial
  });
});
