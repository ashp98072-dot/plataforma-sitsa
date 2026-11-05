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

const dialogo = () => document.querySelector('[role="alertdialog"]');
const textoDialogo = () => dialogo()?.textContent ?? "";
const botonDialogo = (texto: string) => [...(dialogo()?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === texto);
const fallarBorrado = () => vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => { throw new Error("fallo simulado de borrado"); });
const abrirBD = () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open("novalvion-borradores", 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
/** Mantiene abierta una transacción de escritura ~`ms` ms: cualquier operación posterior sobre la tienda queda en cola (lentitud real). */
function iniciarBloqueo(db: IDBDatabase, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction("borradores", "readwrite");
    const tienda = tx.objectStore("borradores");
    const fin = Date.now() + ms;
    const paso = () => { if (Date.now() >= fin) return; tienda.get("__bloqueo__").onsuccess = paso; };
    tx.oncomplete = () => { db.close(); resolve(); };
    paso();
  });
}

describe("borrado solicitado que NO se confirma: advertencia visible (nunca salida silenciosa)", () => {
  const consentirBorrar = () => confirmar.mockReturnValueOnce(false).mockReturnValueOnce(true); // 1.º «¿conservar?» no → 2.º «¿borrar?» sí

  it("fallo de IndexedDB (menú): advertencia clara, sin «borrado correctamente», la salida espera; «Cancelar salida» no cierra sesión ni borra", async () => {
    await sembrar(U1);
    consentirBorrar();
    fallarBorrado();
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(dialogo()).not.toBeNull());
    expect(textoDialogo()).toMatch(/No se pudieron eliminar los borradores/);
    expect(textoDialogo()).toMatch(/siguen guardados en este equipo/);
    expect(textoDialogo()).not.toMatch(/correctamente|con éxito/i);
    expect(botonDialogo("Reintentar eliminación")).toBeDefined();
    expect(botonDialogo("Salir y conservar los borradores")).toBeDefined();
    expect(botonDialogo("Cancelar salida")).toBeDefined();
    expect(document.activeElement?.textContent).toBe("Cancelar salida"); // el foco cae en la opción segura
    expect(llamo("/api/auth/logout")).toBe(0); // la salida NO continúa mientras no haya decisión
    await clic(botonDialogo("Cancelar salida"));
    await esperar(() => expect(dialogo()).toBeNull());
    expect(llamo("/api/auth/logout")).toBe(0);
    expect(reemplazar).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Saliendo…"); // el menú queda libre
    vi.restoreAllMocks();
    expect(await contar(U1)).toBe(3);
  });

  it("fallo de IndexedDB → «Salir y conservar»: la salida continúa, informada, y los borradores permanecen", async () => {
    await sembrar(U1);
    consentirBorrar();
    fallarBorrado();
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(dialogo()).not.toBeNull());
    await clic(botonDialogo("Salir y conservar los borradores"));
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(dialogo()).toBeNull();
    vi.restoreAllMocks();
    expect(await contar(U1)).toBe(3);
  });

  it("fallo → «Reintentar eliminación»: tras resolverse la causa se elimina, desaparece la advertencia y la salida continúa", async () => {
    await sembrar(U1); await sembrar(U2);
    consentirBorrar();
    const espia = fallarBorrado();
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(dialogo()).not.toBeNull());
    expect(llamo("/api/auth/logout")).toBe(0);
    espia.mockRestore(); // la causa desaparece
    await clic(botonDialogo("Reintentar eliminación"));
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(dialogo()).toBeNull();
    expect(await contar(U1)).toBe(0);
    expect(await contar(U2)).toBe(3); // el otro usuario, intacto
  });

  it("reintentar con el fallo persistente vuelve a advertir (no sale) y permite cancelar después de un fallo", async () => {
    await sembrar(U1);
    consentirBorrar();
    fallarBorrado();
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(dialogo()).not.toBeNull());
    await clic(botonDialogo("Reintentar eliminación"));
    await esperar(() => expect(botonDialogo("Cancelar salida")?.disabled).toBe(false)); // volvió a advertir tras el 2.º intento
    expect(llamo("/api/auth/logout")).toBe(0);
    await clic(botonDialogo("Cancelar salida"));
    await esperar(() => expect(dialogo()).toBeNull());
    expect(llamo("/api/auth/logout")).toBe(0);
    vi.restoreAllMocks();
    expect(await contar(U1)).toBe(3);
  });

  it("borrado PARCIAL: la advertencia dice cuántos se eliminaron y cuántos quedan", async () => {
    await sembrar(U1);
    consentirBorrar();
    const original = IDBObjectStore.prototype.delete;
    let n = 0;
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, ...a: Parameters<IDBObjectStore["delete"]>) {
      if (++n === 1) return original.apply(this, a);
      throw new Error("fallo simulado");
    });
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(dialogo()).not.toBeNull());
    expect(textoDialogo()).toMatch(/No se pudieron eliminar todos los borradores/);
    expect(textoDialogo()).toMatch(/Se eliminaron 1 de 3 borradores/);
    expect(textoDialogo()).toMatch(/2 siguen guardados/);
    expect(llamo("/api/auth/logout")).toBe(0);
    await clic(botonDialogo("Salir y conservar los borradores restantes"));
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    vi.restoreAllMocks();
    expect(await contar(U1)).toBe(2);
  });

  it("Escape cancela la salida; mientras la advertencia está abierta no hay cierre de sesión", async () => {
    await sembrar(U1);
    consentirBorrar();
    fallarBorrado();
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(dialogo()).not.toBeNull());
    await act(async () => { dialogo()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await esperar(() => expect(dialogo()).toBeNull());
    expect(llamo("/api/auth/logout")).toBe(0);
  });

  it("selector de empresa: mismo comportamiento (fallo → advertencia → reintentar → sale)", async () => {
    await sembrar(U1);
    consentirBorrar();
    const espia = fallarBorrado();
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [SelectEmpresaClient, { empresas: EMPRESAS, user: { username: "usuario.demo", rol: "Operaciones" } }]);
    await clic(botonPorTexto("Salir"));
    await esperar(() => expect(dialogo()).not.toBeNull());
    expect(textoDialogo()).not.toMatch(/correctamente/i);
    expect(llamo("/api/auth/logout")).toBe(0);
    espia.mockRestore();
    await clic(botonDialogo("Reintentar eliminación"));
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    expect(await contar(U1)).toBe(0);
  });

  it("selector de empresa: cancelar tras un fallo no cierra sesión y deja el botón «Salir» libre", async () => {
    await sembrar(U1);
    consentirBorrar();
    fallarBorrado();
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [SelectEmpresaClient, { empresas: EMPRESAS, user: { username: "usuario.demo", rol: "Operaciones" } }]);
    await clic(botonPorTexto("Salir"));
    await esperar(() => expect(dialogo()).not.toBeNull());
    await clic(botonDialogo("Cancelar salida"));
    await esperar(() => expect(dialogo()).toBeNull());
    expect(llamo("/api/auth/logout")).toBe(0);
    expect(botonPorTexto("Salir")?.disabled).toBe(false);
    vi.restoreAllMocks();
    expect(await contar(U1)).toBe(3);
  });

  it("operación LENTA real (tienda ocupada): al vencer el plazo se cancela, se advierte y NO hay borrados tardíos cuando la tienda se libera", async () => {
    await sembrar(U1);
    const db = await abrirBD();
    let bloqueo: Promise<void> = Promise.resolve();
    confirmar.mockReturnValueOnce(false).mockImplementationOnce(() => { bloqueo = iniciarBloqueo(db, 4200); return true; }); // la tienda se ocupa justo al consentir
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [AccountMenu, PROPS_MENU]);
    await abrirMenuYSalir();
    await esperar(() => expect(dialogo()).not.toBeNull(), 6000);
    expect(textoDialogo()).toMatch(/no terminó a tiempo/i);
    expect(textoDialogo()).toMatch(/Se eliminaron 0 de 3/);
    expect(llamo("/api/auth/logout")).toBe(0);
    await clic(botonDialogo("Salir y conservar los borradores restantes"));
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1));
    await bloqueo; // la tienda queda libre y las operaciones en cola se ejecutan
    await new Promise((r) => setTimeout(r, 200));
    expect(await contar(U1)).toBe(3); // la cancelación cooperativa impidió cualquier borrado tardío
  }, 15000);
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
    expect(dialogo()).toBeNull(); // ni advertencia ni diálogo de ningún tipo
    expect(await contar(U1)).toBe(3); // conservados (aislados por ownerKey)
  });

  it("expiración confirmada por el reloj de sesión: cierra sesión SIN diálogo ni borrado", async () => {
    await sembrar(U1);
    const ahora = Math.floor(Date.now() / 1000);
    respuestaActividad = () => new Response(JSON.stringify({ serverNow: ahora, lastActivityAt: ahora, idleExpiresAt: ahora + 1, absoluteExpiresAt: ahora + 3600 }), { status: 200 });
    await renderizar([RegistroSalidaBorradores, { ownerKey: U1 }], [SessionInactivityGuard, {}]);
    await esperar(() => expect(llamo("/api/auth/logout")).toBe(1), 6000);
    expect(confirmar).not.toHaveBeenCalled();
    expect(dialogo()).toBeNull();
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
