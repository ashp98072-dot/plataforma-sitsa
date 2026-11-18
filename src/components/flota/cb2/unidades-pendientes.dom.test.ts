// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { UnidadesPendientesCB2 } from "./unidades-pendientes";
import { placasPendientes, referenciaUnidadShell } from "./placas-pendientes";
import type { CatalogosCB2, FilaCB2 } from "./client";

const fila = (candidato: string, placa: string) => ({ candidato, estado: "LISTA", bloqueada: false, placa, placaNormalizada: placa }) as unknown as FilaCB2;
const cat = { proveedores: [], vehiculos: [{ id: 1, placa: "C-125CCM" }, { id: 2, placa: "C-111AAA" }] } as unknown as CatalogosCB2;
const FILAS = [fila("1", "917 CDH"), fila("2", "917 CDH"), fila("3", "M-006LQN"), fila("4", "CANECA"), fila("5", "-"), fila("6", "125 CCN"), fila("7", "C-111AAA"), fila("8", "006LQN")];

it("clasifica placas desconocidas: registrables (con tipos permitidos) vs. textos y placas sospechosas que nunca se registran", () => {
  const { registrables, excluidas } = placasPendientes(FILAS, cat);
  expect(registrables.map(p => [p.placa, p.filas, p.tipos])).toEqual([["917 CDH", 2, ["VEHICULO", "MOTOCICLETA"]], ["M-006LQN", 1, ["MOTOCICLETA"]], ["006LQN", 1, ["VEHICULO", "MOTOCICLETA"]]]);
  expect(excluidas.map(x => x.texto).sort()).toEqual(["-", "125 CCN", "CANECA"]);
  expect(excluidas.find(x => x.texto === "125 CCN")!.motivo).toContain("C-125CCM");
  expect(referenciaUnidadShell("917 CDH")).toBe("shell:917CDH");
});
it("no registra nada sin elegir tipo; registra solo las marcadas con el tipo elegido y refresca el catálogo", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const posts: Record<string, unknown>[] = []; const recargar = vi.fn(async () => {});
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => { posts.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 9, existente: false }), { status: 200, headers: { "Content-Type": "application/json" } }); }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(UnidadesPendientesCB2, { api: "/demo", filas: FILAS, cat, recargar, disabled: false })));
  const reg = () => [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith("Registrar las"))! as HTMLButtonElement;
  expect(reg().disabled).toBe(true); expect(host.textContent).toContain("«CANECA»"); expect(host.textContent).toContain("«-»");
  const sel = (t: string) => [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(`Tipo de ${t}`))!.querySelector("select")! as HTMLSelectElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel("M-006LQN"), "MOTOCICLETA"); sel("M-006LQN").dispatchEvent(new Event("change", { bubbles: true })); });
  expect(reg().textContent).toContain("1 unidades"); await act(async () => { reg().click(); });
  expect(posts).toEqual([{ recurso: "UNIDAD", referencia: "shell:M006LQN", placa: "M-006LQN", tipo: "MOTOCICLETA", descripcion: "Unidad externa registrada desde la importación Shell" }]);
  expect(recargar).toHaveBeenCalledTimes(1); expect(host.textContent).toContain("1 unidades externas registradas");
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});
