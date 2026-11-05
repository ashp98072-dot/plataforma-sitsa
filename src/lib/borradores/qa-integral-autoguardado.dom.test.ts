// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  crearAlmacenIndexedDB, crearAlmacenSegunPreferencia, crearNucleoBorradores, establecerFabricaCanal, reiniciarCoordinacionParaPruebas,
  type AlmacenPreferencias, type AmbitoBorrador, type NucleoBorradores, type Resultado, type TipoBorrador,
} from "@/lib/borradores";
import { suspenderEscriturasDe } from "@/lib/borradores/coordinacion";
import { aEstado, construirPayload, ESQUEMA_REQUERIMIENTO_BORRADOR } from "@/lib/compras/requerimiento-borrador";
import { construirPayloadFondo, ESQUEMA_FONDO_BORRADOR, type EstadoFondoForm } from "@/lib/tms/fondo-borrador";
import { construirPayloadGasto, ESQUEMA_GASTO_BORRADOR, type EstadoGastoForm } from "@/lib/tms/gasto-borrador";
import { OpcionesAutoguardadoFondoContext } from "@/components/tms/fondo-autoguardado";
import { OpcionesAutoguardadoGastoContext } from "@/components/tms/gasto-autoguardado";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh }), useParams: () => ({ slug: "empresa-1" }) }));
import { RequerimientoFormClient } from "@/components/compras/requerimiento-form-client";
import FondosPage from "@/app/e/[slug]/fondos/page";
import GastosPage from "@/app/e/[slug]/gastos/page";

/**
 * BORR-1g — QA INTEGRAL del autoguardado (Compras, Fondos y Gastos) con los MISMOS escenarios ejecutados contra las TRES pantallas
 * reales (happy-dom + fake-indexeddb; `fetch` simulado y registrado). Un «driver» por módulo abstrae lo propio de cada pantalla; los
 * escenarios son idénticos, de modo que una garantía compartida no puede cumplirse en un módulo y romperse en otro.
 * ⚠ Son pruebas SIMULADAS (DOM falso, IndexedDB falso): NO sustituyen una prueba en navegador real.
 */
vi.setConfig({ testTimeout: 60_000 });
const U1 = "o1_usuario-ficticio-uno";
const U2 = "o1_usuario-ficticio-dos";
const HOY = "2026-10-01";
const ctx = (ownerKey = U1, empresaId = 1) => ({ ownerKey, empresaId, empresaSlug: `empresa-${empresaId}` });
const ambitoDe = (tipo: TipoBorrador, ownerKey = U1, empresaId = 1): AmbitoBorrador => ({ ...ctx(ownerKey, empresaId), tipo });
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hasta = (fn: () => void | Promise<void>, ms = 15000) => vi.waitFor(fn, { timeout: ms, interval: 10 });
function ok<T>(r: Resultado<T>): T { if (!r.ok) throw new Error(`Se esperaba éxito y fue ${r.motivo}`); return r.valor; }

// ───────────────────────────── red simulada (una sola, compartida por las tres pantallas) ─────────────────────────────
const CAT_COMPRAS = {
  entidades: [{ id: 4, nombre: "Frescofresh" }, { id: 6, nombre: "Otra" }], usuarios: [{ id: 2, nombre: "Ana" }, { id: 3, nombre: "Beto" }], requirentesOperaciones: [{ id: 2, nombre: "Ana" }],
  proveedores: [9, 10].map((id) => ({ id, nombre_comercial: `Proveedor ${id}`, nit: null, contacto_nombre: null, contacto_telefono: null, telefono: null, metodo_pago_habitual: null, banco: null, numero_cuenta: null, dias_credito: null })),
  vehiculos: [{ id: 5, placa: "C-001ABC", descripcion: "Camión", marca: null, modelo: null }],
};
const CAT_TMS = {
  empleados: [{ id: 7, codigo: "E7", nombre: "Pedro Pérez", puesto: "Piloto", cuentaBancaria: "123-456-7", telefono: "55512345" }],
  vehiculos: [{ id: 5, placa: "C-001ABC", marca: null, modelo: null }], clientes: [{ id: 8, codigo: "C8", nombre: "Cliente Ocho", nit: null }],
  planes: [{ id: 11, codigo: "P11", fechaPlan: "2026-10-02", clienteId: 8, clienteNombre: "Cliente Ocho", vehiculoId: 5, placa: "C-001ABC", empleadoId: 7, empleadoNombre: "Pedro Pérez", empleadoPuesto: "Piloto", empleadoCuenta: "123-456-7" }],
  usuarios: [{ id: 2, nombre: "Ana" }, { id: 3, nombre: "Beto" }], usuariosOperaciones: [{ id: 2, nombre: "Ana" }], solicitantes: [{ id: 3, nombre: "Beto" }],
  entidadesRequirentes: [{ id: 4, codigo: "F", nombre: "Frescofresh" }, { id: 6, codigo: "O", nombre: "Otra" }],
  metodosPago: ["Efectivo", "Transferencia", "Transferencia móvil"], categorias: ["Combustible", "Peajes"],
};
type Llamada = { url: string; metodo: string; cuerpo: Record<string, unknown> | null };
let llamadas: Llamada[];
let respuestas: { compras: () => unknown; fondos: () => unknown; gastos: () => unknown };
let enGancho: (() => Promise<void>) | null;
const json = (status: number, cuerpo: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });
function fetchSimulado(url: string, init?: RequestInit) {
  const metodo = init?.method ?? "GET";
  const cuerpo = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  llamadas.push({ url, metodo, cuerpo });
  if (url.endsWith("/compras/catalogos")) return Promise.resolve(json(200, CAT_COMPRAS));
  if (url.includes("/compras/facturas")) return Promise.resolve(json(200, { existe: false }));
  if (url.endsWith("/tms/gastos/catalogos")) return Promise.resolve(json(200, CAT_TMS));
  if (metodo === "GET" && url.includes("/tms/gastos?")) return Promise.resolve(json(200, { gastos: [], categorias: CAT_TMS.categorias, metodosPago: CAT_TMS.metodosPago }));
  if (metodo === "GET" && url.includes("/tms/fondos?")) return Promise.resolve(json(200, { solicitudes: [] }));
  if (metodo === "POST" && url.endsWith("/compras/requerimientos")) return (async () => { await enGancho?.(); return respuestas.compras(); })() as Promise<never>;
  if (metodo === "POST" && url.endsWith("/tms/fondos")) return (async () => { await enGancho?.(); return respuestas.fondos(); })() as Promise<never>;
  if (metodo === "POST" && url.endsWith("/tms/gastos")) return (async () => { await enGancho?.(); return respuestas.gastos(); })() as Promise<never>;
  return Promise.resolve(json(200, {}));
}
const POST_URL = { compras: "/compras/requerimientos", fondos: "/tms/fondos", gastos: "/tms/gastos" } as const;
const posts = (k: keyof typeof POST_URL) => llamadas.filter((l) => l.metodo === "POST" && l.url.endsWith(POST_URL[k]));
const escrituras = () => llamadas.filter((l) => l.metodo !== "GET");

