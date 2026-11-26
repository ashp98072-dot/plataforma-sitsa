// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { IdentificarHistoricos } from "./identificar-historicos";

it("procesa lotes, conserva resultados parciales y solo guarda equivalencia tras completar proveedores", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  const pendientes = Array.from({ length: 5001 }, (_, i) => ({ id: i + 1, revision: 0 }));
  const vista = { nombre: "Jaime Calderon", empleado: { id: 8, nombre: "Jayme Calderón" }, empresaId: 1, proveedores: [
    { proveedorId: 3, pendientes, identificados: 1, conflictos: 1, conflictoIds: [7000] },
    { proveedorId: 4, pendientes: [{ id: 6000, revision: 0 }], identificados: 0, conflictos: 0, conflictoIds: [] },
  ] };
  let fallar = true;
  const llamadas: { ruta: string; body: { proveedorId: number; items?: unknown[]; clave?: string } }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const ruta = url.split("/").at(-1)!, body = JSON.parse(String(init.body)); llamadas.push({ ruta, body });
    if (ruta === "identificacion-vista") return { ok: true, json: async () => vista };
    if (ruta === "identificacion-confirmar" && body.proveedorId === 4 && fallar) { fallar = false; return { ok: false, status: 503, json: async () => ({ error: "Fallo temporal" }) }; }
    if (ruta === "identificacion-confirmar") return { ok: true, json: async () => ({ proveedorId: body.proveedorId, actualizados: body.items.length, repetidos: 0 }) };
    return { ok: true, json: async () => ({ requiereRevision: false }) };
  }));
  const host = document.createElement("div"); document.body.append(host); let root = createRoot(host);
  const props = { api: "/demo", r: { id: 1, proveedor_id: 3, piloto_informado: "Jaime Calderon" }, cat: { proveedores: [{ id: 3, nombre: "Uno" }, { id: 4, nombre: "Dos" }], vehiculos: [] }, empleado: "8", motivo: "Verificado con evidencia" };
  const boton = (s: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.includes(s))!;
  const control = (s: string) => [...host.querySelectorAll("label")].find(l => l.textContent?.includes(s))!.querySelector("input")!;
  try {
    await act(async () => root.render(createElement(IdentificarHistoricos, props)));
    await act(async () => control("Todos los consumos").click());
    await act(async () => control("Recordar equivalencia").click());
    await act(async () => boton("Consultar vista previa").click());
    expect(host.textContent).toContain("5001 pendientes"); expect(host.textContent).toContain("#7000");
    await act(async () => control("Confirmo la identificación").click());
    await act(async () => boton("Confirmar identificación").click());
    expect(host.textContent).toContain("21 de 22 lotes confirmados"); expect(host.textContent).toContain("Fallo temporal");
    expect(llamadas.some(x => x.ruta === "identificacion-recordar")).toBe(false);
    const fallo = llamadas.find(x => x.ruta === "identificacion-confirmar" && x.body.proveedorId === 4)!;
    expect(llamadas.filter(x => x.ruta === "identificacion-confirmar").every(x => x.body.items!.length <= 250)).toBe(true);
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => root.render(createElement(IdentificarHistoricos, props)));
    expect(host.textContent).toContain("21 de 22 lotes confirmados");
    await act(async () => control("Confirmo la identificación").click());
    await act(async () => boton("Confirmar identificación").click());
    const reintentos = llamadas.filter(x => x.ruta === "identificacion-confirmar" && x.body.proveedorId === 4);
    expect(reintentos).toHaveLength(2); expect(reintentos[1].body.clave).toBe(fallo.body.clave);
    expect(llamadas.filter(x => x.ruta === "identificacion-recordar")).toHaveLength(1);
    expect(host.textContent).toContain("22 de 22 lotes confirmados"); expect(host.textContent).toContain("Equivalencia guardada");
  } finally { await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); vi.unstubAllGlobals(); }
});
