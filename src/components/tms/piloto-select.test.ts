import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Harness sin DOM (mismo patrón que cliente-search.test.ts): ejecuta los efectos y handlers
// reales del componente y conserva el estado entre renders.
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
import { PilotoSelect, textoOcupacion, type OcupacionRecurso, type PilotoOpt } from "./piloto-select";

type Props = Parameters<typeof PilotoSelect>[0];

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
  let actuales: Props = { pilotos: [], empleadoId: 0, nombre: "", inputClassName: "in", onChange, ...props } as Props;
  let limpiezas: (void | (() => void))[] = [];
  const pintar = (cambios: Partial<Props> = {}) => {
    actuales = { ...actuales, ...cambios } as Props;
    limpiezas.forEach((l) => typeof l === "function" && l());
    const arbol = ejecutar(() => PilotoSelect(actuales));
    limpiezas = hooks.efectos.map((e) => e());
    return arbol;
  };
  const leer = () => ejecutar(() => PilotoSelect(actuales));
  const input = () => elementos(leer()).find((e) => e.type === "input")!;
  const enfocar = () => (input().props.onFocus as () => void)();
  const opcion = (nombre: string) => elementos(leer()).find((e) => e.type === "button" && texto(e.props.children as ReactNode).includes(nombre));
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

const JUAN: PilotoOpt = { id: 10, codigo: "PIL-010", nombre: "Juan Pérez" };
const ANA: PilotoOpt = { id: 20, codigo: "PIL-020", nombre: "Ana López" };
const OCUPACION: OcupacionRecurso = { planCodigo: "PLAN-000123", horaInicio: "2026-09-22 08:00:00", horaFin: "2026-09-22 11:00:00" };

describe("textoOcupacion — formato del badge", () => {
  it("hora válida en 12h: «PLAN-000123 · 08:00 AM»", () => {
    expect(textoOcupacion(OCUPACION)).toBe("PLAN-000123 · 08:00 AM");
  });
  it("PM se formatea correctamente: «PLAN-000124 · 09:00 AM» / «05:30 PM»", () => {
    expect(textoOcupacion({ planCodigo: "PLAN-000124", horaInicio: "2026-09-22 17:30:00", horaFin: null })).toBe("PLAN-000124 · 05:30 PM");
  });
});

describe("PilotoSelect — disponibilidad (PROGRAMACION-DISPONIBILIDAD-BUSCADORES-1)", () => {
  it("sin `ocupados`: todas las opciones se ven normales, sin badge Asignado", async () => {
    const s = montar({ pilotos: [JUAN, ANA] }); s.pintar(); s.enfocar(); s.pintar();
    const marcado = html(s.leer());
    expect(marcado).toContain("Juan Pérez");
    expect(marcado).not.toContain("Asignado");
    expect(s.opcion("Juan Pérez")!.props.disabled).toBeFalsy();
  });

  it("piloto ocupado: se sigue mostrando (nunca se filtra) con badge «Asignado · PLAN-000123 · 08:00 AM» y disabled", async () => {
    const s = montar({ pilotos: [JUAN, ANA], ocupados: { 10: OCUPACION } }); s.pintar(); s.enfocar();
    const marcado = html(s.pintar());
    expect(marcado).toContain("Juan Pérez"); // sigue visible
    expect(marcado).toContain("Asignado · PLAN-000123 · 08:00 AM");
    const boton = s.opcion("Juan Pérez")!;
    expect(boton.props.disabled).toBe(true);
  });

  it("clic en un piloto ocupado NO dispara onChange (defensa en el handler, además del disabled)", async () => {
    const s = montar({ pilotos: [JUAN, ANA], ocupados: { 10: OCUPACION } }); s.pintar(); s.enfocar(); s.pintar();
    (s.opcion("Juan Pérez")!.props.onClick as () => void)();
    expect(s.onChange).not.toHaveBeenCalled();
  });

  it("clic en un piloto disponible sí selecciona normalmente", async () => {
    const s = montar({ pilotos: [JUAN, ANA], ocupados: { 10: OCUPACION } }); s.pintar(); s.enfocar(); s.pintar();
    (s.opcion("Ana López")!.props.onClick as () => void)();
    expect(s.onChange).toHaveBeenCalledWith({ empleadoId: 20, nombre: "Ana López" });
  });

  it("Enter no selecciona el primer resultado si está ocupado (aunque sea filtered[0])", async () => {
    const s = montar({ pilotos: [JUAN, ANA], ocupados: { 10: OCUPACION } }); s.pintar(); s.enfocar(); s.pintar();
    s.tecla("Enter");
    expect(s.onChange).not.toHaveBeenCalled();
  });
});
