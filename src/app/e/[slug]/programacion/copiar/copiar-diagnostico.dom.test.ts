// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "acme" }) }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));
vi.mock("@/lib/empresa-session", () => ({ useEmpresaSession: () => ({ permisos: {} }) }));
vi.mock("@/lib/permisos-shared", () => ({ tienePermiso: () => true }));

import Pagina from "./page";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type Val = { fila: number; estado: "ok" | "error"; errores: string[]; tarifa: { id: number; nombre: string; monto: number; moneda: string } | null; conflictos?: unknown[]; diagnostico?: unknown; derivada?: unknown };
const TARIFA = { id: 100, nombre: "Base", monto: 1500, moneda: "GTQ" };
const filaCarga = (n: number, tarifaOriginal: { monto: number | null; moneda: string | null } = { monto: null, moneda: null }) => ({
  origen: { planId: 900 + n, codigo: `P${n}`, estado: "Cerrado", clienteNombre: "Acme", rutaCodigo: "1001", pilotoNombre: null, auxiliaresNombres: [], unidadPlaca: "P-1", tcPlaca: null, tarifaOriginal },
  advertencias: [],
  borrador: { fila: n, origenPlanId: 900 + n, rutaId: 10, clienteId: 3, horaCarga: "03:00", tipoTraslado: null, tipoViaje: "Propio", unidadPlaca: "P-1", tcVehiculoId: null, pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [], tarifaId: null, paradas: [] },
  validacion: null,
});
const catalogos = { empleados: [], unidades: [], tcs: [], tarifasPorRuta: { 10: [{ ...TARIFA, predeterminada: true }] } };

let host: HTMLDivElement; let root: Root;
let filasServidor: ReturnType<typeof filaCarga>[];
let validador: (cuerpo: { filas: { fila: number; regresoEditado?: string | null }[] }) => Val[];
let posts: { url: string; cuerpo: { filas: { fila: number; regresoEditado?: string | null }[] } }[];

const texto = () => host.textContent ?? "";
const boton = (t: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(t)) as HTMLButtonElement | undefined;
const esperar = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const pulsar = async (t: string) => { await act(async () => { boton(t)!.click(); }); };
const escribir = async (el: HTMLInputElement, valor: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const marcarTodasYValidar = async () => { await pulsar("Seleccionar todos"); await esperar(900); };

beforeEach(async () => {
  posts = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const cuerpo = JSON.parse(String(init.body));
      posts.push({ url, cuerpo });
      return Response.json({ validacion: validador(cuerpo) });
    }
    return Response.json({ filas: filasServidor, catalogos });
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(Pagina)));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("Copiar programación: diagnóstico del bloqueo (una fila sin regreso bloquea a las demás)", () => {
  const N = 5; const ORIGEN = 3;
  const bloqueadas = (): Val[] => Array.from({ length: N }, (_, i) => {
    const fila = i + 1;
    const detalle = `El recurso está asignado también en la fila ${ORIGEN} de este mismo lote. Alguna fila no tiene hora o regreso válido: se reserva todo el día (fila ${ORIGEN}: sin regreso estimado).`;
    return fila === ORIGEN
      ? { fila, estado: "error", errores: [detalle], tarifa: null, conflictos: [{ recurso: "persona", filas: [1], causa: "dia_completo" }], diagnostico: { horaInvalida: false, regresoInvalido: true, filasAfectadas: [1, 2, 4, 5], recursosCompartidos: ["personal"] } }
      : { fila, estado: "error", errores: [detalle], tarifa: null, conflictos: [{ recurso: "persona", filas: [ORIGEN], causa: "dia_completo" }], derivada: { origenes: [ORIGEN] } };
  });
  const todasOk = (): Val[] => Array.from({ length: N }, (_, i) => ({ fila: i + 1, estado: "ok", errores: [], tarifa: TARIFA }));

  beforeEach(async () => {
    filasServidor = Array.from({ length: N }, (_, i) => filaCarga(i + 1));
    validador = () => bloqueadas();
    await pulsar("Cargar programación"); await esperar(20);
    await marcarTodasYValidar();
  });

  it("muestra UN diagnóstico (motivos, fila origen y cuántas bloquea) en vez de obligar a leer 5 mensajes repetidos", async () => {
    expect(texto()).toContain("5 de 5 fila(s) bloqueada(s)");
    expect(texto()).toContain("Sin hora o regreso válido (reserva todo el día): 5 fila(s)");
    expect(texto()).toContain(`La fila ${ORIGEN} está sin regreso estimado y reserva todo el día: bloquea a 4 filas`);
    expect(boton(`Fila ${ORIGEN} (sin regreso) · bloquea a 4`)).toBeDefined();
    // las 4 derivadas muestran UNA línea corta que remite al origen; el texto largo queda en «Ver detalle»
    const cortas = [...host.querySelectorAll("p")].filter((p) => /bloqueada por la fila 3/.test(p.textContent ?? ""));
    expect(cortas).toHaveLength(4);
    expect(host.querySelectorAll("details")).toHaveLength(4);
  });

  it("«Fila 3 …» lleva directo al campo de regreso de la fila origen", async () => {
    await pulsar(`Fila ${ORIGEN} (sin regreso)`);
    expect(document.activeElement).toBe(host.querySelector(`#regreso-${ORIGEN}`));
  });

  it("EDITAR el regreso de la fila origen: el lote se revalida completo, el diagnóstico desaparece y se puede confirmar", async () => {
    validador = (c) => {
      const editado = c.filas.find((f) => f.fila === ORIGEN)?.regresoEditado;
      return editado ? todasOk() : bloqueadas();
    };
    const input = host.querySelector(`#regreso-${ORIGEN}`) as HTMLInputElement;
    await escribir(input, "2026-11-20T12:00");
    await esperar(900);
    const ultimo = posts[posts.length - 1];
    expect(ultimo.url).toContain("/copiar/validar");
    expect(ultimo.cuerpo.filas).toHaveLength(N);                                              // se revalida TODO el lote, no solo la fila editada
    expect(ultimo.cuerpo.filas.find((f) => f.fila === ORIGEN)?.regresoEditado).toBe("2026-11-20T12:00");
    expect(ultimo.cuerpo.filas.filter((f) => f.fila !== ORIGEN).every((f) => !("regresoEditado" in f) || f.regresoEditado === undefined)).toBe(true);
    expect(texto()).not.toContain("fila(s) bloqueada(s)");
    expect(texto()).not.toContain("bloqueada por la fila");
    expect(texto()).toContain("OK: 5");
    // sin diferencias de tarifa (origen sin tarifa → destino con tarifa SÍ avisa; aquí no hay tarifa de origen): se acepta aparte, ver pruebas de tarifa
  });

  it("si el nuevo regreso SIGUE solapándose, el servidor mantiene el bloqueo y la pantalla lo muestra como solape real (no se relaja nada)", async () => {
    validador = () => [
      { fila: 1, estado: "ok", errores: [], tarifa: TARIFA },
      { fila: 2, estado: "error", errores: ["La unidad X está asignada también en la fila 3 de este mismo lote. Los horarios se solapan."], tarifa: null, conflictos: [{ recurso: "unidad", filas: [3], causa: "solape" }] },
      { fila: 3, estado: "error", errores: ["La unidad X está asignada también en la fila 2 de este mismo lote. Los horarios se solapan."], tarifa: null, conflictos: [{ recurso: "unidad", filas: [2], causa: "solape" }] },
      { fila: 4, estado: "ok", errores: [], tarifa: TARIFA }, { fila: 5, estado: "ok", errores: [], tarifa: TARIFA },
    ];
    await escribir(host.querySelector(`#regreso-${ORIGEN}`) as HTMLInputElement, "2026-11-20T04:00");
    await esperar(900);
    expect(texto()).toContain("2 de 5 fila(s) bloqueada(s)");
    expect(texto()).toContain("Horarios que se solapan de verdad: 2 fila(s)");
    expect(texto()).not.toContain("Corregir primero");                     // no hay fila «sin regreso»: es un solape real
    expect(texto()).toContain("Los horarios se solapan.");
    expect(boton("Confirmar copia")!.disabled).toBe(true);
  });
});

