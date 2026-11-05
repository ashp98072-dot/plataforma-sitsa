// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  crearAlmacenIndexedDB, crearAlmacenSegunPreferencia, crearNucleoBorradores, establecerFabricaCanal, reiniciarCoordinacionParaPruebas,
  type AlmacenPreferencias, type AmbitoBorrador, type NucleoBorradores, type Resultado,
} from "@/lib/borradores";
import { aEstado, construirPayload, ESQUEMA_REQUERIMIENTO_BORRADOR } from "@/lib/compras/requerimiento-borrador";
import { CLAVE_ENVIO_REGEX } from "@/lib/idempotencia/clave-envio";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh }) }));
import { RequerimientoFormClient } from "./requerimiento-form-client";

/**
 * BORR-1d-FIX-01 — el formulario de Nuevo requerimiento NUNCA contiene más de 500 líneas (máximo del backend) ni las recorta en silencio.
 * Formulario REAL en happy-dom + fake-indexeddb; `fetch` simulado. Reproduce el hallazgo F-02 de BORR-1g (clics agrupados en la línea 499).
 */
vi.setConfig({ testTimeout: 180_000 });
const HOY = "2026-10-01";
const U1 = "o1_usuario-ficticio-uno";
const ctx = (ownerKey = U1, empresaId = 1) => ({ ownerKey, empresaId, empresaSlug: `empresa-${empresaId}` });
const ambito = (ownerKey = U1, empresaId = 1): AmbitoBorrador => ({ ...ctx(ownerKey, empresaId), tipo: "requerimiento_compra" });
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hasta = (fn: () => void | Promise<void>, ms = 90000) => vi.waitFor(fn, { timeout: ms, interval: 20 });
function ok<T>(r: Resultado<T>): T { if (!r.ok) throw new Error(`Se esperaba éxito y fue ${r.motivo}`); return r.valor; }
const lc = (n: number) => ({ key: `L${n}`, vehiculo_id: null as number | null, unidad_descripcion: "Pick-up" as string | null, fecha: HOY, serie_factura: null as string | null, numero_factura: String(10000 + n), proveedor_id: 9, repuesto_descripcion: `Filtro ${n}`, metodo_pago: "Transferencia", condicion_pago: "Contado" as const, total: `${n}.07`, observaciones: null as string | null });
const estadoCon = (n: number, obs = "Obs") => aEstado({ fecha: HOY, entidad: 4, requirente: 2, encargado: 0, observaciones: obs, lineas: Array.from({ length: n }, (_, i) => lc(i + 1)) });

