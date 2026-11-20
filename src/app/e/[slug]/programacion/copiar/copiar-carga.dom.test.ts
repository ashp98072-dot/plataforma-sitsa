// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "acme" }) }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));
vi.mock("@/lib/empresa-session", () => ({ useEmpresaSession: () => ({ permisos: {} }) }));
vi.mock("@/lib/permisos-shared", () => ({ tienePermiso: () => true }));
// Plazo del cliente MUY corto para probar el vencimiento con temporizadores reales.
vi.mock("@/lib/tms/plazos-copia", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/tms/plazos-copia")>()), PLAZO_CLIENTE_COPIAR_MS: 80 }));

import Pagina from "./page";
import { MSG_CARGA_TARDO } from "@/lib/tms/plazos-copia";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const fila = (n: number) => ({
  origen: { planId: 900 + n, codigo: `P${n}`, estado: "Cerrado", clienteNombre: "Acme", rutaCodigo: "1001", pilotoNombre: null, auxiliaresNombres: [], unidadPlaca: "P-1", tcPlaca: null },
  advertencias: [],
  borrador: { fila: n, origenPlanId: 900 + n, rutaId: 10, clienteId: 3, horaCarga: "03:00", tipoTraslado: null, tipoViaje: "Propio", unidadPlaca: "P-1", tcVehiculoId: null, pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [], tarifaId: null, paradas: [] },
  validacion: { fila: n, estado: "ok", errores: [], tarifa: null },
});
const carga = (n: number) => ({ filas: Array.from({ length: n }, (_, i) => fila(i + 1)), catalogos: { empleados: [], unidades: [], tcs: [], tarifasPorRuta: {} } });

type Pendiente = { url: string; signal: AbortSignal; resolver: (r: Response) => void; rechazar: (e: unknown) => void };
let pendientes: Pendiente[];
let host: HTMLDivElement; let root: Root;

/** fetch simulado: queda pendiente hasta que el test lo resuelve; rechaza con AbortError al abortarse la señal (como el fetch real). */
function instalarFetch() {
  pendientes = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init!.signal as AbortSignal;
    const p: Pendiente = { url, signal, resolver: resolve, rechazar: reject };
    pendientes.push(p);
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  })));
}
const json = (cuerpo: unknown, status = 200) => Response.json(cuerpo, { status });
const texto = () => host.textContent ?? "";
const boton = (t: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(t)) as HTMLButtonElement | undefined;
const esperar = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const pulsar = async (t: string) => { await act(async () => { boton(t)!.click(); }); };

beforeEach(async () => {
  instalarFetch();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(Pagina)));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("Copiar programación: la carga nunca deja la pantalla indefinidamente en «Cargando…»", () => {
  it("TIMEOUT: si el servidor no responde, la solicitud se CANCELA (AbortController), se muestra un mensaje claro y el botón vuelve a estar disponible", async () => {
    await pulsar("Cargar programación");
    expect(texto()).toContain("Cargando…");
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0].signal.aborted).toBe(false);
    await esperar(200);
    expect(pendientes[0].signal.aborted).toBe(true);
    expect(texto()).toContain(MSG_CARGA_TARDO);
    expect(texto()).not.toContain("Cargando…");
    expect(boton("Cargar programación")!.disabled).toBe(false);
    expect(boton("Reintentar")).toBeDefined();
  });

  it("REINTENTO: tras el vencimiento, «Reintentar» lanza una solicitud NUEVA y, si responde, carga los viajes y limpia el error", async () => {
    await pulsar("Cargar programación"); await esperar(200);
    expect(boton("Reintentar")).toBeDefined();
    await pulsar("Reintentar");
    expect(pendientes).toHaveLength(2);
    expect(texto()).not.toContain(MSG_CARGA_TARDO);
    await act(async () => pendientes[1].resolver(json(carga(2))));
    expect(texto()).toContain("2 viaje(s)");
    expect(texto()).not.toContain("Reintentar");
    expect(texto()).not.toContain("Cargando…");
  });

  it("503 del servidor (plazo/bloqueo): muestra su mensaje controlado y ofrece reintentar; un 400 NO ofrece reintentar", async () => {
    await pulsar("Cargar programación");
    await act(async () => pendientes[0].resolver(json({ error: "La operación tardó demasiado y se canceló. No se guardó ningún cambio. Intenta de nuevo." }, 503)));
    expect(texto()).toContain("La operación tardó demasiado y se canceló");
    expect(boton("Reintentar")).toBeDefined();
    await pulsar("Cargar programación");
    await act(async () => pendientes[1].resolver(json({ error: "Fechas inválidas (YYYY-MM-DD)." }, 400)));
    expect(texto()).toContain("Fechas inválidas");
    expect(boton("Reintentar")).toBeUndefined();
  });

  it("error de red (fetch rechaza sin abortar): mensaje claro y reintentar", async () => {
    await pulsar("Cargar programación");
    await act(async () => pendientes[0].rechazar(new TypeError("Failed to fetch")));
    expect(texto()).toContain("No se pudo conectar con el servidor");
    expect(boton("Reintentar")).toBeDefined();
    expect(texto()).not.toContain("Cargando…");
  });
});

describe("Copiar programación: solicitudes anteriores no sobrescriben a las nuevas", () => {
  it("la respuesta de una carga ya CANCELADA (vencida) que llega tarde se descarta: solo cuenta la solicitud nueva", async () => {
    await pulsar("Cargar programación");
    const primera = pendientes[0];
    await esperar(150);   // la 1.ª vence y se aborta
    expect(primera.signal.aborted).toBe(true);
    await pulsar("Reintentar");
    expect(pendientes).toHaveLength(2);
    primera.resolver(json(carga(9)));   // respuesta tardía de la solicitud anterior
    await act(async () => pendientes[1].resolver(json(carga(3))));
    expect(texto()).toContain("3 viaje(s)");
    expect(texto()).not.toContain("9 viaje(s)");
  });

  it("al salir de la pantalla (desmontar) la solicitud en curso se cancela y no se actualiza el estado", async () => {
    await pulsar("Cargar programación");
    const p = pendientes[0];
    const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => root.unmount());
    expect(p.signal.aborted).toBe(true);
    await esperar(30);
    expect(errores).not.toHaveBeenCalled();   // sin «state update on an unmounted component»
    errores.mockRestore();
    root = createRoot(host);   // para que afterEach pueda desmontar
    await act(async () => root.render(createElement("div")));
  });
});
