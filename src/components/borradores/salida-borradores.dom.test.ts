// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: (props: { href: string; children?: unknown } & Record<string, unknown>) => {
    const { href, children, ...resto } = props;
    void resto;
    return createElement("a", { href }, children as never);
  },
}));
const mocks = vi.hoisted(() => ({ pathname: "/e/kuiqtrans/dashboard" }));

import { AccountMenu } from "@/components/account-menu";
import { RegistroSalidaBorradores } from "@/components/borradores/registro-salida";
import { SessionInactivityGuard } from "@/components/session-inactivity-guard";
import { SelectEmpresaClient } from "@/app/select-empresa/select-empresa-client";
import { crearAlmacenIndexedDB, crearNucleoBorradores, type AmbitoBorrador, type TipoBorrador } from "@/lib/borradores";
import { reiniciarSalidaStaff } from "@/lib/session-navigation";

/**
 * BORR-1b — pruebas de COMPONENTES (happy-dom + fake-indexeddb, sin red real ni Hostinger) del flujo de salida:
 * registro efectivo del gancho, diálogo de confirmación, continuación y cancelación del logout, y salida automática
 * (expiración / HTTP 401) SIN limpieza. Datos ficticios.
 */
const U1 = "o1_usuario-ficticio-uno";
const U2 = "o1_usuario-ficticio-dos";
const TIPOS: TipoBorrador[] = ["solicitud_fondo", "gasto_operativo", "requerimiento_compra"];
const ambito = (ownerKey: string, tipo: TipoBorrador): AmbitoBorrador => ({ ownerKey, empresaId: 1, empresaSlug: "kuiqtrans", tipo });

let host: HTMLDivElement;
let root: Root;
let confirmar: ReturnType<typeof vi.fn>;
let reemplazar: ReturnType<typeof vi.fn>;
let llamadas: { url: string; method: string }[];
let respuestaActividad: () => Response;

function nucleo() {
  return crearNucleoBorradores({ almacen: crearAlmacenIndexedDB(), appBuild: "prueba-dom" });
}

async function sembrar(ownerKey: string, tipos: TipoBorrador[] = TIPOS) {
  const n = nucleo();
  for (const t of tipos) {
    const r = await n.guardar(ambito(ownerKey, t), { payload: { dato: `${ownerKey}-${t}` }, esquemaVersion: 1, revisionBase: null });
    if (!r.ok) throw new Error(`no se pudo sembrar: ${r.motivo}`);
  }
}

async function contar(ownerKey: string): Promise<number> {
  const r = await nucleo().listarMetadatosUsuario(ownerKey);
  if (!r.ok) throw new Error(`no se pudo contar: ${r.motivo}`);
  return r.valor.borradores.length;
}