type Llamada = { url: string; metodo: string; cuerpo: Record<string, unknown> | null };
let llamadas: Llamada[];
let hosts: { host: HTMLElement; root: Root }[];
let nucleo: NucleoBorradores;
let almacenReal: ReturnType<typeof crearAlmacenIndexedDB>;
let prefs: AlmacenPreferencias;
const json = (status: number, cuerpo: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });
const CATALOGOS = { entidades: [{ id: 4, nombre: "F" }], usuarios: [{ id: 2, nombre: "Ana" }], requirentesOperaciones: [{ id: 2, nombre: "Ana" }], proveedores: [{ id: 9, nombre_comercial: "P9", nit: null, contacto_nombre: null, contacto_telefono: null, telefono: null, metodo_pago_habitual: null, banco: null, numero_cuenta: null, dias_credito: null }], vehiculos: [] };
function fetchSimulado(url: string, init?: RequestInit) {
  const metodo = init?.method ?? "GET";
  llamadas.push({ url, metodo, cuerpo: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null });
  if (url.endsWith("/compras/catalogos")) return Promise.resolve(json(200, CATALOGOS));
  if (url.includes("/compras/facturas")) return Promise.resolve(json(200, { existe: false }));
  if (metodo === "POST") return Promise.resolve(json(201, { id: 12, codigo: "RC-1", version: 1 }));
  if (metodo === "PATCH") return Promise.resolve(json(200, { id: 7 }));
  return Promise.resolve(json(200, {}));
}
const posts = () => llamadas.filter((l) => l.metodo === "POST" && l.url.endsWith("/compras/requerimientos"));
type H = { host: HTMLElement; root: Root };
async function montar(extra: Record<string, unknown> = {}, auto: Record<string, unknown> = {}): Promise<H> {
  const host = document.createElement("div"); document.body.append(host);
  const h = { host, root: createRoot(host) }; hosts.push(h);
  await act(async () => { h.root.render(createElement(RequerimientoFormClient, { slug: "empresa-1", editable: true, solicitante: "A", puedeEliminar: true, puedeVerProveedores: false, puedeSubirDocumentos: false, puedeAutorizar: false, fechaHoy: HOY, opcionesAutoguardado: { contexto: ctx(), nucleo, prefs, fabricaCanal: null, debounceMs: 30, maxEsperaMs: 200, ...auto }, ...extra } as never)); });
  return h;
}
async function desmontar(h: H) { await act(async () => { h.root.unmount(); }); h.host.remove(); hosts = hosts.filter((x) => x !== h); }
const dialogo = () => document.querySelector('[role="alertdialog"]');
const boton = (t: string, raiz: ParentNode = document) => [...raiz.querySelectorAll("button")].find((b) => b.textContent?.trim() === t) as HTMLButtonElement | undefined;
const secciones = (h: H) => h.host.querySelectorAll("section h3").length;
const agregar = (h: H) => boton("+ Agregar línea", h.host)!;
const guardarBtn = (h: H) => boton("Guardar requerimiento", h.host)!;
const estadoInd = (h: H) => h.host.querySelector("[data-estado-autoguardado]")?.getAttribute("data-estado-autoguardado");
const textoInd = (h: H) => (h.host.querySelector("[data-estado-autoguardado]")?.textContent ?? "").replace(/\s+/g, " ").trim();
const guardado = async (a = ambito()) => { const l = ok(await nucleo.leer(a, { esquemaVersion: ESQUEMA_REQUERIMIENTO_BORRADOR })); return l.estado === "vacio" ? null : l.borrador; };
const lineasGuardadas = async () => ((await guardado())!.payload as { lineas: { clave: string; repuestoDescripcion: string; total: string }[] }).lineas;
async function sembrar(n: number, a = ambito()) { return ok(await nucleo.guardar(a, { payload: construirPayload(estadoCon(n)), esquemaVersion: ESQUEMA_REQUERIMIENTO_BORRADOR, revisionBase: null })); }
async function recuperar(h: H, esperadas?: number) {
  await hasta(() => expect(dialogo()).not.toBeNull());
  await hasta(() => expect(llamadas.some((l) => l.url.endsWith("/catalogos"))).toBe(true));
  await esperar(80);
  await act(async () => { boton("Recuperar borrador")!.click(); });
  await hasta(() => expect(dialogo()).toBeNull());
  if (esperadas !== undefined) await hasta(() => expect(secciones(h)).toBe(esperadas));
}
async function con(n: number) { await sembrar(n); const h = await montar(); await recuperar(h, n); return h; }

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("fetch", vi.fn(fetchSimulado));
  (window as unknown as { alert: unknown }).alert = vi.fn();
  nav.push.mockReset(); nav.refresh.mockReset();
  llamadas = []; hosts = [];
  const datos = new Map<string, string>();
  prefs = { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => { datos.set(k, v); }, removeItem: (k) => { datos.delete(k); } };
  almacenReal = crearAlmacenIndexedDB();
  nucleo = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(almacenReal, prefs), appBuild: "fix-limite" });
});
afterEach(async () => {
  for (const h of [...hosts]) await act(async () => { try { h.root.unmount(); } catch { /* ya */ } });
  for (const h of hosts) h.host.remove();
  hosts = [];
  vi.restoreAllMocks(); vi.unstubAllGlobals(); reiniciarCoordinacionParaPruebas(); establecerFabricaCanal(undefined);
});

