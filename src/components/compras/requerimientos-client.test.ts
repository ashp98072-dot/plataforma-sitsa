import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetalleCompra } from "@/lib/compras/requerimiento-schema";

// Harness sin dependencias DOM: ejecuta handlers/efectos reales y conserva estado
// entre renders. El HTML estático usa React real; no confundir SSR con interacción.
const hooks = vi.hoisted(() => ({ activo: false, indice: 0, estados: [] as unknown[], efectos: [] as (() => void | (() => void))[] }));
vi.mock("react", async importar => {
  const real = await importar<typeof import("react")>();
  return { ...real,
    useState: (inicial: unknown) => {
      if (!hooks.activo) return real.useState(inicial);
      const i = hooks.indice++;
      if (!(i in hooks.estados)) hooks.estados[i] = typeof inicial === "function" ? inicial() : inicial;
      return [hooks.estados[i], (valor: unknown) => { hooks.estados[i] = typeof valor === "function" ? valor(hooks.estados[i]) : valor; }];
    },
    useEffect: (efecto: () => void | (() => void)) => { if (hooks.activo) hooks.efectos.push(efecto); else real.useEffect(efecto); },
  };
});
import { RequerimientosClient } from "./requerimientos-client";
import { cargarLineasCompra, COLUMNAS_LINEAS_COMPRA, LineasCompraClient, TablaLineasCompra, type LineasCompraConsulta } from "./lineas-compra-client";

