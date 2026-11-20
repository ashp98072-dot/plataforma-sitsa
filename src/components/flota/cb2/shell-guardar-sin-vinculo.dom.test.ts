// @vitest-environment happy-dom
// Importar → Vista previa → Guardar: un vale Shell con placa AMBIGUA y otro con placa SIN unidad en Flota quedan LISTOS sin elegir unidad y se envían sin vincular.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImportarCB2 } from "./importar";
let host: HTMLDivElement, root: Root; const requests: FormData[] = [];
const fila = (candidato: string, placa: string, piloto: string, extra: Record<string, unknown> = {}) => ({ candidato, perfil: "SHELL", estado: "LISTA", bloqueada: false, placa, placaNormalizada: placa, vale: candidato, hoja: "Octubre", fila: 2, fecha: "2026-10-01", motivos: [], errores: [], moneda: "GTQ", origen: { producto: "Diesel", piloto }, ...extra });
const FILAS = [fila("1", "C-591LAB", "Rene Baja Vinculo"), fila("2", "C-593LAB", "Visitante Sin Registro"), fila("3", "C-592LAB", "Visitante Sin Registro")];
const NOMBRES = [
  { clave: "RENE BAJA VINCULO", originales: ["Rene Baja Vinculo"], filas: 1, candidatos: [{ id: 9901, nombre: "Rene Baja Vinculo", estado: "Baja" }], elegibles: [9901], propuesta: { tipo: "EMPLEADO", empleadoId: 9901, confirmado: false } },
  { clave: "VISITANTE SIN REGISTRO", originales: ["Visitante Sin Registro"], filas: 2, candidatos: [], elegibles: [], propuesta: null },
];
const cat = (extra: Record<string, unknown> = {}) => ({ proveedores: [{ id: 83, nombre: "Proveedor" }], pilotosReportados: true, vinculoUnidad: true, empleados: [{ id: 9901, nombre: "Rene Baja Vinculo", estado: "Baja" }],
  vehiculos: [{ id: 1, placa: "C-591LAB", estado: "Activo" }, { id: 2, placa: "C 591LAB", estado: "Activo" }, { id: 3, placa: "C-592LAB", estado: "Activo" }], ...extra });
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; requests.length = 0;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: FormData }) => { requests.push(init.body); return new Response(JSON.stringify(String(url).endsWith("/confirmar") ? { ok: true } : { perfilDetectado: "SHELL", sha256: "a".repeat(64), token: "recibo", filas: FILAS, nombres: NOMBRES, nota: "fixture" }), { status: 200, headers: { "Content-Type": "application/json" } }); }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const boton = (t: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.includes(t))!;
const control = (t: string) => { const l = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(t))!; return (l.querySelector("input,select") ?? document.getElementById(l.htmlFor)) as HTMLInputElement; };
const fijar = async (el: HTMLElement, valor: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, valor); el.dispatchEvent(new Event("change", { bubbles: true })); });
const fila_ = (vale: string) => host.querySelector(`tr[data-candidato="${vale}"]`)!.textContent ?? "";
async function analizar(c: Record<string, unknown>) {
  await act(async () => root.render(createElement(ImportarCB2, { api: "/demo", cat: c as never, run: async (_a, _d, f) => f("clave-sintetica-demo"), locked: false })));
  await act(async () => { const el = control("Excel original"); Object.defineProperty(el, "files", { value: [new File(["x"], "a.xlsx")], configurable: true }); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await fijar(control("Proveedor de la empresa"), "83");
  await act(async () => boton("Analizar Excel").click());
}

it("con la migración: ambigua y sin unidad quedan LISTAS sin elegir unidad, con la placa original visible; se envían con vehiculoId 0 + vinculoUnidad; el empleado de baja se conserva", async () => {
  await analizar(cat());
  expect(fila_("1")).toContain("LISTO"); expect(fila_("1")).toContain("Placa ambigua · se guarda sin vincular"); expect(fila_("1")).toContain("C-591LAB");
  // El vale 2 ya trae la unidad resuelta (sin vincular), pero su piloto desconocido sigue pendiente: no basta con la unidad.
  expect(fila_("2")).toContain("Sin unidad en Flota · se guarda sin vincular"); expect(fila_("2")).toContain("PENDIENTE"); expect(fila_("2")).toContain("Piloto pendiente");
  expect(fila_("3")).toContain("C-592LAB");   // una única unidad de Flota: se vincula sola
  // El piloto desconocido se confirma una vez desde el vale 2 (aplica a las 2 filas con ese nombre)
  await act(async () => (host.querySelector('tr[data-candidato="2"] button') as HTMLButtonElement).click());
  const detalle = [...host.querySelectorAll("tr")].find(tr => tr.getAttribute("hidden") === null && tr.textContent?.includes("Piloto del Excel") && tr.textContent?.includes("Unidad sin vincular") === false)!;
  await act(async () => [...detalle.querySelectorAll("button")].find(b => b.textContent === "Guardar el nombre original como piloto reportado")!.click());
  expect(fila_("2")).toContain("LISTO"); expect(fila_("3")).toContain("LISTO");
  await act(async () => control("Confirmo el procesamiento").click());
  await act(async () => boton("Confirmar selección parcial").click());
  const confirmar = requests.filter(f => f.has("clave")); expect(confirmar).toHaveLength(1);
  const sel = JSON.parse(String(confirmar[0].get("seleccion"))) as { candidato: string; vehiculoId: number; vinculoUnidad?: string; empleadoId?: number | null; decisionNombre?: { tipo: string } }[];
  const por = Object.fromEntries(sel.map(s => [s.candidato, s]));
  expect(por["1"]).toMatchObject({ vehiculoId: 0, vinculoUnidad: "AMBIGUA", empleadoId: 9901 });
  expect(por["2"]).toMatchObject({ vehiculoId: 0, vinculoUnidad: "SIN_VINCULO", decisionNombre: { tipo: "REPORTADO" } });
  expect(por["3"]).toMatchObject({ vehiculoId: 3 }); expect(por["3"].vinculoUnidad).toBeUndefined();   // una única unidad de Flota: se vincula, nunca «sin vincular»
});

it("SIN la migración: la unidad ambigua/desconocida sigue pendiente (comportamiento anterior) y nada se envía sin vincular", async () => {
  await analizar(cat({ vinculoUnidad: false }));
  expect(fila_("1")).toContain("PENDIENTE"); expect(fila_("2")).toContain("PENDIENTE");
  expect(host.textContent).not.toContain("se guarda sin vincular");
});
