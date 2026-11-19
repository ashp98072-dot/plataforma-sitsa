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

describe("Copiar programación: copia fiel al origen (sin regreso o recurso ya ocupado = aviso, no bloqueo)", () => {
  const N = 5; const ORIGEN = 3;
  const detalle = `El recurso está asignado también en la fila ${ORIGEN} de este mismo lote. Alguna fila no tiene hora o regreso válido: se reserva todo el día (fila ${ORIGEN}: sin regreso estimado). Se copia igual que el origen.`;
  const conAvisos = (): Val[] => Array.from({ length: N }, (_, i) => {
    const fila = i + 1;
    return fila === ORIGEN
      ? { fila, estado: "ok", errores: [], tarifa: TARIFA, avisos: [{ tipo: "ventana_incompleta", filas: [1, 2, 4, 5], mensaje: detalle }], conflictos: [{ recurso: "persona", filas: [1], causa: "dia_completo" }], diagnostico: { horaInvalida: false, regresoInvalido: true, filasAfectadas: [1, 2, 4, 5], recursosCompartidos: ["personal"] } }
      : { fila, estado: "ok", errores: [], tarifa: TARIFA, avisos: [{ tipo: "ventana_incompleta", filas: [ORIGEN], mensaje: detalle }], conflictos: [{ recurso: "persona", filas: [ORIGEN], causa: "dia_completo" }] };
  });
  const sinAvisos = (): Val[] => Array.from({ length: N }, (_, i) => ({ fila: i + 1, estado: "ok", errores: [], tarifa: TARIFA }));
  const botonConfirmar = () => boton("Confirmar copia")!;
  const casilla = () => host.querySelector('section[aria-label="Avisos de la copia"] input[type="checkbox"]') as HTMLInputElement;

  beforeEach(async () => {
    filasServidor = Array.from({ length: N }, (_, i) => filaCarga(i + 1, { monto: 1500, moneda: "GTQ" }));
    validador = () => conAvisos();
    await pulsar("Cargar programación"); await esperar(20);
    await marcarTodasYValidar();
  });

  it("NINGUNA fila queda bloqueada: las 5 están OK, con un solo resumen de avisos en vez de 5 errores", () => {
    expect(texto()).toContain("OK: 5");
    expect(texto()).toContain("Con error: 0");
    expect(texto()).not.toContain("no se pueden copiar");
    expect(texto()).toContain("5 fila(s) se copiarán igual que el origen, con avisos");
    expect(texto()).toContain("Comparten recursos con filas sin hora o regreso válido (reservan todo el día, igual que en el origen): 5 fila(s)");
    expect(texto()).toContain(`La fila ${ORIGEN} está sin regreso estimado y reserva todo el día: comparte recursos con 4 filas`);
    expect(boton(`Fila ${ORIGEN} (sin regreso) · comparte con 4`)).toBeDefined();
    // cada fila muestra una línea corta; el texto largo queda en «Ver detalle»
    expect([...host.querySelectorAll("p")].filter((p) => /Comparte recursos con la fila\(s\) 3 sin hora\/regreso válido/.test(p.textContent ?? ""))).toHaveLength(4);
    expect(host.querySelectorAll("tbody details")).toHaveLength(5);
  });

  it("para copiar hay que ACEPTAR los avisos una vez (casilla); sin aceptar el botón queda deshabilitado y con aceptar se habilita; desmarcar lo vuelve a bloquear", async () => {
    expect(botonConfirmar().disabled).toBe(true);
    await act(async () => { casilla().click(); });
    expect(botonConfirmar().disabled).toBe(false);
    await act(async () => { casilla().click(); });
    expect(botonConfirmar().disabled).toBe(true);
  });

  it("confirmar con avisos aceptados envía TODAS las filas y crea la copia (el servidor decide; la aceptación no viaja como dato)", async () => {
    await act(async () => { casilla().click(); });
    const respuesta = vi.mocked(fetch);
    respuesta.mockImplementationOnce(async (url, init) => { posts.push({ url: String(url), cuerpo: JSON.parse(String((init as RequestInit).body)) }); return Response.json({ creados: 5, planIds: [1, 2, 3, 4, 5], codigos: ["P1", "P2", "P3", "P4", "P5"] }); });
    await pulsar("Confirmar copia");
    await esperar(20);
    const ultimo = posts[posts.length - 1];
    expect(ultimo.url).toContain("/copiar/confirmar");
    expect(ultimo.cuerpo.filas).toHaveLength(N);
    expect(JSON.stringify(ultimo.cuerpo)).not.toMatch(/avisosAceptados|aceptad/i);
    expect(texto()).toContain("Copia creada: 5 viaje(s)");
  });

  it("«Fila 3 …» lleva al campo de regreso de la fila para quien prefiera completarlo", async () => {
    await pulsar(`Fila ${ORIGEN} (sin regreso)`);
    expect(document.activeElement).toBe(host.querySelector(`#regreso-${ORIGEN}`));
  });

  it("EDITAR el regreso de la fila origen: el lote se revalida completo, los avisos desaparecen y se puede confirmar SIN aceptar nada", async () => {
    validador = (c) => (c.filas.find((f) => f.fila === ORIGEN)?.regresoEditado ? sinAvisos() : conAvisos());
    await escribir(host.querySelector(`#regreso-${ORIGEN}`) as HTMLInputElement, "2026-11-20T12:00");
    await esperar(900);
    const ultimo = posts[posts.length - 1];
    expect(ultimo.url).toContain("/copiar/validar");
    expect(ultimo.cuerpo.filas).toHaveLength(N);                                              // se revalida TODO el lote, no solo la fila editada
    expect(ultimo.cuerpo.filas.find((f) => f.fila === ORIGEN)?.regresoEditado).toBe("2026-11-20T12:00");
    expect(texto()).not.toContain("con avisos");
    expect(texto()).not.toContain("Comparte recursos con la fila");
    expect(texto()).toContain("OK: 5");
    expect(botonConfirmar().disabled).toBe(false);
  });

  it("un SOLAPE REAL (horas conocidas) sigue BLOQUEANDO: se muestra como bloqueo, no como aviso, y el botón queda deshabilitado", async () => {
    validador = () => [
      { fila: 1, estado: "ok", errores: [], tarifa: TARIFA },
      { fila: 2, estado: "error", errores: ["La unidad X está asignada también en la fila 3 de este mismo lote. Los horarios se solapan."], tarifa: null, conflictos: [{ recurso: "unidad", filas: [3], causa: "solape" }] },
      { fila: 3, estado: "error", errores: ["La unidad X está asignada también en la fila 2 de este mismo lote. Los horarios se solapan."], tarifa: null, conflictos: [{ recurso: "unidad", filas: [2], causa: "solape" }] },
      { fila: 4, estado: "ok", errores: [], tarifa: TARIFA }, { fila: 5, estado: "ok", errores: [], tarifa: TARIFA },
    ];
    await escribir(host.querySelector(`#regreso-${ORIGEN}`) as HTMLInputElement, "2026-11-20T04:00");
    await esperar(900);
    expect(texto()).toContain("2 de 5 fila(s) no se pueden copiar");
    expect(texto()).toContain("Horarios que se solapan de verdad: 2 fila(s)");
    expect(texto()).toContain("Los horarios se solapan.");
    expect(botonConfirmar().disabled).toBe(true);
  });

  it("el recurso ya ocupado en la fecha DESTINO se muestra como aviso (no bloquea) y también exige la aceptación", async () => {
    validador = () => sinAvisos().map((v) => (v.fila === 2 ? { ...v, avisos: [{ tipo: "destino_ocupado", mensaje: "El piloto Juan Pérez ya está asignado al PLAN-9 para el 20/11/2026. Se copia igual que el origen." }] } : v));
    await escribir(host.querySelector(`#regreso-1`) as HTMLInputElement, "2026-11-20T10:00");
    await esperar(900);
    expect(texto()).toContain("El recurso ya tiene otro viaje en la fecha destino: 1 fila(s)");
    expect(texto()).toContain("ya está asignado al PLAN-9");
    expect(botonConfirmar().disabled).toBe(true);
    await act(async () => { casilla().click(); });
    expect(botonConfirmar().disabled).toBe(false);
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