const detalle = {
  id: 12, codigo: "RC-2026-000012", fecha_requerimiento: "2026-09-18", requirente_nombre: "Mario Caal", entidad_requirente_nombre: "Empresa histórica", cantidad_lineas: 2,
  total: "11222.00", estado: "Pendiente", motivo_rechazo: null,
  lineas: [21, 22].map(id => ({ id, fecha: "2026-09-18", unidad_descripcion: "C-123 Histórico", proveedor_nombre_snapshot: "Proveedor histórico", repuesto_descripcion: `Filtro ${id}`, metodo_pago: "Tarjeta de crédito", condicion_pago: "Crédito", serie_factura: "A", numero_factura: "123", total: "5611.00" })),
} as DetalleCompra;
const datos: LineasCompraConsulta = { detalle, documentos: { 21: { documentos: [] }, 22: { documentos: [{ id: 9, tipo: "FACTURA", nombreOriginal: "FAC-1234.pdf" }, { id: 10, tipo: "COTIZACION", nombreOriginal: "cotizacion.pdf" }] } } };
const fetchMock = vi.fn();
const respuesta = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body });
function ejecutar<T>(render: () => T): T {
  hooks.indice = 0; hooks.efectos = []; hooks.activo = true;
  try { return render(); } finally { hooks.activo = false; }
}
function elementos(nodo: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(nodo)) return nodo.flatMap(elementos);
  if (!isValidElement<Record<string, unknown>>(nodo)) return [];
  return [nodo, ...elementos(nodo.props.children as ReactNode)];
}
function texto(nodo: ReactNode): string {
  if (Array.isArray(nodo)) return nodo.map(texto).join("");
  if (isValidElement<{ children?: ReactNode }>(nodo)) return texto(nodo.props.children);
  return typeof nodo === "string" || typeof nodo === "number" ? String(nodo) : "";
}
const html = (nodo: ReactNode) => renderToStaticMarkup(nodo);
beforeEach(() => { hooks.estados = []; hooks.efectos = []; hooks.activo = false; fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("Listado compacto Compras", () => {
  async function cargar(puedeEditar = true) {
    const render = () => RequerimientosClient({ slug: "a", puedeCrear: true, puedeEditar });
    fetchMock.mockImplementation(() => respuesta({ requerimientos: [detalle, { ...detalle, id: 13, codigo: "RC-13", estado: "Autorizada" }, { ...detalle, id: 14, codigo: "RC-14", estado: "Rechazada" }] }));
    ejecutar(render); hooks.efectos[0]();
    await vi.waitFor(() => expect(hooks.estados[5]).toBe(false));
    return { render, arbol: ejecutar(render) };
  }
  it("muestra cabeceras compactas, estados, acciones y filtros, sin tabla general ni enlace obsoleto", async () => {
    const { arbol } = await cargar(); const salida = html(arbol);
    for (const valor of [detalle.codigo, "Mario Caal", "2026-09-18", "Q11,222.00", "Ver líneas", "Ver detalle", "Exportar Excel", "Descargar PDF", "Código", "Desde", "Hasta", "Estado", "+ Nuevo requerimiento", "text-amber-400", "text-emerald-400", "text-red-400"]) expect(salida).toContain(valor);
    expect(salida).not.toContain("<table"); expect(salida).not.toContain("Volver a Compras / Repuestos");
    expect(salida).toContain("/api/empresas/a/compras/requerimientos/12/excel"); expect(salida).toContain("/api/empresas/a/compras/requerimientos/12/pdf");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("expandir monta un solo detalle y repetir oculta, sin solicitudes anticipadas", async () => {
    const { render, arbol } = await cargar();
    const pulsar = (tree: ReactNode, indice: number) => (elementos(tree).filter(e => e.type === "button" && texto(e.props.children as ReactNode).includes("líneas"))[indice].props.onClick as () => void)();
    pulsar(arbol, 0); let tree = ejecutar(render);
    expect(elementos(tree).filter(e => e.type === LineasCompraClient)).toHaveLength(1);
    expect(html(tree)).toContain("Cargando líneas…");
    pulsar(tree, 1); tree = ejecutar(render);
    expect(elementos(tree).filter(e => e.type === LineasCompraClient).map(e => e.props.requerimientoId)).toEqual([13]);
    pulsar(tree, 1); tree = ejecutar(render);
    expect(elementos(tree).filter(e => e.type === LineasCompraClient)).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("editar respeta permiso=%s y solo Pendiente; descargas no dependen de autorizar", async permiso => {
    const { arbol } = await cargar(permiso); const salida = html(arbol);
    expect(salida.includes("/12?editar=1")).toBe(permiso);
    expect(salida).not.toContain("/13?editar=1"); expect(salida).not.toContain("/14?editar=1");
    expect(salida).toContain("Descargar PDF"); expect(salida).not.toContain("Autorizar");
  });
});

describe("Carga inline, caché y errores", () => {
  it("consulta detalle y documentos de cada línea solo usando endpoints existentes", async () => {
    fetchMock.mockImplementation((url: string) => respuesta(url.endsWith("/12") ? { requerimiento: detalle } : { documentos: datos.documentos[url.includes("/21/") ? 21 : 22].documentos }));
    const resultado = await cargarLineasCompra("a", 12, new AbortController().signal);
    expect(resultado).toEqual(datos); expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/empresas/a/compras/requerimientos/12", "/api/empresas/a/compras/requerimientos/12/lineas/21/documentos", "/api/empresas/a/compras/requerimientos/12/lineas/22/documentos"]);
  });
  it("montar expansión carga, guarda caché y reabrir no repite consultas; otro tenant no reutiliza", async () => {
    const cache = new Map<string, LineasCompraConsulta>();
    fetchMock.mockImplementation((url: string) => respuesta(url.endsWith("/12") ? { requerimiento: detalle } : { documentos: [] }));
    ejecutar(() => LineasCompraClient({ slug: "a", requerimientoId: 12, cache })); hooks.efectos[0]();
    await vi.waitFor(() => expect(cache.has("a/12")).toBe(true));
    hooks.estados = []; ejecutar(() => LineasCompraClient({ slug: "a", requerimientoId: 12, cache })); hooks.efectos[0]();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    hooks.estados = []; ejecutar(() => LineasCompraClient({ slug: "b", requerimientoId: 12, cache })); hooks.efectos[0]();
    await vi.waitFor(() => expect(cache.has("b/12")).toBe(true)); expect(fetchMock).toHaveBeenCalledTimes(6);
  });
  it("error de detalle queda dentro del panel y permite reabrir sin cachear fallo", async () => {
    const cache = new Map<string, LineasCompraConsulta>(); fetchMock.mockImplementation(() => respuesta({ error: "No encontrado" }, false));
    const render = () => LineasCompraClient({ slug: "a", requerimientoId: 12, cache });
    ejecutar(render); hooks.efectos[0](); await vi.waitFor(() => expect(hooks.estados[1]).toBe("No encontrado"));
    expect(html(ejecutar(render))).toContain('role="alert"'); expect(cache.size).toBe(0);
  });
  it("fallo de documentos conserva líneas y aísla error por línea", async () => {
    fetchMock.mockImplementation((url: string) => url.endsWith("/12") ? respuesta({ requerimiento: detalle }) : url.includes("/21/") ? Promise.reject(new Error("red")) : respuesta({ documentos: datos.documentos[22].documentos }));
    const resultado = await cargarLineasCompra("a", 12, new AbortController().signal);
    expect(resultado.detalle.lineas).toHaveLength(2); expect(resultado.documentos[21].error).toBeTruthy();
    expect(html(createElement(TablaLineasCompra, { slug: "a", datos: resultado }))).toContain("FAC-1234.pdf");
  });
  it("cerrar aborta y no guarda resultados tardíos", async () => {
    const cache = new Map<string, LineasCompraConsulta>(); let resolver!: (v: unknown) => void;
    fetchMock.mockImplementation(() => new Promise(resolve => { resolver = resolve; }));
    ejecutar(() => LineasCompraClient({ slug: "a", requerimientoId: 12, cache })); const cleanup = hooks.efectos[0]();
    if (cleanup) cleanup();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    resolver({ ok: true, json: async () => ({ requerimiento: { ...detalle, lineas: [] } }) });
    await new Promise(resolve => setTimeout(resolve, 0)); expect(cache.size).toBe(0); expect(hooks.estados[0]).toBeNull();
  });
});

describe("Tabla Excel de snapshots y documentos", () => {
  it("conserva las diez columnas, ambas líneas, snapshots, moneda y scroll horizontal", () => {
    const salida = html(createElement(TablaLineasCompra, { slug: "a", datos }));
    for (const columna of COLUMNAS_LINEAS_COMPRA) expect(salida).toContain(columna);
    for (const valor of ["C-123 Histórico", "Proveedor histórico", "Filtro 21", "Filtro 22", "Tarjeta de crédito", "Crédito", "Q5,611.00", "overflow-x-auto"]) expect(salida).toContain(valor);
    expect(salida.match(/<tr/g)).toHaveLength(3);
  });
  it("sin documentos muestra raya; múltiples muestran tipo/nombre y endpoints protegidos, nunca ruta física", () => {
    const salida = html(createElement(TablaLineasCompra, { slug: "otra", datos }));
    expect(salida).toContain(">—</td>");
    for (const valor of ["Factura", "Cotización", "FAC-1234.pdf", "cotizacion.pdf", "/api/empresas/otra/compras/requerimientos/documentos/9", "/api/empresas/otra/compras/requerimientos/documentos/10", 'target="_blank"', 'rel="noreferrer"']) expect(salida).toContain(valor);
    expect(salida).not.toMatch(/rutaRelativa|imagen_ruta|\/hbuilds|\/uploads/);
  });
  it("un documento y motivo rechazado aparecen dentro del panel", () => {
    const salida = html(createElement(TablaLineasCompra, { slug: "a", datos: { detalle: { ...detalle, motivo_rechazo: "Revisar factura" }, documentos: { 21: { documentos: [datos.documentos[22].documentos[0]] } } } }));
    expect(salida).toContain("Motivo de rechazo: Revisar factura"); expect(salida.match(/>Ver</g)).toHaveLength(1);
  });
});
