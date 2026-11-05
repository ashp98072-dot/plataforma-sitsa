// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  crearAlmacenIndexedDB, crearAlmacenSegunPreferencia, crearNucleoBorradores, establecerFabricaCanal, reiniciarCoordinacionParaPruebas,
  type AlmacenPreferencias, type AmbitoBorrador, type NucleoBorradores, type Resultado,
} from "@/lib/borradores";
import { aEstado, construirPayload, ESQUEMA_REQUERIMIENTO_BORRADOR, MAX_LINEAS_BORRADOR, restaurarPayload } from "@/lib/compras/requerimiento-borrador";
import { construirPayloadFondo, restaurarPayloadFondo, aFormularioFondo, MAX_LINEAS_FONDO } from "@/lib/tms/fondo-borrador";
import { construirPayloadGasto, restaurarPayloadGasto, aFormularioGasto, type EstadoGastoForm } from "@/lib/tms/gasto-borrador";
import { crearRequerimientoSchema } from "@/lib/compras/requerimiento-schema";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useParams: () => ({ slug: "empresa-1" }) }));
import { RequerimientoFormClient } from "@/components/compras/requerimiento-form-client";

/**
 * BORR-1g · Fase F — límites y pérdida de datos. Verifica que formulario, adaptador y backend sean COHERENTES en cada módulo y que
 * nunca haya truncamiento silencioso. Las partes de DOM usan el formulario real de Compras (happy-dom + fake-indexeddb).
 */
vi.setConfig({ testTimeout: 120_000 });
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
const HOY = "2026-10-01";
const U1 = "o1_usuario-ficticio-uno";
const ambito: AmbitoBorrador = { ownerKey: U1, empresaId: 1, empresaSlug: "empresa-1", tipo: "requerimiento_compra" };
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hasta = (fn: () => void | Promise<void>, ms = 60000) => vi.waitFor(fn, { timeout: ms, interval: 20 });
function ok<T>(r: Resultado<T>): T { if (!r.ok) throw new Error(`Se esperaba éxito y fue ${r.motivo}`); return r.valor; }
const lc = (n: number) => ({ key: `L${n}`, vehiculo_id: null as number | null, unidad_descripcion: "Pick-up" as string | null, fecha: HOY, serie_factura: null as string | null, numero_factura: String(10000 + n), proveedor_id: 9, repuesto_descripcion: `Filtro ${n}`, metodo_pago: "Transferencia", condicion_pago: "Contado" as const, total: `${n}.07`, observaciones: null as string | null });

describe("QA-F · Requerimientos de compra: máximo real de 500 líneas coherente en formulario, adaptador y backend", () => {
  it("F1) el máximo es 500 en los tres sitios (backend, adaptador y botón del formulario)", () => {
    expect(MAX_LINEAS_BORRADOR).toBe(500);
    expect(leer("src/lib/compras/requerimiento-schema.ts")).toMatch(/lineas: z\.array\(lineaCompraSchema\)\.min\(1, "Agrega al menos una línea\."\)\.max\(500\)/);
    expect(leer("src/components/compras/requerimiento-form-client.tsx")).toMatch(/lineas\.length >= 500/);
    const base = { fecha_requerimiento: HOY, entidad_requirente_id: 4, requirente_usuario_id: 2 };
    const linea = (n: number) => ({ fecha: HOY, proveedor_id: 9, repuesto_descripcion: `R${n}`, metodo_pago: "Transferencia", condicion_pago: "Contado", total: "1.00", numero_factura: String(n) });
    expect(crearRequerimientoSchema.safeParse({ ...base, lineas: Array.from({ length: 500 }, (_, i) => linea(i)) }).success).toBe(true);
    expect(crearRequerimientoSchema.safeParse({ ...base, lineas: Array.from({ length: 501 }, (_, i) => linea(i)) }).success).toBe(false);
  });

  it("F2) 1, 499, 500 líneas: ida y vuelta idéntica (orden y valores); 501 NO se restaura (se conserva y se avisa, no se aplica a medias)", () => {
    for (const n of [1, 499, 500]) {
      const e = aEstado({ fecha: HOY, entidad: 4, requirente: 2, encargado: 0, observaciones: "", lineas: Array.from({ length: n }, (_, i) => lc(i + 1)) });
      const p = construirPayload(e);
      expect(p.lineas).toHaveLength(n);
      const r = restaurarPayload(JSON.parse(JSON.stringify(p)));
      expect(r.ok && r.estado.lineas.map((l) => [l.clave, l.repuesto_descripcion, l.total])).toEqual(e.lineas.map((l) => [l.clave, l.repuesto_descripcion, l.total]));
    }
    const sobra = JSON.parse(JSON.stringify(construirPayload(aEstado({ fecha: HOY, entidad: 4, requirente: 2, encargado: 0, observaciones: "", lineas: Array.from({ length: 500 }, (_, i) => lc(i + 1)) }))));
    sobra.lineas.push({ ...sobra.lineas[0], clave: "L501" });
    expect(restaurarPayload(sobra).ok).toBe(false); // el borrador no se pierde: la recuperación avisa (prueba DOM de BORR-1d) y el registro sigue descartable
  });
});

