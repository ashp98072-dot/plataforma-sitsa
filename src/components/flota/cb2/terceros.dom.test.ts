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