describe("Copiar programación: tarifa del origen vs la que realmente se usará en destino", () => {
  const validadas = (): Val[] => [1, 2, 3].map((fila) => ({ fila, estado: "ok", errores: [], tarifa: TARIFA }));
  beforeEach(async () => {
    filasServidor = [
      filaCarga(1, { monto: 1500, moneda: "GTQ" }),   // igual
      filaCarga(2, { monto: 1200, moneda: "GTQ" }),  // distinta (+300)
      filaCarga(3),                                                   // el origen no tenía tarifa → asignada
    ];
    validador = validadas;
    await pulsar("Cargar programación"); await esperar(20);
    await marcarTodasYValidar();
  });

  it("muestra origen → destino por fila y advierte cuántos viajes cambian ANTES de confirmar", () => {
    const celdas = [...host.querySelectorAll("tbody tr")].map((tr) => tr.textContent ?? "");
    expect(celdas[0]).toContain("Origen: GTQ 1500.00"); expect(celdas[0]).toContain("Destino: GTQ 1500.00");
    expect(celdas[0]).not.toContain("La tarifa de destino es diferente");              // igual: sin advertencia
    expect(celdas[1]).toContain("Origen: GTQ 1200.00"); expect(celdas[1]).toContain("Destino: GTQ 1500.00");
    expect(celdas[1]).toContain("La tarifa de destino es diferente a la del origen.");
    expect(celdas[2]).toContain("Origen: Sin tarifa"); expect(celdas[2]).toContain("Destino: GTQ 1500.00");
    expect(celdas[2]).toContain("La tarifa de destino es diferente a la del origen.");
    expect(texto()).toContain("2 viaje(s) usarán una tarifa distinta a la del origen");
    expect(texto()).toContain("Los montos del viaje origen NO se copian");
  });

  it("NO se puede confirmar sin aceptar expresamente las diferencias; aceptarlas habilita el botón y desmarcarlas lo vuelve a bloquear", async () => {
    expect(boton("Confirmar copia")!.disabled).toBe(true);
    const aceptar = host.querySelector('section[aria-label="Aviso de tarifas"] input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { aceptar.click(); });
    expect(boton("Confirmar copia")!.disabled).toBe(false);
    await act(async () => { aceptar.click(); });
    expect(boton("Confirmar copia")!.disabled).toBe(true);
  });

  it("sin diferencias de tarifa no aparece el aviso ni se exige aceptar nada", async () => {
    filasServidor = [filaCarga(1, { monto: 1500, moneda: "GTQ" }), filaCarga(2, { monto: 1500, moneda: "GTQ" }), filaCarga(3, { monto: 1500, moneda: "GTQ" })];
    await pulsar("Cargar programación"); await esperar(20);
    await marcarTodasYValidar();
    expect(texto()).not.toContain("usarán una tarifa distinta");
    expect(boton("Confirmar copia")!.disabled).toBe(false);
  });
});
