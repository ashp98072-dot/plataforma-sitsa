// @vitest-environment happy-dom
// Shell: el piloto se resuelve DESDE el vale (sin el panel global «Revisar pilotos por nombre distinto»).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImportarCB2 } from "./importar";
let host: HTMLDivElement, root: Root; const requests: FormData[] = [];
const fila = (candidato: string, placa: string, piloto: string, extra: Record<string, unknown> = {}) => ({ candidato, perfil: "SHELL", estado: "LISTA", bloqueada: false, placa, placaNormalizada: placa, vale: candidato, hoja: "Octubre", fila: 2, fecha: "2026-10-01", motivos: [], errores: [], moneda: "GTQ", origen: { producto: "Diesel", piloto }, ...extra });
const FILAS = [fila("1", "C-111AAA", "Andres Taracena"), fila("2", "C-222BBB", "  Visitante Nuevo "), fila("3", "570BZT", "Visitante Nuevo")];
const NOMBRES = [
  { clave: "ANDRES TARACENA", originales: ["Andres Taracena"], filas: 1, rango: { min: "2026-10-01", max: "2026-10-01", sinFecha: false }, candidatos: [{ id: 110, nombre: "Andrés Norberto Taracena Mayén", estado: "Baja", fechaBaja: "2026-12-31" }], elegibles: [110], propuesta: { tipo: "EMPLEADO", empleadoId: 110, confirmado: false } },
  { clave: "VISITANTE NUEVO", originales: ["  Visitante Nuevo ", "Visitante Nuevo"], filas: 2, candidatos: [], elegibles: [], propuesta: null },
];
const cat = { proveedores: [{ id: 83, nombre: "Proveedor" }], pilotosReportados: true, empleados: [{ id: 110, nombre: "Andrés Norberto Taracena Mayén", estado: "Baja", fechaBaja: "2026-12-31" }],
  vehiculos: [{ id: 1, placa: "C-111AAA", estado: "Activo" }, { id: 2, placa: "C-222BBB", estado: "Activo" }, { id: 3, placa: "C-570BZT", estado: "Activo" }, { id: 4, placa: "P-570BZT", estado: "Activo" }] };
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; requests.length = 0;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: FormData }) => { requests.push(init.body); return new Response(JSON.stringify(String(url).endsWith("/confirmar") ? { ok: true } : { perfilDetectado: "SHELL", sha256: "a".repeat(64), token: "recibo", filas: FILAS, nombres: NOMBRES, nota: "fixture" }), { status: 200, headers: { "Content-Type": "application/json" } }); }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const boton = (t: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.includes(t))!;
const control = (t: string) => { const l = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(t))!; return (l.querySelector("input,select") ?? document.getElementById(l.htmlFor)) as HTMLInputElement; };
const fijar = async (el: HTMLElement, valor: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, valor); el.dispatchEvent(new Event("change", { bubbles: true })); });
const estadoDe = (vale: string) => host.querySelector(`tr[data-candidato="${vale}"]`)!.textContent ?? "";

it("sin panel global; reconocido (baja) LISTO solo; desconocido PENDIENTE → piloto reportado desde el vale → LISTO; unidad ambigua sigue PENDIENTE; el servidor recibe nombre original y decisiones", async () => {
  await act(async () => root.render(createElement(ImportarCB2, { api: "/demo", cat: cat as never, run: async (_a, _d, f) => f("clave-sintetica-demo"), locked: false })));
  await act(async () => { const el = control("Excel original"); Object.defineProperty(el, "files", { value: [new File(["x"], "a.xlsx")], configurable: true }); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await fijar(control("Proveedor de la empresa"), "83");
  await act(async () => boton("Analizar Excel").click());
  expect(host.textContent).not.toContain("Revisar pilotos por nombre distinto"); expect(host.textContent).not.toContain("nombres sin coincidencia");
  expect(estadoDe("1")).toContain("LISTO"); expect(estadoDe("1")).toContain("Andrés Norberto Taracena Mayén (Baja)"); expect(estadoDe("1")).toContain("Reconocido automáticamente");
  expect(estadoDe("2")).toContain("PENDIENTE"); expect(estadoDe("2")).toContain("Piloto pendiente");
  // Resolver desde el vale 2: se muestra el nombre original y se confirma como piloto reportado (aplica también al vale 3, mismo nombre)
  await act(async () => (host.querySelector('tr[data-candidato="2"] button') as HTMLButtonElement).click());
  const detalle = host.querySelector('tr[id$="-2"]') ?? [...host.querySelectorAll("tr")].find(tr => tr.getAttribute("hidden") === null && tr.textContent?.includes("Piloto del Excel"))!;
  expect(detalle.textContent).toContain("Nombre original:"); expect(detalle.textContent).toContain("Visitante Nuevo");
  await act(async () => [...detalle.querySelectorAll("button")].find(b => b.textContent === "Guardar el nombre original como piloto reportado")!.click());
  expect(estadoDe("2")).toContain("LISTO"); expect(estadoDe("2")).toContain("Piloto reportado");
  // El vale 3 comparte nombre pero su placa coincide con dos unidades: el piloto ya está resuelto y SIGUE PENDIENTE hasta elegir la unidad
  expect(estadoDe("3")).toContain("Piloto reportado"); expect(estadoDe("3")).toContain("PENDIENTE");
  await act(async () => control("Confirmo el procesamiento parcial").click());
  await act(async () => boton("Confirmar selección parcial").click());
  const confirmar = requests.filter(f => f.has("clave")), sel = JSON.parse(String(confirmar[0].get("seleccion"))) as { candidato: string; empleadoId: number | null; decisionNombre: { tipo: string; empleadoId?: number; confirmado: boolean } }[];
  expect(confirmar).toHaveLength(1); expect(sel.map(s => s.candidato)).toEqual(["1", "2"]);
  expect(sel[0]).toMatchObject({ empleadoId: 110, decisionNombre: { tipo: "EMPLEADO", empleadoId: 110, confirmado: false } });   // reconocimiento automático (el servidor revalida)
  expect(sel[1]).toMatchObject({ empleadoId: null, decisionNombre: { tipo: "REPORTADO", confirmado: true } });
});
