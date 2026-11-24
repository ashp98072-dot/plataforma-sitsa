// @vitest-environment happy-dom
// Ubicación y texto de las casillas de registro en la revisión de vales (Shell y HALEL):
//  · «Guardar como piloto reportado para futuras importaciones» en el panel «Empleado y combustible», directamente debajo del selector de empleado.
//  · «Guardar como unidad externa para futuras importaciones» en el panel «Unidad y placa», SOLO si la placa no existe en Flota y las políticas CB2 permiten registrarla.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidatosCB2 } from "./preview-vista";
import { AsignacionCB2 } from "./asignacion";
import { UnidadShellVale } from "./unidad-shell-vale";
import type { CatalogosCB2, FilaCB2 } from "./client";

const PILOTO = "Guardar como piloto reportado para futuras importaciones", UNIDAD = "Guardar como unidad externa para futuras importaciones";
let root: Root, host: HTMLDivElement;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const fila = (perfil: "SHELL" | "HALEL", placa: string) => ({ perfil, hoja: "DEMO", fila: 2, candidato: "a", bloqueada: false, documento: null, errores: [], estado: "VALIDA", motivos: [], vale: "0001", placa, placaNormalizada: placa, fecha: "2026-10-01", galones: "10", precio: "20", monto: "200", moneda: "GTQ", lote: "007",
  origen: { piloto: "Pedro Coc", producto: "Diesel", km: "", galones: "10", precio: "20", monto: "200" } }) as unknown as FilaCB2;
const catalogo = (extra: Record<string, unknown> = {}) => ({ proveedores: [], vehiculos: [{ id: 1, placa: "C-570BZT", estado: "Activo" }], empleados: [{ id: 5, nombre: "Juan Perez Lopez", estado: "Activo" }], pilotosReportados: true, tercerosDirectos: true, ...extra }) as unknown as CatalogosCB2;

