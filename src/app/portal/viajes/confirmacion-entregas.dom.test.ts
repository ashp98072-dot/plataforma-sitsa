// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConfirmacionEntregas from "./confirmacion-entregas";
import { TEXTO_RECEPCION_OFICIAL, type EntregaVista } from "@/lib/tms/parada-confirmacion-ui";
import type { ConfirmacionParada } from "@/lib/tms/parada-confirmacion";

// TMS-ENTREGA-PILOTO-2 — COMPORTAMIENTO de la pantalla de confirmación por parada (happy-dom). `fetch` está simulado; nada toca la red ni la base.
const VIAJE = 900;
const conf = (over: Partial<ConfirmacionParada> = {}): ConfirmacionParada => ({ id: 5, planId: 55, paradaId: 11, resultado: "ENTREGADA_POR_PILOTO", revision: "NO_REQUERIDA", pilotoUsuario: "portal:P01",
  confirmadoEn: "2026-11-11 10:05:00", evidenciaId: 77, nota: null, recepcionOficial: "NO_ACEPTADA_POR_PRICESMART", estadoExternoPublicado: false, ...over });
const parada = (id: number, over: Partial<EntregaVista> = {}): EntregaVista => ({ paradaId: id, orden: id - 10, lugarNombre: `Club ${id}`, tipo: "Entrega", evidencias: 0, confirmacion: null, ...over });
let host: HTMLElement; let root: Root; let llamadas: { url: string; init?: RequestInit }[]; let fetchMock: ReturnType<typeof vi.fn>;
const json = (status: number, cuerpo: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });
type Props = Parameters<typeof ConfirmacionEntregas>[0];
async function montar(props: Partial<Props> = {}) {
  await act(async () => { root.render(createElement(ConfirmacionEntregas, { viajeId: VIAJE, entregas: [parada(11, { evidencias: 1 })], puedeConfirmar: true, ...props })); });
}
const texto = () => host.textContent ?? "";
const textoConfirmacion = () => host.querySelector("[data-confirmacion]")?.textContent ?? "";   // solo el bloque de la parada (el encabezado de la sección también nombra la etiqueta)
const botones = (nombre: RegExp) => [...host.querySelectorAll("button")].filter((b) => nombre.test(b.textContent ?? ""));
const boton = (nombre: RegExp) => { const b = botones(nombre)[0]; if (!b) throw new Error(`sin botón ${nombre}`); return b as HTMLButtonElement; };
const clic = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); };
async function escribir(el: HTMLTextAreaElement, valor: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, valor); el.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function elegir(el: HTMLSelectElement, valor: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, valor); el.dispatchEvent(new Event("change", { bubbles: true })); }); }
const cuerpoDe = (i: number) => JSON.parse(String(llamadas[i].init?.body));

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); llamadas = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => { llamadas.push({ url, init }); return json(201, { confirmacion: conf(), replayed: false }); });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); vi.unstubAllGlobals(); });

describe("lista de paradas de entrega", () => {
  it("muestra cada parada recibida (orden, lugar, tipo) y su evidencia; sin paradas no pinta nada", async () => {
    await montar({ entregas: [parada(11, { evidencias: 2 }), parada(12, { tipo: "Descarga" })] });
    expect(texto()).toContain("1. Club 11"); expect(texto()).toContain("2. Club 12"); expect(texto()).toContain("Descarga"); expect(texto()).toContain("Evidencia de esta parada: 2"); expect(texto()).toContain("Sin evidencia de esta parada todavía");
    await montar({ entregas: [] }); expect(host.innerHTML).toBe("");
  });
});

