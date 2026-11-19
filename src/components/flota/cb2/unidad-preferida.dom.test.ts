// @vitest-environment happy-dom
import { act, createElement, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidatosCB2 } from "./preview-vista";
import { useRevisionCB2 } from "./use-revision";
import type { CatalogosCB2, FilaCB2 } from "./client";
import type { DecisionAsignacion } from "./asignacion";

/**
 * Integración del componente real (CandidatosCB2 + useRevisionCB2) para la ficha preferida de una placa repetida (C-558BSJ: #684 compartida, #1301 propia).
 * Filas: V1 (la que se edita), V2/V3 (elegibles), V4 (decisión manual previa → #1301), V5 (bloqueada), V6 (unidad borrada a propósito),
 * V7 (otra pareja ambigua C-034BXR), V8 (placa única).
 */
let host: HTMLDivElement, root: Root;
const cat: CatalogosCB2 = {
  proveedores: [{ id: 1, nombre: "Shell" }],
  vehiculos: [
    { id: 684, placa: "C-558BSJ", tipo_unidad: "VEHICULO", estado: "Activo", propia: false, empresa_duena_nombre: "Kuiqtrans", marca: "International", modelo: "1998", descripcion: "Camion Furgon de 10 Tn" },
    { id: 1301, placa: "C-558BSJ", tipo_unidad: "VEHICULO", estado: "Activo", propia: true },
    { id: 602, placa: "C-034BXR", tipo_unidad: "VEHICULO", estado: "Activo", propia: false, empresa_duena_nombre: "Frescofresh" },
    { id: 1296, placa: "C-034BXR", tipo_unidad: "VEHICULO", estado: "Activo", propia: true },
    { id: 9000, placa: "P-000AAA", tipo_unidad: "VEHICULO", estado: "Activo", propia: true },
  ],
  pilotos: [],
};
const base: FilaCB2 = { hoja: "H", fila: 2, candidato: "a", bloqueada: false, documento: null, errores: [], estado: "ADVERTENCIA", motivos: [], vale: "V1", placa: "C-558BSJ", placaNormalizada: "C-558BSJ", fecha: "2026-10-02", galones: "28", precio: "41.7", monto: "1167.32", moneda: "GTQ", lote: "1", origen: { piloto: "ANDRES", producto: "Diesel", km: "", galones: "28", precio: "41.7", monto: "1167.32" } };
const f = (n: number, placa: string, extra: Partial<FilaCB2> = {}): FilaCB2 => ({ ...base, fila: n + 1, candidato: `c${n}`, vale: `V${n}`, placa, placaNormalizada: placa, ...extra });
const filas = [
  f(1, "C-558BSJ"), f(2, "C-558BSJ"), f(3, "C-558BSJ"), f(4, "C-558BSJ"), f(5, "C-558BSJ", { bloqueada: true, estado: "BLOQUEADA" }),
  f(6, "C-558BSJ"), f(7, "C-034BXR"), f(8, "P-000AAA"),
];

