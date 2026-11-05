// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoAutoguardado } from "@/components/borradores/demo-autoguardado";
import {
  CLAVE_PREFERENCIA_PERSISTENCIA, crearAlmacenIndexedDB, crearAlmacenSegunPreferencia, crearNucleoBorradores, establecerFabricaCanal, fijarPersistencia,
  reiniciarCoordinacionParaPruebas, type AlmacenPreferencias, type AmbitoBorrador, type FabricaCanal, type NucleoBorradores, type Resultado, type TipoBorrador,
} from "@/lib/borradores";
import { prepararSalidaDelNavegador } from "@/lib/borradores/salida-navegador";

/**
 * BORR-1c — pruebas de INTEGRACIÓN de componentes (happy-dom + fake-indexeddb): hook + indicador + diálogos reales, sin tocar
 * ningún formulario oficial. Es también la demostración aislada: escribir → autoguardado → recargar (remontar) → recuperar →
 * descartar → conflicto entre pestañas. Datos ficticios.
 */
const U1 = "o1_usuario-ficticio-uno";
const U2 = "o1_usuario-ficticio-dos";
const ctx = (ownerKey = U1, empresaId = 1) => ({ ownerKey, empresaId, empresaSlug: `empresa-${empresaId}` });
const ambito = (ownerKey = U1, empresaId = 1, tipo: TipoBorrador = "solicitud_fondo"): AmbitoBorrador => ({ ...ctx(ownerKey, empresaId), tipo });
vi.setConfig({ testTimeout: 30_000 }); // los diálogos reales y los temporizadores son lentos con la suite completa en paralelo
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hasta = (fn: () => void, ms = 8000) => vi.waitFor(fn, { timeout: ms, interval: 10 });
function ok<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(`Se esperaba éxito y fue ${r.motivo}`);
  return r.valor;
}

let hosts: { host: HTMLElement; root: Root }[];
let nucleo: NucleoBorradores;
let almacenReal: ReturnType<typeof crearAlmacenIndexedDB>;
let prefs: AlmacenPreferencias & { datos: Map<string, string> };

function nuevoHost() {
  const host = document.createElement("div");
  document.body.append(host);
  const h = { host, root: createRoot(host) };
  hosts.push(h);
  return h;
}
async function montar(el: ReactElement, h = nuevoHost()) {
  await act(async () => { h.root.render(el); });
  return h;
}
async function desmontar(h: { host: HTMLElement; root: Root }) {
  await act(async () => { h.root.unmount(); });
  h.host.remove();
  hosts = hosts.filter((x) => x !== h);
}
const demo = (extra: Partial<Parameters<typeof DemoAutoguardado>[0]> = {}) =>
  createElement(DemoAutoguardado, { contexto: ctx(), nucleo, prefs, fabricaCanal: null, ...extra });

const q = (h: { host: HTMLElement }, sel: string) => h.host.querySelector(sel);
const textarea = (h: { host: HTMLElement }) => h.host.querySelector("textarea") as HTMLTextAreaElement;
const indicador = (h: { host: HTMLElement }) => (q(h, "[data-estado-autoguardado]")?.textContent ?? "").replace(/\s+/g, " ").trim();
const estado = (h: { host: HTMLElement }) => q(h, "[data-estado-autoguardado]")?.getAttribute("data-estado-autoguardado");
const dialogo = () => document.querySelector('[role="alertdialog"]');
const boton = (texto: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;
async function clic(el: Element | undefined | null) {
  if (!el) throw new Error("elemento no encontrado");
  await act(async () => { (el as HTMLElement).click(); });
}
async function escribir(el: HTMLTextAreaElement | HTMLInputElement, valor: string) {
  await act(async () => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const guardado = async (a = ambito()) => { const l = ok(await nucleo.leer(a, { esquemaVersion: 1 })); return l.estado === "vacio" ? null : l.borrador; };

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("indexedDB", new IDBFactory());
  hosts = [];
  const datos = new Map<string, string>();
  prefs = { datos, getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => { datos.set(k, v); }, removeItem: (k) => { datos.delete(k); } };
  almacenReal = crearAlmacenIndexedDB();
  nucleo = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(almacenReal, prefs), appBuild: "prueba-dom" });
});

afterEach(async () => {
  for (const h of [...hosts]) await act(async () => { try { h.root.unmount(); } catch { /* ya desmontado */ } });
  for (const h of hosts) h.host.remove();
  hosts = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  reiniciarCoordinacionParaPruebas();
  establecerFabricaCanal(undefined);
});

