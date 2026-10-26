// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PropiedadFields, type PropiedadForm } from "@/app/e/[slug]/flota/propiedad-fields";
import { useProtegerFormulario } from "./use-proteger-formulario";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it("externo → propio usa administradora, conserva nombre externo al alternar, sin usuarios", async () => {
  function Wrapper() {
    const [value, setValue] = useState<PropiedadForm>({ tipoPropiedad: "EXTERNO", empresaPropietariaId: null, propietarioExterno: "Mensajero de varias empresas", tipoVehiculo: "Motocicleta" });
    return createElement(PropiedadFields, { value, onChange: setValue, empresaAdministradoraId: 3, empresas: [{ id: 1, nombre: "Primera, ajena" }, { id: 3, nombre: "Administradora" }], input: "" });
  }
  await act(async () => root.render(createElement(Wrapper)));
  const tipo = () => host.querySelector("select")!;
  await act(async () => { tipo().value = "EMPRESA"; tipo().dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelectorAll("select")[1].value).toBe("3");
  await act(async () => { tipo().value = "EXTERNO"; tipo().dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector("input")!.value).toBe("Mensajero de varias empresas");
  expect(host.querySelectorAll("select")).toHaveLength(1); expect(host.textContent).toContain("no recibe acceso");
});
it("cierre/cambio de unidad puede cancelarse y no navega con cambios pendientes", async () => {
  let continuar = false;
  function Wrapper({ pendiente, bloqueado = false }: { pendiente: boolean; bloqueado?: boolean }) {
    const confirmar = useProtegerFormulario(pendiente, bloqueado);
    return createElement("button", { onClick: () => { continuar = confirmar(); } }, "Cambiar unidad");
  }
  const confirm = vi.fn().mockReturnValue(false);
  Object.defineProperty(window, "confirm", { value: confirm, configurable: true, writable: true });
  await act(async () => root.render(createElement(Wrapper, { pendiente: true })));
  await act(async () => host.querySelector("button")!.click()); expect(continuar).toBe(false);
  const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  const link = document.createElement("a"); link.href = "/otra"; host.append(link);
  expect(link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).toBe(false);
  confirm.mockReturnValue(true); await act(async () => host.querySelector("button")!.click()); expect(continuar).toBe(true);
  await act(async () => root.render(createElement(Wrapper, { pendiente: false, bloqueado: true })));
  await act(async () => host.querySelector("button")!.click()); expect(continuar).toBe(false);
});
