// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrototipoExternos } from "./prototipo";
import { catalogoSintetico } from "./fixtures";
import type { Catalogo } from "./contratos";
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function elegir(label: string, value: string) {
  const control = [...host.querySelectorAll("label")].find(e => e.firstChild?.textContent === label)?.querySelector("select") as HTMLSelectElement;
  expect(control).toBeTruthy(); await act(async () => { control.value = value; control.dispatchEvent(new Event("change", { bubbles: true })); });
}
it.each([["EMPLEADO", "CATALOGO"], ["EMPLEADO", "EXTERNO"], ["EXTERNO", "CATALOGO"], ["EXTERNO", "EXTERNO"]])("visualiza %s/%s con cero red/escrituras", async (conductor, vehiculo) => {
  const fetch = vi.fn(() => { throw new Error("Red prohibida"); }), xhr = vi.fn(() => { throw new Error("XHR prohibido"); });
  vi.stubGlobal("fetch", fetch); vi.stubGlobal("XMLHttpRequest", xhr);
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Persistencia prohibida"); });
  try {
    await act(async () => root.render(createElement(PrototipoExternos)));
    await elegir("Tipo conductor", conductor); await elegir("Identidad conductor", conductor === "EMPLEADO" ? "11" : "31");
    await elegir("Tipo vehículo", vehiculo); await elegir("Identidad vehículo", vehiculo === "CATALOGO" ? "101" : "301");
    expect(host.querySelector("output")?.textContent).toBe("SIMULACION_VALIDA");
    const button = host.querySelector("button")!; expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(fetch).not.toHaveBeenCalled(); expect(xhr).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    expect(host.querySelector("form")).toBeNull();
  } finally { storage.mockRestore(); }
});
it("muestra externo pendiente y NO_IDENTIFICADO sin confirmar", async () => {
  await act(async () => root.render(createElement(PrototipoExternos)));
  await elegir("Tipo conductor", "EXTERNO"); await elegir("Identidad conductor", "32");
  expect(host.querySelector('[data-codigo="EXTERNO_NO_VALIDADO"]')).not.toBeNull();
  await elegir("Tipo conductor", "NO_IDENTIFICADO");
  expect(host.querySelector('[data-codigo="CONDUCTOR_NO_IDENTIFICADO"]')).not.toBeNull();
});
it("conserva homónimos separados, bloquea inactivos y admite compartido autorizado", async () => {
  await act(async () => root.render(createElement(PrototipoExternos)));
  const opciones = [...host.querySelectorAll("option")].map(e => e.textContent);
  expect(opciones.filter(e => e?.includes("Homónimo"))).toHaveLength(2);
  expect(opciones.some(e => e?.includes("Persona B"))).toBe(false);
  await elegir("Identidad conductor", "11"); await elegir("Identidad vehículo", "202");
  expect(host.querySelector("output")?.textContent).toBe("SIMULACION_VALIDA");
  await elegir("Identidad conductor", "14");
  expect(host.querySelector('[data-codigo="EMPLEADO_NO_DISPONIBLE"]')).not.toBeNull();
  await elegir("Tipo conductor", "EXTERNO"); await elegir("Identidad conductor", "33");
  expect(host.querySelector('[data-codigo="EXTERNO_NO_VALIDADO"]')).not.toBeNull();
  expect(host.querySelector("button")?.disabled).toBe(true);
});
it("cambiar empresa descarta una selección previamente válida", async () => {
  await act(async () => root.render(createElement(PrototipoExternos)));
  await elegir("Identidad conductor", "11"); await elegir("Identidad vehículo", "101");
  expect(host.querySelector("output")?.textContent).toBe("SIMULACION_VALIDA");
  await elegir("Empresa", "B");
  expect(host.querySelector("output")?.textContent).toBe("BLOQUEADO");
  expect(host.textContent).not.toContain("Persona A");
});
it.each(["resolver", "rechazar"])("descarta respuesta A antigua al %s después de B", async modo => {
  let resolver!: (cat: Catalogo) => void, rechazar!: (err: Error) => void;
  const antigua = new Promise<Catalogo>((resolve, reject) => { resolver = resolve; rechazar = reject; });
  const cargar = vi.fn((empresa: string) => empresa === "A" ? antigua : Promise.resolve(catalogoSintetico));
  await act(async () => root.render(createElement(PrototipoExternos, { cargar })));
  await elegir("Empresa", "B"); await elegir("Identidad conductor", "22"); await elegir("Identidad vehículo", "201");
  await act(async () => { if (modo === "resolver") resolver(catalogoSintetico); else rechazar(new Error("Error A antiguo")); });
  expect(host.querySelector('[role="alert"]')).toBeNull(); expect(host.querySelector("output")?.textContent).toBe("SIMULACION_VALIDA");
  expect(host.textContent).not.toContain("Persona A"); expect(host.textContent).not.toContain("Cargando");
});
it("volver a A no recupera selección ni respuesta de una instancia anterior", async () => {
  let resolver!: (cat: Catalogo) => void;
  const antigua = new Promise<Catalogo>(resolve => { resolver = resolve; }); let llamadas = 0;
  const cargar = vi.fn(() => ++llamadas === 1 ? antigua : Promise.resolve(catalogoSintetico));
  await act(async () => root.render(createElement(PrototipoExternos, { cargar })));
  await elegir("Empresa", "B"); await elegir("Empresa", "A");
  await act(async () => resolver({ ...catalogoSintetico, empleados: [] }));
  expect(host.textContent).toContain("Persona A"); expect(host.querySelector("output")?.textContent).toBe("BLOQUEADO");
});
