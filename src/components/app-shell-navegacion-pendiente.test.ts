import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as catalogo from "@/lib/permisos-catalogo";
import * as permisos from "@/lib/permisos-shared";
import * as roles from "@/lib/roles";
import * as sidebar from "@/lib/sidebar-activo";
import * as facturacion from "@/lib/facturacion/capacidades";
import * as proveedores from "@/lib/proveedores/acceso";
import { NAV_PENDING_FALLBACK_MS, debeMarcarNavegacionPendiente } from "@/lib/sidebar-activo";

/**
 * INDICADOR GLOBAL DE NAVEGACIÓN (AppShell) en cambios de pestaña `?tab=` de Flota.
 *
 * Causa: el clic en un enlace del sidebar activaba `navPending` (barra + `opacity-70` en TODO el <main>) y solo se liberaba
 * con el efecto `[pathname, children]`. Con el mismo pathname el slot `children` del layout NO cambia, así que el indicador
 * quedaba hasta el respaldo de 8 s. El harness ejecuta el AppShell REAL (el de `main` en BASE y el del working tree) con un
 * mini-runtime de hooks y timers controlados: no es un navegador ni mide red real.
 */
const BASE = "ec1de1e6052ac6f510235505464ab11ef5c779cd";
const hasBase = (() => { try { execFileSync("git", ["cat-file", "-e", `${BASE}^{commit}`], { stdio: "ignore" }); return true; } catch { return false; } })();
const nativeRequire = createRequire(import.meta.url);

type Fn = (...args: unknown[]) => unknown;
type Nodo = { type?: unknown; props?: Record<string, unknown> };