describe("demostración aislada: escribir → autoguardar → recargar → recuperar → descartar", () => {
  it("el ciclo completo con la interfaz real", async () => {
    const h = await montar(demo());
    await hasta(() => expect(estado(h)).toBe("inicial"));
    await escribir(textarea(h), "Combustible para la ruta Norte");
    expect(estado(h)).toBe("pendiente");
    expect(indicador(h)).toMatch(/Cambios pendientes/);
    await clic(boton("Agregar línea"));
    await hasta(() => expect(estado(h)).toBe("guardado"));
    expect(indicador(h)).toMatch(/Guardado en este equipo a las \d{2}:\d{2}/);
    await escribir(h.host.querySelector('input[aria-label="Monto de la línea 1"]') as HTMLInputElement, "250.75");
    await hasta(() => expect(estado(h)).toBe("guardado"));
    expect(await guardado()).toMatchObject({ revision: expect.any(Number), payload: { descripcion: "Combustible para la ruta Norte", lineas: [{ monto: "250.75", nota: "" }] } });

    await desmontar(h); // «recargar»: se cierra la página sin ninguna limpieza
    const h2 = await montar(demo());
    await hasta(() => expect(dialogo()).not.toBeNull());
    const d = dialogo()!.textContent!;
    expect(d).toMatch(/Encontramos un borrador sin terminar/);
    expect(d).toMatch(/Formulario: Solicitud de fondo/);
    expect(d).toMatch(/Último guardado:.*hace/);
    expect(d).toMatch(/archivos adjuntos no se guardan/i);
    expect(textarea(h2).value).toBe(""); // NUNCA se restaura sola
    await hasta(() => expect(document.activeElement?.textContent).toBe("Recuperar borrador"));
    await clic(boton("Recuperar borrador"));
    await hasta(() => expect(dialogo()).toBeNull());
    await hasta(() => expect(textarea(h2).value).toBe("Combustible para la ruta Norte"));
    await hasta(() => expect((h2.host.querySelector('input[aria-label="Monto de la línea 1"]') as HTMLInputElement).value).toBe("250.75"));
    await hasta(() => expect(estado(h2)).toBe("guardado"));

    await desmontar(h2); // segunda «recarga»: ahora se descarta
    const h3 = await montar(demo());
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Descartar borrador"));
    expect(dialogo()!.textContent).toMatch(/no se podrá deshacer/);
    await hasta(() => expect(document.activeElement?.textContent).toBe("Volver")); // el foco cae en la opción segura
    expect(await guardado()).not.toBeNull();
    await clic(boton("Sí, descartar definitivamente"));
    await hasta(() => expect(dialogo()).toBeNull());
    expect(await guardado()).toBeNull();
    await hasta(() => expect(textarea(h3).value).toBe(""));
  });

  it("«Volver» en la confirmación de descarte no elimina nada", async () => {
    ok(await nucleo.guardar(ambito(), { payload: { descripcion: "x", lineas: [] }, esquemaVersion: 1, revisionBase: null }));
    await montar(demo());
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Descartar borrador"));
    await clic(boton("Volver"));
    expect(dialogo()!.textContent).toMatch(/Encontramos un borrador/);
    expect(await guardado()).not.toBeNull();
  });

  it("«Decidir después» no sobrescribe: se pausa el autoguardado, el borrador sigue intacto y se puede recuperar luego", async () => {
    ok(await nucleo.guardar(ambito(), { payload: { descripcion: "borrador previo", lineas: [] }, esquemaVersion: 1, revisionBase: null }));
    const h = await montar(demo());
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Decidir después"));
    await hasta(() => expect(dialogo()).toBeNull());
    expect(indicador(h)).toMatch(/Autoguardado en pausa/);
    await escribir(textarea(h), "texto nuevo que no debe pisar el borrador");
    await esperar(150);
    expect((await guardado())!.payload).toEqual({ descripcion: "borrador previo", lineas: [] });
    await clic(boton("Recuperar el borrador guardado"));
    await hasta(() => expect(textarea(h).value).toBe("borrador previo"));
  });

  it("si el formulario ya tiene contenido, recuperar pide confirmar el reemplazo", async () => {
    ok(await nucleo.guardar(ambito(), { payload: { descripcion: "del borrador", lineas: [] }, esquemaVersion: 1, revisionBase: null }));
    const h = await montar(demo());
    await hasta(() => expect(dialogo()).not.toBeNull());
    await escribir(textarea(h), "lo que ya escribí");
    await clic(boton("Recuperar borrador"));
    expect(dialogo()!.textContent).toMatch(/reemplazará/);
    expect(textarea(h).value).toBe("lo que ya escribí");
    await clic(boton("Volver"));
    await clic(boton("Recuperar borrador"));
    await clic(boton("Sí, reemplazar con el borrador"));
    await hasta(() => expect(textarea(h).value).toBe("del borrador"));
  });

  it("accesibilidad: foco atrapado con Tab, Escape = decidir después y el foco vuelve a donde estaba", async () => {
    ok(await nucleo.guardar(ambito(), { payload: { descripcion: "x", lineas: [] }, esquemaVersion: 1, revisionBase: null }));
    const h = await montar(demo());
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.getAttribute("aria-modal")).toBe("true");
    expect(dialogo()!.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialogo()!.getAttribute("aria-describedby")).toBeTruthy();
    const botones = [...dialogo()!.querySelectorAll("button")];
    expect(botones.map((b) => b.textContent)).toEqual(["Recuperar borrador", "Descartar borrador", "Decidir después"]);
    (botones[2] as HTMLButtonElement).focus();
    await act(async () => { dialogo()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(botones[0]); // del último al primero
    await act(async () => { dialogo()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(botones[2]);
    await act(async () => { dialogo()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await hasta(() => expect(dialogo()).toBeNull());
    expect(indicador(h)).toMatch(/Autoguardado en pausa/);
  });
});

describe("borradores no utilizables o con envío pendiente", () => {
  it("esquema futuro: advertencia, sin recuperar, nada se modifica", async () => {
    ok(await nucleo.guardar(ambito(), { payload: { formato: "nuevo" }, esquemaVersion: 4, revisionBase: null }));
    await montar(demo());
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/no es compatible con esta versión/);
    expect(boton("Recuperar borrador")!.disabled).toBe(true);
    expect(boton("Descartar borrador")!.disabled).toBe(false);
    expect(ok(await nucleo.listarMetadatosUsuario(U1)).borradores).toHaveLength(1); // …pero sigue intacto
  });

  it("borrador expirado: se advierte y aún puede recuperarse", async () => {
    let t = 1_000;
    const viejo = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(almacenReal, prefs), appBuild: "p", ahora: () => t });
    ok(await viejo.guardar(ambito(), { payload: { descripcion: "viejo", lineas: [] }, esquemaVersion: 1, revisionBase: null }));
    t = Date.now() + 1000; // los 14 días ya pasaron respecto de 1 000 ms
    const h = await montar(demo({ nucleo: crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(almacenReal, prefs), appBuild: "p", ahora: () => Date.now() }) }));
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/superó el tiempo de conservación/);
    expect(boton("Recuperar borrador")!.disabled).toBe(false);
    await clic(boton("Recuperar borrador"));
    await hasta(() => expect(textarea(h).value).toBe("viejo"));
  });

  it("datos corruptos: no se interpretan como borrador; solo se pueden descartar", async () => {
    const clave = JSON.stringify([U1, 1, "solicitud_fondo"]);
    await almacenReal.modificar(clave, () => ({ accion: "escribir", resultado: null, registro: { clave, ambitoClave: JSON.stringify([U1, 1]), ownerKey: U1, formato: 1, revision: "mala" } as never }));
    const h = await montar(demo());
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/está dañado/);
    expect(boton("Recuperar borrador")!.disabled).toBe(true);
    await clic(boton("Decidir después"));
    await escribir(textarea(h), "no debe pisar el dato dañado");
    await esperar(150);
    expect(ok(await almacenReal.obtener(clave))).toMatchObject({ revision: "mala" });
  });

  it("envío oficial sin resolver: ni recuperar ni descartar; solo «decidir después»", async () => {
    ok(await nucleo.guardar(ambito(), { payload: { descripcion: "x", lineas: [] }, esquemaVersion: 1, revisionBase: null, claveEnvio: "7f3c2a9e-1b4d-4e8a-9c6f-0a1b2c3d4e5f", estadoEnvio: "enviando" }));
    await montar(demo());
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/intento de envío sin resultado confirmado/);
    expect(dialogo()!.textContent).toMatch(/No hay acciones disponibles/);
    expect(boton("Recuperar borrador")!.disabled).toBe(true);
    expect(boton("Descartar borrador")!.disabled).toBe(true);
    expect(boton("Decidir después")!.disabled).toBe(false);
    await clic(boton("Decidir después"));
    expect(await guardado()).toMatchObject({ estadoEnvio: "enviando", claveEnvio: "7f3c2a9e-1b4d-4e8a-9c6f-0a1b2c3d4e5f" });
  });
});