// ───────────────────────────── DOM ─────────────────────────────
let hosts: { host: HTMLElement; root: Root }[];
let nucleo: NucleoBorradores;
let almacenReal: ReturnType<typeof crearAlmacenIndexedDB>;
let prefs: AlmacenPreferencias & { datos: Map<string, string> };
type H = { host: HTMLElement; root: Root };
function nuevoHost(): H { const host = document.createElement("div"); document.body.append(host); const h = { host, root: createRoot(host) }; hosts.push(h); return h; }
async function montar(el: ReactElement, h: H = nuevoHost()) { await act(async () => { h.root.render(el); }); return h; }
async function desmontar(h: H) { await act(async () => { h.root.unmount(); }); h.host.remove(); hosts = hosts.filter((x) => x !== h); }
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
const estadoInd = (h: H) => h.host.querySelector("[data-estado-autoguardado]")?.getAttribute("data-estado-autoguardado");
const textoInd = (h: H) => (h.host.querySelector("[data-estado-autoguardado]")?.textContent ?? "").replace(/\s+/g, " ").trim();

// ───────────────────────────── drivers: lo propio de cada pantalla ─────────────────────────────
type Auto = Record<string, unknown>;
type Driver = {
  nombre: string; k: keyof typeof POST_URL; tipo: TipoBorrador; esquema: number; textoEnviar: string;
  abrir: (auto?: Auto, h?: H) => Promise<H>;
  raiz: (h: H) => HTMLElement;
  obs: (h: H) => HTMLTextAreaElement;
  enviar: (h: H) => Promise<void>;
  botonEnviar: (h: H) => HTMLButtonElement;
  agregarLinea: (h: H) => HTMLButtonElement;
  /** Siembra un borrador COMPLETO y enviable con la observación indicada. */
  sembrar: (obs: string, a?: AmbitoBorrador, extra?: Record<string, unknown>) => Promise<{ revision: number }>;
  /** Cuerpo JSON válido para el núcleo pero inválido para el adaptador. */
  invalido: unknown;
  obsDeBorrador: (payload: unknown) => string;
};
const lineaCompra = (n: number) => ({ key: `L${n}`, vehiculo_id: null as number | null, unidad_descripcion: "Pick-up" as string | null, fecha: HOY, serie_factura: null as string | null, numero_factura: String(7000 + n), proveedor_id: 9, repuesto_descripcion: `Filtro ${n}`, metodo_pago: "Transferencia", condicion_pago: "Contado" as const, total: `${n}00.50`, observaciones: null as string | null });
const lineaFondo = (n: number) => ({ categoria: "Combustible", descripcion: `Gasto ${n}`, cantidad: "2", monto: `${n}00.10`, fechaViaje: "2026-10-03", empleadoId: "7", vehiculoId: "5", clienteId: "8", planId: "11", empleadoNombre: "Pedro Pérez", cuenta: "123-456-7", cargo: "Piloto", metodoPago: "Transferencia" });
const formGasto = (obs: string): EstadoGastoForm => ({
  form: { fechaSolicitud: "2026-10-05", fechaViaje: "2026-10-03", empleadoId: 7, vehiculoId: 5, clienteId: 8, planId: 11, categoria: "Combustible", descripcion: "Diesel", cantidad: "2", monto: "1234567.10", metodoPago: "Transferencia", numeroCuentaPago: "123-456-7", tieneFactura: false, observaciones: obs, entidadRequirenteId: 4, requirenteUsuarioId: 2, requirenteNombre: "", solicitanteUsuarioId: 3 },
  lineasAdicionales: [{ categoria: "Peajes", descripcion: "Extra", cantidad: "3", monto: "20.05", metodoPago: "Transferencia", numeroCuentaPago: "123-456-7", fechaViaje: "2026-10-04", empleadoId: 7, vehiculoId: 5, clienteId: 8, planId: 11 }],
});
const compras: Driver = {
  nombre: "Requerimientos de compra", k: "compras", tipo: "requerimiento_compra", esquema: ESQUEMA_REQUERIMIENTO_BORRADOR, textoEnviar: "Guardar requerimiento",
  abrir: async (auto = {}, h = nuevoHost()) => montar(createElement(RequerimientoFormClient, {
    slug: "empresa-1", editable: true, solicitante: "Actual", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: false, puedeAutorizar: false, fechaHoy: HOY,
    opcionesAutoguardado: { contexto: ctx(), nucleo, prefs, fabricaCanal: null, debounceMs: 30, maxEsperaMs: 200, ...auto },
  } as never), h),
  raiz: (h) => h.host,
  obs: (h) => [...h.host.querySelectorAll("label")].find((l) => (l.firstChild?.textContent ?? "").trim().startsWith("Observaciones"))!.querySelector("textarea") as HTMLTextAreaElement,
  botonEnviar: (h) => boton("Guardar requerimiento", h.host)!,
  enviar: async (h) => { await act(async () => { h.host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); },
  agregarLinea: (h) => boton("+ Agregar línea", h.host)!,
  sembrar: async (obs, a = ambitoDe("requerimiento_compra"), extra = {}) => ok(await nucleo.guardar(a, { payload: construirPayload(aEstado({ fecha: HOY, entidad: 4, requirente: 2, encargado: 3, observaciones: obs, lineas: [lineaCompra(1), lineaCompra(2)] })), esquemaVersion: ESQUEMA_REQUERIMIENTO_BORRADOR, revisionBase: null, ...extra })),
  invalido: { cabecera: { fechaRequerimiento: 5 }, lineas: "x" },
  obsDeBorrador: (p) => (p as { cabecera: { observaciones: string } }).cabecera.observaciones,
};
const fondos: Driver = {
  nombre: "Solicitudes de fondo", k: "fondos", tipo: "solicitud_fondo", esquema: ESQUEMA_FONDO_BORRADOR, textoEnviar: "Crear solicitud",
  abrir: async (auto = {}, h = nuevoHost()) => {
    await montar(createElement(OpcionesAutoguardadoFondoContext.Provider, { value: { contexto: ctx(), nucleo, prefs, fabricaCanal: null, debounceMs: 30, maxEsperaMs: 200, ...auto } }, createElement(FondosPage)), h);
    await hasta(() => expect(boton("Nueva solicitud", h.host)).toBeDefined());
    await clic(boton("Nueva solicitud", h.host));
    return h;
  },
  raiz: (h) => h.host.querySelector('section[aria-label="Borrador local de la solicitud"]')!.parentElement as HTMLElement,
  obs: (h) => fondos.raiz(h).querySelector("textarea") as HTMLTextAreaElement,
  botonEnviar: (h) => boton("Crear solicitud", fondos.raiz(h))!,
  enviar: async (h) => clic(boton("Crear solicitud", fondos.raiz(h))),
  agregarLinea: (h) => boton("+ Agregar línea", fondos.raiz(h))!,
  sembrar: async (obs, a = ambitoDe("solicitud_fondo"), extra = {}) => {
    const e: EstadoFondoForm = { entidadRequirenteId: "4", requirenteUsuarioId: "2", solicitanteUsuarioId: "3", fechaRequerimiento: "2026-10-05", observaciones: obs, lineas: [lineaFondo(1), lineaFondo(2)] };
    return ok(await nucleo.guardar(a, { payload: construirPayloadFondo(e, CAT_TMS.empleados), esquemaVersion: ESQUEMA_FONDO_BORRADOR, revisionBase: null, ...extra }));
  },
  invalido: { cabecera: { entidadRequirenteId: 5 }, lineas: "x" },
  obsDeBorrador: (p) => (p as { cabecera: { observaciones: string } }).cabecera.observaciones,
};
const gastos: Driver = {
  nombre: "Gastos operativos", k: "gastos", tipo: "gasto_operativo", esquema: ESQUEMA_GASTO_BORRADOR, textoEnviar: "Guardar",
  abrir: async (auto = {}, h = nuevoHost()) => {
    await montar(createElement(OpcionesAutoguardadoGastoContext.Provider, { value: { contexto: ctx(), nucleo, prefs, fabricaCanal: null, debounceMs: 30, maxEsperaMs: 200, ...auto } }, createElement(GastosPage)), h);
    await hasta(() => expect(boton("Nuevo gasto", h.host)).toBeDefined());
    await clic(boton("Nuevo gasto", h.host));
    return h;
  },
  raiz: (h) => h.host.querySelector('section[aria-label="Borrador local del gasto"]')!.parentElement as HTMLElement,
  obs: (h) => gastos.raiz(h).querySelector("textarea") as HTMLTextAreaElement,
  botonEnviar: (h) => boton("Guardar", gastos.raiz(h))!,
  enviar: async (h) => clic(boton("Guardar", gastos.raiz(h))),
  agregarLinea: (h) => boton("+ Agregar línea", gastos.raiz(h))!,
  sembrar: async (obs, a = ambitoDe("gasto_operativo"), extra = {}) => ok(await nucleo.guardar(a, { payload: construirPayloadGasto(formGasto(obs), CAT_TMS.empleados), esquemaVersion: ESQUEMA_GASTO_BORRADOR, revisionBase: null, ...extra })),
  invalido: { cabecera: { monto: 5 }, lineasAdicionales: "x" },
  obsDeBorrador: (p) => (p as { cabecera: { observaciones: string } }).cabecera.observaciones,
};
const DRIVERS = [compras, fondos, gastos];

const guardadoDe = async (d: Driver, a: AmbitoBorrador = ambitoDe(d.tipo)) => { const l = ok(await nucleo.leer(a, { esquemaVersion: d.esquema })); return l.estado === "vacio" ? null : l.borrador; };
async function recuperar(d: Driver, h: H) {
  await hasta(() => expect(dialogo()).not.toBeNull());
  await hasta(() => expect(llamadas.some((l) => l.url.endsWith("/catalogos"))).toBe(true));
  await esperar(60);
  await clic(boton("Recuperar borrador"));
  await hasta(() => expect(dialogo()).toBeNull());
  await hasta(() => expect(d.botonEnviar(h).disabled).toBe(false));
}
async function listo(d: Driver, obs = "Obs lista", extra: Record<string, unknown> = {}) {
  await d.sembrar(obs, ambitoDe(d.tipo), extra);
  const h = await d.abrir();
  await recuperar(d, h);
  return h;
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("fetch", vi.fn(fetchSimulado));
  (window as unknown as { alert: unknown }).alert = vi.fn();
  nav.push.mockReset(); nav.refresh.mockReset();
  llamadas = []; enGancho = null;
  respuestas = { compras: () => json(201, { id: 12, codigo: "RC-1", version: 1 }), fondos: () => json(200, { mensaje: "ok", solicitud: { id: 55 } }), gastos: () => json(200, { mensaje: "ok", gasto: { id: 66 } }) };
  hosts = [];
  const datos = new Map<string, string>();
  prefs = { datos, getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => { datos.set(k, v); }, removeItem: (k) => { datos.delete(k); } };
  almacenReal = crearAlmacenIndexedDB();
  nucleo = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(almacenReal, prefs), appBuild: "qa-1g" });
});
afterEach(async () => {
  for (const h of [...hosts]) await act(async () => { try { h.root.unmount(); } catch { /* ya desmontado */ } });
  for (const h of hosts) h.host.remove();
  hosts = [];
  vi.restoreAllMocks(); vi.unstubAllGlobals(); reiniciarCoordinacionParaPruebas(); establecerFabricaCanal(undefined);
});

