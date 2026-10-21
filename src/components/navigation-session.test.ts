import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const BASE = "b432bd80dc52d29c9b5584c73718099c276f24a2";
const hasBase = (() => { try { execFileSync("git", ["cat-file", "-e", `${BASE}^{commit}`], { stdio: "ignore" }); return true; } catch { return false; } })();
const nativeRequire = createRequire(import.meta.url);
type Node = { type?: unknown; props?: Record<string, unknown> };
type Fn = (...args: unknown[]) => unknown;
const all = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node as Node, ...all((node as Node).props?.children)] : [];
const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text((node as Node).props?.children) : String(node ?? "");
const empresas = [{ id: 1, codigo: "KT", nombre: "Kuiqtrans / Logiservicios Mónaco", slug: "kt-monaco", modulos: ["rrhh"] }, { id: 2, codigo: "B", nombre: "Empresa B", slug: "b", modulos: ["rrhh"] }];
const user = { username: "fixture", rol: "RRHH" };

// Mismo patrón VM + hooks controlados de app-shell-navegacion-pendiente.test.ts.
// Ejecuta los handlers reales; NO es un navegador ni mide producción.
function mount(version: "base" | "head", selector = false, automatico = false, meDelay = 0) {
  const slots: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  let index = 0, tree: unknown;
  const effects: (() => void)[] = [];
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(init: unknown) {
      const i = index++;
      slots[i] ??= { value: typeof init === "function" ? (init as Fn)() : init };
      return [slots[i].value, (next: unknown) => { slots[i].value = typeof next === "function" ? (next as Fn)(slots[i].value) : next; }];
    },
    useRef(value: unknown) { const i = index++; slots[i] ??= { value: { current: value } }; return slots[i].value; },
    useMemo(fn: () => unknown, deps: unknown[]) { const i = index++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn: Fn, deps: unknown[]) { return react.useMemo(() => fn, deps); },
    useEffect(fn: () => (() => void) | void, deps: unknown[]) {
      const i = index++;
      if (same(slots[i]?.deps, deps)) return;
      const old = slots[i]; slots[i] = { deps };
      effects.push(() => { old?.cleanup?.(); const cleanup = fn(); slots[i].cleanup = typeof cleanup === "function" ? cleanup : undefined; });
    },
  };
  const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), document: vi.fn() };
  const navigation = { pathname: "/e/kt-monaco/rrhh" };
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>(r => { resolve = r; });
  const fetchFn = vi.fn(async (url: string) => {
    if (url !== "/api/auth/me") return pending.then(r => r.clone());
    if (meDelay) await new Promise(r => setTimeout(r, meDelay));
    return new Response(JSON.stringify({ user, empresas: automatico ? empresas.slice(0, 1) : empresas }));
  });
  const modules: Record<string, unknown> = {
    react, "next/link": "Link", "next/navigation": { useRouter: () => router, usePathname: () => navigation.pathname },
    "@/lib/permisos-shared": { labelRol: (r: string) => r }, "@/components/novalvion-brand": { NovalvionIcono: "Icon" },
  };
  const load = (path: string, old = false) => {
    const source = old ? execFileSync("git", ["show", `${BASE}:${path}`], { encoding: "utf8" }) : readFileSync(path, "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const exported: Record<string, Fn> = {};
    runInNewContext(code, { exports: exported, require: (id: string) => id in modules ? modules[id] : nativeRequire(id), fetch: fetchFn,
      window: { setTimeout, clearTimeout, location: { replace: router.document } }, document: { addEventListener: vi.fn(), removeEventListener: vi.fn() }, console });
    return exported;
  };
  if (version === "head") modules["@/lib/session-navigation"] = load("src/lib/session-navigation.ts");
  const exported = load(selector ? version === "base" ? "src/app/select-empresa/page.tsx" : "src/app/select-empresa/select-empresa-client.tsx" : "src/components/account-menu.tsx", version === "base");
  const link = load("src/components/shell-nav-link.tsx", version === "base").ShellNavLink;
  const component = selector ? version === "base" ? exported.default : exported.SelectEmpresaClient : exported.AccountMenu;
  const props = selector ? { user, empresas: automatico ? empresas.slice(0, 1) : empresas } : { slug: "kt-monaco", empresaNombre: empresas[0].nombre, username: "fixture", rol: "RRHH", dominioEmpresa: false };
  const render = () => { index = 0; tree = component(props); effects.splice(0).forEach(e => e()); return tree; };
  render(); vi.advanceTimersByTime(0); render();
  return {
    router, fetchFn, resolve, render, navigation, link,
    nodes: () => all(tree),
    button: (label: string) => all(tree).find(n => n.type === "button" && text(n) === label)!,
    open: () => { const button = all(tree).find(n => n.props?.["aria-haspopup"] === "menu")!; (button.props!.onClick as Fn)(); render(); },
    flush: async () => { await vi.advanceTimersByTimeAsync(0); for (let i = 0; i < 15; i++) await Promise.resolve(); render(); },
    dispose: () => slots.forEach(s => s.cleanup?.()),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.skipIf(!hasBase)("BASE: dos invocaciones antes de respuesta producen dos POST/logout y dos navegaciones", async () => {
  const m = mount("base"); m.open();
  const click = m.button("Salir").props!.onClick as Fn;
  click(); click();
  expect(m.fetchFn).toHaveBeenCalledTimes(2);
  m.resolve(new Response("{}")); await m.flush();
  expect(m.router.push).toHaveBeenCalledTimes(2);
  console.info("BASE LOGOUT", { requests: m.fetchFn.mock.calls.length, navegaciones: m.router.push.mock.calls.length });
  m.dispose();
});

it.skipIf(!hasBase)("BASE: selector dispara GET/me y permite dos POST/selección simultáneos", async () => {
  const m = mount("base", true); await m.flush();
  const button = m.nodes().find(n => n.type === "button" && text(n).includes(empresas[0].nombre))!;
  const click = button.props!.onClick as Fn; click(); click();
  expect(m.fetchFn.mock.calls.map(c => c[0])).toEqual(["/api/auth/me", "/api/auth/select-empresa", "/api/auth/select-empresa"]);
  m.resolve(new Response(JSON.stringify({ redirect: "/e/kt-monaco/dashboard-rrhh" }))); await m.flush();
  expect(m.router.push).toHaveBeenCalledTimes(2);
  console.info("BASE SELECCION", { requests: m.fetchFn.mock.calls.length, navegaciones: m.router.push.mock.calls.length });
  m.dispose();
});

it.skipIf(!hasBase)("waterfall local: GET/me tarda 400 ms inyectados en BASE; HEAD tiene botones desde el render inicial", async () => {
  const base = mount("base", true, false, 400);
  expect(base.nodes().filter(n => n.type === "button")).toHaveLength(1); // Solo Salir mientras espera /me.
  await vi.advanceTimersByTimeAsync(399); base.render();
  expect(base.nodes().filter(n => n.type === "button")).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); await base.flush();
  expect(base.nodes().filter(n => n.type === "button")).toHaveLength(3);
  const head = mount("head", true, false, 400);
  expect(head.nodes().filter(n => n.type === "button")).toHaveLength(3);
  expect(head.fetchFn).not.toHaveBeenCalled();
  base.dispose(); head.dispose();
});

it("HEAD: logout al primer clic, feedback inmediato y segundo clic no duplica POST/navegación", async () => {
  const m = mount("head"); m.open();
  const click = m.button("Salir").props!.onClick as Fn; click(); click(); m.render();
  await m.flush();
  expect(m.fetchFn).toHaveBeenCalledTimes(1);
  expect(m.button("Saliendo…").props!.disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(10000); // Un POST lento no se libera por timeout de UI.
  click(); expect(m.fetchFn).toHaveBeenCalledTimes(1);
  m.resolve(new Response("{}")); await m.flush();
  expect(m.router.document).toHaveBeenCalledExactlyOnceWith("/login");
  expect(m.router.push).not.toHaveBeenCalled(); expect(m.router.refresh).not.toHaveBeenCalled();
  m.dispose();
});

it("HEAD: error de logout visible, sin navegación y se permite reintentar", async () => {
  const m = mount("head"); m.open(); (m.button("Salir").props!.onClick as Fn)();
  m.resolve(new Response("{}", { status: 500 })); await m.flush();
  expect(m.nodes().some(n => n.props?.role === "alert")).toBe(true);
  expect(m.button("Salir").props!.disabled).toBe(false);
  expect(m.router.document).not.toHaveBeenCalled();
  (m.button("Salir").props!.onClick as Fn)(); await m.flush();
  expect(m.fetchFn).toHaveBeenCalledTimes(2);
  m.dispose();
});

it("HEAD: Cambiar empresa permite una navegación Link, bloquea la repetida y conserva href", () => {
  const m = mount("head"); m.open();
  const link = m.nodes().find(n => n.props?.href === "/select-empresa")!;
  const preventDefault = vi.fn();
  const onNavigate = link.props!.onNavigate as Fn;
  onNavigate({ preventDefault }); expect(preventDefault).not.toHaveBeenCalled();
  onNavigate({ preventDefault }); expect(preventDefault).toHaveBeenCalledTimes(1);
  m.render(); expect(m.nodes().some(n => text(n) === "Cambiando empresa…")).toBe(true);
  expect(m.fetchFn).not.toHaveBeenCalled();
  expect(m.router.refresh).not.toHaveBeenCalled(); expect(link.props!.prefetch).toBe(false);
  m.dispose();
});

it("HEAD: selector tiene empresas desde el primer render, sin GET/me; dos clics comparten un POST", async () => {
  const m = mount("head", true);
  expect(m.fetchFn).not.toHaveBeenCalled();
  const button = m.nodes().find(n => n.type === "button" && text(n).includes(empresas[0].nombre))!;
  const click = button.props!.onClick as Fn; click(); click(); m.render();
  await m.flush();
  expect(m.fetchFn).toHaveBeenCalledTimes(1);
  expect(m.fetchFn.mock.calls[0][0]).toBe("/api/auth/select-empresa");
  expect(m.nodes().filter(n => n.type === "button").every(n => n.props!.disabled)).toBe(true);
  (m.button("Salir").props!.onClick as Fn)(); // Selección y logout no compiten.
  expect(m.fetchFn).toHaveBeenCalledTimes(1);
  m.resolve(new Response(JSON.stringify({ redirect: "/e/kt-monaco/dashboard-rrhh" }))); await m.flush();
  expect(m.router.document).toHaveBeenCalledExactlyOnceWith("/e/kt-monaco/dashboard-rrhh");
  expect(m.router.refresh).not.toHaveBeenCalled();
  m.dispose();
});

it("HEAD: empresa única, effect repetido/re-render y clic manual no duplican auto-selección", async () => {
  const m = mount("head", true, true); m.render(); m.render();
  const button = m.nodes().find(n => n.type === "button" && text(n).includes(empresas[0].nombre))!;
  (button.props!.onClick as Fn)();
  await m.flush();
  expect(m.fetchFn).toHaveBeenCalledTimes(1);
  m.resolve(new Response(JSON.stringify({ redirect: "/e/kt-monaco/dashboard-rrhh" }))); await m.flush();
  expect(m.router.document).toHaveBeenCalledTimes(1);
  m.dispose();
});

it("HEAD: error/403 seleccionando otra empresa no navega y libera el selector", async () => {
  const m = mount("head", true);
  const button = m.nodes().find(n => n.type === "button" && text(n).includes(empresas[1].nombre))!;
  (button.props!.onClick as Fn)(); m.resolve(new Response(JSON.stringify({ error: "Sin acceso" }), { status: 403 })); await m.flush();
  expect(m.router.document).not.toHaveBeenCalled();
  expect(m.nodes().some(n => n.props?.role === "alert" && text(n).includes("Sin acceso"))).toBe(true);
  expect(m.nodes().filter(n => n.type === "button").every(n => !n.props!.disabled)).toBe(true);
  m.dispose();
});

it("HEAD: logout del selector también es single-flight", async () => {
  const m = mount("head", true);
  const click = m.button("Salir").props!.onClick as Fn; click(); click(); m.render();
  await m.flush();
  expect(m.fetchFn).toHaveBeenCalledTimes(1); expect(m.button("Saliendo…").props!.disabled).toBe(true);
  m.resolve(new Response("{}")); await m.flush();
  expect(m.router.document).toHaveBeenCalledExactlyOnceWith("/login"); m.dispose();
});

for (const [origen, destino] of [
  ["rrhh", "rrhh/empleados"], ["rrhh/empleados", "dashboard-rrhh"],
  ["rrhh", "dashboard-operaciones"], ["dashboard-operaciones", "programacion"],
]) it(`${origen} → ${destino}: Link conserva un único intento, sin fetch/prefetch manual`, () => {
  for (const version of hasBase ? ["base", "head"] as const : ["head"] as const) {
    const m = mount(version);
    m.navigation.pathname = `/e/kt-monaco/${origen}`;
    const onNavigate = vi.fn(), href = `/e/kt-monaco/${destino}`;
    const node = m.link({ href, children: "Destino", onNavigate }) as Node;
    expect(node.props!.href).toBe(href); expect(node.props!.prefetch).toBe(false);
    (node.props!.onClick as Fn)();
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(m.fetchFn).not.toHaveBeenCalled(); expect(m.router.refresh).not.toHaveBeenCalled();
    m.dispose();
  }
});
