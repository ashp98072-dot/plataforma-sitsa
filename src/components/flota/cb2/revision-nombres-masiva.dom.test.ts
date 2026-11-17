// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RevisionNombresCB2 } from "./revision-nombres";
import type { DecisionNombre, RevisionNombre } from "@/lib/flota/cb2/pilotos-nombres";

const nombre = (clave: string, candidatos: { id: number; nombre: string }[], extra: Partial<RevisionNombre> = {}): RevisionNombre => ({ clave, originales: [clave], filas: 3, candidatos, propuesta: null, ...extra });
const NOMBRES: RevisionNombre[] = [
  nombre("LUIS ESCOBAR", []), nombre("RAYDEL", []),                                   // sin coincidencia → piloto reportado
  nombre("MARVIN XOL", [{ id: 11, nombre: "Marvin Xol Pop" }]), nombre("ALEX PICHE", [{ id: 12, nombre: "Alex Piche Tum" }]),   // un único candidato con TODAS las palabras exactas → empleado
  nombre("MARIO ALVIZURES", [{ id: 31, nombre: "Maria Andrea Alvizures Polanco" }]), nombre("EDGAR TIUL", [{ id: 32, nombre: "Edgar Anibal Tul Paau" }]), nombre("RAYDEL UNO", [{ id: 33, nombre: "Raydel" }]),   // aproximados / una sola palabra → manual
  nombre("JOSE VASQUEZ", [{ id: 21, nombre: "Jose Vasquez A" }, { id: 22, nombre: "Jose Vasquez B" }]),                        // varios → manual
  nombre("PEDRO COC", [], { equivalencia: { tipo: "REPORTADO", confirmado: false } }),                                         // equivalencia previa → manual
  nombre("YA DECIDIDO", []),                                                                                                   // ya tiene decisión → no se toca
];

async function montar(props: { instalado: boolean; disabled?: boolean; decisiones?: Record<string, DecisionNombre | undefined> }) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host); const onChange = vi.fn();
  await act(async () => root.render(createElement(RevisionNombresCB2, { nombres: NOMBRES, decisiones: props.decisiones ?? { "YA DECIDIDO": { tipo: "REPORTADO", confirmado: true } }, onChange, disabled: props.disabled ?? false, instalado: props.instalado })));
  const boton = (texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(texto)) as HTMLButtonElement;
  return { host, root, onChange, boton, limpiar: async () => { await act(async () => root.unmount()); host.remove(); } };
}

it("acciones masivas: guarda como piloto reportado SOLO los nombres sin coincidencia (p. ej. un mensajero que no es de planilla) y no toca los que tienen candidatos, equivalencia previa o decisión", async () => {
  const t = await montar({ instalado: true });
  try {
    const b = t.boton("sin coincidencia"); expect(b.textContent).toContain("2 nombres"); expect(b.disabled).toBe(false);
    await act(async () => { b.click(); });
    expect(t.onChange.mock.calls).toEqual([["LUIS ESCOBAR", { tipo: "REPORTADO", confirmado: true }], ["RAYDEL", { tipo: "REPORTADO", confirmado: true }]]);
  } finally { await t.limpiar(); }
});
it("acciones masivas: usa el empleado sugerido SOLO cuando hay un único candidato; con varios candidatos o equivalencia previa deja la decisión manual y lo informa", async () => {
  const t = await montar({ instalado: true });
  try {
    const b = t.boton("todas las palabras"); expect(b.textContent).toContain("(2)");
    await act(async () => { b.click(); });
    expect(t.onChange.mock.calls).toEqual([["MARVIN XOL", { tipo: "EMPLEADO", empleadoId: 11, confirmado: true }], ["ALEX PICHE", { tipo: "EMPLEADO", empleadoId: 12, confirmado: true }]]);
    expect(t.host.querySelector('div[aria-label="Acciones masivas de nombres"] span')?.textContent).toContain("Pendientes de decidir: 9"); expect(t.host.textContent).toContain("5 con coincidencia aproximada, varios candidatos o equivalencia previa");   // 2+2+1 sin decisión masiva + varios + equivalencia: revisión manual
    expect(t.onChange.mock.calls.map((c) => c[0])).not.toContain("MARIO ALVIZURES");   // «Mario» ≠ «María»: nunca se asigna por parecido
  } finally { await t.limpiar(); }
});
it("acciones masivas: deshabilitadas sin el registro de equivalencias instalado o con el formulario bloqueado, y sin nombres pendientes de ese tipo", async () => {
  const sinRegistro = await montar({ instalado: false });
  try { for (const t of ["sin coincidencia", "todas las palabras"]) { expect(sinRegistro.boton(t).disabled, t).toBe(true); await act(async () => { sinRegistro.boton(t).click(); }); } expect(sinRegistro.onChange).not.toHaveBeenCalled(); } finally { await sinRegistro.limpiar(); }
  const bloqueado = await montar({ instalado: true, disabled: true });
  try { expect((bloqueado.host.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true); } finally { await bloqueado.limpiar(); }   // el navegador no entrega clics a los botones de un fieldset deshabilitado
  const todo: Record<string, DecisionNombre> = Object.fromEntries(NOMBRES.map((n) => [n.clave, { tipo: "REPORTADO", confirmado: true } as DecisionNombre]));
  const decidido = await montar({ instalado: true, decisiones: todo });
  try { expect(decidido.boton("sin coincidencia").disabled).toBe(true); expect(decidido.boton("todas las palabras").disabled).toBe(true); } finally { await decidido.limpiar(); }
});