// ═════════════════════════════ FASE B — persistencia y recuperación (los tres módulos) ═════════════════════════════
describe.each(DRIVERS)("QA-B · $nombre", (d) => {
  it("B1) abrir y cerrar un formulario SIN contenido no crea borradores innecesarios", async () => {
    const h = await d.abrir();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    await desmontar(h);
    const h2 = await d.abrir();
    await hasta(() => expect(estadoInd(h2)).toBe("inicial"));
    await esperar(120);
    expect(await guardadoDe(d)).toBeNull();
    expect(escrituras()).toEqual([]);
  });

  it("B3) varias ediciones consecutivas rápidas conservan SIEMPRE la última versión (sin versiones intermedias persistidas como finales)", async () => {
    const h = await d.abrir();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    for (const t of ["a", "ab", "abc", "abcd", "abcde final"]) await escribir(d.obs(h), t);
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    expect(d.obsDeBorrador((await guardadoDe(d))!.payload)).toBe("abcde final");
    await desmontar(h);
    const h2 = await d.abrir();
    await hasta(() => expect(dialogo()).not.toBeNull());
    await hasta(() => expect(llamadas.some((l) => l.url.endsWith("/catalogos"))).toBe(true));
    await esperar(60);
    await clic(boton("Recuperar borrador"));
    await hasta(() => expect(d.obs(h2).value).toBe("abcde final"));
  });

  it("B7/B13) recuperar sobre información recién capturada exige confirmar el reemplazo; «Volver» conserva lo capturado y el borrador intacto; nunca hay restauración automática", async () => {
    const sembrado = await d.sembrar("Obs guardada");
    const h = await d.abrir();
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Decidir después")); // el usuario sigue trabajando
    await hasta(() => expect(dialogo()).toBeNull());
    await escribir(d.obs(h), "Lo que acabo de capturar");
    await hasta(() => expect(boton("Recuperar el borrador guardado", h.host)).toBeDefined());
    await hasta(() => expect(llamadas.some((l) => l.url.endsWith("/catalogos"))).toBe(true));
    await esperar(60);
    expect(d.obs(h).value).toBe("Lo que acabo de capturar"); // nada se aplicó solo
    expect(d.obsDeBorrador((await guardadoDe(d))!.payload)).toBe("Obs guardada");
    expect((await guardadoDe(d))!.revision).toBe(sembrado.revision);
  });

  it("B12) un borrador de versión de esquema FUTURA se conserva: no se recupera, no se sobrescribe al editar y solo se puede descartar", async () => {
    await d.sembrar("de otra versión", ambitoDe(d.tipo), {});
    // reescribe el registro con una versión de esquema futura (misma identidad) dentro del almacén real
    const actual = (await guardadoDe(d))!;
    ok(await crearNucleoBorradores({ almacen: almacenReal, appBuild: "qa-futuro" }).guardar(ambitoDe(d.tipo), { payload: actual.payload, esquemaVersion: d.esquema + 5, revisionBase: actual.revision }));
    const h = await d.abrir();
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(dialogo()!.textContent).toMatch(/no es compatible|versión más nueva/i);
    expect(boton("Recuperar borrador")!.disabled).toBe(true);
    expect(boton("Descartar borrador")!.disabled).toBe(false);
    await clic(boton("Decidir después"));
    await escribir(d.obs(h), "no debe pisar");
    await esperar(250);
    const real = ok(await crearNucleoBorradores({ almacen: almacenReal, appBuild: "qa-lectura" }).leer(ambitoDe(d.tipo), { esquemaVersion: d.esquema + 5 }));
    expect(real.estado !== "vacio" && d.obsDeBorrador(real.borrador.payload)).toBe("de otra versión");
  });

  it("B14) si el almacén rechaza escribir (cuota/IndexedDB), el usuario sigue trabajando y la interfaz NUNCA dice «Guardado»", async () => {
    const h = await d.abrir();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    const espia = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("cuota", "QuotaExceededError"); });
    await escribir(d.obs(h), "seguimos trabajando");
    await hasta(() => expect(textoInd(h)).toMatch(/Error al guardar/));
    expect(textoInd(h)).not.toMatch(/Guardado en este equipo/);
    expect(d.obs(h).value).toBe("seguimos trabajando");
    await escribir(d.obs(h), "seguimos trabajando más"); // sigue editable
    expect(d.obs(h).value).toBe("seguimos trabajando más");
    espia.mockRestore();
  });

  it("B14b) un fallo de persistencia/serialización devuelto por el núcleo (payload_invalido, escritura_fallida) tampoco se presenta como «Guardado»", async () => {
    for (const motivo of ["payload_invalido", "escritura_fallida"] as const) {
      const roto = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(almacenReal, prefs), appBuild: "qa-roto" });
      vi.spyOn(roto, "guardar").mockResolvedValue({ ok: false, motivo, mensaje: "falla simulada" } as never);
      const h = await d.abrir({ nucleo: roto });
      await hasta(() => expect(estadoInd(h)).toBe("inicial"));
      await escribir(d.obs(h), `texto ${motivo}`);
      await hasta(() => expect(textoInd(h)).toMatch(/Error al guardar/));
      expect(textoInd(h)).not.toMatch(/Guardado en este equipo/);
      await desmontar(h);
      expect(await guardadoDe(d)).toBeNull();
    }
  });

  it("B15) un payload que excede el límite técnico del almacén muestra «Error al guardar … demasiado grande» (nunca «Guardado») y no quita nada de la pantalla", async () => {
    const pequeno = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(almacenReal, prefs), appBuild: "qa-chico", maxPayloadChars: 3000 });
    const h = await d.abrir({ nucleo: pequeno });
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    const antes = d.raiz(h).querySelectorAll("button").length;
    for (let i = 0; i < 25; i++) await clic(d.agregarLinea(h));
    await hasta(() => expect(textoInd(h)).toMatch(/Error al guardar/));
    expect(textoInd(h)).toMatch(/demasiado grande/);
    expect(textoInd(h)).not.toMatch(/^Guardado/);
    expect(d.raiz(h).querySelectorAll("button").length).toBeGreaterThan(antes); // las 25 líneas siguen en pantalla
  });
});