describe("límite de 500 líneas — creación", () => {
  it("1) a 3) 499 líneas → 500: el botón se deshabilita en 500 y el máximo es visible", async () => {
    const h = await con(499);
    expect(agregar(h).disabled).toBe(false);
    expect(h.host.querySelector("[data-limite-lineas]")?.textContent).toMatch(/Máximo 500 líneas por requerimiento \(499\/500\)/);
    await act(async () => { agregar(h).click(); });
    expect(secciones(h)).toBe(500);
    expect(agregar(h).disabled).toBe(true);
    expect(h.host.querySelector("[data-limite-lineas]")?.textContent).toMatch(/\(500\/500\)/);
  });

  it("4) y 5) F-02: tres clics agrupados desde 499 dan EXACTAMENTE 500, y ningún clic posterior crea la 501", async () => {
    const h = await con(499);
    await act(async () => { const b = agregar(h); b.click(); b.click(); b.click(); });
    expect(secciones(h)).toBe(500);
    await act(async () => { const b = agregar(h); b.click(); b.click(); });
    expect(secciones(h)).toBe(500);
  });

  it("6) a 8) y 11) el payload de 500 líneas es íntegro, sin líneas descartadas, y se recupera exacto (orden y valores)", async () => {
    const h = await con(499);
    await act(async () => { const b = agregar(h); b.click(); b.click(); });
    expect(secciones(h)).toBe(500);
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    const guardadas = await lineasGuardadas();
    expect(guardadas).toHaveLength(500); // = pantalla: nada descartado
    expect(guardadas.slice(0, 499).map((l) => [l.clave, l.repuestoDescripcion, l.total])).toEqual(Array.from({ length: 499 }, (_, i) => [`L${i + 1}`, `Filtro ${i + 1}`, `${i + 1}.07`]));
    expect(new Set(guardadas.map((l) => l.clave)).size).toBe(500);
    await desmontar(h);
    const h2 = await montar();
    await recuperar(h2, 500);
    const filtros = [...h2.host.querySelectorAll("label")].filter((l) => (l.firstChild?.textContent ?? "").trim() === "Repuesto a comprar").map((l) => (l.querySelector("input") as HTMLInputElement).value);
    expect(filtros.slice(0, 499)).toEqual(Array.from({ length: 499 }, (_, i) => `Filtro ${i + 1}`));
    expect(filtros).toHaveLength(500);
  });
});

describe("borrador heredado de 501 líneas", () => {
  it("9) y 10) se recupera ÍNTEGRO, avisa del máximo y bloquea el envío (sin POST ni intento registrado); al reducir a 500 se habilita y envía con clave", async () => {
    await sembrar(501);
    const h = await montar();
    await recuperar(h, 501);
    expect(h.host.querySelector("[data-exceso-lineas]")?.textContent).toMatch(/501 líneas.*máximo permitido es 500.*quita 1/);
    expect(guardarBtn(h).disabled).toBe(true);
    expect(agregar(h).disabled).toBe(true);
    await act(async () => { h.host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); // intento forzado del envío
    await esperar(150);
    expect(posts()).toHaveLength(0);
    expect((await guardado())!.estadoEnvio).toBe("ninguno");
    expect(secciones(h)).toBe(501); // no se eliminó nada
    await act(async () => { boton("Eliminar línea", h.host)!.click(); }); // el usuario decide qué quitar
    await hasta(() => expect(secciones(h)).toBe(500));
    await hasta(() => expect(h.host.querySelector("[data-exceso-lineas]")).toBeNull());
    await hasta(() => expect(guardarBtn(h).disabled).toBe(false));
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    await act(async () => { h.host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await hasta(() => expect(posts()).toHaveLength(1));
    expect((posts()[0].cuerpo!.lineas as unknown[]).length).toBe(500);
    expect(posts()[0].cuerpo!.clave_idempotencia).toMatch(CLAVE_ENVIO_REGEX); // 14) la idempotencia sigue funcionando
  });

  it("9b) un borrador de 501 líneas se vuelve a guardar sin truncar al editarlo", async () => {
    await sembrar(501);
    const h = await montar();
    await recuperar(h, 501);
    const area = [...h.host.querySelectorAll("label")].find((l) => (l.firstChild?.textContent ?? "").trim().startsWith("Observaciones"))!.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "editado"); area.dispatchEvent(new Event("input", { bubbles: true })); });
    await hasta(() => expect(estadoInd(h)).toBe("guardado"));
    expect(await lineasGuardadas()).toHaveLength(501);
  });
});

