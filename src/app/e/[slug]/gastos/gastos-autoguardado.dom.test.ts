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
import { construirPayloadGasto, ESQUEMA_GASTO_BORRADOR, type EstadoGastoForm } from "@/lib/tms/gasto-borrador";
import { OpcionesAutoguardadoGastoContext } from "@/components/tms/gasto-autoguardado";

vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "empresa-1" }) }));
import GastosPage from "./page";

/**
 * BORR-1f — COMPORTAMIENTO de la pantalla REAL «Gastos operativos» (solo la CREACIÓN) con el borrador local (happy-dom +
 * fake-indexeddb). `fetch` está simulado y registra cada petición; nada toca MariaDB. Cubre el flujo en dos pasos: crear el gasto
 * y, DESPUÉS, adjuntar el comprobante.
 */
vi.setConfig({ testTimeout: 30_000 });
const U1 = "o1_usuario-ficticio-uno";
const U2 = "o1_usuario-ficticio-dos";
const HOY = new Date().toISOString().slice(0, 10);
const ctx = (ownerKey = U1, empresaId = 1) => ({ ownerKey, empresaId, empresaSlug: `empresa-${empresaId}` });
const ambito = (ownerKey = U1, empresaId = 1): AmbitoBorrador => ({ ...ctx(ownerKey, empresaId), tipo: "gasto_operativo" });
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hasta = (fn: () => void | Promise<void>, ms = 8000) => vi.waitFor(fn, { timeout: ms, interval: 10 });
function ok<T>(r: Resultado<T>): T { if (!r.ok) throw new Error(`Se esperaba éxito y fue ${r.motivo}`); return r.valor; }

const CAT = {
  empleados: [{ id: 7, codigo: "E7", nombre: "Pedro Pérez", puesto: "Piloto", cuentaBancaria: "123-456-7", telefono: "55512345" }],
  vehiculos: [{ id: 5, placa: "C-001ABC", marca: null, modelo: null }],
  clientes: [{ id: 8, codigo: "C8", nombre: "Cliente Ocho", nit: null }],
  planes: [{ id: 11, codigo: "P11", fechaPlan: "2026-10-02", empleadoId: 7, empleadoNombre: "Pedro Pérez", empleadoPuesto: "Piloto", vehiculoId: 5, placa: "C-001ABC", clienteId: 8, clienteNombre: "Cliente Ocho" }],
  usuarios: [{ id: 2, nombre: "Ana" }, { id: 3, nombre: "Beto" }],
  usuariosOperaciones: [{ id: 2, nombre: "Ana" }],
  solicitantes: [{ id: 3, nombre: "Beto" }],
  entidadesRequirentes: [{ id: 4, codigo: "F", nombre: "Frescofresh" }, { id: 6, codigo: "O", nombre: "Otra" }],
};
const CATEGORIAS = ["Combustible", "Peajes"];
const METODOS = ["Efectivo", "Transferencia", "Transferencia móvil"];
type Llamada = { url: string; metodo: string; cuerpo: Record<string, unknown> | null };
let llamadas: Llamada[];
let respuestaCreacion: () => Promise<Partial<Response>> | Partial<Response>;
let respuestaSubida: () => Partial<Response>;
let alAntesDeResponder: (() => Promise<void>) | null;
const json = (status: number, cuerpo: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });
const GASTO_EDITABLE = {
  id: 90, fechaSolicitud: "2026-09-30", fechaViaje: null, empleadoId: null, empleadoNombre: null, empleadoCargo: null, vehiculoId: null, vehiculoPlaca: null, clienteId: null, clienteNombre: null,
  planId: null, planCodigo: null, categoria: "Peajes", descripcion: "Peaje", cantidad: 1, monto: 50, metodoPago: null, numeroCuentaPago: null, tieneFactura: false, facturaNombreOriginal: null,
  facturaTamano: null, observaciones: "Existente", activo: true, estado: "Pendiente", motivoRechazo: null, entidadRequirenteId: null, entidadRequirenteNombre: null,
  requirenteUsuarioId: null, requirenteNombre: null, solicitanteUsuarioId: null, solicitanteNombre: null, lineas: [],
};
function fetchSimulado(url: string, init?: RequestInit) {
  const metodo = init?.method ?? "GET";
  const cuerpo = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  llamadas.push({ url, metodo, cuerpo });
  if (url.endsWith("/tms/gastos/catalogos")) return Promise.resolve(json(200, CAT));
  if (metodo === "POST" && url.endsWith("/tms/gastos")) return (async () => { await alAntesDeResponder?.(); return respuestaCreacion(); })();
  if (metodo === "POST" && /\/tms\/gastos\/\d+\/comprobante$/.test(url)) return Promise.resolve(respuestaSubida());
  if (metodo === "GET" && url.endsWith("/tms/gastos/90")) return Promise.resolve(json(200, { gasto: GASTO_EDITABLE }));
  if (metodo === "GET" && url.includes("/tms/gastos?")) return Promise.resolve(json(200, { gastos: [GASTO_EDITABLE], categorias: CATEGORIAS, metodosPago: METODOS }));
  return Promise.resolve(json(200, { mensaje: "Gasto actualizado." }));
}
const posts = () => llamadas.filter((l) => l.metodo === "POST" && l.url.endsWith("/tms/gastos"));
const subidas = () => llamadas.filter((l) => /\/comprobante$/.test(l.url));
const sinRed = () => Promise.reject(new TypeError("Failed to fetch"));