describe("evidencia primero, luego confirmar", () => {
  it("sin evidencia: «Confirmar entrega» e «Registrar incidencia» están deshabilitados y se pide subir la evidencia primero", async () => {
    await montar({ entregas: [parada(11, { evidencias: 0 })] });
    expect(boton(/Confirmar entrega/).disabled).toBe(true); expect(boton(/Registrar incidencia/).disabled).toBe(true); expect(texto()).toContain("necesitas subir primero la evidencia");
    await clic(boton(/Confirmar entrega/)); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("«Subir evidencia» NO abre otra cámara: avisa al formulario existente con la parada elegida", async () => {
    const alSubir = vi.fn(); await montar({ entregas: [parada(11), parada(12)], onSubirEvidencia: alSubir });
    await clic(botones(/Subir evidencia/)[1]); expect(alSubir).toHaveBeenCalledExactlyOnceWith(12); expect(host.querySelector("video")).toBeNull(); expect(host.querySelector("input[type=file]")).toBeNull();
  });
  it("con evidencia válida «Confirmar entrega» se habilita", async () => {
    await montar({ entregas: [parada(11, { evidencias: 1 })] }); expect(boton(/Confirmar entrega/).disabled).toBe(false);
  });
});

describe("confirmar una entrega", () => {
  it("envía UNA petición al endpoint existente con el resultado, y muestra resultado, usuario y fecha; la recepción oficial sigue pendiente y separada", async () => {
    const alConfirmar = vi.fn(); await montar({ onConfirmada: alConfirmar });
    await clic(boton(/Confirmar entrega/));
    expect(llamadas).toHaveLength(1); expect(llamadas[0].url).toBe("/api/portal/viajes/900/paradas/11/confirmar"); expect(llamadas[0].init?.method).toBe("POST"); expect(cuerpoDe(0)).toEqual({ resultado: "ENTREGADA_POR_PILOTO" });
    expect(texto()).toContain("ENTREGADA POR PILOTO"); expect(texto()).toContain("Registrado por P01 el 11/11/2026 10:05"); expect(alConfirmar).toHaveBeenCalledOnce();
    expect(texto()).toContain("Recepción oficial PriceSmart:"); expect(texto()).toContain(TEXTO_RECEPCION_OFICIAL); expect(host.querySelector("[data-recepcion-oficial]")?.textContent).toBe(`Recepción oficial PriceSmart: ${TEXTO_RECEPCION_OFICIAL}`); expect(textoConfirmacion()).not.toMatch(/PriceSmart/);   // lo del piloto no menciona recepción oficial
    expect(texto()).not.toMatch(/recepci[óo]n oficial[^.]*:\s*(aceptada|recibida|confirmada)/i);
  });
  it("tras confirmar ya no hay botones para esa parada (no se puede confirmar dos veces)", async () => {
    await montar(); await clic(boton(/Confirmar entrega/));
    expect(botones(/Confirmar entrega/)).toHaveLength(0); expect(botones(/Registrar incidencia/)).toHaveLength(0); expect(botones(/Subir evidencia|Subir otra evidencia/)).toHaveLength(0);
  });
  it("dos toques seguidos antes de la respuesta envían UNA sola petición", async () => {
    let liberar!: () => void; fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => { llamadas.push({ url, init }); await new Promise<void>((r) => { liberar = r; }); return json(201, { confirmacion: conf(), replayed: false }); });
    await montar(); const b = boton(/Confirmar entrega/);
    await act(async () => { b.click(); b.click(); });
    expect(llamadas).toHaveLength(1); expect(boton(/Enviando/).disabled).toBe(true);
    await act(async () => { liberar(); }); expect(llamadas).toHaveLength(1); expect(texto()).toContain("ENTREGADA POR PILOTO");
  });
  it("durante el envío de una parada se bloquean las acciones de las demás", async () => {
    let liberar!: () => void; fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => { llamadas.push({ url, init }); await new Promise<void>((r) => { liberar = r; }); return json(201, { confirmacion: conf(), replayed: false }); });
    await montar({ entregas: [parada(11, { evidencias: 1 }), parada(12, { evidencias: 1 })] });
    await act(async () => { botones(/Confirmar entrega/)[0].click(); }); expect(botones(/Confirmar entrega/)[0].disabled).toBe(true);
    await act(async () => { liberar(); });
  });
});

describe("reintentos de red", () => {
  it("si falla la red se avisa SIN perder la acción; reintentar usa el mismo cuerpo y la respuesta repetida (200) no duplica la confirmación", async () => {
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => { llamadas.push({ url, init }); throw new TypeError("Failed to fetch"); });
    await montar(); await clic(boton(/Confirmar entrega/));
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Sin conexión"); expect(host.querySelector("[data-confirmacion]")).toBeNull(); expect(boton(/Reintentar confirmación/).disabled).toBe(false);
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => { llamadas.push({ url, init }); return json(200, { confirmacion: conf(), replayed: true }); });
    await clic(boton(/Reintentar confirmación/));
    expect(llamadas).toHaveLength(2); expect(llamadas[1].url).toBe(llamadas[0].url); expect(cuerpoDe(1)).toEqual(cuerpoDe(0));
    expect(host.querySelectorAll("[data-confirmacion]")).toHaveLength(1); expect(host.querySelector("[role=alert]")).toBeNull(); expect(texto()).toContain("ENTREGADA POR PILOTO");
  });
  it("una respuesta sin JSON o con error del servidor muestra un mensaje y deja reintentar", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 502, json: async () => { throw new Error("html"); } }));
    await montar(); await clic(boton(/Confirmar entrega/)); expect(host.querySelector("[role=alert]")?.textContent).toContain("No se pudo registrar la confirmación"); expect(boton(/Confirmar entrega/).disabled).toBe(false);
  });
});