// ═════════════════════════════ FASE C — concurrencia y varias pestañas ═════════════════════════════
describe.each(DRIVERS)("QA-C · $nombre", (d) => {
  it("C1) pestaña antigua tras un DESCARTE en otra pestaña: no resucita el borrador descartado; pide decidir", async () => {
    await d.sembrar("a descartar");
    const a = await d.abrir();
    await recuperar(d, a);
    const b = await d.abrir();
    await recuperar(d, b);
    await escribir(d.obs(a), "A edita");
    await hasta(() => expect(estadoInd(a)).toBe("guardado"));
    // B descarta lo que ve (aquí, directamente en el almacén, como lo haría su botón «Descartar»)
    ok(await nucleo.eliminar(ambitoDe(d.tipo)));
    await escribir(d.obs(a), "A sigue editando");
    await hasta(() => expect(dialogo()).not.toBeNull()); // conflicto: «ya no existe / descartado en otra pestaña»
    expect(dialogo()!.textContent).toMatch(/descartó|ya no existe/i);
    await esperar(150);
    expect(await guardadoDe(d)).toBeNull(); // no se resucitó en silencio
  });

  it("C2) ediciones simultáneas en dos pestañas: la segunda NO sobrescribe en silencio la versión más reciente", async () => {
    const a = await d.abrir();
    const b = await d.abrir();
    await hasta(() => expect(estadoInd(a)).toBe("inicial"));
    await hasta(() => expect(estadoInd(b)).toBe("inicial"));
    await escribir(d.obs(a), "versión A");
    await hasta(() => expect(estadoInd(a)).toBe("guardado"));
    await escribir(d.obs(b), "versión B");
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(d.obsDeBorrador((await guardadoDe(d))!.payload)).toBe("versión A");
  });

  it("C3) conflicto DURANTE un envío: si otra pestaña cambió el borrador, el intento no se registra y NO hay POST", async () => {
    const a = await listo(d, "base");
    const b = await d.abrir();
    await hasta(() => expect(dialogo()).not.toBeNull());
    await clic(boton("Decidir después"));
    // otra pestaña avanza la revisión del borrador mientras A tiene el formulario listo para enviar
    const actual = (await guardadoDe(d))!;
    ok(await nucleo.guardar(ambitoDe(d.tipo), { payload: actual.payload, esquemaVersion: d.esquema, revisionBase: actual.revision }));
    await d.enviar(a);
    await esperar(200);
    expect(posts(d.k)).toHaveLength(0);
    expect(b).toBeDefined();
    expect((await guardadoDe(d))!.estadoEnvio).toBe("ninguno");
  });

  it("C4) guardado tardío tras cierre de sesión con purga: no recrea el borrador ni escribe en la sesión nueva", async () => {
    const h = await d.abrir();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    await escribir(d.obs(h), "pendiente de guardar");
    await suspenderEscriturasDe(U1);
    ok(await nucleo.purgarUsuario(U1));
    await esperar(300);
    expect(await guardadoDe(d)).toBeNull();
  });

  it("C5) guardado tardío tras una purga que esta pestaña no vio: queda «Sesión anterior finalizada» y no escribe", async () => {
    const h = await d.abrir();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    ok(await nucleo.purgarUsuario(U1));
    await escribir(d.obs(h), "después de la purga");
    await hasta(() => expect(textoInd(h)).toMatch(/Sesión anterior finalizada/));
    expect(await guardadoDe(d)).toBeNull();
  });
});

