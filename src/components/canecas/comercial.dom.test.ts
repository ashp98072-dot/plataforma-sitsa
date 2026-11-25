// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanecasClient } from "./canecas-client";
import { ReportesComerciales } from "./reportes-comerciales";
import { MapeoProveedores } from "./mapeo-proveedores";

type Respuestas = Record<string, unknown>;
async function montar(componente: ReturnType<typeof createElement>, respuestas: Respuestas, extra?: (url: string, init?: RequestInit) => Response | undefined) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const propia = extra?.(url, init);
    if (propia) return propia;
    const recurso = url.split("/canecas/")[1].split("?")[0];
    return Response.json(recurso in respuestas ? (respuestas[recurso] as object) : { datos: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  await act(async () => { root.render(componente); });
  await act(async () => { await new Promise(r => setTimeout(r, 40)); });
  return { host, fetchMock, limpiar: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const clientes = { datos: [{ id: 1, nombre_comercial: "Cliente Uno", direccion: "Zona 4, Ciudad", activo: 1 }, { id: 2, nombre_comercial: "Cliente Inactivo", activo: 0 }] };
const productos = { datos: [{ id: 3, nombre: "Aceite 5L", presentacion: "Caneca", activo: 1 }] };
const ubicaciones = { datos: [{ id: 4, nombre: "Bodega", activo: 1 }] };

describe("pantallas comerciales de Canecas", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("Nueva venta tipo POS: sin producto, fecha ni documento; dirección sugerida del cliente, total en vivo y resultado del servidor", async () => {
    const m = await montar(createElement(CanecasClient, { slug: "demo", vista: "ventas", permisos: { ventas: true, compras: true } }), { clientes, productos, ubicaciones, ventas: { datos: [{ id: "9", fecha: "2026-11-10", documento: "FAC-1", cliente: "Cliente Uno", direccion_entrega: "Zona 4, Ciudad", cantidad: 8, precio_unitario: "Q 95.00", total: "Q 760.00", costo_fifo: "Q 640.00", utilidad: "Q 120.00", estado: "ACTIVA", usuario: "ana" }] } },
      (url, init) => init?.method === "POST" ? Response.json({ id: "10", documento: "VTA-000010", mensaje: "Venta VTA-000010 registrada: ingreso Q 760.00, costo FIFO Q 640.00, utilidad bruta Q 120.00." }, { status: 201 }) : undefined);
    try {
      expect(m.host.textContent).toContain("Ventas");
      for (const t of ["Q 760.00", "Q 640.00", "Q 120.00", "ACTIVA"]) expect(m.host.textContent).toContain(t);
      await act(async () => { m.host.querySelector<HTMLButtonElement>("header button")!.click(); });
      const form = m.host.querySelector<HTMLFormElement>("main form")!;
      for (const nombre of ["moneda", "total", "costo", "utilidad", "empresa_id"]) expect(form.elements.namedItem(nombre)).toBeNull();
      for (const nombre of ["producto_id", "fecha_venta", "documento"]) expect(form.elements.namedItem(nombre)).toBeNull();
      expect(m.host.textContent).toContain("Precio por caneca en Q");
      const clientesOpc = Array.from(form.querySelectorAll('select[name="cliente_id"] option')).map(o => o.textContent);
      expect(clientesOpc).toContain("Cliente Uno"); expect(clientesOpc).not.toContain("Cliente Inactivo");
      const poner = (n: string, v: string) => { (form.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement).value = v; };
      poner("cliente_id", "1"); await act(async () => { form.dispatchEvent(new Event("input", { bubbles: true })); });
      poner("ubicacion_id", "4"); poner("cantidad", "8"); poner("precio_unitario", "95.00");
      await act(async () => { form.querySelector("select")!.dispatchEvent(new Event("input", { bubbles: true })); form.dispatchEvent(new Event("input", { bubbles: true })); });
      expect(m.host.textContent).toContain("Total: Q 760.00");
      expect((form.elements.namedItem("direccion_entrega") as HTMLInputElement).value).toBe("Zona 4, Ciudad");
      expect(form.checkValidity()).toBe(true);
      await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 30)); });
      const envio = m.fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
      expect(String(envio[0])).toMatch(/\/canecas\/ventas$/);
      const cuerpo = JSON.parse(String(envio[1]?.body));
      expect(cuerpo).toMatchObject({ cliente_id: "1", ubicacion_id: "4", direccion_entrega: "Zona 4, Ciudad", cantidad: "8", precio_unitario: "95.00" });
      expect(cuerpo.clave_operacion).toMatch(/^[0-9a-f-]{36}$/);
      expect(m.host.textContent).toContain("Venta VTA-000010 registrada: ingreso Q 760.00, costo FIFO Q 640.00, utilidad bruta Q 120.00.");
    } finally { await m.limpiar(); }
  });
  it("sin permiso de costos no se muestran costo FIFO ni utilidad, y sin permiso de ventas no hay formulario ni anulación", async () => {
    const datos = { ventas: { datos: [{ id: "9", fecha: "2026-11-10", cliente: "Cliente Uno", total: "Q 760.00", estado: "ACTIVA" }] } };
    const sin = await montar(createElement(CanecasClient, { slug: "demo", vista: "ventas", permisos: { ventas: true } }), datos);
    try { expect(sin.host.textContent).not.toContain("Costo FIFO"); expect(sin.host.textContent).not.toContain("Utilidad bruta"); expect(sin.host.textContent).toContain("Anular una venta"); } finally { await sin.limpiar(); }
    const nada = await montar(createElement(CanecasClient, { slug: "demo", vista: "ventas", permisos: {} }), datos);
    try { expect(nada.host.textContent).not.toContain("Nuevo registro"); expect(nada.host.textContent).not.toContain("Anular una venta"); } finally { await nada.limpiar(); }
  });
  it("Ajuste de canecas: nombre visible, campos simples y reversión", async () => {
    const m = await montar(createElement(CanecasClient, { slug: "demo", vista: "redistribuciones", permisos: { ventas: true, compras: true } }), { compras: { datos: [{ id: 8, referencia: "FAC-COMPRA" }] }, ubicaciones, redistribuciones: { datos: [{ id: "3", compra: "FAC-COMPRA", ubicacion: "Bodega", cantidad_origen: 20, cantidad_resultante: 25, diferencia: 5, costo_total: "Q 2,000.00", motivo: "Aceite extra", estado: "Vigente", usuario: "ana" }] } });
    try {
      expect(m.host.querySelector("h1")!.textContent).toBe("Ajuste de canecas");
      for (const t of ["Q 2,000.00", "Vigente", "Revertir un ajuste"]) expect(m.host.textContent).toContain(t);
      expect(m.host.textContent).not.toContain("redistribución");
      await act(async () => { m.host.querySelector<HTMLButtonElement>("header button")!.click(); });
      const form = m.host.querySelector<HTMLFormElement>("main form")!;
      for (const nombre of ["compra_id", "ubicacion_id", "cantidad_final", "motivo"]) expect(form.elements.namedItem(nombre)).not.toBeNull();
      for (const nombre of ["documento", "clave_operacion", "moneda"]) expect(form.elements.namedItem(nombre)).toBeNull();
    } finally { await m.limpiar(); }
  });
  it("Reportes comerciales: importes en Q, advertencias, filtros enviados y sin costos si no hay permiso", async () => {
    const resumen = { vendidas: 14, compradas: 20, recibidas: 20, extras: 5, merma: 0, existencias: 6, ingresos: "Q 1,480.00", costo_ventas: "Q 1,204.00", utilidad_bruta: "Q 276.00", compras_valor: "Q 1,810.00", compras_sin_costo: 1, existencias_con_costo_pendiente: 3, ventas_anuladas: 1, unidades_anuladas: 10, importe_anulado: "Q 1,000.00", existencias_son_actuales: true, solo_ventas: false };
    const m = await montar(createElement(ReportesComerciales, { slug: "demo" }), { reporte_resumen: { datos: [resumen] }, reporte_productos: { datos: [{ producto: "Aceite 5L — Caneca", vendidas: 14, ingresos: "Q 1,480.00", costo_ventas: "Q 1,204.00", utilidad_bruta: "Q 276.00", compradas: 20, recibidas: 20, extras: 5, merma: 0, existencias: 6 }] }, ventas: { datos: [{ id: "1", fecha: "2026-11-01", cliente: "Cliente Uno", total: "Q 760.00", estado: "ANULADA", anulada_por: "ana" }] }, productos, clientes });
    try {
      for (const t of ["Reportes comerciales", "Q 1,480.00", "Q 1,204.00", "Q 276.00", "Utilidad bruta", "Compras del período", "Q 1,810.00", "No es el costo de las ventas", "ANULADA", "No se cuentan en ingresos ni en utilidad", "sin costo conocido"]) expect(m.host.textContent).toContain(t);
      for (const nombre of ["moneda"]) expect(m.host.querySelector(`[name="${nombre}"]`)).toBeNull();
      const [desde, hasta] = [m.host.querySelector<HTMLInputElement>('input[name="desde"]')!, m.host.querySelector<HTMLInputElement>('input[name="hasta"]')!];
      const poner = (el: HTMLInputElement | HTMLSelectElement, valor: string) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, valor); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); };
      await act(async () => { poner(desde, "2026-11-01"); poner(hasta, "2026-11-30"); poner(m.host.querySelector<HTMLSelectElement>('select[name="cliente_id"]')!, "1"); });
      await act(async () => { m.host.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 30)); });
      const consultas = m.fetchMock.mock.calls.map(([u]) => String(u)).filter(u => u.includes("reporte_resumen?"));
      expect(consultas.at(-1)).toContain("desde=2026-11-01"); expect(consultas.at(-1)).toContain("hasta=2026-11-30"); expect(consultas.at(-1)).toContain("cliente_id=1");
    } finally { await m.limpiar(); }
    const sin = await montar(createElement(ReportesComerciales, { slug: "demo" }), { reporte_resumen: { datos: [{ vendidas: 14, ingresos: "Q 1,480.00", ventas_anuladas: 0, solo_ventas: false }] }, reporte_productos: { datos: [] }, ventas: { datos: [] }, productos, clientes });
    try { expect(sin.host.textContent).toContain("No tiene permiso para ver costos ni utilidad."); expect(sin.host.textContent).not.toContain("Utilidad bruta"); } finally { await sin.limpiar(); }
  });
  it("Reportes comerciales: con un cliente solo muestra indicadores de ventas y reporta errores del servidor", async () => {
    const m = await montar(createElement(ReportesComerciales, { slug: "demo" }), { reporte_resumen: { datos: [{ vendidas: 8, ingresos: "Q 760.00", solo_ventas: true, ventas_anuladas: 0 }] }, reporte_productos: { datos: [] }, ventas: { datos: [] }, productos, clientes });
    try { expect(m.host.textContent).toContain("Con un cliente seleccionado solo se muestran los indicadores de ventas."); expect(m.host.textContent).not.toContain("Canecas compradas"); } finally { await m.limpiar(); }
    const err = await montar(createElement(ReportesComerciales, { slug: "demo" }), {}, url => url.includes("reporte_resumen") ? Response.json({ error: "Revise las fechas (AAAA-MM-DD) y los filtros." }, { status: 400 }) : undefined);
    try { expect(err.host.querySelector('[role="alert"]')!.textContent).toContain("Revise las fechas"); } finally { await err.limpiar(); }
  });
  it("Proveedores históricos: el proveedor anterior es de solo lectura y la asignación manual envía compra y proveedor", async () => {
    const m = await montar(createElement(MapeoProveedores, { slug: "demo" }), { compras_historicas: { datos: [{ id: 7, referencia: "HIST-1", producto: "Aceite 5L", cantidad: 20, creado_en: "2026-01-05", proveedor_anterior_id: 1, proveedor_anterior: "Proveedor anterior" }] }, proveedores: { datos: [{ id: 11, nombre_comercial: "Aceites SA", activo: 1 }, { id: 12, nombre_comercial: "Proveedor inactivo", activo: 0 }] }, mapeos_proveedor: { datos: [{ id: "1", referencia: "HIST-0", proveedor_canecas: "Aceites SA", proveedor_anterior_id: 1, realizado_por: "ana", realizado_en: "2026-11-20" }] } },
      (url, init) => init?.method === "POST" ? Response.json({ ok: true }) : undefined);
    try {
      for (const t of ["Proveedores históricos", "Proveedor anterior (solo lectura)", "Proveedor anterior", "HIST-1", "Asignaciones realizadas", "ana"]) expect(m.host.textContent).toContain(t);
      const select = m.host.querySelector<HTMLSelectElement>("select")!;
      expect(Array.from(select.options).map(o => o.textContent)).toEqual(["Seleccione", "Aceites SA"]); // sin inactivos
      const boton = Array.from(m.host.querySelectorAll("button")).find(b => b.textContent === "Asignar proveedor")!;
      expect(boton.disabled).toBe(true); // nada se asigna sin elegir
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "11"); select.dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => { boton.click(); await new Promise(r => setTimeout(r, 30)); });
      const envio = m.fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
      expect(String(envio[0])).toMatch(/\/canecas\/mapeo_proveedor_compra$/);
      expect(JSON.parse(String(envio[1]?.body))).toEqual({ compra_id: 7, proveedor_id: 11 });
      expect(m.host.textContent).toContain("Proveedor asignado");
    } finally { await m.limpiar(); }
  });
});
