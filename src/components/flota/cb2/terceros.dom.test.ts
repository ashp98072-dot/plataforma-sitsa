// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TercerosCB2 } from "./terceros";
import type { CatalogosCB2 } from "./client";
import type { CatalogosTerceros } from "@/lib/flota/cb2/terceros-model";
let host: HTMLDivElement, root: Root;
let catalogos: CatalogosTerceros;
const cat: CatalogosCB2 = { proveedores: [], vehiculos: [], tercerosHabilitados: true };
const a = { id: 31, piloto_id: 11, unidad_id: 21, nombre: "Piloto ficticio", placa: "060 KHK", tipo: "MOTOCICLETA", descripcion: "Ficticia", relacion: "CONTRATISTA", estado: "PENDIENTE", revision: 0, piloto_referencia: "p-ficticio", unidad_referencia: "u-ficticia", creado_por: 9, verificado_por: null };
const fetch = vi.fn();
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  catalogos = { pilotos: [{ id: 11, referencia: "p-ficticio", nombre: "Piloto ficticio" }], unidades: [{ id: 21, referencia: "u-ficticia", placa: "060 KHK", tipo: "MOTOCICLETA", descripcion: "Ficticia" }], asociaciones: [a] };
  fetch.mockReset(); fetch.mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method ? { id: 31, estado: "VERIFICADA" } : catalogos), { headers: { "Content-Type": "application/json" } })); vi.stubGlobal("fetch", fetch);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (actorId = 9, admin = true, catalogo = cat) => act(async () => root.render(createElement(TercerosCB2, { api: "/api/demo", cat: catalogo, admin, actorId, recargar: vi.fn() })));
const form = (label: string) => host.querySelector<HTMLFormElement>(`form[aria-label="${label}"]`)!;
async function submit(f: HTMLFormElement) { await act(async () => f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
function fill(f: HTMLFormElement, fields: Record<string, string>) { for (const [name, value] of Object.entries(fields)) (f.elements.namedItem(name) as HTMLInputElement).value = value; }
async function seleccionar(label: string, value: string) {
  const l = [...host.querySelectorAll("label")].find(l => l.textContent === label)!;
  const s = document.getElementById(l.htmlFor) as HTMLSelectElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(s, value); s.dispatchEvent(new Event("change", { bubbles: true })); });
}
const escrituras = () => fetch.mock.calls.filter(([, init]) => init?.method);
it("D2 apagada no muestra altas ni realiza solicitudes", async () => {
  await render(9, true, { ...cat, tercerosHabilitados: false }); expect(host.textContent).toContain("deshabilitados"); expect(host.querySelector("form")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
});
it("muestra tres secciones, identidades sin asociación y ningún selector de proveedor", async () => {
  catalogos.asociaciones = []; await render();
  for (const label of ["Pilotos tercerizados", "Vehículos y motocicletas tercerizados", "Asociaciones tercerizadas"]) expect(host.querySelector(`section[aria-label="${label}"]`)).not.toBeNull();
  expect(host.textContent).toContain("p-ficticio"); expect(host.textContent).toContain("u-ficticia"); expect(host.querySelector('[name="proveedorId"]')).toBeNull(); expect(host.textContent).not.toContain("Proveedor");
});
it("alta de piloto y unidad son independientes y no envian proveedor ni asociación", async () => {
  await render(); const piloto = form("Registrar piloto tercerizado"); fill(piloto, { referencia: "ref-real-introducida", nombre: "Piloto sintético" }); await submit(piloto);
  expect(JSON.parse(escrituras()[0][1].body)).toEqual({ recurso: "PILOTO", referencia: "ref-real-introducida", nombre: "Piloto sintético" });
  const unidad = form("Registrar unidad tercerizada"); fill(unidad, { referencia: "ref-unidad-introducida", placa: "061 KHK", descripcion: "Moto sintética", tipo: "MOTOCICLETA" }); await submit(unidad);
  expect(JSON.parse(escrituras()[1][1].body)).toEqual({ recurso: "UNIDAD", referencia: "ref-unidad-introducida", placa: "061 KHK", descripcion: "Moto sintética", tipo: "MOTOCICLETA" });
});
it("asocia IDs ya registrados y permite reutilizar piloto con otra unidad", async () => {
  catalogos.unidades.push({ id: 22, referencia: "u-dos", placa: "061 KHK", tipo: "VEHICULO", descripcion: "Ficticia dos" }); await render();
  await seleccionar("Piloto registrado", "11"); await seleccionar("Unidad registrada", "21");
  fill(form("Crear asociación tercerizada"), { evidencia: "respaldo verificado", relacion: "CONTRATISTA" }); await submit(form("Crear asociación tercerizada"));
  expect(JSON.parse(escrituras()[0][1].body)).toEqual({ recurso: "ASOCIACION", pilotoId: 11, unidadId: 21, relacion: "CONTRATISTA", evidencia: "respaldo verificado" });
  await seleccionar("Unidad registrada", "22"); await submit(form("Crear asociación tercerizada"));
  expect(JSON.parse(escrituras()[1][1].body)).toMatchObject({ pilotoId: 11, unidadId: 22 });
});
it("el creador no autoverifica ni mediante submit directo", async () => {
  await render(); const f = form("Revisar asociación 31"), estado = f.elements.namedItem("estado") as HTMLSelectElement;
  expect(estado.options[0].disabled).toBe(true); estado.value = "VERIFICADA"; await submit(f);
  expect(escrituras()).toHaveLength(0); expect(host.querySelector('[role="alert"]')?.textContent).toContain("otro administrador");
});
it("otro administrador verifica sin proveedor y sin poder cambiar el creador", async () => {
  await render(10); await submit(form("Revisar asociación 31"));
  expect(JSON.parse(escrituras()[0][1].body)).toEqual({ id: 31, revision: 0, estado: "VERIFICADA" }); expect(host.textContent).toContain("Vuelve a analizar el Excel");
});
it("solo consulta para no administradores; búsquedas no crean identidades", async () => {
  await render(10, false); expect(host.querySelector("form")).toBeNull(); expect(host.textContent).toContain("Piloto ficticio"); expect(escrituras()).toHaveLength(0);
  const section = host.querySelector('section[aria-label="Pilotos tercerizados"]')!, campo = section.querySelector("input")!;
  for (const [busqueda, cantidad] of [["sin coincidencias", 0], ["p-ficticio", 1]] as const) {
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, busqueda); campo.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(section.querySelectorAll("li")).toHaveLength(cantidad);
  }
  expect(escrituras()).toHaveLength(0);
});
