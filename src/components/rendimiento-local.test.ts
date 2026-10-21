import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as catalogo from "@/lib/permisos-catalogo";
import * as permisos from "@/lib/permisos-shared";
import * as roles from "@/lib/roles";
import * as sidebar from "@/lib/sidebar-activo";
import * as facturacion from "@/lib/facturacion/capacidades";
import * as proveedores from "@/lib/proveedores/acceso";

const BASE = "9ccc0a0c786fd3c3b00aa3d23cd30feb4e7094eb";
// La comparación histórica requiere ese objeto git; no hacer fetch desde tests.
const hasBase = (() => { try { execFileSync("git", ["cat-file", "-e", `${BASE}^{commit}`], { stdio: "ignore" }); return true; } catch { return false; } })();
const nativeRequire = createRequire(import.meta.url);
type Tree = { type?: unknown; props?: Record<string, unknown> };
type Fn = (...args: unknown[]) => unknown;

function harness(base: boolean) {
  const effects: (() => (() => void) | void)[] = [];
  const callbacks: Fn[] = [];
  const store = new Map<string, string>();
  const events = new Map<string, Fn>();
  const prefetch = vi.fn();
  const nav = vi.fn();
  const router = { prefetch, replace: vi.fn(), refresh: vi.fn() };
  let opened = false;
  const Marker = () => null;
  const react = {
    useRef: (current: unknown) => ({ current }),
    useState: (initial: unknown) => [initial && typeof initial === "object" && Object.keys(initial).length === 0
      ? (opened ? Object.fromEntries(["rrhh", "atraccion-talento", "operaciones", "flota", "clientes", "contabilidad", "cms", "admin"].map(k => [k, true])) : {}) : initial, vi.fn()],
    useCallback: (fn: Fn) => { callbacks.push(fn); return fn; },
    useEffect: (fn: () => (() => void) | void) => { effects.push(fn); },
    useMemo: (fn: () => unknown) => fn(),
  };
  const eventTarget = {
    visibilityState: "visible",
    addEventListener: (name: string, fn: Fn) => events.set(name, fn),
    removeEventListener: (name: string) => events.delete(name),
    setInterval, clearInterval, setTimeout, clearTimeout,
  };
  const modules: Record<string, unknown> = {
    react,
    "next/link": { default: Marker, useLinkStatus: () => ({ pending: false }) },
    "next/navigation": { useRouter: () => router, usePathname: () => "/e/a/rrhh/empleados", useSearchParams: () => new URLSearchParams() },
    "@/lib/permisos-catalogo": catalogo,
    "@/lib/permisos-shared": permisos,
    "@/lib/roles": roles,
    "@/lib/sidebar-activo": sidebar,
    "@/lib/facturacion/capacidades": facturacion,
    "@/lib/proveedores/acceso": proveedores,
    "@/lib/dominios": { mapaDominios: () => ({}) },
    "@/lib/empresa-session": { EmpresaSessionProvider: Marker },
    "@/components/shell-nav-link": { ShellNavLink: Marker },
    "@/components/notificaciones-bell": { NotificacionesBell: Marker },
    "@/components/theme-toggle": { ThemeToggle: Marker },
    "@/components/account-menu": { AccountMenu: Marker },
    "@/components/novalvion-brand": { NovalvionIcono: Marker },
  };
  const load = (path: string): Record<string, Fn> => {
    const source = base ? execFileSync("git", ["show", `${BASE}:${path}`], { encoding: "utf8" }) : readFileSync(path, "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const exports: Record<string, Fn> = {};
    runInNewContext(code, {
      exports, require: (id: string) => id in modules ? modules[id] : nativeRequire(id),
      setTimeout, clearTimeout, setInterval, clearInterval, Date, AbortController, URLSearchParams,
      window: eventTarget, document: eventTarget, fetch: (...args: unknown[]) => globalThis.fetch(...args as Parameters<typeof fetch>),
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
      console,
    });
    return exports;
  };
  modules["@/lib/session-activity-client"] = load("src/lib/session-activity-client.ts");
  if (!base) modules["@/lib/session-navigation"] = load("src/lib/session-navigation.ts");
  return { load, effects, callbacks, store, events, prefetch, nav, activityKey: (modules["@/lib/session-activity-client"] as { activityStorageKey: (kind: string) => string }).activityStorageKey("staff"), opened: () => { opened = true; }, Marker };
}

function links(node: unknown, marker: unknown): Tree[] {
  if (Array.isArray(node)) return node.flatMap(n => links(n, marker));
  if (!node || typeof node !== "object") return [];
  const element = node as Tree;
  return [...(element.type === marker && typeof element.props?.href === "string" ? [element] : []), ...links(element.props?.children, marker)];
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T20:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.skipIf(!hasBase)("medición sidebar Admin: cerrados 0; RRHH abierto 18; hovers/focus/touch base=18, nuevo=0", async () => {
  const counts = [];
  for (const base of [true, false]) {
    const h = harness(base);
    const shell = h.load("src/components/app-shell.tsx").AppShell;
    const props = { slug: "a", empresaNombre: "Empresa", username: "admin", rol: "Admin", modulos: ["rrhh", "tms", "flota", "clientes", "contabilidad", "facturacion", "cms", "usuarios", "gerencia"], children: null };
    expect(links(shell(props), h.Marker)).toHaveLength(0);
    h.opened();
    const allLinks = links(shell(props), h.Marker);
    expect(h.prefetch).not.toHaveBeenCalled(); // ni render abierto precarga manualmente
    const rrhhLinks = allLinks.filter(l => String(l.props?.href).includes("/rrhh/") || String(l.props?.href).endsWith("/dashboard-rrhh"));
    const link = h.load("src/components/shell-nav-link.tsx").ShellNavLink;
    for (const route of rrhhLinks) {
      const element = link({ href: route.props?.href, children: "enlace", onNavigate: h.nav }) as Tree;
      for (const event of ["onMouseEnter", "onFocus", "onTouchStart"]) {
        (element.props?.[event] as (() => void) | undefined)?.();
        await vi.advanceTimersByTimeAsync(50);
      }
      expect(element.props?.prefetch).toBe(false);
    }
    const element = link({ href: "/e/a/rrhh/empleados", children: "enlace", onNavigate: h.nav }) as Tree;
    (element.props?.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.nav).toHaveBeenCalledOnce();
    // C-1 traslada Combustibles; comparar los demás enlaces, no su ubicación anterior.
    const sinCombustible = allLinks.filter(l => !["/e/a/combustibles", "/e/a/flota?tab=combustible"].includes(String(l.props?.href)));
    counts.push({ links: sinCombustible.length, rrhh: rrhhLinks.length, prefetch: h.prefetch.mock.calls.length });
  }
  expect(counts[0].links).toBe(counts[1].links);
  expect(counts[0].rrhh).toBe(counts[1].rrhh);
  expect(counts[0].prefetch).toBe(counts[0].rrhh);
  expect(counts[1].prefetch).toBe(0);
  console.info("MEDICION SIDEBAR", JSON.stringify(counts));
});

it.skipIf(!hasBase)("medición campana: inicial + 2 ticks con fetch pendiente, base=3 / nuevo=1", async () => {
  const counts = [];
  for (const base of [true, false]) {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const h = harness(base);
    h.load("src/components/notificaciones-bell.tsx").NotificacionesBell({ slug: "a", rol: "Admin" });
    const cleanup = h.effects[0]();
    await vi.advanceTimersByTimeAsync(302500);
    counts.push(fetcher.mock.calls.length);
    cleanup?.();
  }
  expect(counts).toEqual([3, 1]);
  console.info("MEDICION CAMPANA", JSON.stringify(counts));
});

it.skipIf(!hasBase)("medición activity: GET pendiente + humanos/foco, base=2 simultáneas / nuevo=1; humano diferido no perdido", async () => {
  const counts = [];
  for (const base of [true, false]) {
    const finishes: ((r: Response) => void)[] = [];
    const fetcher = vi.fn(() => new Promise<Response>(resolve => finishes.push(resolve)));
    vi.stubGlobal("fetch", fetcher);
    const h = harness(base);
    h.load("src/components/session-inactivity-guard.tsx").SessionInactivityGuard();
    const cleanup = h.effects[0](); // inicia GET real del guard
    h.events.get("pointerdown")?.({ isTrusted: true, type: "pointerdown" });
    h.events.get("focus")?.();
    h.events.get("visibilitychange")?.();
    h.events.get("keydown")?.({ isTrusted: true, type: "keydown" });
    counts.push(fetcher.mock.calls.length);
    const humanAt = h.store.get(h.activityKey);
    expect(humanAt).toBe(String(Date.now()));
    await vi.advanceTimersByTimeAsync(12000); // GET lento: no inventar nueva actividad
    const now = Date.now() / 1000;
    finishes[0](Response.json({ serverNow: now, lastActivityAt: now, idleExpiresAt: now + 1800, absoluteExpiresAt: now + 43200 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2); // segundo secuencial en nuevo, simultáneo en base
    h.events.get("focus")?.();
    h.events.get("visibilitychange")?.();
    expect(fetcher.mock.calls.length).toBe(base ? 3 : 2);
    if (!base) expect(h.store.get(h.activityKey)).toBe(humanAt);
    cleanup?.();
  }
  expect(counts).toEqual([2, 1]);
  console.info("MEDICION ACTIVITY", JSON.stringify(counts));
});

it("activity: GET 401 no drena humano pendiente; fallo de red permite POST posterior", async () => {
  for (const unauthorized of [true, false]) {
    const finishes: ((r: Response) => void)[] = [];
    const failures: ((e: Error) => void)[] = [];
    const fetcher = vi.fn(() => new Promise<Response>((resolve, reject) => { finishes.push(resolve); failures.push(reject); }));
    vi.stubGlobal("fetch", fetcher);
    const h = harness(false);
    h.load("src/components/session-inactivity-guard.tsx").SessionInactivityGuard();
    const cleanup = h.effects[0]();
    h.events.get("pointerdown")?.({ isTrusted: true, type: "pointerdown" });
    expect(fetcher).toHaveBeenCalledOnce();
    if (unauthorized) finishes[0](new Response(null, { status: 401 }));
    else failures[0](new Error("red"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const requests = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(requests[1][0]).toBe(unauthorized ? "/api/auth/logout" : "/api/auth/activity");
    expect(requests[1][1].method).toBe("POST");
    cleanup?.();
  }
});