describe("dos pestañas", () => {
  async function dosPestanas(fabricaCanal: FabricaCanal | null = null) {
    const a = await montar(demo({ etiqueta: "Pestaña A", fabricaCanal }));
    const b = await montar(demo({ etiqueta: "Pestaña B", fabricaCanal }));
    await hasta(() => { expect(estado(a)).toBe("inicial"); expect(estado(b)).toBe("inicial"); });
    return { a, b };
  }

  it("conflicto: la segunda pestaña NO sobrescribe, se explica y se resuelve releyendo y eligiendo (usar la otra versión)", async () => {
    const { a, b } = await dosPestanas();
    await escribir(textarea(a), "versión de A");
    await hasta(() => expect(estado(a)).toBe("guardado"));
    await escribir(textarea(b), "versión de B");
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(indicador(b)).toMatch(/Conflicto con otra pestaña/);
    expect(dialogo()!.textContent).toMatch(/no se combinan los cambios automáticamente/);
    expect((await guardado())!.payload).toMatchObject({ descripcion: "versión de A" });
    expect(boton("Usar la versión de la otra pestaña")!.disabled).toBe(true); // antes hay que ver la versión guardada
    await clic(boton("Ver la versión guardada"));
    await hasta(() => expect(dialogo()!.textContent).toMatch(/Versión guardada:.*revisión 1/));
    await clic(boton("Usar la versión de la otra pestaña"));
    await hasta(() => expect(dialogo()).toBeNull());
    await hasta(() => expect(textarea(b).value).toBe("versión de A"));
    await hasta(() => expect(estado(b)).toBe("guardado"));
  });

  it("conflicto: «Conservar mis cambios» exige una segunda confirmación y entonces sobrescribe", async () => {
    const { a, b } = await dosPestanas();
    await escribir(textarea(a), "versión de A");
    await hasta(() => expect(estado(a)).toBe("guardado"));
    await escribir(textarea(b), "versión de B");
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Ver la versión guardada"));
    await hasta(() => expect(boton("Conservar mis cambios")!.disabled).toBe(false));
    await clic(boton("Conservar mis cambios"));
    expect(dialogo()!.textContent).toMatch(/se reemplazará/);
    expect((await guardado())!.payload).toMatchObject({ descripcion: "versión de A" }); // aún no se sobrescribió
    await clic(boton("Sí, conservar mis cambios"));
    await hasta(() => expect(dialogo()).toBeNull());
    expect((await guardado())!.payload).toMatchObject({ descripcion: "versión de B" });
  });

  it("con aviso por canal: la pestaña sin cambios solo muestra «otra pestaña actualizó» y no se bloquea", async () => {
    const canales = new Map<string, Set<{ onmessage: ((e: { data: unknown }) => void) | null }>>();
    const bus: FabricaCanal = (nombre) => {
      const grupo = canales.get(nombre) ?? new Set();
      canales.set(nombre, grupo);
      const yo = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage(data: unknown) { for (const o of [...grupo]) if (o !== yo) setTimeout(() => o.onmessage?.({ data: structuredClone(data) }), 0); }, close() { grupo.delete(yo); } };
      grupo.add(yo);
      return yo;
    };
    const { a, b } = await dosPestanas(bus);
    await escribir(textarea(a), "desde A");
    await hasta(() => expect(indicador(b)).toMatch(/Otra pestaña actualizó este borrador/));
    expect(dialogo()).toBeNull();
  });

  it("falta de BroadcastChannel: funciona; el conflicto se detecta por la revisión", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    establecerFabricaCanal(undefined);
    const { a, b } = await dosPestanas(null);
    await escribir(textarea(a), "A");
    await hasta(() => expect(estado(a)).toBe("guardado"));
    await escribir(textarea(b), "B");
    await hasta(() => expect(dialogo()).not.toBeNull());
  });
});

