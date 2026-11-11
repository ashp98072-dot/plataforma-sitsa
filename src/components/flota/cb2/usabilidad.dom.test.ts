// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CandidatosCB2, ResumenSeleccionCB2 } from "./preview-vista";
import { DuplicadosVehiculos } from "./duplicados";
import type { FilaCB2, CatalogosCB2 } from "./client";
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const f: FilaCB2 = { hoja: "Ficticia", fila: 2, candidato: "a", bloqueada: false, documento: null, errores: [], estado: "VALIDA", motivos: [], vale: "FICT-001", placa: "C-001ABC", placaNormalizada: "C-001ABC", fecha: "2026-11-01", galones: "10", precio: "20", monto: "200", moneda: "GTQ" };
const cat: CatalogosCB2 = { proveedores: [], vehiculos: [{ id: 1, placa: "C-001ABC" }, { id: 2, placa: "C-002ABC" }] };
async function click(label: string) { const b = [...host.querySelectorAll("button")].find(b => b.textContent === label); expect(b).toBeDefined(); await act(async () => b!.click()); }
it("resumen identifica cada vale, placa y causa; no oculta bloqueados sin seleccion", async () => {
  await act(async () => root.render(createElement(ResumenSeleccionCB2, { filas: [f, { ...f, candidato: "b", vale: "FICT-002", bloqueada: true, motivos: ["CONFLICTO_HISTORICO: carga interna previa"] }], cat, seleccion: { a: "2" }, onCorregir: vi.fn() })));
  const problemas = host.querySelector('[aria-label="Asignaciones que requieren corrección"]')!;
  expect(problemas.textContent).toContain("Vale FICT-001 · Placa C-001ABC"); expect(problemas.textContent).toContain("no coincide inequívocamente"); expect(problemas.textContent).toContain("Vale FICT-002"); expect(problemas.textContent).toContain("carga interna previa");
  expect(problemas.querySelectorAll("button")).toHaveLength(2);
});
it("Solo problemas filtra sin cambiar asignaciones; Ir a corregir limpia filtros y abre otra pagina", async () => {
  const filas = Array.from({ length: 27 }, (_, i) => ({ ...f, fila: i + 2, candidato: `c${i}`, vale: `FICT-${i}`, ...(i === 26 ? { bloqueada: true, motivos: ["Conflicto ficticio"] } : {}) }));
  const seleccion = Object.fromEntries(filas.map((f, i) => [f.candidato, i === 26 ? "2" : "1"]));
  function App() {
    const [corregir, setCorregir] = useState<{ clave: string; intento: number }>();
    return createElement("div", null, createElement(CandidatosCB2, { filas, cat, seleccion, corregir }), createElement(ResumenSeleccionCB2, { filas, cat, seleccion, onCorregir: clave => setCorregir(p => ({ clave, intento: (p?.intento ?? 0) + 1 })) }));
  }
  await act(async () => root.render(createElement(App)));
  await click("Solo problemas"); expect(host.querySelectorAll("tr[data-candidato]")).toHaveLength(1); expect(host.querySelector("tr[data-candidato]")?.getAttribute("data-candidato")).toBe("c26");
  await click("Ir a corregir vale FICT-26");
  const fila = host.querySelector('tr[data-candidato="c26"]')!;
  expect(fila).not.toBeNull(); expect(fila.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(fila.querySelector("button")); expect(seleccion.c0).toBe("1"); expect(seleccion.c26).toBe("2");
});
it("herramienta muestra IDs y referencias; no ofrece desactivar un registro vinculado", async () => {
  const v = { id: 10, empresaId: 1, placa: "C-001ABC", tipo: "VEHICULO", descripcion: "Ficticio", marca: "Demo", modelo: "2026", chasis: "FICTICIO", sucursal: "No registrada", estado: "Activo", activo: true, propio: true, revision: "a".repeat(64) };
  const fetch = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes("?id=") ? { vehiculo: v, referencias: [{ tabla: "flota_viajes", campo: "vehiculo_id", cantidad: 3, ids: [7, 8, 9] }], puedeDesactivar: false, motivos: ["Referencias históricas preservadas"] } : [{ placa: "C001ABC", vehiculos: [v, { ...v, id: 20 }] }]), { headers: { "Content-Type": "application/json" } })); vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(createElement(DuplicadosVehiculos, { api: "/api/demo", activo: true, recargar: vi.fn() })));
  expect(host.textContent).toContain("Registro #10"); expect(host.textContent).toContain("Registro #20"); expect(host.textContent).toContain("Sucursal: No registrada");
  await click("Revisar referencias del ID #10"); expect(host.textContent).toContain("3 referencias"); expect(host.textContent).toContain("#7, #8, #9");
  expect([...host.querySelectorAll("button")].some(b => b.textContent?.startsWith("Desactivar únicamente"))).toBe(false);
  expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});