function crearRuntime() {
  const slots: { v?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  const pendientes: (() => void)[] = [];
  let i = 0;
  let sucio = false;
  const iguales = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
  const react = {
    useState(init: unknown) {
      const k = i++;
      if (!slots[k]) slots[k] = { v: typeof init === "function" ? (init as Fn)() : init };
      const s = slots[k];
      return [s.v, (n: unknown) => {
        const nv = typeof n === "function" ? (n as Fn)(s.v) : n;
        if (!Object.is(nv, s.v)) { s.v = nv; sucio = true; }
      }];
    },
    useMemo(fn: Fn, deps: unknown[]) {
      const k = i++;
      const s = slots[k];
      if (s && iguales(s.deps, deps)) return s.v;
      const v = fn();
      slots[k] = { v, deps };
      return v;
    },
    useEffect(fn: () => (() => void) | void, deps: unknown[]) {
      const k = i++;
      const previo = slots[k];
      if (previo && iguales(previo.deps, deps)) return;
      const s = (slots[k] = { deps } as { deps: unknown[]; cleanup?: () => void });
      pendientes.push(() => {
        previo?.cleanup?.();
        const c = fn();
        s.cleanup = typeof c === "function" ? c : undefined;
      });
    },
  };
  return {
    react,
    render<T>(fn: () => T): T {
      i = 0;
      const tree = fn();
      for (const efecto of pendientes.splice(0)) efecto();
      return tree;
    },
    get sucio() { return sucio; },
    limpiar() { sucio = false; },
  };
}

function elementos(nodo: unknown): Nodo[] {
  if (Array.isArray(nodo)) return nodo.flatMap(elementos);
  if (!nodo || typeof nodo !== "object") return [];
  const e = nodo as Nodo;
  return [e, ...elementos(e.props?.children)];
}

function montar(version: "base" | "nuevo") {
  const rt = crearRuntime();
  const url = { pathname: "/e/a/flota", search: "tab=dashboard" };
  const Marcador = () => null;
  const ShellNavLink = () => null;
  const ventana = { setTimeout, clearTimeout, setInterval, clearInterval, location: { hostname: "localhost" } };
  const modulos: Record<string, unknown> = {
    react: rt.react,
    "next/navigation": { usePathname: () => url.pathname, useSearchParams: () => new URLSearchParams(url.search) },
    "@/lib/permisos-catalogo": catalogo,
    "@/lib/permisos-shared": permisos,
    "@/lib/roles": roles,
    "@/lib/sidebar-activo": sidebar,
    "@/lib/facturacion/capacidades": facturacion,
    "@/lib/proveedores/acceso": proveedores,
    "@/lib/dominios": { mapaDominios: () => ({}) },
    "@/lib/empresa-session": { EmpresaSessionProvider: Marcador },
    "@/components/shell-nav-link": { ShellNavLink },
    "@/components/notificaciones-bell": { NotificacionesBell: Marcador },
    "@/components/theme-toggle": { ThemeToggle: Marcador },
    "@/components/account-menu": { AccountMenu: Marcador },
    "@/components/novalvion-brand": { NovalvionIcono: Marcador },
  };
  const fuente = version === "base"
    ? execFileSync("git", ["show", `${BASE}:src/components/app-shell.tsx`], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
    : readFileSync("src/components/app-shell.tsx", "utf8");
  const codigo = ts.transpileModule(fuente, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exportado: Record<string, Fn> = {};
  runInNewContext(codigo, {
    exports: exportado, require: (id: string) => (id in modulos ? modulos[id] : nativeRequire(id)),
    window: ventana, document: { body: { style: {} } }, setTimeout, clearTimeout, console,
  });

  const hijos = { hijo: "contenido de la página" }; // `children` estable: no cambia de identidad entre renders
  const props = { slug: "a", empresaNombre: "Empresa", username: "admin", rol: "Admin", modulos: ["flota", "rrhh", "tms"], permisos: [], children: hijos };
  let arbol = rt.render(() => exportado.AppShell(props));
  const asentar = () => {
    for (let n = 0; n < 25; n++) {
      vi.advanceTimersByTime(0);
      if (!rt.sucio) return;
      rt.limpiar();
      arbol = rt.render(() => exportado.AppShell(props));
    }
  };
  asentar();
  const api = {
    url,
    get arbol() { return arbol; },
    asentar,
    avanzar(ms: number) { vi.advanceTimersByTime(ms); asentar(); },
    /** Simula que el router confirmó una nueva URL (pathname y/o query). */
    navegarA(pathname: string, search: string) {
      url.pathname = pathname; url.search = search;
      arbol = rt.render(() => exportado.AppShell(props));
      asentar();
    },
    abrirGrupos() {
      for (const b of elementos(arbol)) {
        if (b.type === "button" && String(b.props?.className ?? "").includes("w-full items-center gap-2")) (b.props?.onClick as () => void)();
      }
      asentar();
    },
    enlaces() {
      return elementos(arbol).filter(e => e.type === ShellNavLink).map(e => ({ href: String(e.props?.href), label: String(e.props?.children), onNavigate: e.props?.onNavigate as () => void }));
    },
    gris() {
      const main = elementos(arbol).find(e => e.type === "main");
      return String(main?.props?.className ?? "").includes("opacity-70");
    },
  };
  return api;
}

type Medicion = { activo: boolean; liberadoEnMs: number | null };
/** Mide cuánto tiempo (ms) permanece `opacity-70` tras un clic; el router «confirma» la URL en `confirmaEnMs`. */
function medir(version: "base" | "nuevo", href: string | ((enlaces: { href: string }[]) => string), confirmacion: { enMs: number; pathname: string; search: string } | null): Medicion {
  const shell = montar(version);
  shell.abrirGrupos();
  const enlaces = shell.enlaces();
  const destino = typeof href === "function" ? href(enlaces) : href;
  const link = enlaces.find(l => l.href === destino);
  expect(link, `enlace ${destino}`).toBeDefined();
  link!.onNavigate();
  shell.asentar();
  const activo = shell.gris();
  if (!activo) return { activo: false, liberadoEnMs: null };
  for (let t = 10; t <= 9000; t += 10) {
    shell.avanzar(10);
    if (confirmacion && t === confirmacion.enMs) shell.navegarA(confirmacion.pathname, confirmacion.search);
    if (!shell.gris()) return { activo: true, liberadoEnMs: t };
  }
  return { activo: true, liberadoEnMs: Infinity };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("debeMarcarNavegacionPendiente (regla pura)", () => {
  it("mismo pathname y solo cambia ?tab= → NO activa el indicador global", () => {
    expect(debeMarcarNavegacionPendiente("/e/a/flota", "/e/a/flota?tab=vehiculos", false)).toBe(false);
    expect(debeMarcarNavegacionPendiente("/e/a/flota", "/e/a/flota", false)).toBe(false);
    expect(debeMarcarNavegacionPendiente("/e/a/flota/", "/e/a/flota?tab=servicios", false)).toBe(false);
  });
  it("distinto pathname → SÍ lo activa (navegación real entre páginas)", () => {
    expect(debeMarcarNavegacionPendiente("/e/a/flota", "/e/a/rrhh/empleados", false)).toBe(true);
    expect(debeMarcarNavegacionPendiente("/e/a/flota", "/e/a/flota-otra?tab=x", false)).toBe(true);
    expect(debeMarcarNavegacionPendiente("/e/a/rrhh", "/e/a/rrhh/vacaciones", false)).toBe(true);
  });
  it("el enlace activo nunca lo activa (comportamiento previo)", () => {
    expect(debeMarcarNavegacionPendiente("/e/a/rrhh", "/e/b/rrhh", true)).toBe(false);
  });
  it("conserva el respaldo de 8 s", () => {
    expect(NAV_PENDING_FALLBACK_MS).toBe(8000);
  });
});

describe("AppShell real — cambio de pestaña de Flota (mismo pathname)", () => {
  it("clic en otra pestaña del sidebar: NO activa barra ni opacidad global; el enlace conserva su href", () => {
    const shell = montar("nuevo");
    shell.abrirGrupos();
    const tabs = shell.enlaces().filter(l => l.href.startsWith("/e/a/flota?tab="));
    expect(tabs.length).toBeGreaterThan(3);
    for (const link of tabs) {
      link.onNavigate();
      shell.asentar();
      expect(shell.gris(), link.href).toBe(false);
    }
  });

  it("clic a otra página real SÍ activa el indicador y se libera cuando el router confirma la URL", () => {
    const shell = montar("nuevo");
    shell.abrirGrupos();
    const otra = shell.enlaces().find(l => !l.href.startsWith("/e/a/flota"))!;
    otra.onNavigate();
    shell.asentar();
    expect(shell.gris()).toBe(true);
    shell.avanzar(540);
    expect(shell.gris()).toBe(true); // el router aún no confirmó
    shell.navegarA(new URL(otra.href, "https://x").pathname, "");
    shell.avanzar(1);
    expect(shell.gris()).toBe(false);
  });

  it("ya activo: un cambio SOLO de search params (mismo pathname) lo libera sin esperar 8 s", () => {
    const shell = montar("nuevo");
    shell.abrirGrupos();
    shell.enlaces().find(l => !l.href.startsWith("/e/a/flota"))!.onNavigate();
    shell.asentar();
    expect(shell.gris()).toBe(true);
    shell.avanzar(300);
    expect(shell.gris()).toBe(true);
    shell.navegarA("/e/a/flota", "tab=vehiculos"); // solo cambió la query; `children` no cambió
    shell.avanzar(1);
    expect(shell.gris()).toBe(false);
  });

  it("si la navegación se cancela el respaldo sigue liberando a los 8 s (ni antes ni después)", () => {
    const shell = montar("nuevo");
    shell.abrirGrupos();
    shell.enlaces().find(l => !l.href.startsWith("/e/a/flota"))!.onNavigate();
    shell.asentar();
    shell.avanzar(NAV_PENDING_FALLBACK_MS - 10);
    expect(shell.gris()).toBe(true);
    shell.avanzar(10);
    expect(shell.gris()).toBe(false);
  });

  it("menús y permisos iguales: mismos enlaces (href y etiqueta) que en BASE", () => {
    if (!hasBase) return;
    const a = montar("base"); a.abrirGrupos();
    const b = montar("nuevo"); b.abrirGrupos();
    const norm = (s: ReturnType<typeof montar>) => s.enlaces().map(l => `${l.href} | ${l.label}`);
    expect(norm(b)).toEqual(norm(a));
    expect(norm(b).length).toBeGreaterThan(10);
  });
});

describe.skipIf(!hasBase)("medición antes/después (harness local, timers controlados)", () => {
  const otraPagina = (enlaces: { href: string }[]) => enlaces.find(l => !l.href.startsWith("/e/a/flota"))!.href;

  it("Flota: clic en la pestaña Vehículos del sidebar — opacity-70 en BASE vs nuevo", () => {
    const confirmacion = { enMs: 540, pathname: "/e/a/flota", search: "tab=vehiculos" };
    const base = medir("base", "/e/a/flota?tab=vehiculos", confirmacion);
    const nuevo = medir("nuevo", "/e/a/flota?tab=vehiculos", confirmacion);
    console.info("MEDICION FLOTA TAB", JSON.stringify({ base, nuevo, confirmacionRouterMs: confirmacion.enMs }));
    // BASE: aunque el router confirmó a los 540 ms, el indicador queda hasta el respaldo de 8 s.
    expect(base.activo).toBe(true);
    expect(base.liberadoEnMs).toBe(8000);
    // NUEVO: nunca se activa.
    expect(nuevo).toEqual({ activo: false, liberadoEnMs: null });
  });

  it("Navegación real entre páginas: se conserva el comportamiento (se libera al confirmar la URL, igual en BASE y nuevo)", () => {
    const shellBase = montar("base"); shellBase.abrirGrupos();
    const destino = otraPagina(shellBase.enlaces());
    const confirmacion = { enMs: 540, pathname: new URL(destino, "https://x").pathname, search: "" };
    const base = medir("base", destino, confirmacion);
    const nuevo = medir("nuevo", destino, confirmacion);
    console.info("MEDICION PAGINA REAL", JSON.stringify({ base, nuevo, destino }));
    expect(base.activo).toBe(true);
    expect(nuevo.activo).toBe(true);
    expect(nuevo.liberadoEnMs).toBe(base.liberadoEnMs);
    expect(nuevo.liberadoEnMs).toBeLessThanOrEqual(550);
  });

  it("Pendiente activo y cambio solo de ?tab= (pathname igual): BASE se queda 8 s, nuevo se libera al cambiar la URL", () => {
    const confirmacion = { enMs: 300, pathname: "/e/a/flota", search: "tab=servicios" };
    const base = medir("base", otraPagina, confirmacion);
    const nuevo = medir("nuevo", otraPagina, confirmacion);
    console.info("MEDICION CAMBIO SOLO QUERY", JSON.stringify({ base, nuevo }));
    expect(base.liberadoEnMs).toBe(8000);
    expect(nuevo.liberadoEnMs).toBeLessThanOrEqual(310);
  });
});