describe("identidad, empresa y sesión", () => {
  it("cambiar de EMPRESA: lo pendiente se finaliza en SU ámbito y nunca se redirige al nuevo; el estado no se mezcla", async () => {
    const h = await montar(demo({ debounceMs: 400, maxEsperaMs: 2000 }));
    await hasta(() => expect(estado(h)).toBe("inicial"));
    await escribir(textarea(h), "trabajo de la empresa 1");
    expect(estado(h)).toBe("pendiente");
    await montar(demo({ contexto: ctx(U1, 2), debounceMs: 400, maxEsperaMs: 2000 }), h); // mismo componente, otra empresa
    await hasta(() => expect(estado(h)).toBe("inicial")); // el estado del ámbito anterior no se muestra
    await esperar(150);
    expect(await guardado(ambito(U1, 2))).toBeNull(); // nada en la empresa nueva
    expect((await guardado(ambito(U1, 1)))!.payload).toMatchObject({ descripcion: "trabajo de la empresa 1" }); // finalizado en la anterior
    await esperar(600);
    expect(await guardado(ambito(U1, 2))).toBeNull(); // el temporizador del ámbito anterior no escribió en el nuevo
  });

  it("cambiar de USUARIO: no se ve el borrador del otro y el estado se reinicia", async () => {
    ok(await nucleo.guardar(ambito(U1), { payload: { descripcion: "del usuario 1", lineas: [] }, esquemaVersion: 1, revisionBase: null }));
    const h = await montar(demo({ contexto: ctx(U2) }));
    await hasta(() => expect(estado(h)).toBe("inicial"));
    expect(dialogo()).toBeNull(); // el usuario 2 no ve el borrador del 1
    await montar(demo({ contexto: ctx(U1) }), h);
    await hasta(() => expect(dialogo()).not.toBeNull()); // el usuario 1 sí
    expect(dialogo()!.textContent).toMatch(/Encontramos un borrador/);
  });

  it("sin contexto autenticado el autoguardado no se activa", async () => {
    const h = await montar(demo({ contexto: null }));
    await escribir(textarea(h), "algo");
    await esperar(150);
    expect(indicador(h)).toMatch(/Autoguardado no disponible/);
    expect(ok(await nucleo.listarMetadatosUsuario(U1)).borradores).toHaveLength(0);
  });

  it("expiración de sesión: no se pierde nada; al volver a autenticarse se ofrece recuperar", async () => {
    const h = await montar(demo());
    await escribir(textarea(h), "trabajo antes de expirar");
    await hasta(() => expect(estado(h)).toBe("guardado"));
    await desmontar(h); // la página se descarta sin ninguna limpieza
    await montar(demo());
    await hasta(() => expect(dialogo()!.textContent).toMatch(/Encontramos un borrador/));
  });

  it("cierre de sesión explícito con «borrar»: pendientes, en vuelo y tardíos no recrean lo eliminado", async () => {
    const h = await montar(demo({ debounceMs: 60, maxEsperaMs: 300 }));
    await escribir(textarea(h), "primer contenido");
    await hasta(() => expect(estado(h)).toBe("guardado"));
    await escribir(textarea(h), "contenido pendiente al salir"); // pendiente (debounce 60 ms)
    const confirmar = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    (window as unknown as { confirm: unknown }).confirm = confirmar;
    const r = await prepararSalidaDelNavegador(U1);
    expect(r).toMatchObject({ continuar: true, limpieza: "borrados" });
    expect(confirmar).toHaveBeenCalledTimes(2);
    expect(indicador(h)).toMatch(/Autoguardado detenido/);
    await esperar(250); // vence cualquier temporizador tardío
    expect(ok(await nucleo.listarMetadatosUsuario(U1)).borradores).toHaveLength(0);
  });

  it("desmontar durante un guardado no produce errores ni avisos de React", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = await montar(demo({ debounceMs: 5 }));
    await escribir(textarea(h), "se desmonta mientras guarda");
    await hasta(() => expect(["guardando", "guardado"]).toContain(estado(h)));
    await desmontar(h);
    await esperar(150);
    const llamadas = consola.mock.calls.map((c) => String(c[0]));
    expect(llamadas.filter((m) => /unmounted|memory leak|Maximum update/i.test(m))).toEqual([]);
  });
});

