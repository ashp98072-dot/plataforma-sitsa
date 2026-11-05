// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  crearAlmacenIndexedDB, crearAlmacenSegunPreferencia, crearNucleoBorradores, establecerFabricaCanal, EVENTO_PREFERENCIA, fijarPersistencia, reiniciarCoordinacionParaPruebas,
  type AlmacenPreferencias, type AmbitoBorrador, type NucleoBorradores, type Resultado,
} from "@/lib/borradores";
import { suspenderEscriturasDe } from "@/lib/borradores/coordinacion";
import { CLAVE_ENVIO_REGEX } from "@/lib/idempotencia/clave-envio";
import { construirPayloadFondo, ESQUEMA_FONDO_BORRADOR, type EstadoFondoForm } from "@/lib/tms/fondo-borrador";
import { OpcionesAutoguardadoFondoContext } from "@/components/tms/fondo-autoguardado";

vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "empresa-1" }) }));
import FondosPage from "./page";

/**
 * BORR-1e — COMPORTAMIENTO de la pantalla REAL «Solicitudes de fondo» (solo la CREACIÓN) con el borrador local
 * (happy-dom + fake-indexeddb). `fetch` está simulado y registra cada petición; nada toca MariaDB.
 */
vi.setConfig({ testTimeout: 30_000 });
const U1 = "o1_usuario-ficticio-uno";
const U2 = "o1_usuario-ficticio-dos";
const HOY = new Date().toISOString().slice(0, 10);
const ctx = (ownerKey = U1, empresaId = 1) => ({ ownerKey, empresaId, empresaSlug: `empresa-${empresaId}` });
const ambito = (ownerKey = U1, empresaId = 1): AmbitoBorrador => ({ ...ctx(ownerKey, empresaId), tipo: "solicitud_fondo" });
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hasta = (fn: () => void | Promise<void>, ms = 8000) => vi.waitFor(fn, { timeout: ms, interval: 10 });
function ok<T>(r: Resultado<T>): T { if (!r.ok) throw new Error(`Se esperaba éxito y fue ${r.motivo}`); return r.valor; }

const CATALOGOS = {
  empleados: [{ id: 7, codigo: "E7", nombre: "Pedro Pérez", puesto: "Piloto", cuentaBancaria: "123-456-7", telefono: "55512345" }],
  vehiculos: [{ id: 5, placa: "C-001ABC", marca: null, modelo: null }],
  clientes: [{ id: 8, codigo: "C8", nombre: "Cliente Ocho", nit: null }],
  planes: [{ id: 11, codigo: "P11", clienteId: 8, clienteNombre: "Cliente Ocho", fechaPlan: "2026-10-02", vehiculoId: 5, placa: "C-001ABC", empleadoId: 7, empleadoNombre: "Pedro Pérez", empleadoPuesto: "Piloto", empleadoCuenta: "123-456-7" }],
  usuarios: [{ id: 2, nombre: "Ana" }, { id: 3, nombre: "Beto" }],
  usuariosOperaciones: [{ id: 2, nombre: "Ana" }],
  solicitantes: [{ id: 3, nombre: "Beto" }],
  entidadesRequirentes: [{ id: 4, codigo: "F", nombre: "Frescofresh" }, { id: 6, codigo: "O", nombre: "Otra" }],
  metodosPago: ["Efectivo", "Transferencia", "Transferencia móvil"],
  categorias: ["Combustible", "Peajes"],
};
type Llamada = { url: string; metodo: string; cuerpo: Record<string, unknown> | null };
let llamadas: Llamada[];
let respuestaCreacion: () => Promise<Partial<Response>> | Partial<Response>;
let alAntesDeResponder: (() => Promise<void>) | null;
const json = (status: number, cuerpo: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });
const SOLICITUD_EDITABLE = {
  id: 90, codigo: "SF-000090", entidadRequirenteId: 4, entidadRequirenteNombre: "Frescofresh", requirenteNombre: "Ana", requirenteUsuarioId: 2, solicitanteUsuarioId: 3, solicitanteNombre: "Beto",
  fechaRequerimiento: "2026-09-30", total: 50, autorizanteNombre: null, estado: "Pendiente", motivoRechazo: null, observaciones: "Existente",
  lineas: [{ id: 1, categoria: "Peajes", descripcion: "Peaje", cantidad: 1, monto: 50, orden: 1, fechaViaje: null, empleadoNombre: null, cargo: null, cuenta: null, metodoPago: null, placa: null, clienteNombre: null, empleadoId: null, vehiculoId: null, clienteId: null, planId: null }],
};
function fetchSimulado(url: string, init?: RequestInit) {
  const metodo = init?.method ?? "GET";
  const cuerpo = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  llamadas.push({ url, metodo, cuerpo });
  if (url.endsWith("/tms/gastos/catalogos")) return Promise.resolve(json(200, CATALOGOS));
  if (metodo === "POST" && url.endsWith("/tms/fondos")) return (async () => { await alAntesDeResponder?.(); return respuestaCreacion(); })();
  if (metodo === "GET" && url.endsWith("/tms/fondos/90")) return Promise.resolve(json(200, { solicitud: SOLICITUD_EDITABLE }));
  if (metodo === "GET" && url.includes("/tms/fondos?")) return Promise.resolve(json(200, { solicitudes: [{ ...SOLICITUD_EDITABLE, lineas: [] }] }));
  return Promise.resolve(json(200, {}));
}
const posts = () => llamadas.filter((l) => l.metodo === "POST" && l.url.endsWith("/tms/fondos"));
const sinRed = () => Promise.reject(new TypeError("Failed to fetch"));