describe("QA-F · Solicitudes de fondo: 39/40/41/101 y corrección #569 intacta", () => {
  const lf = (n: number) => ({ categoria: "Combustible", descripcion: `Gasto ${n}`, cantidad: `${(n % 9) + 1}`, monto: `${n}.07`, fechaViaje: "2026-10-03", empleadoId: "7", vehiculoId: "5", clienteId: "8", planId: "11", empleadoNombre: "Pedro", cuenta: "123-456-7", cargo: "Piloto", metodoPago: "Transferencia" });
  it("F3) 39, 40, 41 y 101 líneas se guardan y restauran íntegras; el límite de 40 es de ENVÍO, atado al backend", () => {
    for (const n of [39, 40, 41, 101]) {
      const e = { entidadRequirenteId: "4", requirenteUsuarioId: "2", solicitanteUsuarioId: "3", fechaRequerimiento: HOY, observaciones: "", lineas: Array.from({ length: n }, (_, i) => lf(i + 1)) };
      const p = construirPayloadFondo(e, [{ id: 7, cuentaBancaria: "123-456-7" }]);
      expect(p.lineas).toHaveLength(n);
      const r = restaurarPayloadFondo(JSON.parse(JSON.stringify(p)));
      expect(r.ok && aFormularioFondo(r.estado, [{ id: 7, cuentaBancaria: "123-456-7" }]).lineas).toEqual(e.lineas);
    }
    expect(MAX_LINEAS_FONDO).toBe(40);
    expect(leer("src/app/api/empresas/[slug]/tms/fondos/route.ts")).toMatch(/\.min\(1\)\.max\(40\)/);
    const f = leer("src/app/e/[slug]/fondos/page.tsx");
    expect(f).toMatch(/disabled=\{!editandoId && lineas\.length >= MAX_LINEAS_FONDO\}/); // #569 intacta
    expect(f).toMatch(/!editandoId && ls\.length >= MAX_LINEAS_FONDO \? ls :/);
    expect(leer("src/lib/tms/fondo-borrador.ts").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\.slice\(0,/);
  });
});

describe("QA-F · Gastos operativos: sin tope artificial (101, 250, 1000)", () => {
  it("F4) 101, 250 y 1000 líneas adicionales se conservan idénticas; el backend no limita `lineas`", () => {
    const base: EstadoGastoForm = { form: { fechaSolicitud: HOY, fechaViaje: "", empleadoId: 7, vehiculoId: 0, clienteId: 0, planId: 0, categoria: "Combustible", descripcion: "", cantidad: "1", monto: "10.10", metodoPago: "Transferencia", numeroCuentaPago: "123-456-7", tieneFactura: false, observaciones: "", entidadRequirenteId: 0, requirenteUsuarioId: 0, requirenteNombre: "", solicitanteUsuarioId: 0 }, lineasAdicionales: [] };
    for (const n of [101, 250, 1000]) {
      const e: EstadoGastoForm = { ...base, lineasAdicionales: Array.from({ length: n }, (_, i) => ({ categoria: "Peajes", descripcion: `Extra ${i + 1}`, cantidad: `${(i % 9) + 1}.5`, monto: `${i + 1}.07`, metodoPago: "Efectivo", numeroCuentaPago: "", fechaViaje: "", empleadoId: 0, vehiculoId: 0, clienteId: 0, planId: 0 })) };
      const p = construirPayloadGasto(e, [{ id: 7, cuentaBancaria: "123-456-7" }]);
      expect(p.lineasAdicionales).toHaveLength(n);
      const r = restaurarPayloadGasto(JSON.parse(JSON.stringify(p)));
      expect(r.ok && aFormularioGasto(r.estado, [{ id: 7, cuentaBancaria: "123-456-7" }]).lineasAdicionales).toEqual(e.lineasAdicionales);
    }
    expect(leer("src/app/api/empresas/[slug]/tms/gastos/route.ts")).not.toMatch(/lineas: z\.array\(lineaSchema\)[^\n]*\.max\(/);
    expect(leer("src/lib/tms/gasto-borrador.ts").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\.slice\(0,/);
  });
});

describe("QA-F · Compras: la línea 501 no puede aparecer ni perderse en silencio (formulario real)", () => {
  let hosts: { host: HTMLElement; root: Root }[];
  let nucleo: NucleoBorradores;
  let prefs: AlmacenPreferencias;
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (url.endsWith("/catalogos") ? { entidades: [{ id: 4, nombre: "F" }], usuarios: [{ id: 2, nombre: "Ana" }], requirentesOperaciones: [{ id: 2, nombre: "Ana" }], proveedores: [{ id: 9, nombre_comercial: "P9", nit: null, contacto_nombre: null, contacto_telefono: null, telefono: null, metodo_pago_habitual: null, banco: null, numero_cuenta: null, dias_credito: null }], vehiculos: [] } : { existe: false }) })));
    hosts = [];
    const datos = new Map<string, string>();
    prefs = { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => { datos.set(k, v); }, removeItem: (k) => { datos.delete(k); } };
    nucleo = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(crearAlmacenIndexedDB(), prefs), appBuild: "qa-limites" });
  });
  afterEach(async () => {
    for (const h of [...hosts]) await act(async () => { try { h.root.unmount(); } catch { /* ya */ } });
    for (const h of hosts) h.host.remove();
    hosts = [];
    vi.restoreAllMocks(); vi.unstubAllGlobals(); reiniciarCoordinacionParaPruebas(); establecerFabricaCanal(undefined);
  });

  async function con499() {
    ok(await nucleo.guardar(ambito, { payload: construirPayload(aEstado({ fecha: HOY, entidad: 4, requirente: 2, encargado: 0, observaciones: "", lineas: Array.from({ length: 499 }, (_, i) => lc(i + 1)) })), esquemaVersion: ESQUEMA_REQUERIMIENTO_BORRADOR, revisionBase: null }));
    const host = document.createElement("div"); document.body.append(host);
    const h = { host, root: createRoot(host) }; hosts.push(h);
    await act(async () => { h.root.render(createElement(RequerimientoFormClient, { slug: "empresa-1", editable: true, solicitante: "A", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: false, puedeAutorizar: false, fechaHoy: HOY, opcionesAutoguardado: { contexto: { ownerKey: U1, empresaId: 1, empresaSlug: "empresa-1" }, nucleo, prefs, fabricaCanal: null, debounceMs: 30, maxEsperaMs: 200 } } as never)); });
    await hasta(() => expect(document.querySelector('[role="alertdialog"]')).not.toBeNull());
    await esperar(80);
    await act(async () => { ([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Recuperar borrador") as HTMLElement).click(); });
    await hasta(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
    return h;
  }
  const secciones = (h: { host: HTMLElement }) => h.host.querySelectorAll("section h3").length;
  const agregar = (h: { host: HTMLElement }) => [...h.host.querySelectorAll("button")].find((b) => b.textContent === "+ Agregar línea") as HTMLButtonElement;

  it("F5) en 499 → 500 el botón se deshabilita; los clics posteriores no agregan; el borrador conserva las 500", async () => {
    const h = await con499();
    await hasta(() => expect(secciones(h)).toBe(499));
    await act(async () => { agregar(h).click(); });
    expect(secciones(h)).toBe(500);
    expect(agregar(h).disabled).toBe(true);
    await act(async () => { agregar(h).click(); });
    expect(secciones(h)).toBe(500);
    await hasta(async () => { const l = ok(await nucleo.leer(ambito, { esquemaVersion: ESQUEMA_REQUERIMIENTO_BORRADOR })); expect(l.estado !== "vacio" && (l.borrador.payload as { lineas: unknown[] }).lineas.length).toBe(500); });
  });

  // HALLAZGO F-02 (P1 candidato). El botón «+ Agregar línea» de Compras se protege SOLO con el atributo `disabled`
  // (requerimiento-form-client.tsx: `disabled={deshabilitado || lineas.length >= 500}` y `setLineas(actual => [...actual, ...])` sin guarda
  // funcional). Varios clics dentro del mismo tick (antes del re-render) pasan el atributo y agregan líneas por encima de 500;
  // `construirPayload` hace `slice(0, 500)` y el borrador queda con 500 mientras la pantalla tiene más: truncamiento silencioso con «Guardado».
  // Esta prueba describe el comportamiento CORRECTO esperado y está marcada `fails` para dejar el defecto reproducido sin ocultarlo.
  it.fails("F6) [F-02 REPRODUCIDO] clics simultáneos en la línea 499 no deben pasar de 500 líneas (ni dejar líneas fuera del borrador)", async () => {
    const h = await con499();
    await hasta(() => expect(secciones(h)).toBe(499));
    await act(async () => { const b = agregar(h); b.click(); b.click(); b.click(); });
    expect(secciones(h)).toBeLessThanOrEqual(500);
  });

  it("F6b) [F-02 CARACTERIZACIÓN] con clics simultáneos la pantalla supera 500 líneas y el borrador guardado queda en 500 con «Guardado» (truncamiento silencioso)", async () => {
    const h = await con499();
    await hasta(() => expect(secciones(h)).toBe(499));
    await act(async () => { const b = agregar(h); b.click(); b.click(); b.click(); });
    const enPantalla = secciones(h);
    expect(enPantalla).toBeGreaterThan(500); // reproduce el defecto: el formulario permite más de 500
    await hasta(() => expect(h.host.querySelector("[data-estado-autoguardado]")?.getAttribute("data-estado-autoguardado")).toBe("guardado"), 90000);
    const l = ok(await nucleo.leer(ambito, { esquemaVersion: ESQUEMA_REQUERIMIENTO_BORRADOR }));
    const guardadas = l.estado !== "vacio" ? (l.borrador.payload as { lineas: unknown[] }).lineas.length : -1;
    console.info(`F-02: líneas en pantalla=${enPantalla}, líneas guardadas=${guardadas}`);
    expect(guardadas).toBe(500); // truncado por slice(0, 500) mientras el indicador dice «Guardado»: P1 abierto (ver expediente)
    expect(guardadas).toBeLessThan(enPantalla);
  });
});
