// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TercerosCB2 } from "./terceros";
import type { CatalogosCB2 } from "./client";
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const cat: CatalogosCB2 = { proveedores: [{ id: 3, nombre: "Proveedor sintético" }], vehiculos: [] };
it("D2 apagada no presenta altas, verificación ni solicitudes de red", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(createElement(TercerosCB2, { api: "/api/demo", cat, admin: true, recargar: vi.fn() })));
  expect(host.textContent).toContain("deshabilitados"); expect(host.querySelector("form")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
});
it("alta envía referencias estables y moto; refresca catálogo sin crear empleados", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 31 }), { status: 201, headers: { "Content-Type": "application/json" } })); vi.stubGlobal("fetch", fetch);
  const recargar = vi.fn();
  await act(async () => root.render(createElement(TercerosCB2, { api: "/api/demo", cat: { ...cat, tercerosHabilitados: true }, admin: true, recargar })));
  for (const [name, value] of Object.entries({ pilotoReferencia: "ref-piloto", nombre: "Piloto sintético", unidadReferencia: "ref-moto", placa: "060 KHK", descripcion: "Reparto", evidencia: "Expediente" })) (host.querySelector(`[name="${name}"]`) as HTMLInputElement).value = value;
  (host.querySelector('[name="tipo"]') as HTMLSelectElement).value = "MOTOCICLETA";
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ proveedorId: 3, pilotoReferencia: "ref-piloto", unidadReferencia: "ref-moto", tipo: "MOTOCICLETA" });
  expect(recargar).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
});
it("la cuenta creadora no puede verificar ni con submit directo del formulario", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const a = { id: 31, piloto_id: 11, unidad_id: 21, nombre: "Piloto ficticio", placa: "060 KHK", tipo: "MOTOCICLETA", descripcion: "Ficticia", relacion: "CONTRATISTA", estado: "PENDIENTE", revision: 0, piloto_referencia: "p-ficticio", unidad_referencia: "u-ficticia", creado_por: 9, verificado_por: null };
  await act(async () => root.render(createElement(TercerosCB2, { api: "/api/demo", cat: { ...cat, tercerosHabilitados: true, terceros: [a] }, admin: true, actorId: 9, recargar: vi.fn() })));
  expect(host.textContent).toContain("misma cuenta no cambia su ID");
  const estado = host.querySelector('[name="estado"]') as HTMLSelectElement;
  expect(estado.options[0].disabled).toBe(true);
  estado.value = "VERIFICADA";
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(fetch).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain("otro administrador");
});
it("otro administrador envía la verificación con revisión y sin identidad del creador manipulable", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 31, estado: "VERIFICADA" }), { headers: { "Content-Type": "application/json" } })); vi.stubGlobal("fetch", fetch);
  const a = { id: 31, piloto_id: 11, unidad_id: 21, nombre: "Piloto ficticio", placa: "060 KHK", tipo: "MOTOCICLETA", descripcion: "Ficticia", relacion: "CONTRATISTA", estado: "PENDIENTE", revision: 0, piloto_referencia: "p-ficticio", unidad_referencia: "u-ficticia", creado_por: 9, verificado_por: null };
  await act(async () => root.render(createElement(TercerosCB2, { api: "/api/demo", cat: { ...cat, tercerosHabilitados: true, terceros: [a] }, admin: true, actorId: 10, recargar: vi.fn() })));
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ proveedorId: 3, id: 31, revision: 0, estado: "VERIFICADA" }); expect(host.textContent).toContain("Vuelve a analizar el Excel");
});