let hosts: { host: HTMLElement; root: Root }[];
let nucleo: NucleoBorradores;
let almacenReal: ReturnType<typeof crearAlmacenIndexedDB>;
let prefs: AlmacenPreferencias & { datos: Map<string, string> };
function nuevoHost() { const host = document.createElement("div"); document.body.append(host); const h = { host, root: createRoot(host) }; hosts.push(h); return h; }
async function montar(el: ReactElement, h = nuevoHost()) { await act(async () => { h.root.render(el); }); return h; }
async function desmontar(h: { host: HTMLElement; root: Root }) { await act(async () => { h.root.unmount(); }); h.host.remove(); hosts = hosts.filter((x) => x !== h); }
const pagina = (auto: Record<string, unknown> = {}) =>
  createElement(OpcionesAutoguardadoFondoContext.Provider, { value: { contexto: ctx(), nucleo, prefs, fabricaCanal: null, debounceMs: 30, maxEsperaMs: 200, ...auto } }, createElement(FondosPage));
const dialogo = () => document.querySelector('[role="alertdialog"]');
const boton = (texto: string, raiz: ParentNode = document) => [...raiz.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;
async function clic(el: Element | undefined | null) { if (!el) throw new Error("elemento no encontrado"); await act(async () => { (el as HTMLElement).click(); }); }
async function escribir(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  await act(async () => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function elegir(el: HTMLSelectElement, valor: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, valor); el.dispatchEvent(new Event("change", { bubbles: true })); });
}
/** Contenedor del formulario de creación/edición (el que contiene el borrador local o el título). */
const formEl = (h: { host: HTMLElement }) => ([...h.host.querySelectorAll("p")].find((p) => /^(Nueva solicitud|Editar solicitud)/.test(p.textContent ?? ""))!.parentElement as HTMLElement);
const estadoInd = (h: { host: HTMLElement }) => h.host.querySelector("[data-estado-autoguardado]")?.getAttribute("data-estado-autoguardado");
const textoInd = (h: { host: HTMLElement }) => (h.host.querySelector("[data-estado-autoguardado]")?.textContent ?? "").replace(/\s+/g, " ").trim();
/** Campo con etiqueta (label que envuelve) dentro del formulario. */
const campo = (h: { host: HTMLElement }, texto: string, n = 0) =>
  ([...formEl(h).querySelectorAll("label")].filter((l) => (l.firstChild?.textContent ?? "").trim().startsWith(texto))[n]!.querySelector("input, select, textarea")) as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
/** Select de CatalogoSearchSelect por su etiqueta exacta (label htmlFor). */
const selector = (h: { host: HTMLElement }, texto: string, n = 0) => {
  const l = [...formEl(h).querySelectorAll("label")].filter((x) => x.textContent === texto && x.htmlFor)[n]!;
  return document.getElementById(l.htmlFor) as HTMLSelectElement;
};
const entrada = (h: { host: HTMLElement }, placeholder: string, n = 0) => [...formEl(h).querySelectorAll("input")].filter((i) => i.placeholder === placeholder)[n] as HTMLInputElement;
const guardarBtn = (h: { host: HTMLElement }) => boton("Crear solicitud", h.host)!;
const guardado = async (a = ambito()) => { const l = ok(await nucleo.leer(a, { esquemaVersion: ESQUEMA_FONDO_BORRADOR })); return l.estado === "vacio" ? null : l.borrador; };

const lineaF = (n: number, extra: Record<string, string> = {}) => ({
  categoria: "Combustible", descripcion: `Gasto ${n}`, cantidad: "2", monto: `${n}00.10`, fechaViaje: "2026-10-03", empleadoId: "7", vehiculoId: "5", clienteId: "8", planId: "11",
  empleadoNombre: "Pedro Pérez", cuenta: "123-456-7", cargo: "Piloto", metodoPago: "Transferencia", ...extra,
});
const estadoCompleto = (n = 2): EstadoFondoForm => ({ entidadRequirenteId: "4", requirenteUsuarioId: "2", solicitanteUsuarioId: "3", fechaRequerimiento: "2026-10-05", observaciones: "Urgente ruta Norte", lineas: Array.from({ length: n }, (_, i) => lineaF(i + 1)) });
async function sembrar(e = estadoCompleto(), a = ambito(), extra: Record<string, unknown> = {}) {
  return ok(await nucleo.guardar(a, { payload: construirPayloadFondo(e, CATALOGOS.empleados), esquemaVersion: ESQUEMA_FONDO_BORRADOR, revisionBase: null, ...extra }));
}
async function abrirFormulario(auto: Record<string, unknown> = {}, h = nuevoHost()) {
  await montar(pagina(auto), h);
  await hasta(() => expect(boton("Nueva solicitud", h.host)).toBeDefined());
  await clic(boton("Nueva solicitud", h.host));
  return h;
}
async function recuperar(h: { host: HTMLElement }) {
  await hasta(() => expect(dialogo()).not.toBeNull());
  await hasta(() => expect(llamadas.some((l) => l.url.endsWith("/catalogos"))).toBe(true));
  await esperar(50);
  await clic(boton("Recuperar borrador"));
  await hasta(() => expect(dialogo()).toBeNull());
  await hasta(() => expect(guardarBtn(h).disabled).toBe(false));
}
async function enviar(h: { host: HTMLElement }) { await clic(guardarBtn(h)); }
async function formularioListo(clave: string | null = null, n = 2) {
  await sembrar(estadoCompleto(n), ambito(), clave ? { claveEnvio: clave, estadoEnvio: "ninguno" } : {});
  const h = await abrirFormulario();
  await recuperar(h);
  return h;
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("fetch", vi.fn(fetchSimulado));
  llamadas = []; alAntesDeResponder = null;
  respuestaCreacion = () => json(200, { mensaje: "Solicitud de fondo creada.", solicitud: { id: 55 } });
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
  vi.restoreAllMocks(); vi.unstubAllGlobals(); reiniciarCoordinacionParaPruebas(); establecerFabricaCanal(undefined);
});

