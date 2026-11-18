// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PilotoShellVale } from "./revision-nombres";
import type { DecisionNombre, RevisionNombre } from "@/lib/flota/cb2/pilotos-nombres";

const edgar = { id: 33, nombre: "Edgar Palala", estado: "Activo" };
const andres = { id: 110, nombre: "Andrés Norberto Taracena Mayén", estado: "Baja", fechaBaja: "2026-06-30" };
const nombre = (extra: Partial<RevisionNombre>): RevisionNombre => ({ clave: "X", originales: ["X"], filas: 3, candidatos: [], elegibles: [], propuesta: null, ...extra });
async function montar(original: string, n: RevisionNombre, decision?: DecisionNombre) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host); const onElegir = vi.fn();
  await act(async () => root.render(createElement(PilotoShellVale, { original, nombre: n, decision, empleados: [edgar, andres], instalado: true, onElegir })));
  return { host, onElegir, limpiar: async () => { await act(async () => root.unmount()); host.remove(); } };
}
it("empleado ACTIVO reconocido automáticamente: se muestra preseleccionado con su nombre, sin exigir revisión", async () => {
  const m = await montar("EDGAR PALALA", nombre({ candidatos: [edgar], elegibles: [33], propuesta: { tipo: "EMPLEADO", empleadoId: 33, confirmado: false } }), { tipo: "EMPLEADO", empleadoId: 33, confirmado: false });
  expect(m.host.textContent).toContain("Edgar Palala · #33 reconocido automáticamente"); expect((m.host.querySelector("select") as HTMLSelectElement).value).toBe("33");
  expect(m.host.textContent).toContain("EDGAR PALALA"); expect(m.onElegir).not.toHaveBeenCalled(); await m.limpiar();
});
it("empleado de BAJA reconocido automáticamente: estado y fecha visibles; consumos posteriores solo avisan", async () => {
  const m = await montar("Andres Taracena", nombre({ candidatos: [andres], elegibles: [110], rango: { min: "2026-05-01", max: "2026-07-15" }, propuesta: { tipo: "EMPLEADO", empleadoId: 110, confirmado: false } }), { tipo: "EMPLEADO", empleadoId: 110, confirmado: false });
  expect(m.host.textContent).toContain("Andrés Norberto Taracena Mayén · #110 · Baja (2026-06-30) reconocido automáticamente"); expect(m.host.textContent).toContain("Empleado de baja desde 2026-06-30"); expect(m.host.textContent).toContain("posteriores a la fecha de baja");
  expect((m.host.querySelector("select") as HTMLSelectElement).value).toBe("110"); await m.limpiar();
});
it("homónimos / varias coincidencias: sin preselección y se exige elegir; el conflicto con una equivalencia antigua se advierte", async () => {
  const m = await montar("Andres Taracena", nombre({ candidatos: [edgar, andres], elegibles: [33, 110], propuesta: null, conflictoEquivalencia: { equivalenciaId: 75, reconocidoId: 110 } }));
  expect(m.host.textContent).toContain("Varios empleados coinciden"); expect(m.host.textContent).toContain("Conflicto"); expect((m.host.querySelector("select") as HTMLSelectElement).value).toBe("");
  const select = m.host.querySelector("select")!; await act(async () => { select.value = "110"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(m.onElegir).toHaveBeenCalledWith({ tipo: "EMPLEADO", empleadoId: 110, confirmado: true }); await m.limpiar();
});
