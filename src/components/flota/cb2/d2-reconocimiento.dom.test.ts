// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ImportarCB2 } from "./importar";
import type { CatalogosCB2 } from "./client";

it("al reanalizar actualiza catalogo: PENDIENTE pasa a LISTO solo tras verificacion independiente", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let verificada = false;
  const a = { id: 31, piloto_id: 11, unidad_id: 21, nombre: "Piloto Ficticio", placa: "060 KHK", tipo: "MOTOCICLETA", descripcion: "Moto ficticia", relacion: "CONTRATISTA", estado: "VERIFICADA", revision: 1, piloto_referencia: "ficticio-p", unidad_referencia: "ficticio-u", creado_por: 9, verificado_por: 10 };
  const inicial: CatalogosCB2 = { tercerosHabilitados: true, proveedores: [{ id: 1, nombre: "Ficticio" }], vehiculos: [], terceros: [{ ...a, estado: "PENDIENTE", verificado_por: null }] };
  const candidato = "a".repeat(64);
  const fila = { hoja: "Ficticia", fila: 2, candidato, bloqueada: false, documento: null, errores: [], estado: "ADVERTENCIA", motivos: ["Serie/factura incompleta"], vale: "FICTICIO-001", placa: "060-KHK", placaNormalizada: "060 KHK", fecha: "2026-11-01", galones: "10", precio: "20", monto: "200", moneda: "GTQ", origen: { piloto: "PILOTO FICTICIO", producto: "DIESEL" } };
  const actualizaciones = vi.fn();
  const fetch = vi.fn(async () => new Response(JSON.stringify({ perfilDetectado: "HALEL", sha256: "b".repeat(64), token: "ficticio", nota: "", filas: [{ ...fila, asociacionExterna: verificada ? a : null }] }), { headers: { "Content-Type": "application/json" } })); vi.stubGlobal("fetch", fetch);
  const run = vi.fn();
  function App() {
    const [cat, setCat] = useState(inicial);
    return createElement(ImportarCB2, { api: "/ficticio", cat, run, locked: false, actualizarCatalogos: async () => {
      actualizaciones(); const actualizado = verificada ? { ...inicial, terceros: [a], vehiculos: [{ id: -21, placa: a.placa }] } : inicial; setCat(actualizado); return actualizado;
    } });
  }
  const control = (label: string) => { const l = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(label))!; return (l.querySelector("input,select") ?? document.getElementById(l.htmlFor)) as HTMLInputElement; };
  const analizar = () => [...host.querySelectorAll("button")].find(b => b.textContent === "Analizar Excel")!;
  try {
    await act(async () => root.render(createElement(App)));
    await act(async () => { const el = control("Proveedor de la empresa"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, "1"); el.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { const el = control("Excel original"); Object.defineProperty(el, "files", { value: [new File(["ficticio"], "ficticio.xlsx")] }); el.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => analizar().click());
    expect(host.textContent).toContain("0 consumos seleccionados para confirmar");
    verificada = true;
    await act(async () => analizar().click());
    expect(host.textContent).toContain("1 consumos seleccionados para confirmar");
    expect(host.querySelector('tr[data-candidato]')?.textContent).toContain("LISTO");
    expect(actualizaciones).toHaveBeenCalledTimes(2); expect(fetch).toHaveBeenCalledTimes(2); expect(run).not.toHaveBeenCalled();
    expect(control("Confirmo el procesamiento parcial").checked).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
