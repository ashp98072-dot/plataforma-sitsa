// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { AsignacionCB2, type DecisionAsignacion } from "./asignacion";
import type { CatalogosCB2, FilaCB2 } from "./client";

it("vale 19955: consulta identidades huérfanas, filtra placa abreviada y exige asociación D2", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const cat: CatalogosCB2 = { proveedores: [], vehiculos: [], tercerosHabilitados: true, terceros: [], pilotosExternos: [{ id: 11, nombre: "Luís Escobar", referencia: "lab-p" }], unidadesExternas: [{ id: 21, placa: "M-060KHK", referencia: "lab-u", tipo: "MOTOCICLETA", descripcion: "Ficticia" }] };
  const fila = { vale: "19955", origen: { piloto: "Luis Escobar" } } as FilaCB2;
  let value: DecisionAsignacion = {};
  const render = () => root.render(createElement(AsignacionCB2, { fila, cat, value, disabled: false, onChange: v => { value = v; render(); } }));
  async function cambiar(label: string, nuevo: string, input = false) {
    const l = [...host.querySelectorAll("label")].find(l => l.textContent === label)!;
    const el = document.getElementById(l.htmlFor)!;
    await act(async () => { Object.getOwnPropertyDescriptor(input ? HTMLInputElement.prototype : HTMLSelectElement.prototype, "value")!.set!.call(el, nuevo); el.dispatchEvent(new Event(input ? "input" : "change", { bubbles: true })); });
  }
  try {
    await act(async () => render());
    await cambiar("Buscar piloto tercerizado para vale 19955", "luis  ESCOBAR", true);
    expect(host.textContent).toContain("Luís Escobar");
    await cambiar("Piloto tercerizado para vale 19955", "11");
    await cambiar("Buscar unidad tercerizada para vale 19955", "060 KHK", true);
    expect(host.textContent).toContain("M-060KHK");
    await cambiar("Unidad tercerizada para vale 19955", "21");
    expect(value).toMatchObject({ pilotoExternoId: 11, unidadExternaId: 21, asociacionExternaId: null, empleadoId: null });
    expect(host.textContent).toContain("Consumo PENDIENTE");
    cat.terceros = [{ id: 31, piloto_id: 11, unidad_id: 21, nombre: "Luís Escobar", placa: "M-060KHK", tipo: "MOTOCICLETA", descripcion: "Ficticia", relacion: "CONTRATISTA", estado: "VERIFICADA", revision: 1, piloto_referencia: "lab-p", unidad_referencia: "lab-u" }];
    await act(async () => render()); await cambiar("Unidad tercerizada para vale 19955", "21");
    expect(value.asociacionExternaId).toBe(31);
    cat.terceros[0].estado = "REVOCADA"; await act(async () => render());
    await cambiar("Unidad tercerizada para vale 19955", "21");
    expect(value.asociacionExternaId).toBeNull(); expect(host.textContent).toContain("Consumo PENDIENTE");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
