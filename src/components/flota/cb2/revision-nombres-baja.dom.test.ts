// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RevisionNombresCB2 } from "./revision-nombres";
import type { DecisionNombre, RevisionNombre } from "@/lib/flota/cb2/pilotos-nombres";

const edgar = { id: 33, nombre: "Edgar Palala", estado: "Activo" };
const andres = { id: 50, nombre: "Andrés Norberto Taracena Mayén", estado: "Baja", fechaBaja: "2026-06-30" };
const NOMBRES: RevisionNombre[] = [
  { clave: "EDGAR PALALA", originales: ["Edgar Palala"], filas: 4, candidatos: [edgar], propuesta: { tipo: "EMPLEADO", empleadoId: 33, confirmado: false } },
  { clave: "ANDRES NORBERTO TARACENA MAYEN", originales: ["Andres Norberto Taracena Mayen"], filas: 5, rango: { min: "2026-05-01", max: "2026-07-15" }, candidatos: [andres], propuesta: null },
];
async function montar(decisiones: Record<string, DecisionNombre | undefined>) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host); const onChange = vi.fn();
  await act(async () => root.render(createElement(RevisionNombresCB2, { nombres: NOMBRES, decisiones, onChange, disabled: false, instalado: true, empleados: [edgar, andres] })));
  return { host, onChange, limpiar: async () => { await act(async () => root.unmount()); host.remove(); } };
}
it("Edgar Palala reconocido: muestra su nombre, deja preseleccionado el empleado y permite confirmarlo; el de baja muestra estado, fecha y advertencia, y exige confirmación manual", async () => {
  const m = await montar({ "EDGAR PALALA": { tipo: "EMPLEADO", empleadoId: 33, confirmado: false } });
  const secciones = [...m.host.querySelectorAll("section")];
  expect(secciones[0].textContent).toContain("Edgar Palala · #33 reconocido");
  const selEdgar = secciones[0].querySelector("select") as HTMLSelectElement; expect(selEdgar.value).toBe("33");
  const confirmar = secciones[0].querySelector("button") as HTMLButtonElement; expect(confirmar.disabled).toBe(false);
  await act(async () => confirmar.click()); expect(m.onChange).toHaveBeenCalledWith("EDGAR PALALA", { tipo: "EMPLEADO", empleadoId: 33, confirmado: true });
  const baja = secciones[1]; expect(baja.textContent).toContain("Requiere confirmación");
  const opciones = [...baja.querySelectorAll("option")].map(o => o.textContent);
  expect(opciones).toContain("Andrés Norberto Taracena Mayén · #50 · Baja (2026-06-30)");
  const sel = baja.querySelector("select") as HTMLSelectElement;
  await act(async () => { sel.value = "50"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(baja.textContent).toContain("Empleado de baja desde 2026-06-30"); expect(baja.textContent).toContain("consumos posteriores a la fecha de baja");
  await m.limpiar();
});
