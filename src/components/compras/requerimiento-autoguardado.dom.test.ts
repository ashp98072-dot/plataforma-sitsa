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
import { aEstado, construirPayload, ESQUEMA_REQUERIMIENTO_BORRADOR, type EstadoFormularioRequerimiento } from "@/lib/compras/requerimiento-borrador";
import { CLAVE_ENVIO_REGEX } from "@/lib/idempotencia/clave-envio";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh }) }));
import { RequerimientoFormClient } from "./requerimiento-form-client";

/**
 * BORR-1d — COMPORTAMIENTO del formulario REAL «Nuevo requerimiento de compra» con el borrador local (happy-dom + fake-indexeddb):
 * escribir, autoguardar, recargar, recuperar, descartar, conflicto entre pestañas, aislamiento usuario/empresa, y — lo crítico —
 * el envío oficial idempotente (clave registrada ANTES del POST, misma clave en reintentos, reconciliación pendiente tras recargar).
 * Datos ficticios; ninguna llamada real: `fetch` está simulado y registra cada petición.
 */
vi.setConfig({ testTimeout: 30_000 });
const U1 = "o1_usuario-ficticio-uno";
const U2 = "o1_usuario-ficticio-dos";
const HOY = "2026-10-01";
const ctx = (ownerKey = U1, empresaId = 1) => ({ ownerKey, empresaId, empresaSlug: `empresa-${empresaId}` });
const ambito = (ownerKey = U1, empresaId = 1): AmbitoBorrador => ({ ...ctx(ownerKey, empresaId), tipo: "requerimiento_compra" });
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hasta = (fn: () => void, ms = 8000) => vi.waitFor(fn, { timeout: ms, interval: 10 });
function ok<T>(r: Resultado<T>): T { if (!r.ok) throw new Error(`Se esperaba éxito y fue ${r.motivo}`); return r.valor; }

const CATALOGOS = {
  entidades: [{ id: 4, nombre: "Frescofresh" }, { id: 6, nombre: "Otra" }],
  usuarios: [{ id: 2, nombre: "Ana" }, { id: 3, nombre: "Beto" }],
  requirentesOperaciones: [{ id: 2, nombre: "Ana" }],
  proveedores: [9, 10].map((id) => ({ id, nombre_comercial: `Proveedor ${id}`, nit: null, contacto_nombre: null, contacto_telefono: null, telefono: null, metodo_pago_habitual: null, banco: null, numero_cuenta: null, dias_credito: null })),
  vehiculos: [{ id: 5, placa: "C-001ABC", descripcion: "Camión", marca: null, modelo: null }],
};
type Llamada = { url: string; metodo: string; cuerpo: Record<string, unknown> | null };
let llamadas: Llamada[];
let alerta: ReturnType<typeof vi.fn>;
let respuestaCreacion: () => Promise<Partial<Response>> | Partial<Response>;
let alAntesDeResponder: (() => Promise<void>) | null;
const json = (status: number, cuerpo: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });
function fetchSimulado(url: string, init?: RequestInit) {
  const metodo = init?.method ?? "GET";
  const cuerpo = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  llamadas.push({ url, metodo, cuerpo });
  if (url.endsWith("/compras/catalogos")) return Promise.resolve(json(200, CATALOGOS));
  if (url.includes("/compras/facturas")) return Promise.resolve(json(200, { existe: false }));
  if (metodo === "POST" && url.endsWith("/compras/requerimientos")) return (async () => { await alAntesDeResponder?.(); return respuestaCreacion(); })();
  if (metodo === "GET" && /\/compras\/requerimientos\/\d+$/.test(url)) return Promise.resolve(json(200, { requerimiento: { lineas: [{ id: 501, orden: 1 }, { id: 502, orden: 2 }] } }));
  if (/\/documentos$/.test(url)) return Promise.resolve(json(500, { error: "falló la subida" }));
  return Promise.resolve(json(200, {}));
}
const posts = () => llamadas.filter((l) => l.metodo === "POST" && l.url.endsWith("/compras/requerimientos"));
const sinRed = () => Promise.reject(new TypeError("Failed to fetch"));

let hosts: { host: HTMLElement; root: Root }[];
let nucleo: NucleoBorradores;
let almacenReal: ReturnType<typeof crearAlmacenIndexedDB>;
let prefs: AlmacenPreferencias & { datos: Map<string, string> };
function nuevoHost() { const host = document.createElement("div"); document.body.append(host); const h = { host, root: createRoot(host) }; hosts.push(h); return h; }
async function montar(el: ReactElement, h = nuevoHost()) { await act(async () => { h.root.render(el); }); return h; }
async function desmontar(h: { host: HTMLElement; root: Root }) { await act(async () => { h.root.unmount(); }); h.host.remove(); hosts = hosts.filter((x) => x !== h); }
const formulario = (extra: Record<string, unknown> = {}, auto: Record<string, unknown> = {}) =>
  createElement(RequerimientoFormClient, {
    slug: "empresa-1", editable: true, solicitante: "Actual", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: true, puedeAutorizar: false, fechaHoy: HOY,
    opcionesAutoguardado: { contexto: ctx(), nucleo, prefs, fabricaCanal: null, debounceMs: 30, maxEsperaMs: 200, ...auto }, ...extra,
  } as never);
