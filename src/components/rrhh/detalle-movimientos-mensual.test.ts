import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RRHH-DASHBOARD-BAJAS-FOTO-1 — fotografía ampliable en el detalle mensual.
 * No hay jsdom/testing-library en este repo: se llama a los componentes REALES
 * como funciones con los hooks de React sustituidos (estado/efectos/refs
 * controlados) y se inspecciona el árbol de elementos que devuelven y sus
 * manejadores — Escape, clic en el fondo, botón Cerrar, foco.
 */
vi.mock("react", async () => {
  const real = await vi.importActual<typeof import("react")>("react");
  return { ...real, useState: vi.fn(), useEffect: vi.fn(), useRef: vi.fn(), useId: vi.fn(() => "titulo-foto") };
});
vi.mock("react-dom", () => ({ createPortal: (hijo: unknown) => hijo }));
vi.mock("next/link", () => ({ default: "a" }));

import { useEffect, useRef, useState } from "react";
import { FotoAmpliada, Miniatura } from "./detalle-movimientos-mensual";

type Nodo = { type?: unknown; props?: Record<string, unknown> } | string | number | null | undefined | false | Nodo[];
const hijos = (n: Nodo): Nodo[] => {
  if (!n || typeof n !== "object" || Array.isArray(n)) return Array.isArray(n) ? n : [];
  const c = (n.props?.children ?? []) as Nodo | Nodo[];
  return Array.isArray(c) ? c : [c];
};
function todos(n: Nodo, acc: Nodo[] = []): Nodo[] {
  if (!n) return acc;
  if (Array.isArray(n)) { n.forEach((x) => todos(x, acc)); return acc; }
  acc.push(n);
  hijos(n).forEach((x) => todos(x, acc));
  return acc;
}
type Elemento = { type?: unknown; props?: Record<string, unknown> };
const hallar = (raiz: Nodo, p: (n: Elemento) => boolean): Elemento[] =>
  todos(raiz).filter((n) => typeof n === "object" && n !== null && !Array.isArray(n) && p(n as Elemento)) as Elemento[];
const prop = (n: { props?: Record<string, unknown> }, k: string) => n.props?.[k];
const texto = (n: Nodo): string => todos(n).filter((x) => typeof x === "string" || typeof x === "number").join("");

const NOMBRE = "Anthony Brian García-Aguirre Ávila";
const PERSONA = { id: 42, codigo: "E42", nombre: NOMBRE, puesto: "Piloto", fechaAlta: "2026-09-01", fechaEgreso: null, esBaja: false } as never;
const URL_FOTO = "/api/empresas/kt-monaco/empleados/42/foto";

