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
import { PlacaSelect, type VehiculoOpt } from "./placa-select";
import type { OcupacionRecurso } from "./piloto-select";

type Props = Parameters<typeof PlacaSelect>[0];

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
  let actuales: Props = { value: "", options: [], inputClassName: "in", onChange, ...props } as Props;
  let limpiezas: (void | (() => void))[] = [];
  const pintar = (cambios: Partial<Props> = {}) => {
    actuales = { ...actuales, ...cambios } as Props;
    limpiezas.forEach((l) => typeof l === "function" && l());
    const arbol = ejecutar(() => PlacaSelect(actuales));
    limpiezas = hooks.efectos.map((e) => e());
    return arbol;
  };
  const leer = () => ejecutar(() => PlacaSelect(actuales));
  const input = () => elementos(leer()).find((e) => e.type === "input")!;
  const enfocar = () => (input().props.onFocus as () => void)();
  const opcion = (placa: string) => elementos(leer()).find((e) => e.type === "button" && texto(e.props.children as ReactNode).includes(placa));
  const tecla = (key: string) => {
    const preventDefault = vi.fn(); const blur = vi.fn();
    (input().props.onKeyDown as (e: unknown) => void)({ key, preventDefault, target: { blur } });
  };
  return { onChange, pintar, leer, enfocar, opcion, tecla };
}

beforeEach(() => {
  hooks.estados = []; hooks.efectos = []; hooks.activo = false;
  documentoMock.addEventListener.mockReset(); documentoMock.removeEventListener.mockReset();
  vi.stubGlobal("document", documentoMock);
});
afterEach(() => vi.unstubAllGlobals());

const LIBRE: VehiculoOpt = { placa: "P-123ABC", marca: "Hino", modelo: "300", estadoDisponibilidad: "disponible" };
const TALLER: VehiculoOpt = { placa: "P-456DEF", marca: "Freightliner", modelo: "M2", estadoDisponibilidad: "en_taller", motivoNoDisponible: "En taller / servicio" };
const OCUPACION: OcupacionRecurso = { planCodigo: "PLAN-000124", horaInicio: "2026-09-22 09:00:00", horaFin: "2026-09-22 12:00:00" };

describe("PlacaSelect — disponibilidad (PROGRAMACION-DISPONIBILIDAD-BUSCADORES-1)", () => {
  it("unidad disponible: seleccionable normalmente, sin badge", () => {
    const s = montar({ options: [LIBRE] }); s.pintar(); s.enfocar();
    const marcado = html(s.pintar());
    expect(marcado).toContain("P-123ABC");
    expect(marcado).not.toMatch(/No disponible|Asignada/);
    expect(s.opcion("P-123ABC")!.props.disabled).toBeFalsy();
  });

  it("unidad en taller: sigue visible (nunca se oculta) con badge «No disponible · En taller / servicio» y disabled", () => {
    const s = montar({ options: [TALLER] }); s.pintar(); s.enfocar();
    const marcado = html(s.pintar());
    expect(marcado).toContain("P-456DEF");
    expect(marcado).toContain("No disponible · En taller / servicio");
    expect(s.opcion("P-456DEF")!.props.disabled).toBe(true);
  });

  it("unidad sin problema de flota pero asignada a otro plan: badge «Asignada · PLAN-000124 · 09:00 AM», disabled", () => {
    const s = montar({ options: [LIBRE], ocupadas: { "P-123ABC": OCUPACION } }); s.pintar(); s.enfocar();
    const marcado = html(s.pintar());
    expect(marcado).toContain("Asignada · PLAN-000124 · 09:00 AM");
    expect(s.opcion("P-123ABC")!.props.disabled).toBe(true);
  });

  it("el motivo de FLOTA (taller) manda sobre una asignación — nunca se muestran los dos badges combinados", () => {
    const s = montar({ options: [TALLER], ocupadas: { "P-456DEF": OCUPACION } }); s.pintar(); s.enfocar();
    const marcado = html(s.pintar());
    expect(marcado).toContain("No disponible · En taller / servicio");
    expect(marcado).not.toContain("Asignada");
  });

  it("clic en una unidad bloqueada (taller o asignada) NO dispara onChange", () => {
    const s = montar({ options: [TALLER, LIBRE], ocupadas: { "P-123ABC": OCUPACION } }); s.pintar(); s.enfocar(); s.pintar();
    (s.opcion("P-456DEF")!.props.onClick as () => void)();
    expect(s.onChange).not.toHaveBeenCalled();
    (s.opcion("P-123ABC")!.props.onClick as () => void)();
    expect(s.onChange).not.toHaveBeenCalled();
  });

  it("Enter no selecciona la primera opción si está bloqueada", () => {
    const s = montar({ options: [TALLER, LIBRE] }); s.pintar(); s.enfocar(); s.pintar();
    s.tecla("Enter");
    expect(s.onChange).not.toHaveBeenCalled();
  });
});