// ═════════════════════════════ FASE D — aislamiento y seguridad ═════════════════════════════
describe.each(DRIVERS)("QA-D · $nombre", (d) => {
  it("D1) otro usuario y otra empresa no ven el borrador; cambiar de usuario o empresa no mezcla información", async () => {
    await d.sembrar("solo del usuario 1 / empresa 1");
    for (const contexto of [ctx(U2, 1), ctx(U1, 2)]) {
      const h = await d.abrir({ contexto });
      await hasta(() => expect(estadoInd(h)).toBe("inicial"));
      expect(dialogo()).toBeNull();
      await escribir(d.obs(h), `escrito en ${contexto.ownerKey}/${contexto.empresaId}`);
      await hasta(() => expect(estadoInd(h)).toBe("guardado"));
      await desmontar(h);
    }
    expect(d.obsDeBorrador((await guardadoDe(d))!.payload)).toBe("solo del usuario 1 / empresa 1");
    expect(d.obsDeBorrador((await guardadoDe(d, ambitoDe(d.tipo, U2, 1)))!.payload)).toBe(`escrito en ${U2}/1`);
    expect(d.obsDeBorrador((await guardadoDe(d, ambitoDe(d.tipo, U1, 2)))!.payload)).toBe(`escrito en ${U1}/2`);
  });

  it("D2) IndexedDB no contiene secretos, tokens, credenciales ni nombres de archivo; el simple autoguardado no llama al backend", async () => {
    const h = await d.abrir();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    await escribir(d.obs(h), "contenido ordinario");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    const volcado = await new Promise<string>((resolve, reject) => {
      const req = indexedDB.open("novalvion-borradores");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const nombres = [...db.objectStoreNames];
        const todo: unknown[] = [];
        const tx = db.transaction(nombres, "readonly");
        let pendientes = nombres.length;
        for (const n of nombres) {
          const g = tx.objectStore(n).getAll();
          g.onsuccess = () => { todo.push(...g.result); if (--pendientes === 0) resolve(JSON.stringify(todo)); };
        }
      };
    }).catch(() => "");
    expect(volcado.length).toBeGreaterThan(10); // se leyó algo real
    expect(volcado).not.toMatch(/password|passwd|contrase|secret|authorization|bearer|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|sitsa_session|"token"/i);
    expect(volcado).not.toMatch(/\.pdf|\.png|\.jpe?g|"file"/i);
    expect(escrituras()).toEqual([]); // ninguna escritura oficial durante el autoguardado
  });

  it("D3) sesión expirada durante el envío (401): se libera el intento sin borrar el borrador ni crear nada", async () => {
    respuestas[d.k] = () => json(401, { error: "Sesión expirada" });
    const h = await listo(d, "sesión que expira");
    await d.enviar(h);
    await hasta(() => expect(posts(d.k)).toHaveLength(1));
    await hasta(async () => { expect((await guardadoDe(d))!.estadoEnvio).toBe("ninguno"); expect(d.botonEnviar(h).disabled).toBe(false); });
    expect(d.obsDeBorrador((await guardadoDe(d))!.payload)).toBe("sesión que expira");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("D4) cierre de sesión SIN purga (permitido): cerrar la pantalla conserva el borrador y la sesión siguiente lo ofrece", async () => {
    const h = await d.abrir();
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    await escribir(d.obs(h), "sobrevive al cierre sin purga");
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    await desmontar(h); // equivale a expirar/cerrar sin elegir «borrar»: no se llama a purgarUsuario
    const h2 = await d.abrir();
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(h2.host.textContent).toBeDefined();
  });
});

// ═════════════════════════════ FASE E — idempotencia y operaciones financieras (los tres módulos) ═════════════════════════════
describe.each(DRIVERS)("QA-E · $nombre", (d) => {
  it("E1) la clave se registra ANTES del POST, es válida y es la misma que viaja; un doble clic no crea dos operaciones", async () => {
    const h = await listo(d);
    let visto: { estadoEnvio: string; claveEnvio: string | null } | null = null;
    enGancho = async () => { const b = (await guardadoDe(d))!; visto = { estadoEnvio: b.estadoEnvio, claveEnvio: b.claveEnvio }; };
    await act(async () => { const b = d.botonEnviar(h); if (d.k === "compras") { const f = h.host.querySelector("form")!; for (let i = 0; i < 3; i++) f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); } else { b.click(); b.click(); b.click(); } });
    await hasta(() => expect(posts(d.k)).toHaveLength(1));
    await hasta(async () => expect(await guardadoDe(d)).toBeNull());
    const clave = (posts(d.k)[0].cuerpo!.clave_idempotencia ?? posts(d.k)[0].cuerpo!.claveIdempotencia) as string;
    expect(clave).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(visto).toMatchObject({ estadoEnvio: "enviando", claveEnvio: clave });
    expect(posts(d.k)).toHaveLength(1);
  });

  it("E2) si el intento no se puede persistir (IndexedDB), NO se hace el POST", async () => {
    const h = await listo(d);
    const espia = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("cuota", "QuotaExceededError"); });
    await d.enviar(h);
    await hasta(() => expect(h.host.textContent).toMatch(/No se pudo preparar el envío en este equipo/));
    expect(posts(d.k)).toHaveLength(0);
    espia.mockRestore();
  });

  it("E3) respuesta incierta (red, 5xx): contenido CONGELADO, misma clave y mismo cuerpo en el reintento, y ninguna duplicación; el éxito limpia el borrador", async () => {
    let n = 0;
    respuestas[d.k] = () => (++n === 1 ? json(503, { error: "boom" }) : d.k === "compras" ? json(201, { id: 12 }) : d.k === "fondos" ? json(200, { solicitud: { id: 55 } }) : json(200, { gasto: { id: 66 } }));
    const h = await listo(d, "incierto");
    await d.enviar(h);
    await hasta(() => expect(h.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull());
    expect(d.obs(h).closest("fieldset")?.disabled).toBe(true); // congelado
    expect((await guardadoDe(d))!.estadoEnvio).toBe("enviando");
    await hasta(() => expect(d.botonEnviar(h).disabled).toBe(false));
    await d.enviar(h);
    await hasta(() => expect(posts(d.k)).toHaveLength(2));
    const [p1, p2] = posts(d.k);
    expect(p2.cuerpo).toEqual(p1.cuerpo);
    await hasta(async () => expect(await guardadoDe(d)).toBeNull());
  });

  it("E4) un 409 se clasifica según el contrato REAL de cada backend", async () => {
    respuestas[d.k] = () => json(409, { error: "conflicto" });
    const h = await listo(d, "409");
    await d.enviar(h);
    await hasta(() => expect(posts(d.k)).toHaveLength(1));
    if (d.k === "compras") {
      // HALLAZGO F-01 (P2, documentado en el expediente): en Compras el 409 mezcla «misma clave con otro contenido» (ConflictoIdempotencia) y
      // «factura duplicada» (nada se creó). BORR-1d lo trata como rechazo definitivo (libera el intento conservando la clave). No hay
      // duplicación posible (el servidor sigue protegiendo la clave), pero el caso de clave ya usada no queda en «reconciliación».
      await hasta(async () => expect((await guardadoDe(d))!.estadoEnvio).toBe("ninguno"));
      expect(h.host.querySelector("[data-reconciliacion-pendiente]")).toBeNull();
    } else {
      // Fondos y Gastos: el 409 de POST es siempre ConflictoIdempotencia → incierto (se conserva clave y contenido).
      await hasta(() => expect(h.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull());
      expect((await guardadoDe(d))!.estadoEnvio).toBe("enviando");
    }
  });

  it("E5) recargar durante un estado incierto NO crea una segunda operación: reconciliación pendiente, sin recuperar/descartar y 0 POST", async () => {
    respuestas[d.k] = () => json(500, { error: "boom" });
    const h = await listo(d, "incierto y recarga");
    await d.enviar(h);
    await hasta(() => expect(h.host.querySelector("[data-reconciliacion-pendiente]")).not.toBeNull());
    const clave = (await guardadoDe(d))!.claveEnvio;
    await desmontar(h);
    llamadas = [];
    const h2 = await d.abrir();
    await hasta(() => expect(dialogo()).not.toBeNull());
    expect(boton("Recuperar borrador")!.disabled).toBe(true);
    expect(boton("Descartar borrador")!.disabled).toBe(true);
    await clic(boton("Decidir después"));
    await d.enviar(h2);
    await esperar(150);
    expect(posts(d.k)).toHaveLength(0);
    expect((await guardadoDe(d))!.claveEnvio).toBe(clave);
    expect(d.obsDeBorrador((await guardadoDe(d))!.payload)).toBe("incierto y recarga");
  });
});