let hosts: { host: HTMLElement; root: Root }[];
let nucleo: NucleoBorradores;
let almacenReal: ReturnType<typeof crearAlmacenIndexedDB>;
let prefs: AlmacenPreferencias & { datos: Map<string, string> };
function nuevoHost() { const host = document.createElement("div"); document.body.append(host); const h = { host, root: createRoot(host) }; hosts.push(h); return h; }
async function montar(el: ReactElement, h = nuevoHost()) { await act(async () => { h.root.render(el); }); return h; }
async function desmontar(h: { host: HTMLElement; root: Root }) { await act(async () => { h.root.unmount(); }); h.host.remove(); hosts = hosts.filter((x) => x !== h); }
const pagina = (auto: Record<string, unknown> = {}) =>
  createElement(OpcionesAutoguardadoGastoContext.Provider, { value: { contexto: ctx(), nucleo, prefs, fabricaCanal: null, debounceMs: 30, maxEsperaMs: 200, ...auto } }, createElement(GastosPage));
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
/** Contenedor del formulario de creación (el que contiene el borrador local). */
const formEl = (h: { host: HTMLElement }) => h.host.querySelector('section[aria-label="Borrador local del gasto"]')!.parentElement as HTMLElement;
const estadoInd = (h: { host: HTMLElement }) => h.host.querySelector("[data-estado-autoguardado]")?.getAttribute("data-estado-autoguardado");
const textoInd = (h: { host: HTMLElement }) => (h.host.querySelector("[data-estado-autoguardado]")?.textContent ?? "").replace(/\s+/g, " ").trim();
/** Campo con etiqueta envolvente, dentro del formulario. */
const campo = (h: { host: HTMLElement }, texto: string, n = 0) =>
  ([...formEl(h).querySelectorAll("label")].filter((l) => (l.firstChild?.textContent ?? "").trim().startsWith(texto))[n]!.querySelector("input, select, textarea")) as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
/** Select de CatalogoSearchSelect por su etiqueta exacta. */
const selector = (h: { host: HTMLElement }, texto: string, n = 0) => {
  const l = [...formEl(h).querySelectorAll("label")].filter((x) => x.textContent === texto && x.htmlFor)[n]!;
  return document.getElementById(l.htmlFor) as HTMLSelectElement;
};
const entrada = (h: { host: HTMLElement }, placeholder: string, n = 0) => [...formEl(h).querySelectorAll("input")].filter((i) => i.placeholder === placeholder)[n] as HTMLInputElement;
const obs = (h: { host: HTMLElement }) => formEl(h).querySelector("textarea") as HTMLTextAreaElement;
const guardarBtn = (h: { host: HTMLElement }) => boton("Guardar", formEl(h))!;
const guardado = async (a = ambito()) => { const l = ok(await nucleo.leer(a, { esquemaVersion: ESQUEMA_GASTO_BORRADOR })); return l.estado === "vacio" ? null : l.borrador; };
const archivoInput = (h: { host: HTMLElement }) => formEl(h).querySelector('input[type="file"]') as HTMLInputElement;
async function elegirArchivo(h: { host: HTMLElement }, nombre = "factura-secreta.pdf") {
  const input = archivoInput(h);
  await act(async () => { Object.defineProperty(input, "files", { value: [new File(["contenido secreto"], nombre, { type: "application/pdf" })], configurable: true }); input.dispatchEvent(new Event("change", { bubbles: true })); });
}