describe("«No guardar en este equipo»", () => {
  it("con la preferencia activa no se escribe ni se lee; el indicador lo dice", async () => {
    fijarPersistencia(prefs, false);
    const h = await montar(demo());
    await hasta(() => expect(indicador(h)).toMatch(/Sin autoguardado en este equipo/));
    await escribir(textarea(h), "no debe guardarse");
    await esperar(150);
    expect(ok(await crearNucleoBorradores({ almacen: almacenReal, appBuild: "p" }).listarMetadatosUsuario(U1)).borradores).toHaveLength(0);
  });

  it("activarla desde el control: confirma, elimina SOLO los borradores del usuario y pausa el autoguardado", async () => {
    const bruto = crearNucleoBorradores({ almacen: almacenReal, appBuild: "p" });
    ok(await bruto.guardar(ambito(U1, 1, "gasto_operativo"), { payload: {}, esquemaVersion: 1, revisionBase: null }));
    ok(await bruto.guardar(ambito(U2), { payload: {}, esquemaVersion: 1, revisionBase: null }));
    const h = await montar(demo());
    await hasta(() => expect(estado(h)).toBe("inicial"));
    await clic(h.host.querySelector('input[role="switch"]'));
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/no se podrán recuperar|eliminarán/);
    await hasta(() => expect(document.activeElement?.textContent).toBe("Cancelar"));
    await clic(boton("Sí, eliminar y no guardar"));
    await hasta(() => expect(prefs.datos.get(CLAVE_PREFERENCIA_PERSISTENCIA)).toBe("desactivada"));
    await hasta(() => expect(indicador(h)).toMatch(/Sin autoguardado en este equipo/));
    await hasta(() => expect(h.host.textContent).toMatch(/se eliminaron los existentes/)); // la eliminación termina DESPUÉS de pausar el autoguardado
    const restantes = ok(await bruto.listarMetadatosUsuario(U1)).borradores;
    expect(restantes.map((r) => `${r.tipo}:${r.empresaId}:${r.revision}`)).toEqual([]);
    expect(ok(await bruto.listarMetadatosUsuario(U2)).borradores).toHaveLength(1);
    expect(h.host.textContent).toMatch(/se eliminaron los existentes/);
    await clic(h.host.querySelector('input[role="switch"]')); // volver a activar el guardado
    await hasta(() => expect(prefs.datos.has(CLAVE_PREFERENCIA_PERSISTENCIA)).toBe(false));
    await hasta(() => expect(estado(h)).toBe("inicial"));
  });

  it("cancelar la confirmación no cambia nada", async () => {
    const bruto = crearNucleoBorradores({ almacen: almacenReal, appBuild: "p" });
    ok(await bruto.guardar(ambito(), { payload: {}, esquemaVersion: 1, revisionBase: null }));
    const h = await montar(demo());
    await hasta(() => expect(dialogo()).not.toBeNull()); // el diálogo de recuperación
    await clic(boton("Decidir después"));
    await clic(h.host.querySelector('input[role="switch"]'));
    await hasta(() => expect(boton("Sí, eliminar y no guardar")).toBeDefined());
    await clic(boton("Cancelar"));
    await hasta(() => expect(h.host.textContent).toMatch(/No se hizo ningún cambio/));
    expect(prefs.datos.size).toBe(0);
    expect(ok(await bruto.listarMetadatosUsuario(U1)).borradores).toHaveLength(1);
  });

  it("la preferencia cambiada DESDE OTRA PESTAÑA (evento storage) pausa el autoguardado de esta", async () => {
    const h = await montar(demo());
    await hasta(() => expect(estado(h)).toBe("inicial"));
    fijarPersistencia(prefs, false);
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: CLAVE_PREFERENCIA_PERSISTENCIA })); });
    await hasta(() => expect(indicador(h)).toMatch(/Sin autoguardado en este equipo/));
    await escribir(textarea(h), "ya no se guarda");
    await esperar(150);
    expect(ok(await crearNucleoBorradores({ almacen: almacenReal, appBuild: "p" }).listarMetadatosUsuario(U1)).borradores).toHaveLength(0);
  });
});

