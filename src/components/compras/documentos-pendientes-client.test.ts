import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ activo: false, indice: 0, estados: [] as unknown[], efectos: [] as (() => void | (() => void))[], push: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async importar => {
  const real = await importar<typeof import("react")>();
  return { ...real, useState: (inicial: unknown) => {
    if (!h.activo) return real.useState(inicial);
    const i = h.indice++; if (!(i in h.estados)) h.estados[i] = typeof inicial === "function" ? inicial() : inicial;
    return [h.estados[i], (valor: unknown) => { h.estados[i] = typeof valor === "function" ? valor(h.estados[i]) : valor; }];
  }, useEffect: (efecto: () => void | (() => void)) => { if (h.activo) h.efectos.push(efecto); else real.useEffect(efecto); } };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }));
import { DocumentosPendientesClient, subirPendientesCompra, type DocumentoPendienteCompra } from "./documentos-pendientes-client";
import { nuevaLinea, RequerimientoFormClient } from "./requerimiento-form-client";
import { compraReporteFixture } from "@/lib/compras/requerimiento-exportaciones.fixture";
import { TIPOS_LINEA_DOCUMENTO, ETIQUETAS_TIPO_LINEA_DOCUMENTO } from "@/lib/compras/linea-documentos-schema";
import { FondoLineasClient, type DetalleLineasFondo } from "@/components/tms/fondo-lineas-client";
const mockFetch = vi.fn(); const alert = vi.fn();
const archivo = (nombre: string) => new File(["pdf"], nombre, { type: "application/pdf" });
const doc = (nombre: string): DocumentoPendienteCompra => ({ key: nombre, tipo: "FACTURA", file: archivo(nombre) });
const res = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => body });
function ejecutar<T>(fn: () => T): T { h.indice = 0; h.efectos = []; h.activo = true; try { return fn(); } finally { h.activo = false; } }
function elementos(nodo: ReactNode): ReactElement<Record<string, unknown>>[] { if (Array.isArray(nodo)) return nodo.flatMap(elementos); if (!isValidElement<Record<string, unknown>>(nodo)) return []; return [nodo, ...elementos(nodo.props.children as ReactNode)]; }
beforeEach(() => { h.estados = []; h.efectos = []; h.push.mockReset(); h.refresh.mockReset(); mockFetch.mockReset(); alert.mockReset(); vi.stubGlobal("fetch", mockFetch); vi.stubGlobal("window", { alert }); });
afterEach(() => vi.unstubAllGlobals());