const todos = (h: { host: HTMLElement }, sel: string) => [...h.host.querySelectorAll(sel)] as HTMLElement[];
const etiqueta = (h: { host: HTMLElement }, texto: string, n = 0) => {
  const l = todos(h, "label").filter((x) => (x.firstChild?.textContent ?? "").trim().startsWith(texto) || x.textContent!.trim().startsWith(texto));
  return l[n]!.querySelector("input, select, textarea") as HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement;
};
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
const dialogo = () => document.querySelector('[role="alertdialog"]');
const boton = (texto: string, raiz: ParentNode = document) => [...raiz.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;
async function clic(el: Element | undefined | null) { if (!el) throw new Error("elemento no encontrado"); await act(async () => { (el as HTMLElement).click(); }); }
const estadoInd = (h: { host: HTMLElement }) => h.host.querySelector("[data-estado-autoguardado]")?.getAttribute("data-estado-autoguardado");
const textoInd = (h: { host: HTMLElement }) => (h.host.querySelector("[data-estado-autoguardado]")?.textContent ?? "").replace(/\s+/g, " ").trim();
const guardar = (h: { host: HTMLElement }) => boton("Guardar requerimiento", h.host)!;
const guardado = async (a = ambito()) => { const l = ok(await nucleo.leer(a, { esquemaVersion: ESQUEMA_REQUERIMIENTO_BORRADOR })); return l.estado === "vacio" ? null : l.borrador; };
const linea = (n: number, extra: Record<string, unknown> = {}) => ({
  key: `L${n}`, vehiculo_id: null as number | null, unidad_descripcion: "Pick-up" as string | null, fecha: HOY, serie_factura: null as string | null, numero_factura: String(7000 + n), proveedor_id: 9,
  repuesto_descripcion: `Filtro ${n}`, metodo_pago: "Transferencia", condicion_pago: "Contado" as const, total: `${n}00.50`, observaciones: null as string | null, ...extra,
});
const estadoCompleto = (n = 2, extra: Partial<EstadoFormularioRequerimiento> = {}): EstadoFormularioRequerimiento => ({
  ...aEstado({ fecha: HOY, entidad: 4, requirente: 2, encargado: 3, observaciones: "Urgente para la ruta", lineas: Array.from({ length: n }, (_, i) => linea(i + 1)) }), ...extra,
});
async function sembrar(e = estadoCompleto(), a = ambito(), extra: Record<string, unknown> = {}) {
  return ok(await nucleo.guardar(a, { payload: construirPayload(e), esquemaVersion: ESQUEMA_REQUERIMIENTO_BORRADOR, revisionBase: null, ...extra }));
}
async function recuperar(h: { host: HTMLElement }) {
  await hasta(() => expect(dialogo()).not.toBeNull());
  await clic(boton("Recuperar borrador"));
  await hasta(() => expect(dialogo()).toBeNull());
  await hasta(() => expect(guardar(h).disabled).toBe(false)); // catálogos cargados y sin bloqueos
}
const cerrado = async () => { await hasta(() => expect(["inicial", "guardado", "pendiente", "guardando"]).toContain(estadoInd({ host: document.body })!)); };

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("fetch", vi.fn(fetchSimulado));
  alerta = vi.fn(); (window as unknown as { alert: unknown }).alert = alerta;
  nav.push.mockReset(); nav.refresh.mockReset();
  llamadas = []; alAntesDeResponder = null;
  respuestaCreacion = () => json(201, { id: 12, codigo: "RC-2026-000012", version: 1 });
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
void cerrado;
async function formularioListo(clave: string | null = null) {
  await sembrar(estadoCompleto(2), ambito(), clave ? { claveEnvio: clave, estadoEnvio: "ninguno" } : {});
  const h = await montar(formulario());
  await recuperar(h);
  return h;
}
/** Envía el formulario como lo hace el navegador (evento submit); el clic en happy-dom no dispara siempre la validación nativa. */
async function enviar(h: { host: HTMLElement }) {
  await act(async () => { h.host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

describe("autoguardado y recuperación en el formulario real", () => {
  it("1) sin borrador previo: no aparece diálogo, el autoguardado queda activo y no se escribe nada hasta que el usuario cambia algo", async () => {
    const h = await montar(formulario());
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    expect(dialogo()).toBeNull();
    await esperar(150);
    expect(await guardado()).toBeNull();
    expect(h.host.textContent).toMatch(/no es un requerimiento registrado hasta que lo envíes/);
  });

  it("2) escribir → «Cambios pendientes» → «Guardado en este equipo»; el borrador contiene solo los campos permitidos", async () => {
    const h = await montar(formulario());
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    await escribir(etiqueta(h, "Observaciones") as HTMLTextAreaElement, "Compra urgente");
    expect(estadoInd(h)).toBe("pendiente");
    await escribir(etiqueta(h, "Repuesto a comprar"), "Filtro de aceite");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    expect(textoInd(h)).toMatch(/Guardado en este equipo a las \d{2}:\d{2}/);
    const b = (await guardado())!;
    expect(b.tipo).toBe("requerimiento_compra");
    expect(b.esquemaVersion).toBe(ESQUEMA_REQUERIMIENTO_BORRADOR);
    expect(b.payload).toMatchObject({ cabecera: { observaciones: "Compra urgente" }, lineas: [{ repuestoDescripcion: "Filtro de aceite" }] });
    expect(b.estadoEnvio).toBe("ninguno");
  });

  it("3) recargar → diálogo de recuperación; NUNCA restaura solo; «Recuperar» restaura cabecera y líneas", async () => {
    await sembrar(estadoCompleto(2));
    const h = await montar(formulario());
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/Formulario: Requerimiento de compra/);
    expect(etiqueta(h, "Observaciones").value).toBe(""); // nada se aplicó solo
    expect(etiqueta(h, "Repuesto a comprar").value).toBe("");
    await recuperar(h);
    expect(etiqueta(h, "Observaciones").value).toBe("Urgente para la ruta");
    expect(etiqueta(h, "Repuesto a comprar", 0).value).toBe("Filtro 1");
    expect(etiqueta(h, "Repuesto a comprar", 1).value).toBe("Filtro 2");
  });

  it("4) «Descartar» (con segunda confirmación) elimina el borrador y no toca lo que hay en pantalla", async () => {
    await sembrar();
    const h = await montar(formulario());
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Descartar borrador"));
    expect(await guardado()).not.toBeNull(); // aún no
    await clic(boton("Sí, descartar definitivamente"));
    await hasta(() => expect(dialogo()).toBeNull());
    expect(await guardado()).toBeNull();
    expect(etiqueta(h, "Observaciones").value).toBe("");
  });

  it("5) «Decidir después»: el borrador queda intacto, escribir NO lo sobrescribe y el envío espera", async () => {
    const sembrado = await sembrar();
    const h = await montar(formulario());
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Decidir después"));
    await hasta(() => expect(dialogo()).toBeNull());
    await escribir(etiqueta(h, "Observaciones") as HTMLTextAreaElement, "Texto nuevo");
    await esperar(250);
    expect(await guardado()).toMatchObject({ revision: sembrado.revision, payload: { cabecera: { observaciones: "Urgente para la ruta" } } });
    expect(textoInd(h)).toMatch(/Autoguardado en pausa/);
    await hasta(() => expect(guardar(h).disabled).toBe(true));
    expect(h.host.textContent).toMatch(/borrador guardado sin resolver/);
    await clic(boton("Recuperar el borrador guardado", h.host)); // sigue pudiendo recuperarlo luego
    await hasta(() => expect(etiqueta(h, "Observaciones").value).toBe("Urgente para la ruta"));
  });

  it("6) y 7) varias líneas: se restauran TODAS, con el mismo orden y las mismas claves estables", async () => {
    await sembrar(estadoCompleto(5));
    const h = await montar(formulario());
    await recuperar(h);
    const reps = todos(h, "label").filter((l) => l.textContent!.startsWith("Repuesto a comprar")).map((l) => (l.querySelector("input") as HTMLInputElement).value);
    expect(reps).toEqual(["Filtro 1", "Filtro 2", "Filtro 3", "Filtro 4", "Filtro 5"]);
    await escribir(etiqueta(h, "Repuesto a comprar", 4), "Filtro 5 editado");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    const p = (await guardado())!.payload as { lineas: { clave: string; repuestoDescripcion: string }[] };
    expect(p.lineas.map((l) => l.clave)).toEqual(["L1", "L2", "L3", "L4", "L5"]); // identidad estable
    expect(p.lineas[4].repuestoDescripcion).toBe("Filtro 5 editado");
  });

  it("8) eliminar líneas se refleja en el borrador (y «+ Agregar línea» agrega con clave nueva)", async () => {
    await sembrar(estadoCompleto(3));
    const h = await montar(formulario());
    await recuperar(h);
    await clic(boton("Eliminar línea", h.host));
    await hasta(() => expect(todos(h, "section").filter((s) => s.querySelector("h3")).length).toBe(2));
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    const p = (await guardado())!.payload as { lineas: { clave: string }[] };
    expect(p.lineas).toHaveLength(2);
    await clic(boton("+ Agregar línea", h.host));
    await hasta(async () => { expect(((await guardado())!.payload as { lineas: unknown[] }).lineas).toHaveLength(3); });
    const q = (await guardado())!.payload as { lineas: { clave: string }[] };
    expect(new Set(q.lineas.map((l) => l.clave)).size).toBe(3);
  });

  it("9) cabecera completa: fecha, empresa requirente, requirente, encargado y observaciones se guardan y se restauran", async () => {
    const h = await montar(formulario());
    await hasta(() => expect(guardar(h).disabled).toBe(true)); // catálogos aún o sin datos
    await hasta(() => expect(etiqueta(h, "Empresa requirente").options.length).toBeGreaterThan(1)); // catálogos cargados
    await escribir(etiqueta(h, "Fecha de requerimiento"), "2026-10-05");
    await elegir(etiqueta(h, "Empresa requirente") as unknown as HTMLSelectElement, "6");
    await escribir(etiqueta(h, "Observaciones") as HTMLTextAreaElement, "Obs cabecera");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    expect((await guardado())!.payload).toMatchObject({ cabecera: { fechaRequerimiento: "2026-10-05", entidadRequirenteId: 6, observaciones: "Obs cabecera" } });
    await sembrar(estadoCompleto(1, { fecha: "2026-10-09", entidad: 4, requirente: 2, encargado: 3 }), ambito(U2));
    const h2 = await montar(formulario({}, { contexto: ctx(U2) }));
    await recuperar(h2);
    expect(etiqueta(h2, "Fecha de requerimiento").value).toBe("2026-10-09");
    expect(etiqueta(h2, "Empresa requirente").value).toBe("4");
  });

  it("10) proveedor/unidad que ya no existen: se conserva lo escrito, se avisa y NO se envía ni se crea nada", async () => {
    const e = estadoCompleto(2); e.lineas[0].proveedor_id = 77; e.lineas[1].vehiculo_id = 88;
    await sembrar(e);
    const h = await montar(formulario());
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Recuperar borrador"));
    await hasta(() => expect(h.host.textContent).toMatch(/Línea 1: el proveedor guardado ya no está disponible/));
    expect(h.host.textContent).toMatch(/Línea 2: la unidad guardada ya no está disponible/);
    expect(etiqueta(h, "Repuesto a comprar", 0).value).toBe("Filtro 1"); // no se pierde lo escrito
    expect(guardar(h).disabled).toBe(true);
    expect(llamadas.filter((l) => l.metodo !== "GET")).toEqual([]); // nada se creó automáticamente (ni proveedores ni requerimientos)
  });

  it("11) payload válido para el núcleo pero INVÁLIDO para el adaptador: «Recuperar» no cambia nada (sigue pendiente de decisión), no se sobrescribe al editar y se puede descartar", async () => {
    const invalido = { cabecera: { fechaRequerimiento: 5 }, lineas: "x" };
    const sembrado = ok(await nucleo.guardar(ambito(), { payload: invalido, esquemaVersion: ESQUEMA_REQUERIMIENTO_BORRADOR, revisionBase: null }));
    const h = await montar(formulario());
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Recuperar borrador"));
    await hasta(() => expect(h.host.textContent).toMatch(/no tiene un formato válido y no se aplicó/));
    // NO pasó a «activo»: el diálogo sigue, el indicador sigue en decisión pendiente y el formulario no cambió
    expect(dialogo()).not.toBeNull();
    expect(textoInd(h)).toMatch(/borrador guardado sin recuperar/);
    expect(etiqueta(h, "Observaciones").value).toBe("");
    // editar el formulario NO sobrescribe el registro
    await escribir(etiqueta(h, "Observaciones") as HTMLTextAreaElement, "Texto nuevo que no debe pisar el borrador");
    await esperar(300);
    expect(await guardado()).toMatchObject({ revision: sembrado.revision, payload: invalido });
    expect(guardar(h).disabled).toBe(true);
    // el descarte explícito sigue disponible
    await clic(boton("Descartar borrador"));
    await clic(boton("Sí, descartar definitivamente"));
    await hasta(() => expect(dialogo()).toBeNull());
    expect(await guardado()).toBeNull();
  });

  it("11b) conflicto con una versión remota inválida: «Usar la versión de la otra pestaña» no la activa ni cambia el formulario", async () => {
    const a = await montar(formulario());
    const b = await montar(formulario());
    await hasta(() => expect(estadoInd(a)).toBe("inicial"));
    await hasta(() => expect(estadoInd(b)).toBe("inicial"));
    await escribir(etiqueta(a, "Observaciones") as HTMLTextAreaElement, "Desde A");
    await hasta(() => expect(estadoInd(a)).toBe("guardado"));
    await escribir(etiqueta(b, "Observaciones") as HTMLTextAreaElement, "Desde B");
    await hasta(() => expect(dialogo()).not.toBeNull());
    const actual = (await guardado())!;
    const invalido = { cabecera: null, lineas: [] };
    const nuevo = ok(await nucleo.guardar(ambito(), { payload: invalido, esquemaVersion: ESQUEMA_REQUERIMIENTO_BORRADOR, revisionBase: actual.revision }));
    await clic(boton("Ver la versión guardada"));
    await hasta(() => expect(boton("Usar la versión de la otra pestaña")!.disabled).toBe(false));
    await clic(boton("Usar la versión de la otra pestaña"));
    await hasta(() => expect(document.body.textContent).toMatch(/no tiene un formato válido y no se aplicó/));
    expect(dialogo()).not.toBeNull(); // sigue en conflicto: nada se activó
    expect(etiqueta(b, "Observaciones").value).toBe("Desde B");
    expect(await guardado()).toMatchObject({ revision: nuevo.revision, payload: invalido }); // no se tocó
  });

  it("12) y 13) los archivos NO se guardan; tras recuperar se avisa que hay que adjuntarlos otra vez", async () => {
    const h = await montar(formulario());
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    const input = h.host.querySelector('input[type="file"]') as HTMLInputElement;
    const archivo = new File(["contenido secreto"], "factura-secreta.pdf", { type: "application/pdf" });
    await act(async () => { Object.defineProperty(input, "files", { value: [archivo], configurable: true }); input.dispatchEvent(new Event("change", { bubbles: true })); });
    await clic(boton("Agregar documento", h.host));
    expect(h.host.textContent).toMatch(/factura-secreta\.pdf/);
    await escribir(etiqueta(h, "Repuesto a comprar"), "Con adjunto");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    const crudo = JSON.stringify((await guardado())!.payload);
    expect(crudo).not.toMatch(/factura-secreta|contenido secreto|documentosPendientes|"file"/);
    await desmontar(h);
    const h2 = await montar(formulario());
    await recuperar(h2);
    expect(h2.host.textContent).toMatch(/documentos adjuntos no se guardan: vuelve a seleccionarlos/);
    expect(h2.host.textContent).not.toMatch(/factura-secreta/);
  });
});

describe("aislamiento y concurrencia", () => {
  it("14) otro usuario no ve ni recupera el borrador ajeno", async () => {
    await sembrar();
    const h = await montar(formulario({}, { contexto: ctx(U2) }));
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    expect(dialogo()).toBeNull();
    expect(await guardado(ambito(U2))).toBeNull();
  });

  it("15) otra empresa del mismo usuario no ve el borrador (y al cambiar de empresa no se mezclan)", async () => {
    await sembrar();
    const h = await montar(formulario({}, { contexto: ctx(U1, 2) }));
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    expect(dialogo()).toBeNull();
    await escribir(etiqueta(h, "Observaciones") as HTMLTextAreaElement, "Solo empresa 2");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    expect((await guardado(ambito(U1, 2)))!.payload).toMatchObject({ cabecera: { observaciones: "Solo empresa 2" } });
    expect((await guardado(ambito(U1, 1)))!.payload).toMatchObject({ cabecera: { observaciones: "Urgente para la ruta" } });
  });

  it("16) dos pestañas: la segunda NO sobrescribe en silencio; entra en conflicto y exige decidir", async () => {
    const a = await montar(formulario());
    const b = await montar(formulario());
    await hasta(() => expect(estadoInd(a)).toBe("inicial"));
    await hasta(() => expect(estadoInd(b)).toBe("inicial"));
    await escribir(etiqueta(a, "Observaciones") as HTMLTextAreaElement, "Desde la pestaña A");
    await hasta(() => expect(estadoInd(a)).toBe("guardado"));
    await escribir(etiqueta(b, "Observaciones") as HTMLTextAreaElement, "Desde la pestaña B");
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/Otra pestaña modificó este borrador/);
    expect((await guardado())!.payload).toMatchObject({ cabecera: { observaciones: "Desde la pestaña A" } });
    await hasta(() => expect(guardar(b).disabled).toBe(true));
  });

  it("17) «No guardar en este equipo»: no se escribe nada, se avisa, y el borrador previo queda intacto", async () => {
    const previo = await sembrar();
    fijarPersistencia(prefs, false);
    const h = await montar(formulario());
    await hasta(() => expect(textoInd(h)).toMatch(/Sin autoguardado en este equipo/));
    expect(dialogo()).toBeNull();
    await escribir(etiqueta(h, "Observaciones") as HTMLTextAreaElement, "No se guarda");
    await esperar(200);
    const real = crearNucleoBorradores({ almacen: almacenReal, appBuild: "lectura" });
    const l = ok(await real.leer(ambito(), { esquemaVersion: ESQUEMA_REQUERIMIENTO_BORRADOR }));
    expect(l.estado !== "vacio" && l.borrador.revision).toBe(previo.revision);
  });

  it("18) cerrar sesión borrando: la marca de purga impide que un guardado tardío resucite el borrador", async () => {
    const h = await montar(formulario());
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    await escribir(etiqueta(h, "Observaciones") as HTMLTextAreaElement, "Pendiente de guardar");
    await suspenderEscriturasDe(U1); // lo que hace la salida explícita antes de purgar
    ok(await nucleo.purgarUsuario(U1));
    await esperar(300);
    expect(await guardado()).toBeNull();
    expect(h.host.textContent).toMatch(/Autoguardado detenido|Se está cerrando la sesión/);
  });

  it("19) la sesión expirada NO limpia: el borrador sobrevive a una respuesta 401 y a desmontar el formulario", async () => {
    await sembrar();
    const h = await montar(formulario());
    await recuperar(h);
    respuestaCreacion = () => json(401, { error: "Sesión expirada" });
    await enviar(h);
    await hasta(() => expect(posts()).toHaveLength(1));
    await hasta(() => expect(guardar(h).disabled).toBe(false));
    await desmontar(h);
    const b = (await guardado())!;
    expect(b).not.toBeNull();
    expect(b.estadoEnvio).toBe("ninguno"); // el rechazo definitivo libera el intento, conservando la clave
    expect(b.claveEnvio).toMatch(CLAVE_ENVIO_REGEX);
  });

  it("20) guardado pendiente + purga persistente: una pestaña antigua no recrea el borrador purgado", async () => {
    const h = await montar(formulario());
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    ok(await nucleo.purgarUsuario(U1)); // otra pestaña cerró sesión borrando (esta no recibió ningún aviso)
    await escribir(etiqueta(h, "Observaciones") as HTMLTextAreaElement, "Escrito después de la purga");
    await hasta(() => expect(textoInd(h)).toMatch(/Sesión anterior finalizada/));
    expect(await guardado()).toBeNull();
  });

  it("21) fallo de IndexedDB: se ve «Error al guardar», el contenido sigue en pantalla y NO se hace el POST (no se envía sin la preparación local)", async () => {
    const h = await formularioListo();
    const espia = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("cuota", "QuotaExceededError"); });
    await escribir(etiqueta(h, "Observaciones") as HTMLTextAreaElement, "No se puede guardar");
    await hasta(() => expect(textoInd(h)).toMatch(/Error al guardar/));
    expect(etiqueta(h, "Observaciones").value).toBe("No se puede guardar"); // sigue en pantalla
    await enviar(h);
    await hasta(() => expect(h.host.textContent).toMatch(/No se pudo preparar el envío en este equipo/));
    expect(posts()).toHaveLength(0);
    espia.mockRestore();
  });
});