describe("errores visibles", () => {
  it("un fallo de IndexedDB se muestra como «Error al guardar» con su causa, sin afirmar que está a salvo", async () => {
    const roto = crearNucleoBorradores({ almacen: crearAlmacenIndexedDB({ fabrica: new IDBFactory() }), appBuild: "p" });
    vi.spyOn(roto, "guardar").mockResolvedValue({ ok: false, motivo: "cuota_excedida", mensaje: "x" });
    const h = await montar(demo({ nucleo: roto }));
    await escribir(textarea(h), "contenido");
    await hasta(() => expect(estado(h)).toBe("error_almacenamiento"));
    expect(indicador(h)).toMatch(/Error al guardar en este equipo/);
    expect(indicador(h)).toMatch(/no hay espacio suficiente/);
    expect(indicador(h)).toMatch(/no están a salvo/);
    expect(indicador(h)).not.toMatch(/Guardado en este equipo a las/);
  });
});

describe("el hook no mezcla estados al cambiar de ámbito (observado render a render)", () => {
  it("tras cambiar de empresa, ningún render muestra el estado del ámbito anterior", async () => {
    const { useBorradorLocal } = await import("@/lib/borradores/use-borrador-local");
    const vistos: string[] = [];
    function Sonda({ contexto, payload }: { contexto: ReturnType<typeof ctx>; payload: { v: string } }) {
      const { snapshot } = useBorradorLocal({ tipo: "solicitud_fondo", esquemaVersion: 1, payload, contexto, nucleo, prefs, fabricaCanal: null, debounceMs: 10, maxEsperaMs: 50 });
      vistos.push(`${contexto.empresaId}:${snapshot.fase}:${snapshot.guardado.estado}`);
      return null;
    }
    const payload = { v: "x" };
    const h = await montar(createElement(Sonda, { contexto: ctx(U1, 1), payload }));
    await hasta(() => expect(vistos.at(-1)).toBe("1:activo:inicial"));
    await montar(createElement(Sonda, { contexto: ctx(U1, 1), payload: { v: "cambio" } }), h);
    await hasta(() => expect(vistos.at(-1)).toBe("1:activo:guardado"));
    vistos.length = 0;
    await montar(createElement(Sonda, { contexto: ctx(U1, 2), payload: { v: "cambio" } }), h);
    await hasta(() => expect(vistos.at(-1)).toBe("2:activo:inicial"));
    // En el primer render con la empresa 2 NUNCA se ve «guardado» (estado de la empresa 1)
    expect(vistos.filter((x) => x.startsWith("2:") && x.endsWith(":guardado"))).toEqual([]);
  });
});