describe("autoguardado y recuperación en la pantalla real", () => {
  it("1) nueva solicitud vacía: sin diálogo, autoguardado activo y nada escrito hasta que el usuario cambia algo", async () => {
    const h = await abrirFormulario();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    expect(dialogo()).toBeNull();
    await esperar(150);
    expect(await guardado()).toBeNull();
    expect(h.host.textContent).toMatch(/no es una solicitud registrada hasta que pulses/);
  });

  it("2) escribir → «Cambios pendientes» → «Guardado en este equipo»; importes como texto exacto y SIN la cuenta autocompletada", async () => {
    const h = await abrirFormulario();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    await hasta(() => expect(selector(h, "Empleado")).toBeDefined());
    await escribir(entrada(h, "Monto (Q)"), "1234567.10");
    expect(estadoInd(h)).toBe("pendiente");
    await elegir(selector(h, "Empleado"), "7"); // autocompleta nombre, cargo y cuenta desde RRHH
    await elegir(campo(h, "Método de pago"), "Transferencia");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    expect(textoInd(h)).toMatch(/Guardado en este equipo a las \d{2}:\d{2}/);
    const b = (await guardado())!;
    expect(b.tipo).toBe("solicitud_fondo");
    const p = b.payload as { lineas: Record<string, unknown>[] };
    expect(p.lineas[0]).toMatchObject({ monto: "1234567.10", empleadoId: "7", empleadoNombre: "Pedro Pérez", cargo: "Piloto", metodoPago: "Transferencia", cuentaOverride: null });
    expect(JSON.stringify(b.payload)).not.toMatch(/123-456-7/); // dato bancario derivado del catálogo: no se guarda
  });

  it("2b) una cuenta que el usuario SOBRESCRIBIÓ sí se guarda (override) y se restaura", async () => {
    await sembrar({ ...estadoCompleto(1), lineas: [lineaF(1, { cuenta: "999-OTRA" })] });
    const h = await abrirFormulario();
    await recuperar(h);
    expect(campo(h, "Cuenta").value).toBe("999-OTRA");
  });

  it("3) recargar → diálogo; NUNCA restaura solo; «Recuperar» restaura todo y re-sugiere la cuenta desde el catálogo vigente", async () => {
    await sembrar(estadoCompleto(2));
    const h = await abrirFormulario();
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/Formulario: Solicitud de fondo/);
    expect(campo(h, "Fecha de requerimiento").value).toBe(HOY); // nada se aplicó solo
    expect((formEl(h).querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
    await recuperar(h);
    expect((formEl(h).querySelector("textarea") as HTMLTextAreaElement).value).toBe("Urgente ruta Norte");
    expect(campo(h, "Fecha de requerimiento").value).toBe("2026-10-05");
    expect(entrada(h, "Monto (Q)", 1).value).toBe("200.10");
    expect(campo(h, "Cuenta").value).toBe("123-456-7");
  });

  it("4) «Descartar» (con segunda confirmación) elimina el borrador y no toca la pantalla", async () => {
    await sembrar();
    const h = await abrirFormulario();
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Descartar borrador"));
    expect(await guardado()).not.toBeNull();
    await clic(boton("Sí, descartar definitivamente"));
    await hasta(() => expect(dialogo()).toBeNull());
    expect(await guardado()).toBeNull();
    expect(campo(h, "Fecha de requerimiento").value).toBe(HOY);
  });

  it("5) «Decidir después»: el borrador queda intacto, escribir NO lo sobrescribe y el envío espera", async () => {
    const sembrado = await sembrar();
    const h = await abrirFormulario();
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Decidir después"));
    await hasta(() => expect(dialogo()).toBeNull());
    await escribir(formEl(h).querySelector("textarea") as HTMLTextAreaElement, "Texto nuevo");
    await esperar(250);
    expect(await guardado()).toMatchObject({ revision: sembrado.revision, payload: { cabecera: { observaciones: "Urgente ruta Norte" } } });
    expect(textoInd(h)).toMatch(/Autoguardado en pausa/);
    expect(guardarBtn(h).disabled).toBe(true);
    expect(h.host.textContent).toMatch(/borrador guardado sin resolver/);
    await clic(boton("Recuperar el borrador guardado", h.host));
    await hasta(() => expect((formEl(h).querySelector("textarea") as HTMLTextAreaElement).value).toBe("Urgente ruta Norte"));
  });

  it("6) y 7) múltiples líneas: se restauran todas, en orden, y las ediciones se reflejan en el borrador", async () => {
    await sembrar(estadoCompleto(4));
    const h = await abrirFormulario();
    await recuperar(h);
    const montos = [0, 1, 2, 3].map((i) => entrada(h, "Monto (Q)", i).value);
    expect(montos).toEqual(["100.10", "200.10", "300.10", "400.10"]);
    await escribir(entrada(h, "Descripción", 3), "Gasto 4 editado");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    const p = (await guardado())!.payload as { lineas: { descripcion: string }[] };
    expect(p.lineas.map((l) => l.descripcion)).toEqual(["Gasto 1", "Gasto 2", "Gasto 3", "Gasto 4 editado"]);
  });

  it("8) eliminar líneas («Quitar») y agregarlas se refleja en el borrador", async () => {
    await sembrar(estadoCompleto(3));
    const h = await abrirFormulario();
    await recuperar(h);
    await clic([...formEl(h).querySelectorAll("button")].filter((b) => b.textContent === "Quitar")[1]);
    await hasta(async () => { expect(((await guardado())!.payload as { lineas: unknown[] }).lineas).toHaveLength(2); });
    expect(((await guardado())!.payload as { lineas: { descripcion: string }[] }).lineas.map((l) => l.descripcion)).toEqual(["Gasto 1", "Gasto 3"]);
    await clic(boton("+ Agregar línea", h.host));
    await hasta(async () => { expect(((await guardado())!.payload as { lineas: unknown[] }).lineas).toHaveLength(3); });
  });

  it("9) cabecera completa: empresa, requirente, solicitante, fecha y observaciones se guardan y se restauran", async () => {
    const h = await abrirFormulario();
    await hasta(() => expect(selector(h, "Requirente")).toBeDefined());
    await hasta(() => expect(campo(h, "Empresa requirente").options.length).toBeGreaterThan(1));
    await elegir(campo(h, "Empresa requirente"), "6");
    await elegir(selector(h, "Requirente"), "2");
    await elegir(selector(h, "Solicitante"), "3");
    await escribir(campo(h, "Fecha de requerimiento"), "2026-10-09");
    await escribir(formEl(h).querySelector("textarea") as HTMLTextAreaElement, "Obs cabecera");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    expect((await guardado())!.payload).toMatchObject({ cabecera: { entidadRequirenteId: "6", requirenteUsuarioId: "2", solicitanteUsuarioId: "3", fechaRequerimiento: "2026-10-09", observaciones: "Obs cabecera" } });
    await desmontar(h);
    const h2 = await abrirFormulario();
    await recuperar(h2);
    expect(campo(h2, "Empresa requirente").value).toBe("6");
    expect(selector(h2, "Solicitante").value).toBe("3");
    expect(campo(h2, "Fecha de requerimiento").value).toBe("2026-10-09");
  });

  it("10) catálogos desactualizados: se conserva lo escrito, se avisa, NO se envía y no se crea nada", async () => {
    const e = estadoCompleto(2);
    e.entidadRequirenteId = "99"; e.lineas[0] = { ...e.lineas[0], empleadoId: "77", vehiculoId: "88", clienteId: "66", planId: "55", categoria: "Inexistente" };
    await sembrar(e);
    const h = await abrirFormulario();
    await recuperar(h).catch(() => undefined);
    await hasta(() => expect(h.host.textContent).toMatch(/Línea 1: el empleado guardado ya no está disponible/));
    const t = h.host.textContent!;
    expect(t).toMatch(/La empresa requirente guardada ya no está disponible/);
    expect(t).toMatch(/Línea 1: la unidad guardada ya no está disponible/);
    expect(t).toMatch(/Línea 1: el cliente guardado ya no está disponible/);
    expect(t).toMatch(/Línea 1: el viaje\/plan guardado ya no está disponible/);
    expect(t).toMatch(/Línea 1: la categoría guardada ya no está disponible/);
    expect(entrada(h, "Descripción", 0).value).toBe("Gasto 1"); // no se pierde lo escrito
    expect(guardarBtn(h).disabled).toBe(true);
    expect(llamadas.filter((l) => l.metodo !== "GET")).toEqual([]);
  });

  it("11) payload válido para el núcleo pero INVÁLIDO para el adaptador: no activa la recuperación, no sobrescribe y se puede descartar", async () => {
    const invalido = { cabecera: { entidadRequirenteId: 5 }, lineas: "x" };
    const sembrado = ok(await nucleo.guardar(ambito(), { payload: invalido, esquemaVersion: ESQUEMA_FONDO_BORRADOR, revisionBase: null }));
    const h = await abrirFormulario();
    await hasta(() => expect(dialogo()).not.toBeNull());
    await hasta(() => expect(llamadas.some((l) => l.url.endsWith("/catalogos"))).toBe(true));
    await esperar(50);
    await clic(boton("Recuperar borrador"));
    await hasta(() => expect(h.host.textContent).toMatch(/no tiene un formato válido y no se aplicó/));
    expect(dialogo()).not.toBeNull();
    expect(textoInd(h)).toMatch(/borrador guardado sin recuperar/);
    await escribir(formEl(h).querySelector("textarea") as HTMLTextAreaElement, "No debe pisar");
    await esperar(300);
    expect(await guardado()).toMatchObject({ revision: sembrado.revision, payload: invalido });
    await clic(boton("Descartar borrador"));
    await clic(boton("Sí, descartar definitivamente"));
    await hasta(() => expect(dialogo()).toBeNull());
    expect(await guardado()).toBeNull();
  });

  it("12) conflicto entre pestañas: la segunda NO sobrescribe en silencio; y una versión remota inválida no se adopta", async () => {
    const a = await abrirFormulario();
    const b = await abrirFormulario();
    await hasta(() => expect(estadoInd(a)).toBe("inicial"));
    await hasta(() => expect(estadoInd(b)).toBe("inicial"));
    await escribir(formEl(a).querySelector("textarea") as HTMLTextAreaElement, "Desde A");
    await hasta(() => expect(estadoInd(a)).toBe("guardado"));
    await escribir(formEl(b).querySelector("textarea") as HTMLTextAreaElement, "Desde B");
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/Otra pestaña modificó este borrador/);
    expect((await guardado())!.payload).toMatchObject({ cabecera: { observaciones: "Desde A" } });
    const actual = (await guardado())!;
    const invalido = { cabecera: null, lineas: [] };
    const nuevo = ok(await nucleo.guardar(ambito(), { payload: invalido, esquemaVersion: ESQUEMA_FONDO_BORRADOR, revisionBase: actual.revision }));
    await clic(boton("Ver la versión guardada"));
    await hasta(() => expect(boton("Usar la versión de la otra pestaña")!.disabled).toBe(false));
    await clic(boton("Usar la versión de la otra pestaña"));
    await hasta(() => expect(document.body.textContent).toMatch(/no tiene un formato válido y no se aplicó/));
    expect(dialogo()).not.toBeNull();
    expect((formEl(b).querySelector("textarea") as HTMLTextAreaElement).value).toBe("Desde B");
    expect(await guardado()).toMatchObject({ revision: nuevo.revision, payload: invalido });
  });
});