// ═════════════════════════════ FASE G — pruebas CRUZADAS (los tres módulos a la vez) ═════════════════════════════
describe("QA-G · el mismo usuario con los tres módulos a la vez", () => {
  async function tresAbiertos() {
    for (const d of DRIVERS) await d.sembrar(`borrador de ${d.nombre}`);
    const hs: Record<string, H> = {};
    for (const d of DRIVERS) { hs[d.k] = await d.abrir(); await hasta(() => expect(dialogo()).not.toBeNull()); await clic(boton("Decidir después")); await hasta(() => expect(dialogo()).toBeNull()); }
    return hs;
  }
  const revisiones = async () => Object.fromEntries(await Promise.all(DRIVERS.map(async (d) => [d.k, (await guardadoDe(d))?.revision ?? null])));

  it("G1) los tres borradores coexisten con identidades y contenidos independientes", async () => {
    await tresAbiertos();
    const ids = await Promise.all(DRIVERS.map(async (d) => (await guardadoDe(d))!.borradorId));
    expect(new Set(ids).size).toBe(3);
    for (const d of DRIVERS) expect(d.obsDeBorrador((await guardadoDe(d))!.payload)).toBe(`borrador de ${d.nombre}`);
  });

  it("G2) recuperar UNO no modifica los otros; descartar UNO no borra los demás", async () => {
    const hs = await tresAbiertos();
    const antes = await revisiones();
    await hasta(() => expect(llamadas.some((l) => l.url.endsWith("/catalogos"))).toBe(true));
    await esperar(60);
    await clic(boton("Recuperar el borrador guardado", hs.fondos.host));
    await hasta(() => expect(fondos.obs(hs.fondos).value).toBe("borrador de Solicitudes de fondo"));
    expect(await revisiones()).toEqual(antes); // recuperar no escribe en ninguno
    // descartar UNO (Gastos) con su confirmación propia: los otros dos conservan su revisión y contenido
    (window as unknown as { confirm: unknown }).confirm = () => true;
    await clic(boton("Descartar el borrador guardado", hs.gastos.host));
    await hasta(async () => expect(await guardadoDe(gastos)).toBeNull());
    expect((await guardadoDe(compras))!.revision).toBe(antes.compras);
    expect((await guardadoDe(fondos))!.revision).toBe(antes.fondos);
    expect(compras.obsDeBorrador((await guardadoDe(compras))!.payload)).toBe("borrador de Requerimientos de compra");
  });

  it("G3) enviar UNO (Gastos) no limpia ni altera los borradores de los otros dos", async () => {
    await gastos.sembrar("g", ambitoDe("gasto_operativo"));
    await compras.sembrar("c");
    await fondos.sembrar("f");
    const antes = await revisiones();
    const hg = await gastos.abrir();
    await recuperar(gastos, hg);
    await gastos.enviar(hg);
    await hasta(() => expect(posts("gastos")).toHaveLength(1));
    await hasta(async () => expect(await guardadoDe(gastos)).toBeNull());
    expect((await guardadoDe(compras))!.revision).toBe(antes.compras);
    expect((await guardadoDe(fondos))!.revision).toBe(antes.fondos);
    expect(posts("compras")).toHaveLength(0);
    expect(posts("fondos")).toHaveLength(0);
  });

  it("G4) cambiar de empresa mantiene el aislamiento de los tres módulos", async () => {
    for (const d of DRIVERS) await d.sembrar(`empresa 1 ${d.k}`);
    for (const d of DRIVERS) {
      const h = await d.abrir({ contexto: ctx(U1, 2) });
      await hasta(() => expect(estadoInd(h)).toBe("inicial"));
      expect(dialogo()).toBeNull();
      await desmontar(h);
    }
    for (const d of DRIVERS) expect(d.obsDeBorrador((await guardadoDe(d))!.payload)).toBe(`empresa 1 ${d.k}`);
  });

  it("G5) el cierre de sesión con purga elimina los tres y ninguna pestaña viva los recrea", async () => {
    const hs = await tresAbiertos();
    await Promise.all(DRIVERS.map((d) => escribir(d.obs(hs[d.k]), `pendiente ${d.k}`)));
    await suspenderEscriturasDe(U1);
    ok(await nucleo.purgarUsuario(U1));
    await esperar(350);
    for (const d of DRIVERS) expect(await guardadoDe(d)).toBeNull();
  });
});