describe("parcial, rechazada o incidencia", () => {
  it("exige una nota de al menos 5 caracteres (los espacios no cuentan) antes de poder enviar", async () => {
    await montar(); await clic(boton(/Registrar incidencia/));
    const enviar = () => boton(/Enviar incidencia/); const area = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(enviar().disabled).toBe(true); await escribir(area, "     "); expect(enviar().disabled).toBe(true); await escribir(area, "abcd"); expect(enviar().disabled).toBe(true);
    await escribir(area, "falta 1"); expect(enviar().disabled).toBe(false); await clic(enviar()); expect(llamadas).toHaveLength(1);
  });
  it("envía el resultado elegido con su nota y queda EN REVISIÓN HUMANA, sin botones para confirmarla como entregada", async () => {
    await montar({ entregas: [parada(11, { evidencias: 1 })] });
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => { llamadas.push({ url, init }); return json(201, { confirmacion: conf({ resultado: "RECHAZADA", revision: "PENDIENTE", nota: "El cliente no recibió" }), replayed: false }); });
    await clic(boton(/Registrar incidencia/)); await elegir(host.querySelector("select") as HTMLSelectElement, "RECHAZADA"); await escribir(host.querySelector("textarea") as HTMLTextAreaElement, "  El cliente no recibió  ");
    await clic(boton(/Enviar incidencia/));
    expect(cuerpoDe(0)).toEqual({ resultado: "RECHAZADA", nota: "El cliente no recibió" });   // la nota se envía sin espacios sobrantes
    expect(texto()).toContain("ENTREGA RECHAZADA"); expect(texto()).toContain("En revisión por personal de Operaciones"); expect(texto()).toContain("Nota: El cliente no recibió");
    expect(textoConfirmacion()).not.toContain("ENTREGADA POR PILOTO"); expect(botones(/Confirmar entrega|Registrar incidencia|Enviar incidencia/)).toHaveLength(0);
  });
  it("ofrece exactamente las tres opciones PARCIAL, RECHAZADA e INCIDENCIA (nunca «entregada» desde el formulario de incidencia)", async () => {
    await montar(); await clic(boton(/Registrar incidencia/));
    expect([...host.querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value)).toEqual(["PARCIAL", "RECHAZADA", "INCIDENCIA"]);
  });
});

describe("conflictos y estado ya existente", () => {
  it("un rechazo del servidor (409) se muestra tal cual y se vuelve a leer el estado", async () => {
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => { llamadas.push({ url, init }); return json(409, { error: "Esta parada ya fue confirmada como entregada.", codigo: "YA_CONFIRMADA" }); });
    const alConfirmar = vi.fn(); await montar({ onConfirmada: alConfirmar }); await clic(boton(/Confirmar entrega/));
    expect(host.querySelector("[role=alert]")?.textContent).toBe("Esta parada ya fue confirmada como entregada."); expect(alConfirmar).toHaveBeenCalledOnce();
  });
  it("si la confirmación aún no está habilitada (503) lo dice y no inventa un éxito", async () => {
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => { llamadas.push({ url, init }); return json(503, { error: "La confirmación de entregas aún no está habilitada.", codigo: "NO_DISPONIBLE" }); });
    await montar(); await clic(boton(/Confirmar entrega/)); expect(host.querySelector("[role=alert]")?.textContent).toContain("aún no está habilitada"); expect(host.querySelector("[data-confirmacion]")).toBeNull();
  });
  it("una confirmación que ya trae el servidor se muestra de solo lectura (sin acciones) con usuario, fecha y nota", async () => {
    await montar({ entregas: [parada(11, { evidencias: 1, confirmacion: conf({ resultado: "PARCIAL", revision: "PENDIENTE", nota: "Faltaron 3 cajas", pilotoUsuario: "portal:P09" }) })] });
    expect(texto()).toContain("ENTREGA PARCIAL"); expect(texto()).toContain("Registrado por P09 el 11/11/2026 10:05"); expect(texto()).toContain("Faltaron 3 cajas"); expect(texto()).toContain("En revisión"); expect(host.querySelectorAll("button")).toHaveLength(0);
  });
  it("lo que trae el servidor manda sobre un estado local anterior", async () => {
    await montar(); await clic(boton(/Confirmar entrega/)); expect(textoConfirmacion()).toContain("ENTREGADA POR PILOTO");
    await montar({ entregas: [parada(11, { evidencias: 1, confirmacion: conf({ resultado: "INCIDENCIA", revision: "PENDIENTE", nota: "Cliente cerrado" }) })] });
    expect(textoConfirmacion()).toContain("INCIDENCIA EN LA ENTREGA"); expect(textoConfirmacion()).not.toContain("ENTREGADA POR PILOTO");
  });
});

describe("permisos de la pantalla y límites", () => {
  it("un auxiliar (sin permiso de piloto) ve el estado pero ninguna acción, aunque haya evidencia", async () => {
    await montar({ puedeConfirmar: false }); expect(host.querySelectorAll("button")).toHaveLength(0); expect(texto()).toContain("1. Club 11");
  });
  it("la pantalla solo habla con el endpoint de confirmación del propio viaje: ninguna otra ruta, ni PriceSmart, ni solicitudes", async () => {
    await montar({ entregas: [parada(11, { evidencias: 1 }), parada(12, { evidencias: 1 })] });
    await clic(botones(/Confirmar entrega/)[0]); await clic(botones(/Confirmar entrega/)[0]);
    expect(llamadas.map((l) => l.url)).toEqual(["/api/portal/viajes/900/paradas/11/confirmar", "/api/portal/viajes/900/paradas/12/confirmar"]);
    expect(llamadas.every((l) => l.init?.method === "POST")).toBe(true);
  });
});