describe("aislamiento y concurrencia", () => {
  it("13) otro usuario no ve ni recupera el borrador ajeno", async () => {
    await sembrar();
    const h = await abrirFormulario({ contexto: ctx(U2) });
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    expect(dialogo()).toBeNull();
    expect(await guardado(ambito(U2))).toBeNull();
  });

  it("14) otra empresa del mismo usuario no ve el borrador y no se mezclan", async () => {
    await sembrar();
    const h = await abrirFormulario({ contexto: ctx(U1, 2) });
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    expect(dialogo()).toBeNull();
    await escribir(formEl(h).querySelector("textarea") as HTMLTextAreaElement, "Solo empresa 2");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    expect((await guardado(ambito(U1, 2)))!.payload).toMatchObject({ cabecera: { observaciones: "Solo empresa 2" } });
    expect((await guardado(ambito(U1, 1)))!.payload).toMatchObject({ cabecera: { observaciones: "Urgente ruta Norte" } });
  });

  it("15) «No guardar en este equipo»: no se escribe nada, se avisa y el borrador previo queda intacto", async () => {
    const previo = await sembrar();
    fijarPersistencia(prefs, false);
    const h = await abrirFormulario();
    await hasta(() => expect(textoInd(h)).toMatch(/Sin autoguardado en este equipo/));
    expect(dialogo()).toBeNull();
    await escribir(formEl(h).querySelector("textarea") as HTMLTextAreaElement, "No se guarda");
    await esperar(200);
    const real = crearNucleoBorradores({ almacen: almacenReal, appBuild: "lectura" });
    const l = ok(await real.leer(ambito(), { esquemaVersion: ESQUEMA_FONDO_BORRADOR }));
    expect(l.estado !== "vacio" && l.borrador.revision).toBe(previo.revision);
  });

  it("16) cerrar sesión borrando: la marca de purga impide que un guardado tardío resucite el borrador", async () => {
    const h = await abrirFormulario();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    await escribir(formEl(h).querySelector("textarea") as HTMLTextAreaElement, "Pendiente de guardar");
    await suspenderEscriturasDe(U1);
    ok(await nucleo.purgarUsuario(U1));
    await esperar(300);
    expect(await guardado()).toBeNull();
    expect(h.host.textContent).toMatch(/Autoguardado detenido|Se está cerrando la sesión/);
  });

  it("16b) pestaña antigua sin aviso + purga persistente: no recrea el borrador purgado", async () => {
    const h = await abrirFormulario();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    ok(await nucleo.purgarUsuario(U1));
    await escribir(formEl(h).querySelector("textarea") as HTMLTextAreaElement, "Después de la purga");
    await hasta(() => expect(textoInd(h)).toMatch(/Sesión anterior finalizada/));
    expect(await guardado()).toBeNull();
  });

  it("17) la sesión expirada NO limpia: una respuesta 401 libera el intento y el borrador sobrevive a desmontar", async () => {
    const h = await formularioListo();
    respuestaCreacion = () => json(401, { error: "Sesión expirada" });
    await enviar(h);
    await hasta(() => expect(posts()).toHaveLength(1));
    await hasta(async () => { expect((await guardado())!.estadoEnvio).toBe("ninguno"); expect(guardarBtn(h).disabled).toBe(false); });
    await desmontar(h);
    const b = (await guardado())!;
    expect(b).not.toBeNull();
    expect(b.claveEnvio).toMatch(CLAVE_ENVIO_REGEX);
  });

  it("18) fallo de IndexedDB: se ve «Error al guardar», el contenido sigue en pantalla y NO se hace el POST", async () => {
    const h = await formularioListo();
    const espia = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("cuota", "QuotaExceededError"); });
    await escribir(formEl(h).querySelector("textarea") as HTMLTextAreaElement, "No se puede guardar");
    await hasta(() => expect(textoInd(h)).toMatch(/Error al guardar/));
    expect((formEl(h).querySelector("textarea") as HTMLTextAreaElement).value).toBe("No se puede guardar");
    await enviar(h);
    await hasta(() => expect(h.host.textContent).toMatch(/No se pudo preparar el envío en este equipo/));
    expect(posts()).toHaveLength(0);
    espia.mockRestore();
  });
});