const lineaG = (n: number, extra: Record<string, unknown> = {}) => ({
  categoria: "Peajes", descripcion: `Extra ${n}`, cantidad: "3", monto: `${n}0.05`, metodoPago: "Transferencia", numeroCuentaPago: "123-456-7", fechaViaje: "2026-10-04",
  empleadoId: 7, vehiculoId: 5, clienteId: 8, planId: 11, ...extra,
});
const estadoCompleto = (n = 2): EstadoGastoForm => ({
  form: {
    fechaSolicitud: "2026-10-05", fechaViaje: "2026-10-03", empleadoId: 7, vehiculoId: 5, clienteId: 8, planId: 11, categoria: "Combustible", descripcion: "Diesel", cantidad: "2", monto: "1234567.10",
    metodoPago: "Transferencia", numeroCuentaPago: "123-456-7", tieneFactura: false, observaciones: "Obs cabecera", entidadRequirenteId: 4, requirenteUsuarioId: 2, requirenteNombre: "", solicitanteUsuarioId: 3,
  },
  lineasAdicionales: Array.from({ length: n }, (_, i) => lineaG(i + 1)),
});
async function sembrar(e = estadoCompleto(), a = ambito(), extra: Record<string, unknown> = {}) {
  return ok(await nucleo.guardar(a, { payload: construirPayloadGasto(e, CAT.empleados), esquemaVersion: ESQUEMA_GASTO_BORRADOR, revisionBase: null, ...extra }));
}
async function abrirFormulario(auto: Record<string, unknown> = {}, h = nuevoHost()) {
  await montar(pagina(auto), h);
  await hasta(() => expect(boton("Nuevo gasto", h.host)).toBeDefined());
  await clic(boton("Nuevo gasto", h.host));
  return h;
}
async function recuperar(h: { host: HTMLElement }) {
  await hasta(() => expect(dialogo()).not.toBeNull());
  await hasta(() => expect(llamadas.some((l) => l.url.endsWith("/catalogos"))).toBe(true));
  await esperar(80);
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
  respuestaCreacion = () => json(200, { mensaje: "Gasto registrado.", gasto: { id: 55 } });
  respuestaSubida = () => json(200, { mensaje: "Comprobante adjuntado." });
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
  it("1) gasto nuevo vacío: sin diálogo, autoguardado activo y nada escrito hasta que el usuario cambia algo", async () => {
    const h = await abrirFormulario();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    expect(dialogo()).toBeNull();
    await esperar(150);
    expect(await guardado()).toBeNull();
    expect(h.host.textContent).toMatch(/no es un gasto registrado hasta que pulses/);
  });

  it("2) y 9) cabecera: se autoguarda con importes como TEXTO exacto y SIN el destino de pago autocompletado", async () => {
    const h = await abrirFormulario();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    await hasta(() => expect(campo(h, "Empresa requirente").options.length).toBeGreaterThan(1));
    await escribir(campo(h, "Monto (Q)"), "1234567.10");
    expect(estadoInd(h)).toBe("pendiente");
    await escribir(campo(h, "Cantidad"), "2.50");
    await elegir(campo(h, "Categoría"), "Combustible");
    await elegir(campo(h, "Empresa requirente"), "6");
    await elegir(selector(h, "Empleado / persona"), "7");
    await elegir(campo(h, "Método de pago"), "Transferencia"); // autocompleta la cuenta desde RRHH
    await escribir(obs(h), "Compra urgente");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    expect(textoInd(h)).toMatch(/Guardado en este equipo a las \d{2}:\d{2}/);
    const b = (await guardado())!;
    expect(b.tipo).toBe("gasto_operativo");
    expect(b.payload).toMatchObject({ cabecera: { monto: "1234567.10", cantidad: "2.50", categoria: "Combustible", entidadRequirenteId: 6, empleadoId: 7, metodoPago: "Transferencia", numeroCuentaOverride: null, observaciones: "Compra urgente" } });
    expect(campo(h, "Cuenta").value).toBe("123-456-7");
    expect(JSON.stringify(b.payload)).not.toMatch(/123-456-7/); // dato bancario derivado del catálogo: no se guarda
  });

  it("3) y 8) líneas adicionales: se autoguardan en orden, y agregar/eliminar se refleja en el borrador", async () => {
    const h = await abrirFormulario();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    await clic(boton("+ Agregar línea", formEl(h)));
    await clic(boton("+ Agregar línea", formEl(h)));
    await clic(boton("+ Agregar línea", formEl(h)));
    await escribir(entrada(h, "Descripción", 0), "Extra A");
    await escribir(entrada(h, "Monto (Q)", 0), "10.10");
    await escribir(entrada(h, "Descripción", 1), "Extra B");
    await escribir(entrada(h, "Descripción", 2), "Extra C");
    await hasta(async () => expect(((await guardado())!.payload as { lineasAdicionales: unknown[] }).lineasAdicionales).toHaveLength(3));
    await clic([...formEl(h).querySelectorAll("button")].filter((b) => b.textContent === "Quitar")[1]);
    await hasta(async () => expect(((await guardado())!.payload as { lineasAdicionales: unknown[] }).lineasAdicionales).toHaveLength(2));
    const p = (await guardado())!.payload as { lineasAdicionales: { descripcion: string; monto: string }[] };
    expect(p.lineasAdicionales.map((l) => l.descripcion)).toEqual(["Extra A", "Extra C"]);
    expect(p.lineasAdicionales[0].monto).toBe("10.10");
  });

  it("4) y 5) recargar → diálogo; NUNCA restaura solo; «Recuperar» restaura todo y re-sugiere la cuenta desde el catálogo vigente", async () => {
    await sembrar(estadoCompleto(2));
    const h = await abrirFormulario();
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/Formulario: Gasto operativo/);
    expect(campo(h, "Fecha solicitud").value).toBe(HOY); // nada se aplicó solo
    expect(obs(h).value).toBe("");
    await recuperar(h);
    expect(obs(h).value).toBe("Obs cabecera");
    expect(campo(h, "Fecha solicitud").value).toBe("2026-10-05");
    expect(campo(h, "Monto (Q)").value).toBe("1234567.10");
    expect(campo(h, "Cuenta").value).toBe("123-456-7");
    expect(entrada(h, "Monto (Q)", 1).value).toBe("20.05");
    expect(entrada(h, "Descripción", 1).value).toBe("Extra 2");
  });

  it("3b) REGRESIÓN: 101 líneas adicionales se guardan y se recuperan TODAS, en orden y con sus valores (nada desaparece en silencio)", async () => {
    const e = estadoCompleto(0);
    e.lineasAdicionales = Array.from({ length: 101 }, (_, i) => lineaG(i + 1, { descripcion: `Extra ${i + 1}`, monto: `${i + 1}.07` }));
    await sembrar(e);
    const h = await abrirFormulario();
    await recuperar(h);
    const quitar = () => [...formEl(h).querySelectorAll("button")].filter((b) => b.textContent === "Quitar");
    expect(quitar()).toHaveLength(101);
    expect(entrada(h, "Descripción", 100).value).toBe("Extra 101");
    expect(entrada(h, "Monto (Q)", 100).value).toBe("101.07");
    await escribir(entrada(h, "Descripción", 100), "Extra 101 editada");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    const p = (await guardado())!.payload as { lineasAdicionales: { descripcion: string; monto: string }[] };
    expect(p.lineasAdicionales).toHaveLength(101);
    expect(p.lineasAdicionales.map((l) => l.monto)).toEqual(e.lineasAdicionales.map((l) => l.monto));
    expect(p.lineasAdicionales[100].descripcion).toBe("Extra 101 editada");
    await desmontar(h);
    const h2 = await abrirFormulario();
    await recuperar(h2);
    expect([...formEl(h2).querySelectorAll("button")].filter((b) => b.textContent === "Quitar")).toHaveLength(101);
    expect(entrada(h2, "Descripción", 100).value).toBe("Extra 101 editada");
  });

  it("3c) si el borrador excede el límite TÉCNICO de almacenamiento, se muestra «Error al guardar» (nunca «Guardado») y no se pierde nada de la pantalla", async () => {
    const pequeno = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(almacenReal, prefs), appBuild: "prueba-dom", maxPayloadChars: 3000 });
    const h = await abrirFormulario({ nucleo: pequeno });
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    for (let i = 0; i < 25; i++) await clic(boton("+ Agregar línea", formEl(h)));
    await hasta(() => expect(textoInd(h)).toMatch(/Error al guardar/));
    expect(textoInd(h)).toMatch(/demasiado grande/);
    expect(textoInd(h)).not.toMatch(/^Guardado/);
    expect([...formEl(h).querySelectorAll("button")].filter((b) => b.textContent === "Quitar")).toHaveLength(25); // nada se eliminó de la pantalla
  });

  it("6) «Descartar» (con segunda confirmación) elimina el borrador y no toca la pantalla", async () => {
    await sembrar();
    const h = await abrirFormulario();
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Descartar borrador"));
    expect(await guardado()).not.toBeNull();
    await clic(boton("Sí, descartar definitivamente"));
    await hasta(() => expect(dialogo()).toBeNull());
    expect(await guardado()).toBeNull();
    expect(campo(h, "Fecha solicitud").value).toBe(HOY);
  });

  it("7) «Decidir después»: el borrador queda intacto, escribir NO lo sobrescribe y el envío espera", async () => {
    const sembrado = await sembrar();
    const h = await abrirFormulario();
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Decidir después"));
    await hasta(() => expect(dialogo()).toBeNull());
    await escribir(obs(h), "Texto nuevo");
    await esperar(250);
    expect(await guardado()).toMatchObject({ revision: sembrado.revision, payload: { cabecera: { observaciones: "Obs cabecera" } } });
    expect(textoInd(h)).toMatch(/Autoguardado en pausa/);
    expect(guardarBtn(h).disabled).toBe(true);
    expect(h.host.textContent).toMatch(/borrador guardado sin resolver/);
    await clic(boton("Recuperar el borrador guardado", h.host));
    await hasta(() => expect(obs(h).value).toBe("Obs cabecera"));
  });

  it("10) catálogos desactualizados: se conserva lo escrito, se avisa, NO se envía y no se crea nada", async () => {
    const e = estadoCompleto(1);
    e.form = { ...e.form, entidadRequirenteId: 99, empleadoId: 77, vehiculoId: 88, clienteId: 66, planId: 55, categoria: "Inexistente", metodoPago: "Cheque" };
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
    expect(t).toMatch(/Línea 1: el método de pago guardado ya no está disponible/);
    expect(campo(h, "Descripción").value).toBe("Diesel");
    expect(guardarBtn(h).disabled).toBe(true);
    expect(llamadas.filter((l) => l.metodo === "POST")).toEqual([]);
  });

  it("11) payload válido para el núcleo pero INVÁLIDO para el adaptador: no activa la recuperación, no sobrescribe y se puede descartar", async () => {
    const invalido = { cabecera: { monto: 5 }, lineasAdicionales: "x" };
    const sembrado = ok(await nucleo.guardar(ambito(), { payload: invalido, esquemaVersion: ESQUEMA_GASTO_BORRADOR, revisionBase: null }));
    const h = await abrirFormulario();
    await hasta(() => expect(dialogo()).not.toBeNull());
    await hasta(() => expect(llamadas.some((l) => l.url.endsWith("/catalogos"))).toBe(true));
    await esperar(80);
    await clic(boton("Recuperar borrador"));
    await hasta(() => expect(h.host.textContent).toMatch(/no tiene un formato válido y no se aplicó/));
    expect(dialogo()).not.toBeNull();
    expect(textoInd(h)).toMatch(/borrador guardado sin recuperar/);
    await escribir(obs(h), "No debe pisar");
    await esperar(300);
    expect(await guardado()).toMatchObject({ revision: sembrado.revision, payload: invalido });
    await clic(boton("Descartar borrador"));
    await clic(boton("Sí, descartar definitivamente"));
    await hasta(() => expect(dialogo()).toBeNull());
    expect(await guardado()).toBeNull();
  });

  it("12) y 13) conflicto entre pestañas: la segunda NO sobrescribe en silencio; una versión remota inválida no se adopta", async () => {
    const a = await abrirFormulario();
    const b = await abrirFormulario();
    await hasta(() => expect(estadoInd(a)).toBe("inicial"));
    await hasta(() => expect(estadoInd(b)).toBe("inicial"));
    await escribir(obs(a), "Desde A");
    await hasta(() => expect(estadoInd(a)).toBe("guardado"));
    await escribir(obs(b), "Desde B");
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/Otra pestaña modificó este borrador/);
    expect((await guardado())!.payload).toMatchObject({ cabecera: { observaciones: "Desde A" } });
    const actual = (await guardado())!;
    const invalido = { cabecera: null, lineasAdicionales: [] };
    const nuevo = ok(await nucleo.guardar(ambito(), { payload: invalido, esquemaVersion: ESQUEMA_GASTO_BORRADOR, revisionBase: actual.revision }));
    await clic(boton("Ver la versión guardada"));
    await hasta(() => expect(boton("Usar la versión de la otra pestaña")!.disabled).toBe(false));
    await clic(boton("Usar la versión de la otra pestaña"));
    await hasta(() => expect(document.body.textContent).toMatch(/no tiene un formato válido y no se aplicó/));
    expect(dialogo()).not.toBeNull();
    expect(obs(b).value).toBe("Desde B");
    expect(await guardado()).toMatchObject({ revision: nuevo.revision, payload: invalido });
  });
});

