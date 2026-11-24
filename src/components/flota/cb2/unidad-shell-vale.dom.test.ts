// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { UnidadShellVale } from "./unidad-shell-vale";
import type { CatalogosCB2, FilaCB2 } from "./client";

const fila = (placa: string) => ({ perfil: "SHELL", vale: "0001", placa, placaNormalizada: placa, candidato: "k1", estado: "VALIDA", bloqueada: false, motivos: [], errores: [], origen: { piloto: "X Y", producto: "Diesel" } }) as unknown as FilaCB2;
const cat = (extra: Record<string, unknown> = {}) => ({ proveedores: [], vehiculos: [{ id: 1, placa: "C-570BZT", estado: "Activo" }], tercerosDirectos: true, ...extra }) as unknown as CatalogosCB2;
async function montar(f: FilaCB2, c: CatalogosCB2, vehiculoId = "", api: string | undefined = "/demo") {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host); const onUnidad = vi.fn(), recargar = vi.fn(async () => undefined);
  await act(async () => root.render(createElement(UnidadShellVale, { fila: f, cat: c, vehiculoId, api, recargar: api ? recargar : undefined, onUnidad })));
  return { host, onUnidad, recargar, limpiar: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const boton = (host: HTMLElement, t: string) => [...host.querySelectorAll("label")].find(l => l.textContent?.includes(t) && l.querySelector("input[type=checkbox]"))?.querySelector("input") as HTMLInputElement | undefined;

it("unidad no identificada: explica qué falta y NO registra nada hasta que se elige el tipo y se confirma; luego usa la identidad externa devuelta", async () => {
  const llamadas: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => { llamadas.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: 12, existente: false }), { status: 201, headers: { "Content-Type": "application/json" } }); }));
  const m = await montar(fila("C-123XYZ"), cat());
  try {
    expect(m.host.textContent).toContain("Unidad no identificada"); expect(m.host.textContent).toContain("«C-123XYZ»"); expect(m.host.textContent).toContain("No crea ningún vehículo en Flota");
    expect(boton(m.host, "Guardar como unidad externa para futuras importaciones")!.disabled).toBe(true); expect(llamadas).toHaveLength(0);
    const sel = m.host.querySelector("select")!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, "VEHICULO"); sel.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => boton(m.host, "Guardar como unidad externa para futuras importaciones")!.click());
    expect(llamadas).toHaveLength(1); expect(llamadas[0].url).toBe("/demo/terceros");
    expect(llamadas[0].body).toMatchObject({ recurso: "UNIDAD", referencia: "shell:C123XYZ", placa: "C-123XYZ", tipo: "VEHICULO" }); expect(String(llamadas[0].body.descripcion)).toContain("«C-123XYZ»");
    expect(m.recargar).toHaveBeenCalledTimes(1); expect(m.onUnidad).toHaveBeenCalledWith("-12");   // se elige la identidad externa, no un vehículo de Flota
  } finally { vi.unstubAllGlobals(); await m.limpiar(); }
});
it("placa sospechosa, sin forma de placa o configuración deshabilitada: no se ofrece registrar; unidad interna/externa/ambigua se describen", async () => {
  let m = await montar(fila("C-570BZS"), cat());   // casi igual a una unidad de Flota
  expect(m.host.textContent).toContain("Placa sospechosa"); expect(boton(m.host, "como unidad externa")).toBeUndefined(); await m.limpiar();
  m = await montar(fila("CANECA"), cat()); expect(boton(m.host, "como unidad externa")).toBeUndefined(); await m.limpiar();
  m = await montar(fila("C-123XYZ"), cat({ tercerosDirectos: false })); expect(m.host.textContent).toContain("deshabilitado por configuración"); expect(boton(m.host, "como unidad externa")).toBeUndefined(); await m.limpiar();
  m = await montar(fila("C-570BZT"), cat(), "1"); expect(m.host.textContent).toContain("Unidad interna"); await m.limpiar();
  m = await montar(fila("C-999EXT"), cat({ unidadesExternas: [{ id: 7, placa: "C-999EXT", referencia: "r", tipo: "VEHICULO", descripcion: "d" }] }), "-7"); expect(m.host.textContent).toContain("Unidad externa"); await m.limpiar();
  m = await montar(fila("570BZT"), cat({ vehiculos: [{ id: 1, placa: "C-570BZT", estado: "Activo" }, { id: 2, placa: "P-570BZT", estado: "Activo" }] })); expect(m.host.textContent).toContain("Unidad ambigua"); await m.limpiar();
});
it("un fallo del registro se muestra y no elige ninguna unidad; el doble clic no registra dos veces", async () => {
  const f = vi.fn(async () => { await new Promise(r => setTimeout(r, 20)); return new Response(JSON.stringify({ error: "Placa coincidente con unidades #3" }), { status: 409, headers: { "Content-Type": "application/json" } }); });
  vi.stubGlobal("fetch", f);
  const m = await montar(fila("C-123XYZ"), cat());
  try {
    const sel = m.host.querySelector("select")!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, "VEHICULO"); sel.dispatchEvent(new Event("change", { bubbles: true })); });
    const b = boton(m.host, "Guardar como unidad externa")!; await act(async () => { b.click(); b.click(); await new Promise(r => setTimeout(r, 60)); });
    expect(f).toHaveBeenCalledTimes(1); expect(m.host.textContent).toContain("Placa coincidente"); expect(m.onUnidad).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); await m.limpiar(); }
});