describe("envío oficial e idempotencia", () => {
  it("19) doble envío rápido: UN solo POST", async () => {
    const h = await formularioListo();
    await act(async () => { const b = guardarBtn(h); b.click(); b.click(); b.click(); });
    await hasta(() => expect(h.host.textContent).toMatch(/Solicitud de fondo creada/));
    expect(posts()).toHaveLength(1);
  });

  it("20) respuesta incierta (red caída): intento REGISTRADO como «enviando», contenido congelado y «Reconciliación pendiente»", async () => {
    const h = await formularioListo();
    vi.stubGlobal("fetch", vi.fn((u: string, i?: RequestInit) => (i?.method === "POST" && u.endsWith("/tms/fondos") ? (llamadas.push({ url: u, metodo: "POST", cuerpo: JSON.parse(i.body as string) }), sinRed()) : fetchSimulado(u, i))));
    await enviar(h);
    await hasta(() => expect(h.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull());
    await hasta(async () => {
      const b = (await guardado())!;
      expect(b.estadoEnvio).toBe("enviando");
      expect(b.claveEnvio).toBe(posts()[0].cuerpo!.claveIdempotencia);
      expect(formEl(h).querySelector("fieldset")!.disabled).toBe(true);
    });
  });

  it("21) reintento seguro: MISMA clave y MISMO cuerpo; un 5xx es incierto, el segundo intento confirma y se limpia", async () => {
    const h = await formularioListo();
    let n = 0;
    respuestaCreacion = () => (++n === 1 ? json(500, { error: "No se pudo procesar." }) : json(200, { mensaje: "Solicitud de fondo creada.", solicitud: { id: 55 } }));
    await enviar(h);
    await hasta(() => expect(h.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull());
    await hasta(() => expect(guardarBtn(h).disabled).toBe(false));
    await enviar(h);
    await hasta(() => expect(h.host.textContent).toMatch(/Solicitud de fondo creada/));
    const [p1, p2] = posts();
    expect(p2.cuerpo).toEqual(p1.cuerpo);
    expect(p2.cuerpo!.claveIdempotencia).toMatch(CLAVE_ENVIO_REGEX);
    await hasta(async () => expect(await guardado()).toBeNull());
  });

  it("21b) un 409 (conflicto de idempotencia) NO se trata como rechazo definitivo: se conserva la clave y el contenido", async () => {
    const h = await formularioListo();
    respuestaCreacion = () => json(409, { error: "La clave de envío ya se usó con otro contenido." });
    await enviar(h);
    await hasta(() => expect(posts()).toHaveLength(1));
    await hasta(() => expect(h.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull());
    expect((await guardado())!.estadoEnvio).toBe("enviando");
  });

  it("21c) un rechazo definitivo (400) libera el intento: se corrige y se reenvía con la MISMA clave", async () => {
    const h = await formularioListo();
    respuestaCreacion = () => json(400, { error: "Línea 1 — Monto: inválido", errores: [] });
    await enviar(h);
    await hasta(() => expect(posts()).toHaveLength(1));
    await hasta(async () => { expect((await guardado())!.estadoEnvio).toBe("ninguno"); expect(guardarBtn(h).disabled).toBe(false); });
    expect(h.host.querySelector("[data-reconciliacion-pendiente]")).toBeNull();
    respuestaCreacion = () => json(200, { mensaje: "Solicitud de fondo creada.", solicitud: { id: 56 } });
    await enviar(h);
    await hasta(() => expect(posts()).toHaveLength(2));
    expect(posts()[1].cuerpo!.claveIdempotencia).toBe(posts()[0].cuerpo!.claveIdempotencia);
  });

  it("22) recargar con un envío incierto: «reconciliación pendiente», sin recuperar ni descartar y NINGÚN POST nuevo", async () => {
    const h = await formularioListo();
    respuestaCreacion = () => json(503, { error: "boom" });
    await enviar(h);
    await hasta(() => expect(h.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull());
    const clave = (await guardado())!.claveEnvio;
    await desmontar(h);
    llamadas = [];
    const h2 = await abrirFormulario();
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/intento de envío sin resultado confirmado/);
    expect(boton("Recuperar borrador")!.disabled).toBe(true);
    expect(boton("Descartar borrador")!.disabled).toBe(true);
    await clic(boton("Decidir después"));
    await hasta(() => expect(dialogo()).toBeNull());
    expect(h2.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull();
    expect(guardarBtn(h2).disabled).toBe(true);
    await clic(guardarBtn(h2));
    await esperar(100);
    expect(posts()).toHaveLength(0);
    expect((await guardado())!.claveEnvio).toBe(clave);
  });

  it("23) creación confirmada: clave registrada ANTES del POST, borrador eliminado, formulario cerrado y listado recargado", async () => {
    const h = await formularioListo();
    let visto: { estadoEnvio: string; claveEnvio: string | null } | null = null;
    alAntesDeResponder = async () => { const b = (await guardado())!; visto = { estadoEnvio: b.estadoEnvio, claveEnvio: b.claveEnvio }; };
    const antes = llamadas.filter((l) => l.metodo === "GET" && l.url.includes("/tms/fondos?")).length;
    await enviar(h);
    await hasta(() => expect(h.host.textContent).toMatch(/Solicitud de fondo creada/));
    expect(visto).toMatchObject({ estadoEnvio: "enviando", claveEnvio: posts()[0].cuerpo!.claveIdempotencia });
    await hasta(async () => expect(await guardado()).toBeNull());
    await hasta(() => expect(boton("Crear solicitud", h.host)).toBeUndefined()); // formulario cerrado
    await hasta(() => expect(llamadas.filter((l) => l.metodo === "GET" && l.url.includes("/tms/fondos?")).length).toBeGreaterThan(antes));
    expect(posts()).toHaveLength(1);
  });

  it("23b) un borrador recuperado con clave persistida la REUTILIZA", async () => {
    const clave = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const h = await formularioListo(clave);
    await enviar(h);
    await hasta(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].cuerpo!.claveIdempotencia).toBe(clave);
    await hasta(() => expect(h.host.textContent).toMatch(/Solicitud de fondo creada/));
  });
});

describe("BORR-1e-FIX-01: límite de 40 líneas y borradores heredados", () => {
  const mas = (n: number): EstadoFondoForm => ({ ...estadoCompleto(0), lineas: Array.from({ length: n }, (_, i) => lineaF(i + 1, { descripcion: `Gasto ${i + 1}`, monto: `${i + 1}.07`, cantidad: `${(i % 9) + 1}` })) });
  const filas = (h: { host: HTMLElement }) => [...formEl(h).querySelectorAll("button")].filter((b) => b.textContent === "Quitar");
  const agregar = (h: { host: HTMLElement }) => boton("+ Agregar línea", formEl(h))!;

  it("1) a 3) y 5) 39 líneas → se agrega la 40 → el botón queda deshabilitado, con el máximo visible, y ninguna línea desaparece", async () => {
    await sembrar(mas(39));
    const h = await abrirFormulario();
    await recuperar(h);
    expect(filas(h)).toHaveLength(39);
    expect(agregar(h).disabled).toBe(false);
    expect(h.host.querySelector("[data-limite-lineas]")?.textContent).toMatch(/Máximo 40 líneas por solicitud \(39\/40\)/);
    await clic(agregar(h));
    expect(filas(h)).toHaveLength(40);
    expect(agregar(h).disabled).toBe(true);
    expect(h.host.querySelector("[data-limite-lineas]")?.textContent).toMatch(/\(40\/40\)/);
    expect(entrada(h, "Descripción", 0).value).toBe("Gasto 1");
    expect(entrada(h, "Descripción", 38).value).toBe("Gasto 39");
  });

  it("4) clics simultáneos en la línea 39 no pueden crear una línea 41", async () => {
    await sembrar(mas(39));
    const h = await abrirFormulario();
    await recuperar(h);
    await act(async () => { const b = agregar(h); b.click(); b.click(); b.click(); });
    expect(filas(h)).toHaveLength(40);
    await act(async () => { agregar(h).click(); });
    expect(filas(h)).toHaveLength(40);
  });

  it("6) y 12) un borrador de 40 líneas se recupera íntegro: orden, descripciones, cantidades y montos", async () => {
    await sembrar(mas(40));
    const h = await abrirFormulario();
    await recuperar(h);
    expect(filas(h)).toHaveLength(40);
    expect([0, 17, 39].map((i) => entrada(h, "Descripción", i).value)).toEqual(["Gasto 1", "Gasto 18", "Gasto 40"]);
    expect([0, 17, 39].map((i) => entrada(h, "Monto (Q)", i).value)).toEqual(["1.07", "18.07", "40.07"]);
    expect([0, 17, 39].map((i) => entrada(h, "Cantidad", i).value)).toEqual(["1", "9", "4"]);
    expect(guardarBtn(h).disabled).toBe(false);
  });

  it("8) y 9) y 10) un borrador heredado de 101 líneas se recupera ÍNTEGRO, avisa del máximo y bloquea el POST (sin eliminar nada)", { timeout: 90_000 }, async () => {
    await sembrar(mas(101));
    const h = await abrirFormulario();
    await hasta(() => expect(dialogo()).not.toBeNull());
    await hasta(() => expect(llamadas.some((l) => l.url.endsWith("/catalogos"))).toBe(true));
    await esperar(80);
    await clic(boton("Recuperar borrador"));
    await hasta(() => expect(dialogo()).toBeNull(), 30_000);
    await hasta(() => expect(filas(h)).toHaveLength(101), 30_000); // nada se truncó
    expect(entrada(h, "Descripción", 100).value).toBe("Gasto 101");
    expect(h.host.querySelector("[data-exceso-lineas]")?.textContent).toMatch(/101 líneas.*máximo permitido es 40/);
    expect(guardarBtn(h).disabled).toBe(true);
    await clic(guardarBtn(h));
    await esperar(80);
    expect(posts()).toHaveLength(0); // el POST está bloqueado
    expect(await guardado()).toMatchObject({ estadoEnvio: "ninguno" });
  });

  it("11) y 15) reducir de 41 a 40 líneas habilita el envío, que usa la clave de idempotencia y las 40 líneas en orden", { timeout: 60_000 }, async () => {
    await sembrar(mas(41));
    const h = await abrirFormulario();
    await recuperar(h).catch(() => undefined);
    await hasta(() => expect(filas(h)).toHaveLength(41), 30_000);
    expect(h.host.querySelector("[data-exceso-lineas]")?.textContent).toMatch(/41 líneas.*quita 1/);
    expect(guardarBtn(h).disabled).toBe(true);
    await clic(filas(h)[40]);
    expect(filas(h)).toHaveLength(40);
    await hasta(() => expect(h.host.querySelector("[data-exceso-lineas]")).toBeNull());
    await hasta(() => expect(guardarBtn(h).disabled).toBe(false));
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    await enviar(h);
    await hasta(() => expect(posts()).toHaveLength(1));
    expect((posts()[0].cuerpo!.lineas as unknown[]).length).toBe(40);
    expect(posts()[0].cuerpo!.claveIdempotencia).toMatch(CLAVE_ENVIO_REGEX);
    expect((posts()[0].cuerpo!.lineas as { descripcion: string }[]).map((l) => l.descripcion).slice(0, 3)).toEqual(["Gasto 1", "Gasto 2", "Gasto 3"]);
  });

  it("7) el borrador de 101 líneas conserva TODAS al volver a guardarse (no se trunca al editar)", { timeout: 90_000 }, async () => {
    await sembrar(mas(101));
    const h = await abrirFormulario();
    await hasta(() => expect(dialogo()).not.toBeNull());
    await hasta(() => expect(llamadas.some((l) => l.url.endsWith("/catalogos"))).toBe(true));
    await esperar(80);
    await clic(boton("Recuperar borrador"));
    await hasta(() => expect(filas(h)).toHaveLength(101));
    await escribir(entrada(h, "Descripción", 100), "Gasto 101 editada");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    const p = (await guardado())!.payload as { lineas: { descripcion: string }[] };
    expect(p.lineas).toHaveLength(101);
    expect(p.lineas[100].descripcion).toBe("Gasto 101 editada");
  });

  it("13) si se excede el límite TÉCNICO de almacenamiento: «Error al guardar» (nunca «Guardado») y no se pierde nada de la pantalla", async () => {
    const pequeno = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(almacenReal, prefs), appBuild: "prueba-dom", maxPayloadChars: 3000 });
    const h = await abrirFormulario({ nucleo: pequeno });
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    for (let i = 0; i < 25; i++) await clic(agregar(h));
    await hasta(() => expect(textoInd(h)).toMatch(/Error al guardar/));
    expect(textoInd(h)).toMatch(/demasiado grande/);
    expect(textoInd(h)).not.toMatch(/^Guardado/);
    expect(filas(h)).toHaveLength(26);
  });

  it("16) la edición de una solicitud existente no cambia: sin límite de creación y PATCH sin clave", async () => {
    const h = nuevoHost();
    await montar(pagina(), h);
    await hasta(() => expect(boton("Editar", h.host)).toBeDefined());
    await clic(boton("Editar", h.host));
    await hasta(() => expect(boton("Guardar cambios", h.host)).toBeDefined());
    expect(h.host.querySelector("[data-limite-lineas]")).toBeNull();
    expect(h.host.querySelector("[data-estado-autoguardado]")).toBeNull();
    await clic(boton("Guardar cambios", h.host));
    await hasta(() => expect(llamadas.some((l) => l.metodo === "PATCH")).toBe(true));
    expect(llamadas.find((l) => l.metodo === "PATCH")!.cuerpo).not.toHaveProperty("claveIdempotencia");
  });
});

describe("alcance", () => {
  it("24) editar una solicitud existente no cambia: sin autoguardado, sin escrituras locales, PATCH con acción «editar» y sin clave", async () => {
    await sembrar();
    const h = nuevoHost();
    await montar(pagina(), h);
    await hasta(() => expect(boton("Editar", h.host)).toBeDefined());
    await clic(boton("Editar", h.host));
    await hasta(() => expect(boton("Guardar cambios", h.host)).toBeDefined());
    expect(h.host.querySelector("[data-estado-autoguardado]")).toBeNull();
    expect(dialogo()).toBeNull();
    await escribir(formEl(h).querySelector("textarea") as HTMLTextAreaElement, "Editado");
    await esperar(200);
    expect(((await guardado())!.payload as { cabecera: { observaciones: string } }).cabecera.observaciones).toBe("Urgente ruta Norte");
    await elegir(campo(h, "Método de pago"), "").catch(() => undefined);
    await clic(boton("Guardar cambios", h.host));
    await hasta(() => expect(llamadas.some((l) => l.metodo === "PATCH")).toBe(true));
    const patch = llamadas.find((l) => l.metodo === "PATCH")!;
    expect(patch.cuerpo).toMatchObject({ accion: "editar" });
    expect(patch.cuerpo).not.toHaveProperty("claveIdempotencia");
    expect(posts()).toHaveLength(0);
  });

  it("25) cerrar y volver a abrir el formulario: el borrador recuperable no se sobrescribe sin decisión explícita", async () => {
    const h = await abrirFormulario();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    await escribir(formEl(h).querySelector("textarea") as HTMLTextAreaElement, "Lo que escribí");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    const guardadoAntes = (await guardado())!;
    await clic(boton("Cancelar", h.host));
    await clic(boton("Nueva solicitud", h.host));
    await hasta(() => expect(dialogo()).not.toBeNull()); // vuelve a ofrecer la recuperación
    expect((formEl(h).querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
    await clic(boton("Decidir después"));
    await esperar(250);
    expect((await guardado())!.revision).toBe(guardadoAntes.revision);
    expect((await guardado())!.payload).toMatchObject({ cabecera: { observaciones: "Lo que escribí" } });
  });

  it("26) el autoguardado nunca llama a la API oficial: solo catálogos y listado (lecturas de la pantalla)", async () => {
    const h = await abrirFormulario();
    await escribir(formEl(h).querySelector("textarea") as HTMLTextAreaElement, "Solo local");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    await esperar(100);
    expect(llamadas.filter((l) => l.metodo !== "GET")).toEqual([]);
    expect(llamadas.every((l) => l.url.endsWith("/tms/gastos/catalogos") || l.url.includes("/tms/fondos?") || l.url.includes("/tms/fondos/entregas/resumen"))).toBe(true);
  });

  it("27) si el usuario desactiva el autoguardado en plena sesión, el envío funciona como antes (sin registrar nada)", async () => {
    const h = await formularioListo();
    fijarPersistencia(prefs, false);
    await act(async () => { window.dispatchEvent(new Event(EVENTO_PREFERENCIA)); });
    await hasta(() => expect(textoInd(h)).toMatch(/Sin autoguardado en este equipo/));
    await enviar(h);
    await hasta(() => expect(h.host.textContent).toMatch(/Solicitud de fondo creada/));
    expect(posts()).toHaveLength(1);
    expect(posts()[0].cuerpo!.claveIdempotencia).toMatch(CLAVE_ENVIO_REGEX);
    const real = crearNucleoBorradores({ almacen: almacenReal, appBuild: "lectura" });
    const l = ok(await real.leer(ambito(), { esquemaVersion: ESQUEMA_FONDO_BORRADOR }));
    expect(l.estado !== "vacio" && l.borrador.estadoEnvio).toBe("ninguno");
  });
});