describe("aislamiento y concurrencia", () => {
  it("14) otro usuario no ve ni recupera el borrador ajeno", async () => {
    await sembrar();
    const h = await abrirFormulario({ contexto: ctx(U2) });
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    expect(dialogo()).toBeNull();
    expect(await guardado(ambito(U2))).toBeNull();
  });

  it("15) otra empresa del mismo usuario no ve el borrador y no se mezclan", async () => {
    await sembrar();
    const h = await abrirFormulario({ contexto: ctx(U1, 2) });
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    expect(dialogo()).toBeNull();
    await escribir(obs(h), "Solo empresa 2");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    expect((await guardado(ambito(U1, 2)))!.payload).toMatchObject({ cabecera: { observaciones: "Solo empresa 2" } });
    expect((await guardado(ambito(U1, 1)))!.payload).toMatchObject({ cabecera: { observaciones: "Obs cabecera" } });
  });

  it("16) «No guardar en este equipo»: no se escribe nada y el borrador previo queda intacto", async () => {
    const previo = await sembrar();
    fijarPersistencia(prefs, false);
    const h = await abrirFormulario();
    await hasta(() => expect(textoInd(h)).toMatch(/Sin autoguardado en este equipo/));
    expect(dialogo()).toBeNull();
    await escribir(obs(h), "No se guarda");
    await esperar(200);
    const real = crearNucleoBorradores({ almacen: almacenReal, appBuild: "lectura" });
    const l = ok(await real.leer(ambito(), { esquemaVersion: ESQUEMA_GASTO_BORRADOR }));
    expect(l.estado !== "vacio" && l.borrador.revision).toBe(previo.revision);
  });

  it("17) cerrar sesión borrando: la marca de purga impide que un guardado tardío resucite el borrador (también en una pestaña antigua)", async () => {
    const h = await abrirFormulario();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    await escribir(obs(h), "Pendiente de guardar");
    await suspenderEscriturasDe(U1);
    ok(await nucleo.purgarUsuario(U1));
    await esperar(300);
    expect(await guardado()).toBeNull();
    expect(h.host.textContent).toMatch(/Autoguardado detenido|Se está cerrando la sesión/);
    const v = await abrirFormulario({}, nuevoHost());
    await hasta(() => expect(estadoInd(v)).toBe("inicial"));
    ok(await nucleo.purgarUsuario(U1)); // otra pestaña vuelve a cerrar sesión sin avisar a ésta
    await escribir(obs(v), "Después de la purga");
    await hasta(() => expect(textoInd(v)).toMatch(/Sesión anterior finalizada/));
    expect(await guardado()).toBeNull();
  });

  it("18) la sesión expirada NO limpia: una respuesta 401 libera el intento y el borrador sobrevive a desmontar", async () => {
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

  it("19) fallo de IndexedDB: se ve «Error al guardar», el contenido sigue en pantalla y NO se hace el POST", async () => {
    const h = await formularioListo();
    const espia = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("cuota", "QuotaExceededError"); });
    await escribir(obs(h), "No se puede guardar");
    await hasta(() => expect(textoInd(h)).toMatch(/Error al guardar/));
    expect(obs(h).value).toBe("No se puede guardar");
    await enviar(h);
    await hasta(() => expect(h.host.textContent).toMatch(/No se pudo preparar el envío en este equipo/));
    expect(posts()).toHaveLength(0);
    espia.mockRestore();
  });
});