type Elemento = [ComponentType<never>, object];
async function renderizar(...elementos: Elemento[]) {
  await act(async () => { root.render(createElement("div", null, ...elementos.map((e, i) => createElement(e[0] as ComponentType<object>, { key: i, ...e[1] })))); });
  // El menú de cuenta cierra su dropdown con un setTimeout(0) tras montar ("cerrar al navegar"): se espera antes de interactuar.
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

const botones = () => [...host.querySelectorAll("button")];
const botonPorTexto = (t: string) => botones().find((b) => b.textContent?.trim() === t);
async function clic(el: Element | undefined) {
  if (!el) throw new Error("botón no encontrado");
  await act(async () => { (el as HTMLElement).click(); });
}
async function abrirMenuYSalir() {
  await clic(host.querySelector("button[aria-haspopup]") ?? botones()[0]);
  await clic(botonPorTexto("Salir"));
}
const llamo = (url: string) => llamadas.filter((l) => l.url === url).length;
const esperar = (fn: () => void, timeout = 3000) => vi.waitFor(fn, { timeout, interval: 20 });

const PROPS_MENU = { slug: "kuiqtrans", empresaNombre: "Empresa de prueba", username: "usuario.demo", rol: "Operaciones", dominioEmpresa: false };
const EMPRESAS = [
  { id: 1, codigo: "A", nombre: "Empresa A", slug: "empresa-a", modulos: ["tms"] },
  { id: 2, codigo: "B", nombre: "Empresa B", slug: "empresa-b", modulos: ["tms"] },
];

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("indexedDB", new IDBFactory()); // base limpia por prueba
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.pathname = "/e/kuiqtrans/dashboard";
  confirmar = vi.fn(() => true);
  (window as unknown as { confirm: unknown }).confirm = confirmar;
  reemplazar = vi.fn();
  vi.spyOn(window.location, "replace").mockImplementation(reemplazar as never);
  llamadas = [];
  respuestaActividad = () => new Response(JSON.stringify({ serverNow: 1, lastActivityAt: 1, idleExpiresAt: 2, absoluteExpiresAt: 3 }), { status: 200 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    llamadas.push({ url, method: metodo });
    if (url === "/api/auth/logout") return new Response("{}", { status: 200 });
    if (url === "/api/auth/select-empresa") return new Response(JSON.stringify({ redirect: "/e/empresa-a/dashboard" }), { status: 200 });
    if (url === "/api/auth/activity") return respuestaActividad();
    return new Response("{}", { status: 200 });
  }));
  reiniciarSalidaStaff();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("menú de cuenta: salida EXPLÍCITA con el gancho registrado", () => {
  it("con borradores: abre el diálogo informando cuántos hay; «conservar» continúa el logout y no borra nada", async () => {
    await sembrar(U1); await sembrar(U2, ["gasto_operativo"]);
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(String(confirmar.mock.calls[0]![0])).toMatch(/3 borradores sin terminar/);
    expect(String(confirmar.mock.calls[0]![0])).toMatch(/sin respaldo/i);
    expect(reemplazar).toHaveBeenCalledWith("/login");
    expect(await contar(U1)).toBe(3); // conservados
    expect(await contar(U2)).toBe(1);
  });

  it("cancelar (rechazar ambos diálogos): NO cierra sesión, NO borra, el menú no queda bloqueado y se puede reintentar", async () => {
    await sembrar(U1);
    confirmar.mockReturnValue(false);
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(confirmar).toHaveBeenCalledTimes(2)); // conservar → no; borrar → no
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(llamo("/api/auth/logout")).toBe(0);
    expect(reemplazar).not.toHaveBeenCalled();
    expect(await contar(U1)).toBe(3);
    expect(host.textContent).not.toContain("Saliendo…"); // liberado
    expect(host.textContent).not.toContain("No se pudo cerrar sesión"); // cancelar no es un error
    // Reintento: ahora elige conservar y sale.
    confirmar.mockReset(); confirmar.mockReturnValue(true);
    if (!botonPorTexto("Salir")) await clic(host.querySelector("button[aria-haspopup]") ?? botones()[0]);
    await clic(botonPorTexto("Salir"));
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
  });

  it("borrar (equipo compartido): elimina SOLO los borradores del usuario y el logout continúa", async () => {
    await sembrar(U1); await sembrar(U2);
    confirmar.mockReturnValueOnce(false).mockReturnValueOnce(true); // no conservar → sí borrar
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(await contar(U1)).toBe(0);
    expect(await contar(U2)).toBe(3);
  });

  it("sin borradores: no pregunta y el logout continúa", async () => {
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("si el diálogo falla o está bloqueado (window.confirm lanza): se CONSERVA y el logout continúa", async () => {
    await sembrar(U1);
    confirmar.mockImplementation(() => { throw new Error("diálogos bloqueados"); });
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(await contar(U1)).toBe(3);
  });

  it("sin gancho registrado (sin ownerKey / función desactivada): el logout sigue siendo el de siempre", async () => {
    await sembrar(U1);
    await renderizar([RegistroSalidaBorradores, { ownerKey: null }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(confirmar).not.toHaveBeenCalled();
    expect(await contar(U1)).toBe(3);
  });

  it("desmontar el registro retira el gancho: ya no se pregunta", async () => {
    await sembrar(U1);
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await renderizar([AccountMenu, PROPS_MENU]); // el registro se desmonta
    await abrirMenuYSalir();
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("IndexedDB no disponible: el logout NO se bloquea y no se pregunta ni se «borra» nada", async () => {
    await sembrar(U1);
    const real = indexedDB;
    vi.stubGlobal("indexedDB", undefined);
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(confirmar).not.toHaveBeenCalled();
    vi.stubGlobal("indexedDB", real);
    expect(await contar(U1)).toBe(3); // nada se eliminó
  });

  it("falla del almacenamiento DURANTE el borrado: el logout continúa y los borradores NO se dan por eliminados", async () => {
    await sembrar(U1);
    confirmar.mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => { throw new Error("fallo simulado"); });
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    vi.restoreAllMocks();
    expect(await contar(U1)).toBe(3);
  });

  it("IndexedDB que no responde: el logout continúa tras el tiempo máximo", async () => {
    await sembrar(U1);
    const colgada = { open: () => new Proxy({}, {}) } as unknown as IDBFactory; // open() devuelve una petición que nunca dispara eventos
    vi.stubGlobal("indexedDB", colgada);
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    const t0 = Date.now();
    await abrirMenuYSalir();
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1), 8000);
    expect(Date.now() - t0).toBeLessThan(7000);
    expect(confirmar).not.toHaveBeenCalled();
  }, 12000);
});

describe("selector de empresa", () => {
  const props = { empresas: EMPRESAS, user: { username: "usuario.demo", rol: "Operaciones" } };

  it("Salir pasa por el mismo gancho: cancelar no cierra sesión; conservar sí", async () => {
    await sembrar(U1);
    confirmar.mockReturnValue(false);
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [SelectEmpresaClient, props]);
    await clic(botonPorTexto("Salir"));
    await esperar(() => expect(confirmar).toHaveBeenCalledTimes(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(llamo("/api/auth/logout")).toBe(0);
    expect(await contar(U1)).toBe(3);
    confirmar.mockReset(); confirmar.mockReturnValue(true);
    await clic(botonPorTexto("Salir"));
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(await contar(U1)).toBe(3);
  });

  it("Salir → borrar elimina los borradores del usuario y continúa", async () => {
    await sembrar(U1); await sembrar(U2);
    confirmar.mockReturnValueOnce(false).mockReturnValueOnce(true);
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [SelectEmpresaClient, props]);
    await clic(botonPorTexto("Salir"));
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(await contar(U1)).toBe(0);
    expect(await contar(U2)).toBe(3);
  });

  it("CAMBIAR de empresa no borra ni pregunta por borradores", async () => {
    await sembrar(U1);
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [SelectEmpresaClient, props]);
    await clic(botones().find((b) => b.textContent?.includes("Empresa A")));
    await esperar(() => expect(llamo("/api/auth/select-empresa")).toBe(1));
    expect(confirmar).not.toHaveBeenCalled();
    expect(llamo("/api/auth/logout")).toBe(0);
    expect(await contar(U1)).toBe(3);
  });
});

describe("salida AUTOMÁTICA (guard de inactividad): nunca limpia", () => {
  it("HTTP 401 de la validación de sesión: cierra sesión SIN diálogo ni borrado, con el gancho registrado y borradores presentes", async () => {
    await sembrar(U1);
    respuestaActividad = () => new Response("{}", { status: 401 });
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [SessionInactivityGuard, {}]);
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(reemplazar).toHaveBeenCalledWith("/login");
    expect(confirmar).not.toHaveBeenCalled();
    expect(await contar(U1)).toBe(3); // conservados (aislados por ownerKey)
  });

  it("expiración confirmada por el reloj de sesión: cierra sesión SIN diálogo ni borrado", async () => {
    await sembrar(U1);
    const ahora = Math.floor(Date.now() / 1000);
    respuestaActividad = () => new Response(JSON.stringify({ serverNow: ahora, lastActivityAt: ahora, idleExpiresAt: ahora + 1, absoluteExpiresAt: ahora + 3600 }), { status: 200 });
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [SessionInactivityGuard, {}]);
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1), 6000);
    expect(confirmar).not.toHaveBeenCalled();
    expect(await contar(U1)).toBe(3);
  }, 10000);

  it("tras la salida por expiración otro usuario del mismo navegador no ve los borradores del anterior, y el dueño los recupera", async () => {
    await sembrar(U1);
    respuestaActividad = () => new Response("{}", { status: 401 });
    await renderizar([SessionInactivityGuard, {}]);
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(await contar(U2)).toBe(0);
    expect(await contar(U1)).toBe(3);
  });
});