it("línea nueva muestra selector de seis tipos, formatos de Fase 3, cero o varios documentos", () => {
  const html = renderToStaticMarkup(createElement(DocumentosPendientesClient, { documentos: [doc("a.pdf"), doc("b.pdf")], onChange: vi.fn(), disabled: false }));
  for (const t of TIPOS_LINEA_DOCUMENTO) expect(html).toContain(ETIQUETAS_TIPO_LINEA_DOCUMENTO[t]);
  expect(html).toContain("Documentos de la línea"); expect(html).toContain("a.pdf"); expect(html).toContain("b.pdf"); expect(html).not.toContain(".bmp");
  expect(mockFetch).not.toHaveBeenCalled();
});
it("agregar y quitar documentos son locales; rechaza BMP", () => {
  let documentos: DocumentoPendienteCompra[] = []; const change = (docs: DocumentoPendienteCompra[]) => { documentos = docs; };
  const render = () => DocumentosPendientesClient({ documentos, onChange: change, disabled: false });
  ejecutar(render); h.estados[1] = archivo("a.pdf");
  let tree = ejecutar(render); (elementos(tree).find(e => e.type === "button")!.props.onClick as () => void)(); expect(documentos).toHaveLength(1);
  tree = ejecutar(render); (elementos(tree).filter(e => e.type === "button")[1].props.onClick as () => void)(); expect(documentos).toHaveLength(0);
  h.estados[1] = archivo("no.bmp"); tree = ejecutar(render); (elementos(tree).find(e => e.type === "button")!.props.onClick as () => void)(); expect(h.estados[2]).toContain("Formato no permitido"); expect(mockFetch).not.toHaveBeenCalled();
});
it("cero documentos no consulta ni sube", async () => { expect(await subirPendientesCompra("a", 12, [{}])).toBe(0); expect(mockFetch).not.toHaveBeenCalled(); });
it("líneas idénticas se asocian por orden explícito aunque el detalle esté desordenado", async () => {
  mockFetch.mockImplementation((url: string) => res(url.endsWith("/12") ? { requerimiento: { lineas: [{ id: 92, orden: 2 }, { id: 91, orden: 1 }] } } : {}));
  const lineas = ["primera", "segunda"].map(key => ({ ...nuevaLinea("2026-09-18", key), proveedor_id: 9, total: "100.00", repuesto_descripcion: "Filtro idéntico", documentosPendientes: key === "primera" ? [doc("primera.pdf"), doc("otra.pdf")] : [doc("segunda.pdf")] }));
  expect(await subirPendientesCompra("a", 12, lineas)).toBe(0);
  expect(mockFetch.mock.calls.slice(1).map(([url, init]) => [url, init.body.get("file").name, init.body.get("tipo")])).toEqual([
    ["/api/empresas/a/compras/requerimientos/12/lineas/91/documentos", "primera.pdf", "FACTURA"], ["/api/empresas/a/compras/requerimientos/12/lineas/91/documentos", "otra.pdf", "FACTURA"], ["/api/empresas/a/compras/requerimientos/12/lineas/92/documentos", "segunda.pdf", "FACTURA"],
  ]);
});
it("orden ausente o ambiguo no adivina ids ni sube", async () => {
  mockFetch.mockImplementation(() => res({ requerimiento: { lineas: [{ id: 91 }, { id: 92 }] } }));
  expect(await subirPendientesCompra("a", 12, [{ documentosPendientes: [doc("a.pdf")] }, {}])).toBe(1); expect(mockFetch).toHaveBeenCalledTimes(1);
});
it.each([false, true])("JSON %s primero, versión intacta, luego GET y uploads; fallo parcial mantiene registro y navega", async editar => {
  const detalle = editar ? compraReporteFixture : undefined;
  const render = () => RequerimientoFormClient({ slug: "a", detalle, editable: true, solicitante: "Actual", puedeEliminar: true, puedeVerProveedores: false, puedeSubirDocumentos: true, puedeAutorizar: false, fechaHoy: "2026-09-18" });
  ejecutar(render); h.estados[1] = 4; h.estados[2] = 2;
  h.estados[5] = [{ ...nuevaLinea("2026-09-18", "nueva"), proveedor_id: 9, repuesto_descripcion: "Filtro", total: "100.00", documentosPendientes: [doc("exito.pdf"), doc("fallo.pdf")] }];
  mockFetch.mockImplementation((url: string, init?: RequestInit) => init?.method === "POST" && init.headers || init?.method === "PATCH" ? res({ id: 12 }) : url.endsWith("/12") ? res({ requerimiento: { lineas: [{ id: 91, orden: 1 }] } }) : res({}, (init?.body as FormData).get("file") instanceof File && ((init?.body as FormData).get("file") as File).name === "exito.pdf"));
  const tree = ejecutar(render); await (elementos(tree).find(e => e.type === "form")!.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault() {} });
  const primer = mockFetch.mock.calls[0][1]; expect(primer.method).toBe(editar ? "PATCH" : "POST"); expect(primer.headers).toEqual({ "Content-Type": "application/json" });
  const payload = JSON.parse(primer.body); expect(payload.lineas[0]).not.toHaveProperty("documentosPendientes"); expect(payload.lineas[0]).not.toHaveProperty("key"); if (editar) expect(payload.version).toBe(detalle!.version);
  expect(mockFetch.mock.calls[1][0]).toBe("/api/empresas/a/compras/requerimientos/12"); expect(alert).toHaveBeenCalledWith(expect.stringContaining("correctamente, pero algunos documentos")); expect(h.push).toHaveBeenCalledWith("/e/a/compras/requerimientos/12"); expect(mockFetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
});
it("gestor persistido se conserva; nuevo gestor no requiere detalle ni id", () => {
  const src = readFileSync("src/components/compras/requerimiento-form-client.tsx", "utf8"); expect(src).toContain("detalle && l.id ? <LineaDocumentosClient"); expect(src).toContain("editable && !l.id && puedeSubirDocumentos");
  expect(readFileSync("src/lib/compras/requerimientos.ts", "utf8")).toContain("const columnasLinea = `id, orden,");
});

const fondo: DetalleLineasFondo = { lineas: [{ id: 1, categoria: "Combustible", descripcion: "Diesel real", empleadoNombre: "Piloto", cargo: "Operaciones", metodoPago: "Cheque", cuenta: "123", placa: "C-1", clienteNombre: "Cliente", fechaViaje: "2026-09-18", cantidad: 2, monto: 100 }] };
it("Fondos consulta bajo demanda, presenta datos y método persistido; cachea sin cruzar slug/id", async () => {
  const cache = new Map<string, DetalleLineasFondo>(); mockFetch.mockImplementation(() => res({ solicitud: fondo }));
  const render = () => FondoLineasClient({ slug: "a", id: 12, cache });
  let tree = ejecutar(render); expect(renderToStaticMarkup(tree)).toContain("Cargando líneas…"); expect(mockFetch).not.toHaveBeenCalled(); h.efectos[0]();
  await vi.waitFor(() => expect(cache.has("a/12")).toBe(true)); tree = ejecutar(render); const html = renderToStaticMarkup(tree); for (const valor of ["Diesel real", "Método de pago", "Cheque", "Q200.00"]) expect(html).toContain(valor);
  h.estados = []; ejecutar(render); h.efectos[0](); expect(mockFetch).toHaveBeenCalledTimes(1);
  h.estados = []; ejecutar(() => FondoLineasClient({ slug: "b", id: 12, cache })); h.efectos[0](); await vi.waitFor(() => expect(cache.has("b/12")).toBe(true)); expect(mockFetch).toHaveBeenCalledTimes(2);
});
it("Fondos cerrar aborta y errores quedan locales sin cachear", async () => {
  const cache = new Map<string, DetalleLineasFondo>(); mockFetch.mockImplementation(() => res({ error: "Sin acceso" }, false));
  const render = () => FondoLineasClient({ slug: "a", id: 12, cache }); ejecutar(render); const cleanup = h.efectos[0]();
  await vi.waitFor(() => expect(h.estados[1]).toBe("Sin acceso")); expect(renderToStaticMarkup(ejecutar(render))).toContain('role="alert"'); expect(cache.size).toBe(0); if (cleanup) cleanup(); expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
  const page = readFileSync("src/app/e/[slug]/fondos/page.tsx", "utf8"); expect(page).not.toContain("s.lineas.map"); expect(page).toContain("expandido === s.id ? null : s.id"); expect(page).toContain("<FondoLineasClient");
});