describe("envío oficial e idempotencia", () => {
  it("20) doble envío rápido: UN solo POST", async () => {
    const h = await formularioListo();
    await act(async () => { const b = guardarBtn(h); b.click(); b.click(); b.click(); });
    await hasta(() => expect(h.host.querySelector('section[aria-label="Borrador local del gasto"]')).toBeNull()); // creado y formulario cerrado
    expect(posts()).toHaveLength(1);
  });

  it("21) respuesta incierta (red caída): intento REGISTRADO como «enviando», contenido congelado y «Reconciliación pendiente»", async () => {
    const h = await formularioListo();
    vi.stubGlobal("fetch", vi.fn((u: string, i?: RequestInit) => (i?.method === "POST" && u.endsWith("/tms/gastos") ? (llamadas.push({ url: u, metodo: "POST", cuerpo: JSON.parse(i.body as string) }), sinRed()) : fetchSimulado(u, i))));
    await enviar(h);
    await hasta(() => expect(h.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull());
    await hasta(async () => {
      const b = (await guardado())!;
      expect(b.estadoEnvio).toBe("enviando");
      expect(b.claveEnvio).toBe(posts()[0].cuerpo!.claveIdempotencia);
      expect(campo(h, "Categoría").closest("fieldset")!.disabled).toBe(true);
      expect(obs(h).closest("fieldset")!.disabled).toBe(true);
    });
  });

  it("22) reintento seguro: MISMA clave y MISMO cuerpo; un 5xx es incierto, el segundo intento confirma y se limpia", async () => {
    const h = await formularioListo();
    let n = 0;
    respuestaCreacion = () => (++n === 1 ? json(500, { error: "No se pudo procesar." }) : json(200, { mensaje: "Gasto registrado.", gasto: { id: 55 } }));
    await enviar(h);
    await hasta(() => expect(h.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull());
    await hasta(() => expect(guardarBtn(h).disabled).toBe(false));
    await enviar(h);
    await hasta(() => expect(h.host.querySelector('section[aria-label="Borrador local del gasto"]')).toBeNull());
    const [p1, p2] = posts();
    expect(p2.cuerpo).toEqual(p1.cuerpo);
    expect(p2.cuerpo!.claveIdempotencia).toMatch(CLAVE_ENVIO_REGEX);
    await hasta(async () => expect(await guardado()).toBeNull());
  });

  it("22b) un 409 (conflicto de idempotencia) NO se trata como rechazo definitivo: se conserva la clave y el contenido", async () => {
    const h = await formularioListo();
    respuestaCreacion = () => json(409, { error: "La clave de envío ya se usó con otro contenido." });
    await enviar(h);
    await hasta(() => expect(posts()).toHaveLength(1));
    await hasta(() => expect(h.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull());
    expect((await guardado())!.estadoEnvio).toBe("enviando");
  });

  it("22c) un rechazo definitivo (400) libera el intento: se corrige y se reenvía con la MISMA clave", async () => {
    const h = await formularioListo();
    respuestaCreacion = () => json(400, { error: "Línea 1 — Monto: inválido", errores: [] });
    await enviar(h);
    await hasta(() => expect(posts()).toHaveLength(1));
    await hasta(async () => { expect((await guardado())!.estadoEnvio).toBe("ninguno"); expect(guardarBtn(h).disabled).toBe(false); });
    expect(h.host.querySelector("[data-reconciliacion-pendiente]")).toBeNull();
    respuestaCreacion = () => json(200, { mensaje: "Gasto registrado.", gasto: { id: 56 } });
    await enviar(h);
    await hasta(() => expect(posts()).toHaveLength(2));
    expect(posts()[1].cuerpo!.claveIdempotencia).toBe(posts()[0].cuerpo!.claveIdempotencia);
  });

  it("23) recargar con un envío incierto: «reconciliación pendiente», sin recuperar ni descartar y NINGÚN POST nuevo", async () => {
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

  it("24) creación confirmada sin comprobante: clave registrada ANTES del POST, borrador eliminado, formulario cerrado y listado recargado", async () => {
    const h = await formularioListo();
    let visto: { estadoEnvio: string; claveEnvio: string | null } | null = null;
    alAntesDeResponder = async () => { const b = (await guardado())!; visto = { estadoEnvio: b.estadoEnvio, claveEnvio: b.claveEnvio }; };
    const antes = llamadas.filter((l) => l.metodo === "GET" && l.url.includes("/tms/gastos?")).length;
    await enviar(h);
    await hasta(() => expect(h.host.querySelector('section[aria-label="Borrador local del gasto"]')).toBeNull());
    expect(visto).toMatchObject({ estadoEnvio: "enviando", claveEnvio: posts()[0].cuerpo!.claveIdempotencia });
    await hasta(async () => expect(await guardado()).toBeNull());
    await hasta(() => expect(h.host.querySelector('section[aria-label="Borrador local del gasto"]')).toBeNull());
    await hasta(() => expect(llamadas.filter((l) => l.metodo === "GET" && l.url.includes("/tms/gastos?")).length).toBeGreaterThan(antes));
    expect(posts()).toHaveLength(1);
    expect(subidas()).toHaveLength(0);
  });

  it("24b) un borrador recuperado con clave persistida la REUTILIZA", async () => {
    const clave = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const h = await formularioListo(clave);
    await enviar(h);
    await hasta(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].cuerpo!.claveIdempotencia).toBe(clave);
  });

  it("25) y 29) creación confirmada CON comprobante: el archivo no va en el borrador ni en el JSON del POST, se sube después al id creado y se limpia todo", async () => {
    const h = await formularioListo();
    await elegirArchivo(h);
    await hasta(async () => expect(JSON.stringify((await guardado())!.payload)).toContain('"tieneFactura":true'));
    expect(JSON.stringify((await guardado())!.payload)).not.toMatch(/factura-secreta|contenido secreto|"file"/); // 29) File excluido de IndexedDB
    await enviar(h);
    await hasta(() => expect(subidas()).toHaveLength(1));
    expect(subidas()[0].url).toBe("/api/empresas/empresa-1/tms/gastos/55/comprobante");
    expect(JSON.stringify(posts()[0].cuerpo)).not.toMatch(/factura-secreta/);
    await hasta(() => expect(h.host.textContent).toMatch(/Gasto y comprobante guardados/));
    await hasta(async () => expect(await guardado()).toBeNull());
    expect(posts()).toHaveLength(1);
  });

  it("26) y 27) si la subida falla DESPUÉS de crear: el gasto queda creado (una sola vez), sin presentarlo como creación pendiente; el reintento solo sube el archivo", async () => {
    const h = await formularioListo();
    await elegirArchivo(h);
    respuestaSubida = () => json(500, { error: "No se pudo guardar el comprobante." });
    await enviar(h);
    await hasta(() => expect(h.host.querySelector("[data-subida-pendiente]")).not.toBeNull());
    expect(h.host.textContent).toMatch(/no se creará otro gasto/);
    expect(h.host.textContent).toMatch(/El gasto n\.º 55 ya está creado/);
    expect(h.host.querySelector("[data-reconciliacion-pendiente]")).toBeNull(); // la creación ya NO es incierta
    expect(posts()).toHaveLength(1);
    await hasta(async () => expect((await guardado())!.estadoEnvio).toBe("completado"));
    expect(obs(h).closest("fieldset")!.disabled).toBe(true); // el contenido ya no se puede cambiar
    expect(archivoInput(h).closest("fieldset")!.disabled).toBe(false); // pero sí se puede volver a elegir el comprobante
    // reintento: SOLO la subida, al mismo id; sin nuevo POST de creación
    respuestaSubida = () => json(200, { mensaje: "Comprobante adjuntado." });
    await enviar(h);
    await hasta(() => expect(h.host.textContent).toMatch(/Gasto y comprobante guardados/));
    expect(posts()).toHaveLength(1);
    expect(subidas().map((s) => s.url)).toEqual(["/api/empresas/empresa-1/tms/gastos/55/comprobante", "/api/empresas/empresa-1/tms/gastos/55/comprobante"]);
    await hasta(async () => expect(await guardado()).toBeNull());
  });

  it("26b) una red caída DURANTE la subida no se confunde con una creación incierta", async () => {
    const h = await formularioListo();
    await elegirArchivo(h);
    vi.stubGlobal("fetch", vi.fn((u: string, i?: RequestInit) => (/\/comprobante$/.test(u) ? (llamadas.push({ url: u, metodo: "POST", cuerpo: null }), sinRed()) : fetchSimulado(u, i))));
    await enviar(h);
    await hasta(() => expect(h.host.querySelector("[data-subida-pendiente]")).not.toBeNull());
    expect(h.host.querySelector("[data-reconciliacion-pendiente]")).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  it("28) recargar tras la creación confirmada con la subida pendiente: no hay POST nuevo, el borrador figura como ya enviado (descartable) y no finge conservar el archivo", async () => {
    const h = await formularioListo();
    await elegirArchivo(h);
    respuestaSubida = () => json(500, { error: "No se pudo guardar el comprobante." });
    await enviar(h);
    await hasta(() => expect(h.host.querySelector("[data-subida-pendiente]")).not.toBeNull());
    await hasta(async () => expect((await guardado())!.estadoEnvio).toBe("completado"));
    await desmontar(h);
    llamadas = [];
    const h2 = await abrirFormulario();
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/ya se envió oficialmente/);
    expect(boton("Recuperar borrador")!.disabled).toBe(true); // no se restaura para no duplicar el gasto
    expect(boton("Descartar borrador")!.disabled).toBe(false);
    expect(dialogo()!.textContent).toMatch(/archivos adjuntos no se guardan/i);
    await clic(boton("Descartar borrador"));
    await clic(boton("Sí, descartar definitivamente"));
    await hasta(() => expect(dialogo()).toBeNull());
    expect(posts()).toHaveLength(0);
    expect(subidas()).toHaveLength(0);
    expect(h2.host.querySelector("[data-reconciliacion-pendiente]")).toBeNull();
  });

  it("30) al recuperar un gasto con factura se avisa que el comprobante debe volver a seleccionarse", async () => {
    const e = estadoCompleto(1); e.form.tieneFactura = true;
    await sembrar(e);
    const h = await abrirFormulario();
    await recuperar(h);
    expect(h.host.querySelector("[data-aviso-comprobante]")?.textContent).toMatch(/vuelve a seleccionarlo/);
    expect(archivoInput(h).files?.length ?? 0).toBe(0);
    await elegirArchivo(h);
    await hasta(() => expect(h.host.querySelector("[data-aviso-comprobante]")).toBeNull());
  });
});

describe("alcance", () => {
  it("31) editar un gasto existente no cambia: sin autoguardado, sin escrituras locales y PATCH sin clave", async () => {
    await sembrar();
    const h = nuevoHost();
    await montar(pagina(), h);
    await hasta(() => expect(boton("Editar", h.host)).toBeDefined());
    await clic(boton("Editar", h.host));
    await hasta(() => expect(h.host.querySelector('[class*="panel"] textarea, textarea')).not.toBeNull());
    expect(h.host.querySelector("[data-estado-autoguardado]")).toBeNull();
    expect(dialogo()).toBeNull();
    const area = [...h.host.querySelectorAll("textarea")].find((t) => t.value === "Existente") as HTMLTextAreaElement;
    await escribir(area, "Editado");
    await esperar(200);
    expect(((await guardado())!.payload as { cabecera: { observaciones: string } }).cabecera.observaciones).toBe("Obs cabecera");
    await clic(boton("Guardar", h.host));
    await hasta(() => expect(llamadas.some((l) => l.metodo === "PATCH")).toBe(true));
    const patch = llamadas.find((l) => l.metodo === "PATCH")!;
    expect(patch.url).toMatch(/\/tms\/gastos\/90$/);
    expect(patch.cuerpo).not.toHaveProperty("claveIdempotencia");
    expect(posts()).toHaveLength(0);
  });

  it("32) cancelar y volver a abrir: el borrador recuperable no se sobrescribe sin decisión explícita", async () => {
    const h = await abrirFormulario();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    await escribir(obs(h), "Lo que escribí");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    const antes = (await guardado())!;
    await clic(boton("Cancelar", h.host));
    await clic(boton("Nuevo gasto", h.host));
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(obs(h).value).toBe("");
    await clic(boton("Decidir después"));
    await esperar(250);
    expect((await guardado())!.revision).toBe(antes.revision);
    expect((await guardado())!.payload).toMatchObject({ cabecera: { observaciones: "Lo que escribí" } });
  });

  it("33) el autoguardado nunca llama a la API oficial: solo catálogos y listado (lecturas de la pantalla)", async () => {
    const h = await abrirFormulario();
    await escribir(obs(h), "Solo local");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    await esperar(100);
    expect(llamadas.filter((l) => l.metodo !== "GET")).toEqual([]);
    expect(llamadas.every((l) => l.url.endsWith("/tms/gastos/catalogos") || l.url.includes("/tms/gastos?"))).toBe(true);
  });

  it("34) si el usuario desactiva el autoguardado en plena sesión, el envío funciona como antes (sin registrar nada)", async () => {
    const h = await formularioListo();
    fijarPersistencia(prefs, false);
    await act(async () => { window.dispatchEvent(new Event(EVENTO_PREFERENCIA)); });
    await hasta(() => expect(textoInd(h)).toMatch(/Sin autoguardado en este equipo/));
    await enviar(h);
    await hasta(() => expect(h.host.querySelector('section[aria-label="Borrador local del gasto"]')).toBeNull());
    expect(posts()).toHaveLength(1);
    expect(posts()[0].cuerpo!.claveIdempotencia).toMatch(CLAVE_ENVIO_REGEX);
    const real = crearNucleoBorradores({ almacen: almacenReal, appBuild: "lectura" });
    const l = ok(await real.leer(ambito(), { esquemaVersion: ESQUEMA_GASTO_BORRADOR }));
    expect(l.estado !== "vacio" && l.borrador.estadoEnvio).toBe("ninguno");
  });
});
