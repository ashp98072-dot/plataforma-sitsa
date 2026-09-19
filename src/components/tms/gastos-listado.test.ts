import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Harness sin DOM (mismo patrón que requerimientos-client.test.ts): ejecuta los
// efectos reales de GastoDetalleClient y conserva su estado entre renders.
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
import { GastoDetalleClient, GastoDetalleVista, GastosListado, lineasDeGasto, type GastoVista, type GastosListadoProps } from "./gastos-listado";

const base: GastoVista = {
  id: 7, fechaSolicitud: "2026-09-18", fechaViaje: "2026-09-19", empleadoNombre: "Jayme Calderón", empleadoCargo: "Piloto de Transporte",
  vehiculoPlaca: "C-625BZF", clienteNombre: "Pricesmart", planCodigo: "PL-1", categoria: "Combustible", descripcion: "PAGO DE COMBUSTIBLE RUTA SALAMA",
  cantidad: 2, monto: 150, metodoPago: "Transferencia", numeroCuentaPago: "1270167065", facturaNombreOriginal: null, observaciones: null,
  estado: "Pendiente", motivoRechazo: null, entidadRequirenteNombre: "KuiqTrans", requirenteNombre: "Mario Caal", solicitanteNombre: "Ana Muñoz",
};
const props = (over: Partial<GastosListadoProps> = {}): GastosListadoProps => ({
  slug: "a", gastos: [base], loading: false, puedeAutorizar: false, expandido: null, onToggle: vi.fn(), cache: new Map(),
  autorizandoId: null, motivoRechazo: {}, onMotivoChange: vi.fn(), onAutorizar: vi.fn(), onRechazar: vi.fn(), onEditar: vi.fn(),
  onDesactivar: vi.fn(), onEliminarComprobante: vi.fn(), ...over,
});
const html = (p: GastosListadoProps) => renderToStaticMarkup(GastosListado(p));
function elementos(nodo: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(nodo)) return nodo.flatMap(elementos);
  if (!isValidElement<Record<string, unknown>>(nodo)) return [];
  return [nodo, ...elementos(nodo.props.children as ReactNode)];
}
function ejecutar<T>(render: () => T): T {
  hooks.indice = 0; hooks.efectos = []; hooks.activo = true;
  try { return render(); } finally { hooks.activo = false; }
}
const fetchMock = vi.fn();
const respuesta = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body });
beforeEach(() => { hooks.estados = []; hooks.efectos = []; hooks.activo = false; fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("Listado compacto", () => {
  it("cada gasto es una tarjeta compacta (sin tabla ancha) con id, persona, fecha, estado y total", () => {
    const salida = html(props());
    expect(salida).not.toContain("<table");
    for (const v of ["Gasto #7", "Jayme Calderón", "2026-09-19", "Pendiente", "Q300.00", "Combustible", "KuiqTrans", "Transferencia"]) expect(salida).toContain(v);
    // No vuelca todas las columnas del detalle en la fila.
    for (const v of ["C-625BZF", "Pricesmart", "PL-1", "Piloto de Transporte"]) expect(salida).not.toContain(v);
  });
  it("el total de la fila sigue siendo cantidad × monto (cálculo intacto)", () => {
    expect(html(props({ gastos: [{ ...base, cantidad: 3, monto: 1234.5 }] }))).toContain("Q3,703.50");
  });
  it.each([["Pendiente", "text-amber-400"], ["Autorizada", "text-emerald-400"], ["Rechazada", "text-red-400"], [null, "text-[var(--muted)]"]] as const)("estado %s usa %s; null se muestra como Histórico", (estado, clase) => {
    const salida = html(props({ gastos: [{ ...base, estado }] }));
    expect(salida).toContain(clase);
    if (estado === null) expect(salida).toContain("Histórico");
  });
  it("muestra el motivo de rechazo y el comprobante con Quitar", () => {
    const salida = html(props({ gastos: [{ ...base, estado: "Rechazada", motivoRechazo: "Sin presupuesto", facturaNombreOriginal: "fac.pdf" }] }));
    expect(salida).toContain("Motivo de rechazo: Sin presupuesto");
    expect(salida).toContain("/api/empresas/a/tms/gastos/7/comprobante"); expect(salida).toContain("Quitar");
  });
  it("loading y vacío", () => {
    expect(html(props({ gastos: [], loading: true }))).toContain("Cargando…");
    expect(html(props({ gastos: [], loading: true }))).not.toContain("Sin gastos con este filtro.");
    expect(html(props({ gastos: [] }))).toContain("Sin gastos con este filtro.");
  });
});

describe("Acciones según estado/permisos (el backend sigue siendo la autoridad)", () => {
  it("siempre: Ver detalle, Exportar Excel y Desactivar; sin permiso no hay Autorizar/Rechazar", () => {
    const salida = html(props());
    for (const v of ["Ver detalle", "Exportar Excel", "/api/empresas/a/tms/gastos/7/exportar", "Desactivar", "Editar"]) expect(salida).toContain(v);
    expect(salida).not.toContain("Autorizar"); expect(salida).not.toContain("Rechazar"); expect(salida).not.toContain("Motivo de rechazo");
  });
  it("con permiso: Autorizar/Rechazar solo en Pendiente", () => {
    const pendiente = html(props({ puedeAutorizar: true }));
    expect(pendiente).toContain(">Autorizar<"); expect(pendiente).toContain(">Rechazar<"); expect(pendiente).toContain("Motivo de rechazo");
    for (const estado of ["Autorizada", "Rechazada", null] as const) {
      const salida = html(props({ puedeAutorizar: true, gastos: [{ ...base, estado }] }));
      expect(salida).not.toContain(">Autorizar<"); expect(salida).not.toContain(">Rechazar<");
    }
  });
  it("Editar solo en Pendiente o histórico; Descargar PDF solo en Autorizada", () => {
    const en = (estado: string | null) => html(props({ gastos: [{ ...base, estado }] }));
    expect(en("Pendiente")).toContain(">Editar<"); expect(en(null)).toContain(">Editar<");
    expect(en("Autorizada")).not.toContain(">Editar<"); expect(en("Rechazada")).not.toContain(">Editar<");
    expect(en("Autorizada")).toContain("Descargar PDF"); expect(en("Autorizada")).toContain("/api/empresas/a/tms/gastos/7/pdf");
    expect(en("Pendiente")).not.toContain("Descargar PDF");
  });
  it("Autorizar queda deshabilitado mientras hay una autorización en curso; los handlers reciben el id", () => {
    expect(html(props({ puedeAutorizar: true, autorizandoId: 7 }))).toContain("disabled");
    const p = props({ puedeAutorizar: true });
    const botones = elementos(GastosListado(p)).filter(e => e.type === "button");
    const pulsar = (texto: string) => (botones.find(b => b.props.children === texto)!.props.onClick as () => void)();
    pulsar("Autorizar"); expect(p.onAutorizar).toHaveBeenCalledWith(7);
    pulsar("Rechazar"); expect(p.onRechazar).toHaveBeenCalledWith(7);
    pulsar("Desactivar"); expect(p.onDesactivar).toHaveBeenCalledWith(7);
    pulsar("Editar"); expect(p.onEditar).toHaveBeenCalledWith(7);
  });
});

describe("Detalle expandible", () => {
  it("solo el gasto expandido monta el detalle (uno a la vez); ninguno cargado por defecto", () => {
    const dos = [base, { ...base, id: 8 }];
    expect(elementos(GastosListado(props({ gastos: dos }))).filter(e => e.type === GastoDetalleClient)).toHaveLength(0);
    const abierto = elementos(GastosListado(props({ gastos: dos, expandido: 8 }))).filter(e => e.type === GastoDetalleClient);
    expect(abierto.map(e => e.props.id)).toEqual([8]);
    const salida = html(props({ gastos: dos, expandido: 8 }));
    expect(salida).toContain("Ocultar detalle"); expect(salida).toContain('aria-expanded="true"'); expect(salida).toContain("gasto-detalle-8");
  });
  it("carga lazy por id con caché: no repite la consulta y no comparte entre tenants", async () => {
    const cache = new Map<string, GastoVista>();
    fetchMock.mockImplementation(() => respuesta({ gasto: { ...base, lineas: [] } }));
    ejecutar(() => GastoDetalleClient({ slug: "a", id: 7, cache })); hooks.efectos[0]();
    await vi.waitFor(() => expect(cache.has("a/7")).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/empresas/a/tms/gastos/7");
    hooks.estados = []; ejecutar(() => GastoDetalleClient({ slug: "a", id: 7, cache })); hooks.efectos[0]();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    hooks.estados = []; ejecutar(() => GastoDetalleClient({ slug: "b", id: 7, cache })); hooks.efectos[0]();
    await vi.waitFor(() => expect(cache.has("b/7")).toBe(true)); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("loading inicial y error de carga (sin cachear el fallo)", async () => {
    const cache = new Map<string, GastoVista>();
    fetchMock.mockImplementation(() => respuesta({ error: "Gasto no encontrado." }, false));
    const render = () => GastoDetalleClient({ slug: "a", id: 7, cache });
    expect(renderToStaticMarkup(ejecutar(render) as ReactElement)).toContain("Cargando detalle…");
    hooks.efectos[0](); await vi.waitFor(() => expect(hooks.estados[1]).toBe("Gasto no encontrado."));
    const salida = renderToStaticMarkup(ejecutar(render) as ReactElement);
    expect(salida).toContain('role="alert"'); expect(salida).toContain("Gasto no encontrado."); expect(cache.size).toBe(0);
  });
  it("cerrar aborta la consulta y no guarda resultados tardíos", async () => {
    const cache = new Map<string, GastoVista>(); let resolver!: (v: unknown) => void;
    fetchMock.mockImplementation(() => new Promise(resolve => { resolver = resolve; }));
    ejecutar(() => GastoDetalleClient({ slug: "a", id: 7, cache })); const limpiar = hooks.efectos[0]();
    if (limpiar) limpiar();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    resolver({ ok: true, json: async () => ({ gasto: base }) });
    await new Promise(r => setTimeout(r, 0)); expect(cache.size).toBe(0);
  });
});

describe("Detalle interno", () => {
  const conLineas: GastoVista = { ...base, cantidad: 1, monto: 700, observaciones: "Entregar contra factura", facturaNombreOriginal: "fac.pdf", lineas: [
    { id: 1, categoria: "Combustible", descripcion: "Diésel", cantidad: 2, monto: 200, metodoPago: null, numeroCuentaPago: null, fechaViaje: null, empleadoNombre: "X", cargo: "Piloto", placa: "C-1", clienteNombre: "Calsa" },
    { id: 2, categoria: "Hospedaje", descripcion: "Hotel", cantidad: 1, monto: 300, metodoPago: null, numeroCuentaPago: null, fechaViaje: null, empleadoNombre: "X", cargo: "Piloto", placa: "C-1", clienteNombre: "Calsa" },
  ] };
  it("separa DATOS GENERALES / DETALLE-LÍNEAS / OBSERVACIONES / DOCUMENTOS con los campos de Gastos", () => {
    const salida = renderToStaticMarkup(GastoDetalleVista({ slug: "a", gasto: conLineas }));
    for (const v of ["Datos generales", "Detalle / líneas", "Observaciones", "Documentos", "Empresa requirente", "Método de pago", "Cuenta / número", "Cargo", "Placa", "Cliente", "Categoría", "Cantidad", "Descripción", "Valor", "Subtotal", "Entregar contra factura", "fac.pdf"]) expect(salida).toContain(v);
    expect(salida).toContain("Q400.00"); expect(salida).toContain("Q300.00"); expect(salida).toContain("Total: Q700.00");
  });
  it("observaciones y documentos aparecen solo si existen", () => {
    const salida = renderToStaticMarkup(GastoDetalleVista({ slug: "a", gasto: base }));
    expect(salida).not.toContain('aria-label="Observaciones"'); expect(salida).not.toContain('aria-label="Documentos"');
  });
  it("importes alineados a la derecha; tabla con texto envuelto en escritorio y tarjetas en móvil", () => {
    const salida = renderToStaticMarkup(GastoDetalleVista({ slug: "a", gasto: conLineas }));
    expect(salida.match(/text-right/g)!.length).toBeGreaterThanOrEqual(5);
    expect(salida).toContain("hidden overflow-x-auto md:block"); expect(salida).toContain("md:hidden"); expect(salida).toContain("break-words");
    expect(salida).not.toContain("min-w-[");
  });
  it("gasto sin líneas usa sus campos de cabecera como única línea", () => {
    const [unica] = lineasDeGasto(base);
    expect(unica).toMatchObject({ categoria: "Combustible", cantidad: 2, monto: 150, cargo: "Piloto de Transporte", placa: "C-625BZF", clienteNombre: "Pricesmart" });
    expect(renderToStaticMarkup(GastoDetalleVista({ slug: "a", gasto: base }))).toContain("Total: Q300.00");
  });
});

describe("La página conserva toda la lógica de Gastos", () => {
  const page = readFileSync("src/app/e/[slug]/gastos/page.tsx", "utf8");
  it("usa el listado nuevo y ya no la tabla ancha", () => {
    expect(page).toContain("<GastosListado"); expect(page).not.toContain("<table");
  });
  it("mantiene formularios, campos, permisos y endpoints propios de Gastos", () => {
    for (const v of ["gastos_operativos_autorizar", "Empresa requirente", "Método de pago", "Líneas adicionales", "+ Agregar línea", "Tiene factura", "Guardar",
      "async function guardar", "async function editar", "async function desactivar", "async function eliminarComprobante", "async function cambiarEstado", "confirmarAutorizacion",
      "/tms/gastos/${id}/${accion}", "AutorizacionConfirmacionModal", "paramsExportarGastos", "Exportar Excel", "Exportar PDF", "Limpiar filtros"]) expect(page).toContain(v);
  });
  it("conserva los filtros existentes y no agrega filtros nuevos", () => {
    for (const v of ["Fecha desde", "Fecha hasta", "Mes", "Año", "Categoría", "Empleado / persona", "Unidad", "Cliente"]) expect(page).toContain(v);
    expect(page).not.toMatch(/Estado<select|fEstado/);
  });
  it("un solo gasto expandido a la vez y caché de detalle que se limpia al recargar", () => {
    expect(page).toContain("useState<number | null>(null)"); expect(page).toContain("cacheDetalle.clear(); setExpandido(null);");
  });
  it("homologa layout con Compras (contenedor, título, panel de filtros) sin tocar el backend", () => {
    expect(page).toContain("space-y-5 p-6"); expect(page).toContain("text-2xl font-semibold"); expect(page).toContain("rounded-xl border border-[var(--border)] bg-[var(--card)] p-4");
  });
});