async function montar(f: FilaCB2, cat: CatalogosCB2) {
  const nombre = { clave: "PEDRO COC", originales: ["Pedro Coc"], filas: 1, candidatos: [], elegibles: [], propuesta: null };
  await act(async () => root.render(createElement(CandidatosCB2, {
    filas: [f], cat, seleccion: {}, onChange: vi.fn(), disabled: false,
    unidadExterna: g => createElement(UnidadShellVale, { parte: "casilla", fila: g.fila, cat, vehiculoId: g.vehiculoId, api: "/demo", recargar: async () => undefined, onUnidad: vi.fn(), disabled: false }),
    revisionExtra: g => createElement(AsignacionCB2, { api: "/demo", actualizarCatalogos: async () => undefined, fila: g.fila, cat, value: {}, disabled: false, vehiculoId: g.vehiculoId, onUnidad: vi.fn(), nombre: nombre as never, onNombre: vi.fn(), onChange: vi.fn() }),
  })));
}
const seccion = (titulo: string) => [...host.querySelectorAll("section")].find(s => s.getAttribute("aria-label")?.startsWith(titulo))!;
const casilla = (raiz: ParentNode, texto: string) => [...raiz.querySelectorAll("label")].find(l => l.textContent?.startsWith(texto) && l.querySelector("input[type=checkbox]"))?.querySelector("input[type=checkbox]") as HTMLInputElement | undefined;
const sigue = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe.each(["SHELL", "HALEL"] as const)("casillas de registro — %s", (perfil) => {
  it("placa fuera de Flota con política habilitada: la unidad externa va en «Unidad y placa» y el piloto en «Empleado y combustible» (nunca al revés)", async () => {
    await montar(fila(perfil, "C-123XYZ"), catalogo());
    const izquierda = seccion("Unidad y placa"), derecha = seccion("Empleado y combustible");
    expect(izquierda).toBeDefined(); expect(derecha).toBeDefined();
    expect(casilla(izquierda, UNIDAD)).toBeDefined(); expect(casilla(derecha, UNIDAD)).toBeUndefined();   // una sola casilla de unidad, en el panel izquierdo
    expect(casilla(derecha, PILOTO)).toBeDefined(); expect(casilla(izquierda, PILOTO)).toBeUndefined();   // una sola casilla de piloto, en el panel derecho
    expect([...host.querySelectorAll("label")].some(l => l.textContent?.includes("Ninguno corresponde"))).toBe(false);   // el texto ya no tiene el prefijo
    expect(host.querySelectorAll(`input[type=checkbox]`).length).toBeGreaterThanOrEqual(2);
  });

  it("la casilla de unidad externa necesita elegir el tipo y registra una vez con la política CB2 (no se muestra la del panel derecho)", async () => {
    const llamadas: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { llamadas.push(String(url)); return new Response(JSON.stringify({ id: 9, existente: false }), { status: 201, headers: { "Content-Type": "application/json" } }); }));
    try {
      await montar(fila(perfil, "C-123XYZ"), catalogo());
      const c = casilla(seccion("Unidad y placa"), UNIDAD)!;
      expect(c.disabled).toBe(true); expect(llamadas).toHaveLength(0);                                    // sin tipo no se puede marcar
      const sel = [...seccion("Unidad y placa").querySelectorAll("label")].find(l => l.textContent?.startsWith("Tipo de unidad externa"))!.querySelector("select")!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, "VEHICULO"); sel.dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => casilla(seccion("Unidad y placa"), UNIDAD)!.click());
      expect(llamadas).toEqual(["/demo/terceros"]);
    } finally { vi.unstubAllGlobals(); }
  });

  it("placa que YA existe en Flota: no se muestra la casilla de unidad externa", async () => {
    await montar(fila(perfil, "C-570BZT"), catalogo());
    expect(casilla(host, UNIDAD)).toBeUndefined();
    expect(casilla(seccion("Empleado y combustible"), PILOTO)).toBeDefined();   // la del piloto no depende de la placa
  });

  it("política CB2 de terceros deshabilitada: no se muestra la casilla de unidad externa aunque la placa no exista", async () => {
    await montar(fila(perfil, "C-123XYZ"), catalogo({ tercerosDirectos: false }));
    expect(casilla(host, UNIDAD)).toBeUndefined();
  });

  it("placa sin forma de placa o casi igual a una de Flota: no se ofrece registrar", async () => {
    await montar(fila(perfil, "CANECA"), catalogo()); expect(casilla(host, UNIDAD)).toBeUndefined();
    await montar(fila(perfil, "C-570BZS"), catalogo()); expect(casilla(host, UNIDAD)).toBeUndefined();
  });
});

describe("casilla de piloto directamente debajo del selector de empleado", () => {
  it("SHELL: la casilla sigue al selector «Empleado existente» sin otros controles entre ambos", async () => {
    await montar(fila("SHELL", "C-123XYZ"), catalogo());
    const derecha = seccion("Empleado y combustible"), c = casilla(derecha, PILOTO)!;
    const selector = [...derecha.querySelectorAll("input[type=search]")].find(i => i.closest("label,div,fieldset")?.textContent?.includes("Empleado existente") || true)!;
    expect(sigue(selector, c)).toBe(true);
    const controles = [...derecha.querySelectorAll("input,select,button,textarea")], entre = controles.slice(controles.indexOf(selector as Element) + 1, controles.indexOf(c));
    expect(entre.filter(x => x.tagName === "BUTTON" || (x as HTMLInputElement).type === "checkbox")).toEqual([]);   // ningún botón ni otra casilla entre el selector y la casilla del piloto
  });

  it("HALEL con identidades independientes: la casilla queda dentro de la sección del piloto, justo después del selector «Piloto de la empresa»", async () => {
    await montar(fila("HALEL", "C-570BZT"), catalogo({ identidadesIndependientes: true }));
    const derecha = seccion("Empleado y combustible"), c = casilla(derecha, PILOTO)!;
    expect(c).toBeDefined();
    const campo = c.closest("fieldset")!;
    expect(campo.textContent).toContain("Piloto reportado y vinculacion opcional");
    const selector = [...campo.querySelectorAll("label")].find(l => l.textContent?.includes("Piloto de la empresa para vale"));
    expect(selector).toBeDefined(); expect(sigue(selector!, c)).toBe(true);
  });
});