describe("almacenamiento, aislamiento y edición", () => {
  it("12) un fallo técnico de almacenamiento se ve («Error al guardar») y nunca se afirma «Guardado»; la pantalla conserva todo", async () => {
    const h = await con(499);
    const espia = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("cuota", "QuotaExceededError"); });
    await act(async () => { agregar(h).click(); });
    await hasta(() => expect(textoInd(h)).toMatch(/Error al guardar/));
    expect(textoInd(h)).not.toMatch(/Guardado en este equipo/);
    expect(secciones(h)).toBe(500);
    espia.mockRestore();
  });

  it("12b) un payload que excede el límite técnico del núcleo muestra el error y no «Guardado»", async () => {
    const pequeno = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(almacenReal, prefs), appBuild: "fix-chico", maxPayloadChars: 3000 });
    const h = await montar({}, { nucleo: pequeno });
    await hasta(() => expect(estadoInd(h)).toBe("inicial"));
    for (let i = 0; i < 25; i++) await act(async () => { agregar(h).click(); });
    await hasta(() => expect(textoInd(h)).toMatch(/Error al guardar/));
    expect(textoInd(h)).toMatch(/demasiado grande/);
    expect(textoInd(h)).not.toMatch(/^Guardado/);
    expect(secciones(h)).toBe(26);
  });

  it("13) otro usuario y otra empresa no ven el borrador de 501 líneas ni lo modifican", async () => {
    const sembrado = await sembrar(501);
    for (const contexto of [ctx("o1_usuario-ficticio-dos", 1), ctx(U1, 2)]) {
      const h = await montar({}, { contexto });
      await hasta(() => expect(estadoInd(h)).toBe("inicial"));
      expect(dialogo()).toBeNull();
      expect(secciones(h)).toBe(1);
      await desmontar(h);
    }
    expect((await guardado())!.revision).toBe(sembrado.revision);
  });

  it("15) edición de un requerimiento existente: sin borradores, sin contador de creación roto y la guarda funcional no estorba al agregar", async () => {
    const lineasDetalle = [1, 2, 3].map((n) => ({ id: n, orden: n, vehiculo_id: null, unidad_descripcion: "P", fecha: HOY, serie_factura: null, numero_factura: String(n), proveedor_id: 9, repuesto_descripcion: `R${n}`, metodo_pago: "Transferencia", condicion_pago: "Contado", total: "1.00", observaciones: null, proveedor_nombre_snapshot: "P9", proveedor_razon_social_snapshot: null, proveedor_nit_snapshot: null, banco_snapshot: null, numero_cuenta_snapshot: null, dias_credito_snapshot: null }));
    const detalle = { id: 7, codigo: "RC-7", fecha_requerimiento: HOY, entidad_requirente_id: 4, entidad_requirente_nombre: "F", requirente_usuario_id: 2, requirente_nombre: "Ana", solicitante_usuario_id: 1, solicitante_nombre: "S", encargado_compras_usuario_id: null, encargado_compras_nombre: null, observaciones: null, total: "3.00", estado: "Pendiente", version: 3, cantidad_lineas: 3, autorizante_usuario_id: null, autorizante_nombre: null, autorizado_en: null, rechazado_en: null, motivo_rechazo: null, lineas: lineasDetalle };
    await sembrar(2); // un borrador de creación NO debe ofrecerse al editar
    const h = await montar({ detalle });
    await hasta(() => expect(guardarBtn(h).disabled).toBe(false));
    expect(h.host.querySelector("[data-estado-autoguardado]")).toBeNull();
    expect(dialogo()).toBeNull();
    expect(secciones(h)).toBe(3);
    await act(async () => { agregar(h).click(); });
    expect(secciones(h)).toBe(4);
    await act(async () => { h.host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await hasta(() => expect(llamadas.some((l) => l.metodo === "PATCH")).toBe(true));
    const patch = llamadas.find((l) => l.metodo === "PATCH")!;
    expect(patch.cuerpo).toMatchObject({ version: 3 });
    expect(patch.cuerpo).not.toHaveProperty("clave_idempotencia");
    expect(posts()).toHaveLength(0);
  });
});