describe("envío oficial e idempotencia", () => {
  it("22) doble envío rápido (clic + clic + Enter): UN solo POST", async () => {
    const h = await formularioListo();
    const form = h.host.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await hasta(() => expect(nav.push).toHaveBeenCalled());
    expect(posts()).toHaveLength(1);
  });

  it("23) POST sin respuesta (red caída): el intento queda REGISTRADO como «enviando», el contenido congelado y se muestra «Reconciliación pendiente»", async () => {
    const h = await formularioListo();
    vi.stubGlobal("fetch", vi.fn((u: string, i?: RequestInit) => (i?.method === "POST" && u.endsWith("/compras/requerimientos") ? (llamadas.push({ url: u, metodo: "POST", cuerpo: JSON.parse(i.body as string) }), sinRed()) : fetchSimulado(u, i))));
    await enviar(h);
    await hasta(() => expect(h.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull());
    await hasta(() => expect(h.host.textContent).toMatch(/Failed to fetch/));
    await hasta(async () => {
      const b = (await guardado())!;
      expect(b.estadoEnvio).toBe("enviando");
      expect(b.claveEnvio).toBe(posts()[0].cuerpo!.clave_idempotencia);
      expect(etiqueta(h, "Observaciones").closest("fieldset")!.disabled).toBe(true);
    }); // el reintento será EXACTAMENTE lo mismo
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("24) reintento tras la respuesta incierta: MISMA clave y MISMO cuerpo; el servidor devuelve la creación original y se navega", async () => {
    const h = await formularioListo();
    let n = 0;
    respuestaCreacion = () => (++n === 1 ? json(503, { error: "No se pudo procesar el requerimiento." }) : json(201, { id: 12, codigo: "RC-2026-000012", version: 1 }));
    await enviar(h);
    await hasta(() => expect(h.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull());
    await hasta(() => expect(guardar(h).disabled).toBe(false));
    await enviar(h);
    await hasta(() => expect(nav.push).toHaveBeenCalledWith("/e/empresa-1/compras/requerimientos/12"));
    const [p1, p2] = posts();
    expect(p2.cuerpo).toEqual(p1.cuerpo);
    expect(p2.cuerpo!.clave_idempotencia).toMatch(CLAVE_ENVIO_REGEX);
  });

  it("25) recargar con un envío incierto: «reconciliación pendiente», sin recuperar ni descartar, y NINGÚN POST nuevo", async () => {
    const h = await formularioListo();
    respuestaCreacion = () => json(500, { error: "boom" });
    await enviar(h);
    await hasta(() => expect(h.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull());
    const clave = (await guardado())!.claveEnvio;
    await desmontar(h);
    llamadas = [];
    const h2 = await montar(formulario());
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/intento de envío sin resultado confirmado/);
    expect(boton("Recuperar borrador")!.disabled).toBe(true);
    expect(boton("Descartar borrador")!.disabled).toBe(true);
    await clic(boton("Decidir después"));
    await hasta(() => expect(dialogo()).toBeNull());
    expect(h2.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull();
    expect(guardar(h2).disabled).toBe(true);
    await enviar(h2);
    await esperar(100);
    expect(posts()).toHaveLength(0);
    expect(h2.host.textContent).toMatch(/Reconciliación pendiente/);
    expect(h2.host.textContent).toContain(clave!.slice(0, 8));
    expect((await guardado())!.claveEnvio).toBe(clave); // la clave y el contenido se conservan
  });

  it("26) creación confirmada: la clave se registró ANTES del POST, se marca «completado», el borrador se elimina y se navega al detalle", async () => {
    const h = await formularioListo();
    let visto: { estadoEnvio: string; claveEnvio: string | null } | null = null;
    alAntesDeResponder = async () => { const b = (await guardado())!; visto = { estadoEnvio: b.estadoEnvio, claveEnvio: b.claveEnvio }; };
    await enviar(h);
    await hasta(() => expect(nav.push).toHaveBeenCalledWith("/e/empresa-1/compras/requerimientos/12"));
    expect(visto).toMatchObject({ estadoEnvio: "enviando", claveEnvio: posts()[0].cuerpo!.clave_idempotencia });
    expect(await guardado()).toBeNull();
    expect(posts()).toHaveLength(1);
    await enviar(h);
    expect(posts()).toHaveLength(1); // formulario bloqueado mientras navega
  });

  it("27) un borrador recuperado con clave persistida la REUTILIZA (no genera otro intento oficial)", async () => {
    const clave = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const h = await formularioListo(clave);
    await enviar(h);
    await hasta(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].cuerpo!.clave_idempotencia).toBe(clave);
    await hasta(() => expect(nav.push).toHaveBeenCalled()); // deja terminar el flujo antes de la siguiente prueba
  });

  it("28) la subida de adjuntos que falla DESPUÉS de crear no repite la creación: un solo POST, aviso y navegación", async () => {
    const h = await formularioListo();
    const input = h.host.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { Object.defineProperty(input, "files", { value: [new File(["x"], "comprobante.pdf", { type: "application/pdf" })], configurable: true }); input.dispatchEvent(new Event("change", { bubbles: true })); });
    await clic(boton("Agregar documento", h.host));
    await enviar(h);
    await hasta(() => expect(nav.push).toHaveBeenCalled());
    expect(posts()).toHaveLength(1);
    expect(llamadas.filter((l) => /\/documentos$/.test(l.url))).toHaveLength(1);
    expect(alerta).toHaveBeenCalledWith(expect.stringMatching(/creado correctamente, pero algunos documentos no pudieron subirse/));
    expect(await guardado()).toBeNull();
  });

  it("29) un rechazo definitivo (422) libera el intento: se puede corregir y reenviar con la MISMA clave", async () => {
    const h = await formularioListo();
    respuestaCreacion = () => json(422, { error: "Datos inválidos", errores: [] });
    await enviar(h);
    await hasta(() => expect(posts()).toHaveLength(1));
    await hasta(async () => { expect((await guardado())!.estadoEnvio).toBe("ninguno"); expect(guardar(h).disabled).toBe(false); });
    expect(h.host.querySelector("[data-reconciliacion-pendiente]")).toBeNull();
    expect(etiqueta(h, "Observaciones").closest("fieldset")!.disabled).toBe(false);
    respuestaCreacion = () => json(201, { id: 13 });
    await enviar(h);
    await hasta(() => expect(nav.push).toHaveBeenCalledWith("/e/empresa-1/compras/requerimientos/13"));
    expect(posts()).toHaveLength(2);
    expect(posts()[1].cuerpo!.clave_idempotencia).toBe(posts()[0].cuerpo!.clave_idempotencia);
  });

  it("30) si el usuario desactiva el autoguardado en plena sesión, el envío funciona como antes (clave en memoria, sin registrar nada)", async () => {
    const h = await formularioListo();
    fijarPersistencia(prefs, false);
    await act(async () => { window.dispatchEvent(new Event(EVENTO_PREFERENCIA)); });
    await hasta(() => expect(textoInd(h)).toMatch(/Sin autoguardado en este equipo/));
    await enviar(h);
    await hasta(() => expect(nav.push).toHaveBeenCalledWith("/e/empresa-1/compras/requerimientos/12"));
    expect(posts()).toHaveLength(1);
    expect(posts()[0].cuerpo!.clave_idempotencia).toMatch(CLAVE_ENVIO_REGEX);
    const real = crearNucleoBorradores({ almacen: almacenReal, appBuild: "lectura" });
    const l = ok(await real.leer(ambito(), { esquemaVersion: ESQUEMA_REQUERIMIENTO_BORRADOR }));
    expect(l.estado !== "vacio" && l.borrador.estadoEnvio).toBe("ninguno"); // no se tocó el almacén
  });
});

describe("alcance", () => {
  it("31) editar un requerimiento existente no cambia: sin autoguardado, sin escrituras locales y PATCH con versión (sin clave)", async () => {
    const detalle = { id: 7, codigo: "RC-2026-000007", fecha_requerimiento: HOY, entidad_requirente_id: 4, entidad_requirente_nombre: "Frescofresh", requirente_usuario_id: 2, requirente_nombre: "Ana", solicitante_usuario_id: 1, solicitante_nombre: "Sol", encargado_compras_usuario_id: 3, encargado_compras_nombre: "Beto", observaciones: null, total: "100.50", estado: "Pendiente", version: 3, cantidad_lineas: 1, autorizante_usuario_id: null, autorizante_nombre: null, autorizado_en: null, rechazado_en: null, motivo_rechazo: null,
      lineas: [{ id: 21, orden: 1, vehiculo_id: null, unidad_descripcion: "Pick-up", fecha: HOY, serie_factura: null, numero_factura: null, proveedor_id: 9, repuesto_descripcion: "Filtro", metodo_pago: "Transferencia", condicion_pago: "Contado", total: "100.50", observaciones: null, proveedor_nombre_snapshot: "Proveedor 9", proveedor_razon_social_snapshot: null, proveedor_nit_snapshot: null, banco_snapshot: null, numero_cuenta_snapshot: null, dias_credito_snapshot: null }] };
    await sembrar(); // un borrador de creación NO debe ofrecerse al editar
    const h = await montar(formulario({ detalle }));
    await hasta(() => expect(guardar(h).disabled).toBe(false));
    expect(h.host.querySelector("[data-estado-autoguardado]")).toBeNull();
    expect(dialogo()).toBeNull();
    await escribir(etiqueta(h, "Observaciones") as HTMLTextAreaElement, "Editado");
    await esperar(200);
    expect(((await guardado())!.payload as { cabecera: { observaciones: string } }).cabecera.observaciones).toBe("Urgente para la ruta"); // el borrador de creación sigue intacto
    respuestaCreacion = () => json(200, { id: 7 });
    vi.stubGlobal("fetch", vi.fn((u: string, i?: RequestInit) => { llamadas.push({ url: u, metodo: i?.method ?? "GET", cuerpo: typeof i?.body === "string" ? JSON.parse(i.body) : null }); return Promise.resolve(u.endsWith("/catalogos") ? json(200, CATALOGOS) : json(200, { id: 7 })); }));
    await enviar(h);
    await hasta(() => expect(llamadas.some((l) => l.metodo === "PATCH")).toBe(true));
    const patch = llamadas.find((l) => l.metodo === "PATCH")!;
    expect(patch.cuerpo).toMatchObject({ version: 3 });
    expect(patch.cuerpo).not.toHaveProperty("clave_idempotencia");
  });

  it("32) el autoguardado nunca llama a la API de Compras: solo IndexedDB (catálogos y facturas son lecturas del formulario)", async () => {
    const h = await montar(formulario());
    await escribir(etiqueta(h, "Observaciones") as HTMLTextAreaElement, "Solo local");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    await esperar(100);
    expect(llamadas.filter((l) => l.metodo !== "GET")).toEqual([]);
    expect(llamadas.every((l) => l.url.endsWith("/compras/catalogos") || l.url.includes("/compras/facturas"))).toBe(true);
  });
});