type Api = ReturnType<typeof useRevisionCB2>;
/** Lo que el componente padre expone a la prueba (se captura en un efecto; no se reasignan variables externas durante el render). */
const captura = { api: undefined as unknown as Api, decisiones: {} as Record<string, DecisionAsignacion>, llamadas: 0 };
function Parent({ modo }: { modo: "varias" | "uno-a-uno" | "onchange" }) {
  const [d, setD] = useState<Record<string, DecisionAsignacion>>({});
  const espiado: Dispatch<SetStateAction<Record<string, DecisionAsignacion>>> = (v) => { captura.llamadas++; setD(v); };
  const r = useRevisionCB2(filas, cat, d, espiado);
  useEffect(() => { captura.api = r; captura.decisiones = d; });
  const [mapa, setMapa] = useState<Record<string, string>>({});
  if (modo === "onchange") return createElement(CandidatosCB2, { filas, cat, seleccion: mapa, onChange: setMapa });
  return createElement(CandidatosCB2, { filas, cat, seleccion: r.asignaciones, manuales: r.manuales, omitidos: r.omitidos, revisados: r.revisados, decisiones: d, onAsignar: r.asignar, ...(modo === "varias" ? { onAsignarVarias: r.asignarVarias } : {}), onSeleccionar: r.seleccionar, onRevisar: r.revisar });
}
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; captura.llamadas = 0; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (modo: "varias" | "uno-a-uno" | "onchange" = "varias") => act(async () => root.render(createElement(Parent, { modo })));
function control(text: string) { const label = [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(text))!; return (label.querySelector("input,select") ?? document.getElementById(label.htmlFor)) as HTMLInputElement | HTMLSelectElement; }
async function elegir(vale: string, id: string) {
  const el = control(`Unidad para vale ${vale}`);
  await act(async () => { Object.getOwnPropertyDescriptor(el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(el, id); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}
const seccion = (vale: string) => host.querySelector(`[aria-label="Unidad y placa del vale ${vale}"]`)!;
const botonDe = (vale: string) => [...seccion(vale).querySelectorAll("button")].find(b => b.textContent?.startsWith("Usar esta ficha")) as HTMLButtonElement | undefined;
/** Prepara el escenario: V4 con decisión manual previa (#1301) y V6 con la unidad borrada a propósito. */
async function preparar() { await render(); await act(async () => { captura.api.asignar("c4", "1301"); captura.api.asignar("c6", ""); }); }

describe("ficha preferida de una placa repetida (C-558BSJ) en el componente real", () => {
  it("muestra el aviso, la procedencia de AMBAS fichas y no oculta ninguna", async () => {
    await render();
    const avisos = [...seccion("V1").querySelectorAll('[role="alert"]')].map(a => a.textContent ?? "");
    const aviso = avisos.find(a => a.includes("C-558BSJ"))!;
    expect(aviso).toContain("2 fichas sin identidad física aprobada");
    expect(aviso).toContain("#684 (Ficha compartida de Kuiqtrans · International 1998)");
    expect(aviso).toContain("#1301 (Ficha propia)");
    expect(aviso).toContain("unidades distintas");
    expect(aviso).toContain("Identidades físicas");
    // La placa única no muestra advertencia de placa repetida.
    expect([...seccion("V8").querySelectorAll('[role="alert"]')].some(a => a.textContent?.includes("sin identidad física aprobada"))).toBe(false);
    expect(botonDe("V1")).toBeUndefined(); // aún no se eligió ficha: nada se aplica solo
    expect(captura.api.manuales).toEqual({});
  });

  it.each([["684", "1301"], ["1301", "684"]])("elegir #%s y pulsar el botón actualiza SOLO las filas elegibles de C-558BSJ", async (elegida, previa) => {
    await render();
    await act(async () => { captura.api.asignar("c4", previa); captura.api.asignar("c6", ""); });
    await elegir("V1", elegida);
    expect(captura.api.manuales).toEqual({ c4: previa, c6: "", c1: elegida }); // elegir una ficha no toca otras filas
    const boton = botonDe("V1")!;
    expect(boton.textContent).toBe(`Usar esta ficha (#${elegida}) en las 2 filas ambiguas de este archivo con la placa C-558BSJ`); // V2 y V3
    captura.llamadas = 0;
    await act(async () => boton.click());
    expect(captura.api.manuales).toEqual({ c1: elegida, c2: elegida, c3: elegida, c4: previa, c6: "" }); // V5 (bloqueada), V6 (borrada a propósito), V7 y V8 intactas; V4 conserva su decisión manual
    expect(Object.keys(captura.api.manuales)).not.toContain("c5"); expect(Object.keys(captura.api.manuales)).not.toContain("c7"); expect(Object.keys(captura.api.manuales)).not.toContain("c8");
    expect(control("Unidad para vale V2").value).toBe(elegida); expect(control("Unidad para vale V3").value).toBe(elegida);
    expect(control("Unidad para vale V4").value).toBe(previa);
    expect(control("Unidad para vale V6").value).toBe(""); expect(control("Unidad para vale V7").value).toBe("");
    expect(control("Unidad para vale V8").value).toBe("9000"); // placa única: su asignación automática exacta no se toca
    expect(botonDe("V1")).toBeUndefined(); // ya no quedan filas ambiguas que cubrir
  });

  it("la aplicación es ATÓMICA: una sola actualización de decisiones para todas las filas y ninguna se pierde", async () => {
    await preparar();
    await elegir("V1", "684");
    captura.llamadas = 0;
    await act(async () => botonDe("V1")!.click());
    expect(captura.llamadas).toBe(1); // un único setDecisiones para V2 y V3
    for (const k of ["c2", "c3"]) expect(captura.decisiones[k]).toMatchObject({ unidadExternaId: null, asociacionExternaId: null, pilotoExternoId: null });
    expect(captura.decisiones.c4).toEqual({ ...captura.decisiones.c4 }); // V4 no se tocó por esta acción
    expect(Object.keys(captura.api.manuales).sort()).toEqual(["c1", "c2", "c3", "c4", "c6"]);
  });

  it("un padre que solo ofrece onAsignar (con actualizadores funcionales) tampoco pierde asignaciones", async () => {
    await render("uno-a-uno");
    await act(async () => { captura.api.asignar("c4", "1301"); captura.api.asignar("c6", ""); });
    await elegir("V1", "684");
    await act(async () => botonDe("V1")!.click());
    expect(captura.api.manuales).toEqual({ c1: "684", c2: "684", c3: "684", c4: "1301", c6: "" });
  });

  it("sin onAsignar/onAsignarVarias, onChange recibe UN mapa con todas las filas (no varias llamadas que se pisen)", async () => {
    const llamadas: Record<string, string>[] = [];
    const Cap = () => { const [m, setM] = useState<Record<string, string>>({ c1: "684" }); return createElement(CandidatosCB2, { filas, cat, seleccion: m, onChange: (v: Record<string, string>) => { llamadas.push(v); setM(v); } }); };
    await act(async () => root.render(createElement(Cap)));
    await act(async () => botonDe("V1")!.click());
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toMatchObject({ c1: "684", c2: "684", c3: "684", c4: "684", c6: "684" }); // sin manuales previos distintos de la selección, aplica a las ambiguas sin unidad
    expect(Object.keys(llamadas[0])).not.toContain("c5"); expect(Object.keys(llamadas[0])).not.toContain("c7"); expect(Object.keys(llamadas[0])).not.toContain("c8");
  });

  it("con identidad física aprobada común (una sola ficha canónica) no hay advertencia ni botón", async () => {
    const canonico: CatalogosCB2 = { ...cat, vehiculos: [{ ...cat.vehiculos[1], identidadFisicaId: 5 }, ...cat.vehiculos.slice(2)] };
    function P() { const r = useRevisionCB2(filas, canonico); useEffect(() => { captura.api = r; }); return createElement(CandidatosCB2, { filas, cat: canonico, seleccion: r.asignaciones, manuales: r.manuales, onAsignar: r.asignar, onAsignarVarias: r.asignarVarias }); }
    await act(async () => root.render(createElement(P)));
    expect([...seccion("V1").querySelectorAll('[role="alert"]')].some(a => a.textContent?.includes("C-558BSJ"))).toBe(false);
    expect(botonDe("V1")).toBeUndefined();
  });
});

describe("otras parejas conocidas no se contaminan", () => {
  it("elegir #602 para C-034BXR solo ofrece/aplica a filas C-034BXR, nunca a C-558BSJ", async () => {
    await render();
    await elegir("V7", "602");
    expect(captura.api.manuales).toEqual({ c7: "602" });
    expect(botonDe("V7")).toBeUndefined(); // no hay otras filas ambiguas de esa placa
  });
});