function montarMiniatura(fallida: boolean, ampliada: boolean) {
  const setFallida = vi.fn();
  const setAmpliada = vi.fn();
  vi.mocked(useState).mockReset();
  vi.mocked(useState).mockImplementationOnce((() => [fallida, setFallida]) as never).mockImplementationOnce((() => [ampliada, setAmpliada]) as never);
  const arbol = Miniatura({ slug: "kt-monaco", persona: PERSONA }) as unknown as Nodo;
  return { arbol, setFallida, setAmpliada };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("Miniatura — solo una fotografía válida es ampliable", () => {
  it("foto válida: es un BOTÓN accesible con aria-label 'Ampliar fotografía de <nombre>'", () => {
    const { arbol } = montarMiniatura(false, false);
    const [boton] = hallar(arbol, (n) => n.type === "button");
    expect(boton).toBeDefined();
    expect(prop(boton, "type")).toBe("button");
    expect(prop(boton, "aria-label")).toBe(`Ampliar fotografía de ${NOMBRE}`);
  });

  it("la imagen usa la MISMA URL privada existente y sigue siendo object-cover en la miniatura", () => {
    const { arbol } = montarMiniatura(false, false);
    const [img] = hallar(arbol, (n) => n.type === "img");
    expect(prop(img, "src")).toBe(URL_FOTO);
    expect(prop(img, "className")).toContain("object-cover");
  });

  it("clic en la foto abre el modal (setAmpliada(true))", () => {
    const { arbol, setAmpliada } = montarMiniatura(false, false);
    const [boton] = hallar(arbol, (n) => n.type === "button");
    (prop(boton, "onClick") as () => void)();
    expect(setAmpliada).toHaveBeenCalledWith(true);
  });

  it("cerrado: no hay modal en el árbol", () => {
    const { arbol } = montarMiniatura(false, false);
    expect(hallar(arbol, (n) => n.type === FotoAmpliada)).toHaveLength(0);
  });

  it("abierto: monta FotoAmpliada con la MISMA URL de la miniatura y el nombre completo; cerrar() hace setAmpliada(false)", () => {
    const { arbol, setAmpliada } = montarMiniatura(false, true);
    const [modal] = hallar(arbol, (n) => n.type === FotoAmpliada);
    expect(prop(modal, "src")).toBe(URL_FOTO);
    expect(prop(modal, "nombre")).toBe(NOMBRE);
    (prop(modal, "cerrar") as () => void)();
    expect(setAmpliada).toHaveBeenCalledWith(false);
  });

  it("foto fallida: muestra iniciales, NO hay botón ni imagen clicable, y no abre modal", () => {
    const { arbol } = montarMiniatura(true, false);
    expect(hallar(arbol, (n) => n.type === "button")).toHaveLength(0);
    expect(hallar(arbol, (n) => n.type === "img")).toHaveLength(0);
    const [iniciales] = hallar(arbol, (n) => n.type === "span");
    expect(prop(iniciales, "aria-label")).toBe(`Sin fotografía de ${NOMBRE}`);
    expect(texto(iniciales as Nodo)).toBe("AB");
    expect(prop(iniciales, "onClick")).toBeUndefined();
  });

  it("aunque ampliada quedara en true, una foto fallida nunca monta el modal (no hay modal vacío)", () => {
    const { arbol } = montarMiniatura(true, true);
    expect(hallar(arbol, (n) => n.type === FotoAmpliada)).toHaveLength(0);
  });

  it("si la imagen falla al cargar (onError) pasa a iniciales", () => {
    const { arbol, setFallida } = montarMiniatura(false, false);
    const [img] = hallar(arbol, (n) => n.type === "img");
    (prop(img, "onError") as () => void)();
    expect(setFallida).toHaveBeenCalledWith(true);
  });
});

describe("FotoAmpliada — modal", () => {
  const cerrar = vi.fn();
  const montar = () => FotoAmpliada({ src: URL_FOTO, nombre: NOMBRE, cerrar }) as unknown as Nodo;

  beforeEach(() => {
    // FotoAmpliada renderiza con createPortal(..., document.body).
    vi.stubGlobal("document", { body: {}, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.mocked(useRef).mockReturnValue({ current: { focus: vi.fn() } } as never);
  });

  it("oscurece el fondo (fixed, bg-black/80) y se limita al viewport", () => {
    const [fondo] = hallar(montar(), (n) => "data-foto-fondo" in (n.props ?? {}));
    expect(prop(fondo, "className")).toContain("fixed inset-0");
    expect(prop(fondo, "className")).toContain("bg-black/80");
  });

  it("es un diálogo modal accesible con nombre = nombre del empleado", () => {
    const arbol = montar();
    const [dialogo] = hallar(arbol, (n) => prop(n, "role") === "dialog");
    expect(prop(dialogo, "aria-modal")).toBe("true");
    expect(prop(dialogo, "aria-labelledby")).toBe("titulo-foto");
    const [titulo] = hallar(arbol, (n) => prop(n, "id") === "titulo-foto");
    expect(texto(titulo as Nodo)).toBe(NOMBRE);
  });

  it("muestra la foto GRANDE: misma URL privada, object-contain, sin deformar, máx. 90vw × 85vh", () => {
    const [img] = hallar(montar(), (n) => n.type === "img");
    expect(prop(img, "src")).toBe(URL_FOTO);
    const clase = String(prop(img, "className"));
    expect(clase).toContain("object-contain");
    expect(clase).toContain("max-w-[90vw]");
    expect(clase).toContain("max-h-[85vh]");
    expect(clase).not.toContain("object-cover");
    expect(prop(img, "alt")).toBe(`Fotografía de ${NOMBRE}`);
  });

  it("clic en el fondo (fuera de la imagen) cierra", () => {
    const [fondo] = hallar(montar(), (n) => "data-foto-fondo" in (n.props ?? {}));
    (prop(fondo, "onClick") as () => void)();
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("clic dentro del diálogo/imagen NO cierra (no se propaga al fondo)", () => {
    const [dialogo] = hallar(montar(), (n) => prop(n, "role") === "dialog");
    const parar = vi.fn();
    (prop(dialogo, "onClick") as (e: { stopPropagation: () => void }) => void)({ stopPropagation: parar });
    expect(parar).toHaveBeenCalled();
    expect(cerrar).not.toHaveBeenCalled();
  });

  it("el botón Cerrar cierra", () => {
    const [boton] = hallar(montar(), (n) => n.type === "button");
    expect(texto(boton as Nodo)).toBe("Cerrar");
    (prop(boton, "onClick") as () => void)();
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  describe("teclado y foco", () => {
    let handler: (e: { key: string; preventDefault: () => void }) => void;
    let quitado: unknown;
    const previo = { focus: vi.fn() };
    const boton = { focus: vi.fn() };

    beforeEach(() => {
      handler = () => {};
      quitado = undefined;
      vi.stubGlobal("document", {
        body: {},
        activeElement: previo,
        addEventListener: (_t: string, h: typeof handler) => { handler = h; },
        removeEventListener: (_t: string, h: unknown) => { quitado = h; },
      });
      vi.mocked(useRef).mockReturnValue({ current: boton } as never);
    });

    function activarEfecto() {
      montar();
      const efecto = vi.mocked(useEffect).mock.calls.at(-1)![0] as () => (() => void) | void;
      return efecto();
    }

    it("Escape cierra", () => {
      activarEfecto();
      const preventDefault = vi.fn();
      handler({ key: "Escape", preventDefault });
      expect(cerrar).toHaveBeenCalledTimes(1);
      expect(preventDefault).toHaveBeenCalled();
    });

    it("otras teclas no cierran; Tab mantiene el foco dentro del modal (en el botón Cerrar)", () => {
      activarEfecto();
      handler({ key: "a", preventDefault: vi.fn() });
      expect(cerrar).not.toHaveBeenCalled();
      boton.focus.mockClear();
      handler({ key: "Tab", preventDefault: vi.fn() });
      expect(boton.focus).toHaveBeenCalled();
    });

    it("al abrir el foco entra al botón Cerrar; al cerrar se quita el listener y el foco vuelve a la miniatura", () => {
      boton.focus.mockClear();
      const limpiar = activarEfecto() as () => void;
      expect(boton.focus).toHaveBeenCalled();
      limpiar();
      expect(quitado).toBe(handler);
      expect(previo.focus).toHaveBeenCalled();
    });
  });
});

describe("no se creó un endpoint nuevo y el detalle mensual no cambió", () => {
  const fuente = readFileSync("src/components/rrhh/detalle-movimientos-mensual.tsx", "utf8").replace(/\r\n/g, "\n");

  it("la URL de la foto se define UNA sola vez (la del endpoint privado existente) y el modal la recibe por prop", () => {
    expect((fuente.match(/\/api\/empresas\/\$\{slug\}\/empleados\/\$\{persona\.id\}\/foto/g) ?? []).length).toBe(1);
    expect(fuente).not.toMatch(/foto-grande|foto\/ampliada|\/foto\?/);
    expect(fuente).toContain("src={src} nombre={persona.nombre}");
  });

  it("no abre una pestaña nueva (sin window.open ni target=_blank)", () => {
    expect(fuente).not.toContain("window.open");
    expect(fuente).not.toContain("_blank");
  });

  it("sigue cargando altas/bajas del mes del mismo endpoint y mostrando ambos bloques", () => {
    expect(fuente).toContain("/rrhh/dashboard?detalleMes=");
    expect(fuente).toContain('"Altas del mes" : "Bajas del mes"');
    expect(fuente).toContain('(["altas", "bajas"] as const)');
  });

  it("'Ver ficha' / 'Ver ficha e histórico' siguen apuntando a la ficha del empleado", () => {
    expect(fuente).toContain("`/e/${slug}/rrhh/empleados?empleado=${persona.id}`");
    expect(fuente).toContain('persona.esBaja ? "Ver ficha e histórico" : "Ver ficha"');
  });

  it("conserva código, puesto y fecha de alta/egreso en cada fila", () => {
    expect(fuente).toContain("{persona.codigo} · {persona.puesto");
    expect(fuente).toContain('"Fecha de alta" : "Fecha de egreso"');
  });
});