describe("pestaña antigua tras cerrar sesión (marca de purga persistente, sin BroadcastChannel)", () => {
  it("la pestaña que no recibió ningún aviso no recrea el borrador; avisa que la sesión terminó; una sesión nueva sí guarda", async () => {
    const vieja = await montar(demo({ etiqueta: "Pestaña antigua", debounceMs: 150, maxEsperaMs: 400 }));
    await hasta(() => expect(estado(vieja)).toBe("inicial"));
    reiniciarCoordinacionParaPruebas(); // otra página cerrará sesión: esta no figura en su registro y no hay canal
    await escribir(textarea(vieja), "trabajo pendiente de la sesión anterior"); // se guardaría a los 150 ms
    // Otra página cierra sesión y elige «borrar» (hay otro borrador del usuario que purgar):
    ok(await nucleo.guardar(ambito(U1, 1, "gasto_operativo"), { payload: { v: 1 }, esquemaVersion: 1, revisionBase: null }));
    const confirmar = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    (window as unknown as { confirm: unknown }).confirm = confirmar;
    const r = await prepararSalidaDelNavegador(U1);
    expect(r).toMatchObject({ continuar: true, limpieza: "borrados" });
    await hasta(() => expect(indicador(vieja)).toMatch(/Sesión anterior finalizada/));
    expect(indicador(vieja)).toMatch(/recarga la página/);
    await esperar(500);
    expect(ok(await nucleo.listarMetadatosUsuario(U1)).borradores).toHaveLength(0); // nada reapareció
    expect(textarea(vieja).value).toBe("trabajo pendiente de la sesión anterior"); // el contenido sigue en pantalla
    // Nueva autenticación: otra carga del formulario (época vigente) guarda con normalidad
    const nueva = await montar(demo({ etiqueta: "Sesión nueva" }));
    await hasta(() => expect(estado(nueva)).toBe("inicial"));
    await escribir(textarea(nueva), "borrador legítimo de la sesión nueva");
    await hasta(() => expect(estado(nueva)).toBe("guardado"));
    expect((await guardado())!.payload).toMatchObject({ descripcion: "borrador legítimo de la sesión nueva" });
    await escribir(textarea(vieja), "la antigua insiste");
    await esperar(400);
    expect((await guardado())!.payload).toMatchObject({ descripcion: "borrador legítimo de la sesión nueva" });
  });
});
