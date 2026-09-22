import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Harness sin DOM (mismo patrón que cliente-search.test.ts / piloto-select.test.ts).
const hooks = vi.hoisted(() => ({ activo: false, indice: 0, estados: [] as unknown[], efectos: [] as (() => void | (() => void))[] }));
vi.mock("react", async (importar) => {
  const real = await importar<typeof import("react")>();
  return {
    ...real,
    useId: () => (hooks.activo ? ":r1:" : real.useId()),
    useRef: (inicial: unknown) => (hooks.activo ? { current: inicial } : real.useRef(inicial)),
    useState: (inicial: unknown) => {
      if (!hooks.activo) return real.useState(inicial);
      const i = hooks.indice++;
      if (!(i in hooks.estados)) hooks.estados[i] = typeof inicial === "function" ? inicial() : inicial;
      return [hooks.estados[i], (valor: unknown) => { hooks.estados[i] = typeof valor === "function" ? valor(hooks.estados[i]) : valor; }];
    },
    useEffect: (efecto: () => void | (() => void)) => { if (hooks.activo) hooks.efectos.push(efecto); else real.useEffect(efecto); },
  };
});
import { AuxiliaresSelect, type AuxiliarOpt } from "./auxiliares-select";
import type { OcupacionRecurso } from "./piloto-select";

type Props = Parameters<typeof AuxiliaresSelect>[0];

const documentoMock = { addEventListener: vi.fn(), removeEventListener: vi.fn(), activeElement: null };

function ejecutar<T>(render: () => T): T {
  hooks.indice = 0; hooks.efectos = []; hooks.activo = true;
  try { return render(); } finally { hooks.activo = false; }
}
function elementos(nodo: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(nodo)) return nodo.flatMap(elementos);
  if (!isValidElement<Record<string, unknown>>(nodo)) return [];
  return [nodo, ...elementos(nodo.props.children as ReactNode)];
}
function texto(nodo: ReactNode): string {
  if (Array.isArray(nodo)) return nodo.map(texto).join("");
  if (isValidElement<{ children?: ReactNode }>(nodo)) return texto(nodo.props.children);
  return typeof nodo === "string" || typeof nodo === "number" ? String(nodo) : "";
}
const html = (tree: ReactNode) => renderToStaticMarkup(tree as ReactElement);

function montar(props: Partial<Props> = {}) {
  const onChange = vi.fn();
  let actuales: Props = { auxiliares: [], empleadoIds: [], nombresLibres: [], max: 8, inputClassName: "in", onChange, ...props } as Props;
  let limpiezas: (void | (() => void))[] = [];
  const pintar = (cambios: Partial<Props> = {}) => {
    actuales = { ...actuales, ...cambios } as Props;
    limpiezas.forEach((l) => typeof l === "function" && l());
    const arbol = ejecutar(() => AuxiliaresSelect(actuales));
    limpiezas = hooks.efectos.map((e) => e());
    return arbol;
  };
  const leer = () => ejecutar(() => AuxiliaresSelect(actuales));
  const input = () => elementos(leer()).find((e) => e.type === "input")!;
  const enfocar = () => (input().props.onFocus as () => void)();
  const escribir = (valor: string) => (input().props.onChange as (e: unknown) => void)({ target: { value: valor } });
  const opcion = (nombre: string) => elementos(leer()).find((e) => e.type === "button" && texto(e.props.children as ReactNode).includes(nombre));
  const tecla = (key: string) => {
    const preventDefault = vi.fn(); const blur = vi.fn();
    (input().props.onKeyDown as (e: unknown) => void)({ key, preventDefault, target: { blur } });
  };
  return { onChange, pintar, leer, enfocar, escribir, opcion, tecla };
}

beforeEach(() => {
  hooks.estados = []; hooks.efectos = []; hooks.activo = false;
  documentoMock.addEventListener.mockReset(); documentoMock.removeEventListener.mockReset();
  vi.stubGlobal("document", documentoMock);
});
afterEach(() => vi.unstubAllGlobals());

const JUAN: AuxiliarOpt = { id: 10, codigo: "AUX-010", nombre: "Juan Pérez" };
const ANA: AuxiliarOpt = { id: 20, codigo: "AUX-020", nombre: "Ana López" };
const OCUPACION: OcupacionRecurso = { planCodigo: "PLAN-000123", horaInicio: "2026-09-22 08:00:00", horaFin: "2026-09-22 11:00:00" };

describe("AuxiliaresSelect — disponibilidad (PROGRAMACION-DISPONIBILIDAD-BUSCADORES-1)", () => {
  it("auxiliar ocupado sigue visible (nunca se filtra) con badge «Asignado · PLAN-000123 · 08:00 AM» y disabled", () => {
    const s = montar({ auxiliares: [JUAN, ANA], ocupados: { 10: OCUPACION } }); s.pintar(); s.enfocar();
    const marcado = html(s.pintar());
    expect(marcado).toContain("Juan Pérez");
    expect(marcado).toContain("Asignado · PLAN-000123 · 08:00 AM");
    expect(s.opcion("Juan Pérez")!.props.disabled).toBe(true);
  });

  it("clic en un auxiliar ocupado NO lo agrega", () => {
    const s = montar({ auxiliares: [JUAN, ANA], ocupados: { 10: OCUPACION } }); s.pintar(); s.enfocar(); s.pintar();
    (s.opcion("Juan Pérez")!.props.onClick as () => void)();
    expect(s.onChange).not.toHaveBeenCalled();
  });

  it("clic en un auxiliar disponible sí lo agrega normalmente", () => {
    const s = montar({ auxiliares: [JUAN, ANA], ocupados: { 10: OCUPACION } }); s.pintar(); s.enfocar(); s.pintar();
    (s.opcion("Ana López")!.props.onClick as () => void)();
    expect(s.onChange).toHaveBeenCalledWith({ empleadoIds: [20], nombresLibres: [] });
  });

  it("Enter con match exacto de nombre NO agrega si ese auxiliar está ocupado", () => {
    const s = montar({ auxiliares: [JUAN, ANA], ocupados: { 10: OCUPACION } }); s.pintar(); s.enfocar(); s.pintar();
    s.escribir("Juan Pérez");
    s.pintar();
    s.tecla("Enter");
    expect(s.onChange).not.toHaveBeenCalled();
  });

  it("Enter con único resultado filtrado NO agrega si ese único resultado está ocupado", () => {
    const s = montar({ auxiliares: [JUAN, ANA], ocupados: { 10: OCUPACION } }); s.pintar(); s.enfocar(); s.pintar();
    s.escribir("Juan"); // filtra a un solo resultado: Juan Pérez (ocupado)
    s.pintar();
    s.tecla("Enter");
    expect(s.onChange).not.toHaveBeenCalled();
  });

  it("múltiples auxiliares: el ya elegido no vuelve a aparecer como OPCIÓN de la lista (sigue como chip; comportamiento previo intacto)", () => {
    const s = montar({ auxiliares: [JUAN, ANA], empleadoIds: [20] }); s.pintar(); s.enfocar(); s.pintar();
    expect(s.opcion("Ana López")).toBeUndefined(); // ya no es una opción seleccionable, solo el chip
    expect(s.opcion("Juan Pérez")).toBeDefined();
  });
});
