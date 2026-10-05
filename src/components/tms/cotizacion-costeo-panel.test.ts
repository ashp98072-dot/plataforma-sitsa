import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Harness sin DOM (mismo patrón que requerimientos-client.test.ts): ejecuta los
// efectos/handlers reales y conserva el estado entre renders.
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
import { CotizacionCosteoPanel, CosteoRegistradoDetalle, HistorialCosteos, ResumenCosteo, TarjetaCosteo, fechaEmisionValida, useCosteoConfig, type ConfigCosteo, type CotizacionCosteoPanelProps } from "./cotizacion-costeo-panel";
import type { SnapshotCosteo } from "@/lib/tms/cotizacion-costeo-db";
import { formatearFechaHoraCosteo, seccionesConfiguracionCosteo } from "@/lib/tms/cotizacion-costeo-historial-ui";
import { calcularCosteoServicio } from "@/lib/tms/cotizacion-costeo";
import { COSTEO_FORM_VACIO, monedaCosteo, resumenDesdeResultado } from "@/lib/tms/cotizacion-costeo-ui";

const fetchMock = vi.fn();
it("ya no hay costeo único: el mensaje «crea una nueva cotización» se reemplazó por el historial de versiones",()=>{
 const fuente=readFileSync(new URL("./cotizacion-costeo-panel.tsx",import.meta.url),"utf8");
 expect(fuente).not.toContain("Esta cotización ya tiene un costeo registrado. Es un registro histórico inmutable. Para realizar un nuevo costeo, crea una nueva cotización.");
 for (const t of ["Historial de costeos","Ver configuración","Usar este costeo","Seleccionado","/costeo/historial","/costeo/seleccionar"]) expect(fuente).toContain(t);
});
const respuesta = (body: unknown, ok = true, status = ok ? 200 : 400) => Promise.resolve({ ok, status, json: async () => body });
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
const boton = (tree: ReactNode, etiqueta: string) => elementos(tree).find(e => e.type === "button" && texto(e.props.children as ReactNode) === etiqueta);
const html = (tree: ReactNode) => renderToStaticMarkup(tree as ReactElement);

beforeEach(() => { hooks.estados = []; hooks.efectos = []; hooks.activo = false; fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

const LISTO: ConfigCosteo = {
  estado: "listo", vigenteDesde: "2026-09-21", margenObjetivo: 0.2,
  perfiles: [{ id: 4, codigo: "CABEZAL", nombre: "Cabezal", gpsMensual: 174.1, seguroVehiculoMensual: 1550, costoRefrigeracion: null }],
};
const PERFIL_MOTOR = { codigo: "CABEZAL", nombre: "Cabezal", diasOperacionMes: 30, gpsMensual: 174.1, seguroVehiculoMensual: 1550, costoAceiteServicio: 1860, vidaUtilAceiteKm: 5000, costoJuegoLlantas: 38466, vidaUtilLlantasKm: 50000, rendimientoKmGalon: 9.3 };
const PARAM = { precioCombustibleGalon: 29.89, ivaTasa: 0.12, costoPilotoDia: 207.74, costoAuxiliarDia: 148.04, viaticoPilotoDia: 200, viaticoAuxiliarDia: 200, viaticoGuiaDia: 125, margenObjetivo: 0.2 };
const resultadoReal = (precioVenta: number | null) => calcularCosteoServicio({ perfil: PERFIL_MOTOR, parametros: PARAM, distanciaKm: 600, diasServicio: 1, cantidadPilotos: 2, cantidadAuxiliares: 2, incluirGps: true, incluirSeguroVehiculo: true, precioVenta });
it("Cotizador 2026: el desglose usa los conceptos del libro, con «Viáticos y hotel» como una sola línea",()=>{
 const r=calcularCosteoServicio({motorVersion:"COSTEO_COTIZADOR_2026",perfil:{...PERFIL_MOTOR,viajesMes:20,viaticosHotelViaje:200},parametros:PARAM,distanciaKm:220,diasServicio:1,cantidadPilotos:1,cantidadAuxiliares:1,incluirGps:true,incluirSeguroVehiculo:true,margenObjetivo:.30});
 const salida=html(ResumenCosteo({datos:resumenDesdeResultado(r)}));
 for(const t of ["Gastos varios / gastos generales","Seguro mercadería","Depreciación","GPS","Seguro vehículo","Aceite","Llantas","Combustible","Piloto","Auxiliar","Viáticos y hotel","COSTO BASE","Margen objetivo (%)","Valor del margen","Subtotal antes IVA","IVA","TOTAL CON IVA","Precio/km (informativo)"]) expect(salida).toContain(t);
 for(const retirado of ["Viático piloto","Viático auxiliar","Viático guía","Hotel<"]) expect(salida).not.toContain(retirado);
});
it("resumen V2 muestra desglose completo, un margen, IVA posterior y advertencias persistibles",()=>{
 const r=calcularCosteoServicio({motorVersion:"COSTEO_EXCEL_2026",perfil:{...PERFIL_MOTOR,viajesMes:20},parametros:PARAM,distanciaKm:220,diasServicio:1,cantidadPilotos:1,cantidadAuxiliares:1,incluirGps:true,incluirSeguroVehiculo:true,margenObjetivo:.30});
 const salida=html(ResumenCosteo({datos:resumenDesdeResultado(r)}));
 expect((salida.match(/Margen objetivo/g) ?? [])).toHaveLength(1);
 for(const t of ["Gastos generales","Seguro de mercadería","Hotel","Valor del margen","Margen objetivo (%)","Subtotal antes IVA","TOTAL CON IVA","Precio/km (informativo)","Costeo incompleto"]) expect(salida).toContain(t);
});

function props(over: Partial<CotizacionCosteoPanelProps> = {}): CotizacionCosteoPanelProps {
  return { slug: "kt", config: LISTO, fechaEmision: "2026-09-21", tarifaCotizada: "5000", incluyeIva: false, cotizacionId: null, editable: true, onPayloadGuardar: vi.fn(), onUsarPrecioSugerido: vi.fn(), ...over };
}
/** Estado 0 del panel = form: se precarga para no depender de teclear cada input. */
function conFormulario(over: Partial<typeof COSTEO_FORM_VACIO> = {}) {
  hooks.estados[0] = { ...COSTEO_FORM_VACIO, perfilId: 4, distanciaKm: "600", cantidadPilotos: "2", cantidadAuxiliares: "2", incluirGps: true, incluirSeguroVehiculo: true, ...over };
}

describe("La sección se oculta cuando el backend responde 403 (el resto de Cotizaciones sigue igual)", () => {
  it("useCosteoConfig: 403 => sin-permiso; 401 también; nunca un error global", async () => {
    for (const status of [403, 401]) {
      hooks.estados = []; fetchMock.mockReset();
      fetchMock.mockImplementation(() => respuesta({ error: "Sin permiso para el costeo interno de cotizaciones." }, false, status));
      ejecutar(() => useCosteoConfig("kt", "2026-09-21")); hooks.efectos[0]();
      await vi.waitFor(() => expect(hooks.estados[0]).toEqual({ estado: "sin-permiso" }));
      expect(fetchMock.mock.calls[0][0]).toBe("/api/empresas/kt/tms/cotizaciones/costeo/config?fecha=2026-09-21");
    }
  });
  it("useCosteoConfig: 200 => listo con perfiles y margen; 409 (sin parámetros) => error visible dentro de la sección; sin permiso jamás", async () => {
    fetchMock.mockImplementation(() => respuesta({ perfiles: LISTO.perfiles, parametros: { vigenteDesde: "2026-09-21", margenObjetivo: 0.2 } }));
    ejecutar(() => useCosteoConfig("kt", "2026-09-21")); hooks.efectos[0]();
    await vi.waitFor(() => expect(hooks.estados[0]).toMatchObject({ estado: "listo", margenObjetivo: 0.2, vigenteDesde: "2026-09-21" }));
    hooks.estados = []; fetchMock.mockReset();
    fetchMock.mockImplementation(() => respuesta({ error: "No hay parámetros de costeo vigentes para la fecha indicada." }, false, 409));
    ejecutar(() => useCosteoConfig("kt", "2026-09-21")); hooks.efectos[0]();
    await vi.waitFor(() => expect(hooks.estados[0]).toEqual({ estado: "error", mensaje: "No hay parámetros de costeo vigentes para la fecha indicada." }));
  });
  it("el panel no renderiza NADA con sin-permiso ni mientras carga", () => {
    for (const config of [{ estado: "sin-permiso" }, { estado: "cargando" }] as ConfigCosteo[]) {
      expect(ejecutar(() => CotizacionCosteoPanel(props({ config })))).toBeNull();
    }
  });
  it("con error de configuración muestra el mensaje DENTRO de la sección (role=alert)", () => {
    const salida = html(ejecutar(() => CotizacionCosteoPanel(props({ config: { estado: "error", mensaje: "No hay parámetros de costeo vigentes para la fecha indicada." } }))));
    expect(salida).toContain('role="alert"'); expect(salida).toContain("No hay parámetros de costeo vigentes"); expect(salida).toContain("Costeo interno");
  });
  it("la página oculta el costeo por config y nunca lo trata como error del módulo", () => {
    const pagina = readFileSync("src/app/e/[slug]/cotizaciones/page.tsx", "utf8");
    expect(pagina).toContain("useCosteoConfig(slug, form.fechaEmision)"); expect(pagina).toContain('costeoConfig.estado === "listo"');
    expect(pagina).not.toMatch(/costeoConfig[^\n]*setError|setError[^\n]*costeoConfig/);
  });
});

describe("La configuración visible usa la MISMA fecha que el cálculo (fechaEmision)", () => {
  const vigencia = (desde: string, margen: number) => respuesta({ perfiles: LISTO.perfiles, parametros: { vigenteDesde: desde, margenObjetivo: margen } });
  it("consulta /costeo/config?fecha=<fechaEmision> y muestra la vigencia y el margen de ESA fecha", async () => {
    fetchMock.mockImplementation((url: string) => (url.endsWith("fecha=2026-09-21") ? vigencia("2026-09-21", 0.2) : vigencia("2026-12-01", 0.25)));
    ejecutar(() => useCosteoConfig("kt", "2026-09-21")); hooks.efectos[0]();
    await vi.waitFor(() => expect(hooks.estados[0]).toMatchObject({ estado: "listo", vigenteDesde: "2026-09-21", margenObjetivo: 0.2 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/empresas/kt/tms/cotizaciones/costeo/config?fecha=2026-09-21");
  });
  it("al cambiar la fecha de emisión recarga: nueva petición con la nueva fecha, aborta la anterior y actualiza vigencia y margen", async () => {
    fetchMock.mockImplementation((url: string) => (url.endsWith("fecha=2026-09-21") ? vigencia("2026-09-21", 0.2) : vigencia("2026-12-01", 0.25)));
    ejecutar(() => useCosteoConfig("kt", "2026-09-21")); const limpiar = hooks.efectos[0]();
    await vi.waitFor(() => expect(hooks.estados[0]).toMatchObject({ vigenteDesde: "2026-09-21" }));
    // Re-render con otra fecha: React corre el cleanup del efecto anterior y luego el nuevo.
    if (limpiar) limpiar();
    ejecutar(() => useCosteoConfig("kt", "2026-12-15")); hooks.efectos[0]();
    await vi.waitFor(() => expect(hooks.estados[0]).toMatchObject({ estado: "listo", vigenteDesde: "2026-12-01", margenObjetivo: 0.25 }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/empresas/kt/tms/cotizaciones/costeo/config?fecha=2026-12-15");
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal!.aborted).toBe(true);
  });
  it("una respuesta obsoleta (de la fecha anterior) no pisa la de la fecha vigente", async () => {
    let resolverVieja!: (v: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolverVieja = resolve; }));
    fetchMock.mockImplementationOnce(() => vigencia("2026-12-01", 0.25));
    ejecutar(() => useCosteoConfig("kt", "2026-09-21")); const limpiar = hooks.efectos[0]();
    if (limpiar) limpiar();
    ejecutar(() => useCosteoConfig("kt", "2026-12-15")); hooks.efectos[0]();
    await vi.waitFor(() => expect(hooks.estados[0]).toMatchObject({ vigenteDesde: "2026-12-01" }));
    resolverVieja({ ok: true, status: 200, json: async () => ({ perfiles: [], parametros: { vigenteDesde: "2026-09-21", margenObjetivo: 0.2 } }) });
    await new Promise(r => setTimeout(r, 0));
    expect(hooks.estados[0]).toMatchObject({ vigenteDesde: "2026-12-01", margenObjetivo: 0.25 });
  });
  it.each(["", "2026-09", "2026-9-1", "21/09/2026", "2026-02-31", "2026-13-01", "abc"])("fecha inválida %j: NO se hace ninguna petición", (fecha) => {
    ejecutar(() => useCosteoConfig("kt", fecha)); hooks.efectos[0]();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hooks.estados[0]).toEqual({ estado: "cargando" });
    expect(fechaEmisionValida(fecha)).toBe(false);
  });
  it("fechas válidas se aceptan (incluido bisiesto)", () => {
    for (const f of ["2026-09-21", "2028-02-29", "2026-12-31"]) expect(fechaEmisionValida(f)).toBe(true);
    expect(fechaEmisionValida("2027-02-29")).toBe(false);
  });
  it("una fecha inválida a medio escribir conserva la configuración ya cargada (no oculta la sección)", async () => {
    fetchMock.mockImplementation(() => vigencia("2026-09-21", 0.2));
    ejecutar(() => useCosteoConfig("kt", "2026-09-21")); hooks.efectos[0]();
    await vi.waitFor(() => expect(hooks.estados[0]).toMatchObject({ estado: "listo" }));
    ejecutar(() => useCosteoConfig("kt", "")); hooks.efectos[0]();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hooks.estados[0]).toMatchObject({ estado: "listo", vigenteDesde: "2026-09-21" });
  });
  it("la fecha sin parámetros vigentes (409) muestra el error dentro de la sección y se recupera al volver a una fecha válida", async () => {
    fetchMock.mockImplementation((url: string) => (url.endsWith("fecha=2026-01-01") ? respuesta({ error: "No hay parámetros de costeo vigentes para la fecha indicada." }, false, 409) : vigencia("2026-09-21", 0.2)));
    ejecutar(() => useCosteoConfig("kt", "2026-01-01")); hooks.efectos[0]();
    await vi.waitFor(() => expect(hooks.estados[0]).toMatchObject({ estado: "error" }));
    ejecutar(() => useCosteoConfig("kt", "2026-09-21")); hooks.efectos[0]();
    await vi.waitFor(() => expect(hooks.estados[0]).toMatchObject({ estado: "listo", vigenteDesde: "2026-09-21" }));
  });
  it("el margen placeholder del panel es el de la vigencia cargada", () => {
    const salida = html(ejecutar(() => CotizacionCosteoPanel(props({ config: { ...LISTO, margenObjetivo: 0.25, vigenteDesde: "2026-12-01" } }))));
    expect(salida).toContain('placeholder="25"'); expect(salida).toContain("Parámetros vigentes desde 2026-12-01");
  });
  it("la página pasa form.fechaEmision al hook (misma fecha que el cálculo real)", () => {
    const pagina = readFileSync("src/app/e/[slug]/cotizaciones/page.tsx", "utf8");
    expect(pagina).toContain("useCosteoConfig(slug, form.fechaEmision)");
    expect(pagina).toContain("fechaEmision={form.fechaEmision}");
  });
});

describe("Sección COSTEO INTERNO (con permiso)", () => {
  it("se diferencia de la parte comercial y muestra todos los campos pedidos", () => {
    const salida = html(ejecutar(() => CotizacionCosteoPanel(props())));
    for (const v of ["Costeo interno", "Confidencial", "no aparece en el PDF ni en el listado", "Perfil de unidad", "Distancia (km)", "Días de servicio", "Pilotos", "Auxiliares",
      "Incluir GPS", "Incluir seguro del vehículo", "Seguro de mercadería (Q)", "Usar refrigeración", "Viáticos y hotel (Q)", "Otros costos", "Margen objetivo (%)", "Precio combustible usado", "Calcular costeo", "border-amber-500/50", "Cabezal"]) expect(salida).toContain(v);
    // La tarifa comercial NO es un input del costeo.
    expect(salida).not.toContain("Tarifa cotizada");
  });
  it("Cotizador 2026: ya no pide guías, viáticos por rol ni hotel por separado — un solo «Viáticos y hotel (Q)»", () => {
    const salida = html(ejecutar(() => CotizacionCosteoPanel(props())));
    for (const retirado of ["Guías", "Viático piloto total", "Viático auxiliar total", "Viático guía total", "Hotel total"]) expect(salida).not.toContain(retirado);
    expect((salida.match(/Viáticos y hotel \(Q\)/g) ?? [])).toHaveLength(1);
  });
  it("el campo muestra como sugerencia el valor del perfil (vacío = usar el perfil)", () => {
    const conPerfil: ConfigCosteo = { ...LISTO, perfiles: [{ ...(LISTO as Extract<ConfigCosteo, { estado: "listo" }>).perfiles[0], viaticosHotelViaje: 200 }] };
    const salida = html(ejecutar(() => { hooks.estados[0] = { ...COSTEO_FORM_VACIO, perfilId: 4 }; return CotizacionCosteoPanel(props({ config: conPerfil })); }));
    expect(salida).toContain('placeholder="200"');
  });
  it("Usar refrigeración queda deshabilitado si el perfil no tiene equipo de refrigeración", () => {
    conFormulario();
    expect(html(ejecutar(() => CotizacionCosteoPanel(props())))).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""[^>]*\/> Usar refrigeración/);
  });
  it("sin cálculo no hay resumen ni 'Usar precio sugerido'", () => {
    conFormulario();
    const salida = html(ejecutar(() => CotizacionCosteoPanel(props())));
    expect(salida).not.toContain("Resumen de costeo"); expect(salida).not.toContain("Usar precio sugerido");
  });
});

describe("Cálculo y 'Usar precio sugerido' (nunca automático)", () => {
  async function calcularUnaVez(p: CotizacionCosteoPanelProps) {
    conFormulario();
    fetchMock.mockImplementation(() => respuesta({ resultado: resultadoReal(5600), perfil: { id: 4 }, parametrosVigenteDesde: "2026-09-21" }));
    let arbol = ejecutar(() => CotizacionCosteoPanel(p));
    (boton(arbol, "Calcular costeo")!.props.onClick as () => void)();
    await vi.waitFor(() => expect(hooks.estados[1]).not.toBeNull());
    arbol = ejecutar(() => CotizacionCosteoPanel(p));
    return arbol;
  }
  it("Calcular envía SOLO datos operativos + contexto comercial; nunca parámetros económicos ni datos del perfil", async () => {
    await calcularUnaVez(props());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/empresas/kt/tms/cotizaciones/costeo/calcular");
    const cuerpo = JSON.parse((init as RequestInit).body as string);
    expect(cuerpo).toEqual({ incluirSeguroMercaderia: true, perfilId: 4, distanciaKm: 600, diasServicio: 1, cantidadPilotos: 2, cantidadAuxiliares: 2, incluirGps: true, incluirSeguroVehiculo: true, usarRefrigeracion: false, fechaEmision: "2026-09-21", tarifaCotizada: 5000, incluyeIva: false });
    for (const clave of ["gpsMensual", "precioCombustibleGalon", "costoPilotoDia", "ivaTasa", "precioVenta", "perfil", "parametros"]) expect(clave in cuerpo).toBe(false);
  });
  it("el resultado muestra el resumen pedido y el detalle (sin renglones en 0)", async () => {
    const salida = html(await calcularUnaVez(props()));
    for (const v of ["Resumen de costeo", "Costo operativo", "IVA costo", "Costo con IVA", "Margen objetivo", "Precio sugerido", "Tarifa comercial", "Utilidad estimada", "Margen sobre costo", "Detalle del costo", "Combustible", "Llantas", "Aceite", "GPS"]) expect(salida).toContain(v);
    expect(salida).not.toContain("Depreciación"); expect(salida).not.toContain("Equipo de refrigeración");
  });
  it("calcular NO aplica el precio sugerido: la tarifa comercial no cambia sola", async () => {
    const p = props();
    await calcularUnaVez(p);
    expect(p.onUsarPrecioSugerido).not.toHaveBeenCalled();
  });
  it("el botón explícito aplica el precio sugerido (redondeado a centavos) y recalcula con la nueva tarifa como total con IVA", async () => {
    const p = props();
    const arbol = await calcularUnaVez(p);
    const esperado = Math.round(resultadoReal(5600).precioSugerido * 100) / 100;
    (boton(arbol, "Usar precio sugerido")!.props.onClick as () => void)();
    expect(p.onUsarPrecioSugerido).toHaveBeenCalledExactlyOnceWith(esperado);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const cuerpo = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(cuerpo.tarifaCotizada).toBe(esperado); expect(cuerpo.incluyeIva).toBe(true);
  });
  it("'Usar precio sugerido' solo existe en formularios editables (Borrador/alta)", async () => {
    const arbol = await calcularUnaVez(props({ editable: false }));
    expect(boton(arbol, "Usar precio sugerido")).toBeUndefined();
  });
  it("si cambian datos después de calcular, el resultado queda obsoleto: aviso, botón deshabilitado y NO se registra", async () => {
    const p = props();
    await calcularUnaVez(p);
    const obsoleto = ejecutar(() => CotizacionCosteoPanel({ ...p, tarifaCotizada: "6000" }));
    expect(html(obsoleto)).toContain("vuelve a calcular");
    expect(boton(obsoleto, "Usar precio sugerido")!.props.disabled).toBe(true);
    hooks.efectos[0](); expect(p.onPayloadGuardar).toHaveBeenLastCalledWith(null);
  });
  it("con un cálculo vigente, el payload a registrar viaja al padre (y solo si el usuario quiere registrarlo)", async () => {
    const p = props();
    await calcularUnaVez(p);
    ejecutar(() => CotizacionCosteoPanel(p)); hooks.efectos[0]();
    expect(p.onPayloadGuardar).toHaveBeenLastCalledWith(expect.objectContaining({ perfilId: 4, distanciaKm: 600 }));
    hooks.estados[4] = false; // "Registrar este costeo…" desmarcado
    ejecutar(() => CotizacionCosteoPanel(p)); hooks.efectos[0]();
    expect(p.onPayloadGuardar).toHaveBeenLastCalledWith(null);
  });
  it("un error del servidor se muestra dentro de la sección y no deja un resultado", async () => {
    conFormulario();
    fetchMock.mockImplementation(() => respuesta({ error: "El perfil de unidad indicado no existe en esta empresa." }, false, 400));
    const p = props();
    let arbol = ejecutar(() => CotizacionCosteoPanel(p));
    (boton(arbol, "Calcular costeo")!.props.onClick as () => void)();
    await vi.waitFor(() => expect(hooks.estados[3]).toBe("El perfil de unidad indicado no existe en esta empresa."));
    arbol = ejecutar(() => CotizacionCosteoPanel(p));
    expect(html(arbol)).toContain('role="alert"'); expect(hooks.estados[1]).toBeNull();
  });
  it("datos inválidos del formulario no llegan al servidor", () => {
    conFormulario({ distanciaKm: "" });
    const arbol = ejecutar(() => CotizacionCosteoPanel(props()));
    (boton(arbol, "Calcular costeo")!.props.onClick as () => void)();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HISTORIAL DE COSTEOS: 1 cotización -> N versiones inmutables
// ---------------------------------------------------------------------------
const PERFIL_2026 = {
  ...PERFIL_MOTOR, codigo: "CAMION_2_7T", nombre: "Camión 2.7 toneladas", viajesMes: 20, precioLlanta: 850, cantidadLlantas: 4, salarioPilotoMensual: 6787.69, salarioAuxiliarMensual: 6039.97,
  viaticosHotelViaje: 200, auxiliarMultiplicaDias: true as boolean | null, viaticosHotelMultiplicaDias: null as boolean | null, depreciacion: { valorBase: 150000, anios: 5, diasOperacionMes: 26 }, costoRefrigeracion: null,
};
const PARAM_2026 = { ...PARAM, precioCombustibleGalon: 43, seguroMercaderiaAnual: 70000, cantidadCamiones: 46, viajesAnuales: 240, diasDepreciacionMes: 26, diasGastosMes: 20, diasLaboralesMes: 20, gastosAdministracion: 90586.01, gastosMantenimiento: 34602.28, gastosSeguridad: 25826.24, gastosPredios: 52221.96 };
const INPUT_2026 = { distanciaKm: 220, diasServicio: 2, cantidadPilotos: 1, cantidadAuxiliares: 1, incluirGps: true, incluirSeguroVehiculo: true, margenObjetivo: 0.3, viaticosHotelTotal: 250, seguroMercaderia: 50, otrosCostos: [{ concepto: "Peaje", monto: 100 }] };
type Motor = "V1" | "EXCEL" | "COTIZADOR" | "V2";
function version(n: number, motor: Motor = "COTIZADOR", seleccionado = false, over: Partial<SnapshotCosteo> = {}): SnapshotCosteo {
  const motorVersion = motor === "COTIZADOR" ? "COSTEO_COTIZADOR_2026" : motor === "V2" ? "COSTEO_COTIZADOR_2026_V2" : motor === "EXCEL" ? "COSTEO_EXCEL_2026" : undefined;
  const perfil = motor === "V1" ? PERFIL_MOTOR : { ...PERFIL_2026, rendimientoKmGalon: 25 + n };
  const parametros = motor === "V1" ? PARAM : { ...PARAM_2026, precioCombustibleGalon: 40 + n };
  const input = motor === "V1" ? { distanciaKm: 600, diasServicio: 1, cantidadPilotos: 2, cantidadAuxiliares: 2, incluirGps: true, incluirSeguroVehiculo: true } : { ...INPUT_2026, distanciaKm: 200 + n };
  const resultado = calcularCosteoServicio({ ...input, motorVersion, perfil, parametros } as never);
  return {
    id: 50 + n, cotizacionId: 10, version: n, esSeleccionado: seleccionado, seleccionadoPor: seleccionado ? "ana" : null, seleccionadoEn: seleccionado ? "2026-10-05 10:30:00" : null,
    perfilId: 4, perfilCodigo: perfil.codigo, perfilNombre: perfil.nombre, perfil: perfil as never, parametros, input: input as never, motorVersion: resultado.motorVersion ?? "COSTEO_V1",
    costoOperativo: resultado.costoOperativo, iva: resultado.iva, costoConIva: resultado.costoConIva, margenObjetivo: resultado.margenObjetivoAplicado, precioSugerido: resultado.precioSugerido,
    precioVenta: motor === "V1" ? 7000 : null, utilidadEstimada: null, margenReal: null, creadoPor: "admin", creadoEn: `2026-10-05 09:5${n}:00`, componentes: resultado.componentes,
    resultado: motor === "V1" ? null : resultado, ...over,
  };
}
const V1 = version(1, "COTIZADOR", false), V2 = version(2, "COTIZADOR", true), V3 = version(3, "COTIZADOR", false);

describe("F. Historial de costeos en la tarjeta de versiones", () => {
  it("muestra varias versiones, de la más reciente a la más antigua, con los datos de cada una", () => {
    const salida = html(HistorialCosteos({ versiones: [V3, V2, V1], editable: true }));
    expect(salida).toContain("Historial de costeos");
    const i3 = salida.indexOf("Costeo #3"), i2 = salida.indexOf("Costeo #2"), i1 = salida.indexOf("Costeo #1");
    expect(i3).toBeGreaterThan(-1); expect(i2).toBeGreaterThan(i3); expect(i1).toBeGreaterThan(i2);
    for (const t of ["05/10/2026 09:53", "05/10/2026 09:52", "Usuario: admin", "Perfil: CAMION_2_7T", "Motor: COSTEO_COTIZADOR_2026", "Costo base", "Margen", "IVA", "Total sugerido", "Precio/km", "Precio comercial"]) expect(salida).toContain(t);
    expect(salida).toContain(monedaCosteo(V3.costoOperativo)); expect(salida).toContain(monedaCosteo(V1.precioSugerido));
  });
  it("badge «Seleccionado» solo en la versión utilizada (y quién/cuándo la eligió)", () => {
    const salida = html(HistorialCosteos({ versiones: [V3, V2, V1], editable: true }));
    expect((salida.match(/>Seleccionado</g) ?? [])).toHaveLength(1);
    expect(salida.indexOf(">Seleccionado<")).toBeGreaterThan(salida.indexOf("Costeo #2")); expect(salida.indexOf(">Seleccionado<")).toBeLessThan(salida.indexOf("Costeo #1"));
    expect(salida).toContain("Seleccionado por ana"); expect(salida).toContain("05/10/2026 10:30");
  });
  it("«Usar este costeo» aparece en las NO seleccionadas cuando se puede editar; nunca en la seleccionada ni en modo solo lectura", () => {
    expect((html(HistorialCosteos({ versiones: [V3, V2, V1], editable: true, onUsar: vi.fn() })).match(/Usar este costeo/g) ?? [])).toHaveLength(2);
    expect(html(HistorialCosteos({ versiones: [V3, V2, V1], editable: false, onUsar: vi.fn() }))).not.toContain("Usar este costeo");
    expect(html(HistorialCosteos({ versiones: [V2], editable: true, onUsar: vi.fn() }))).not.toContain("Usar este costeo");
  });
  it("«Ver configuración» despliega el snapshot de ESA versión (perfil, parámetros, input, resultado) y se puede ocultar", () => {
    const arbol = ejecutar(() => TarjetaCosteo({ v: V2, editable: true }));
    expect(html(arbol)).not.toContain("Datos del perfil usado");
    (boton(arbol, "Ver configuración")!.props.onClick as () => void)();
    const abierto = ejecutar(() => TarjetaCosteo({ v: V2, editable: true }));
    const salida = html(abierto);
    for (const t of ["Datos del perfil usado", "Parámetros económicos usados", "Input de esta cotización", "COSTO BASE", "TOTAL CON IVA", "Ocultar configuración", "Configuración exacta utilizada en esta versión"]) expect(salida).toContain(t);
    expect(boton(abierto, "Ocultar configuración")).toBeDefined();
    (boton(abierto, "Ocultar configuración")!.props.onClick as () => void)();
    expect(html(ejecutar(() => TarjetaCosteo({ v: V2, editable: true })))).not.toContain("Datos del perfil usado");
  });
  it("el detalle sale del SNAPSHOT: rendimiento, combustible, días y override de esa versión, no valores vivos", () => {
    const filas = Object.fromEntries(seccionesConfiguracionCosteo(V2).flatMap((x) => x.filas));
    expect(filas["Rendimiento (km/galón)"]).toBe("27"); // 25 + versión 2, guardado en perfil_snapshot
    expect(filas["Precio de combustible global (Q/galón)"]).toBe("Q42.00");
    expect(filas["Distancia (km)"]).toBe("202"); expect(filas["Días de servicio"]).toBe("2");
    expect(filas["Viáticos y hotel (override)"]).toBe("Q250.00 (total del servicio)");
    expect(filas["Seguro de mercadería"]).toBe("Manual: Q50.00 (total del servicio)");
    expect(filas["Otros costos"]).toBe("Peaje: Q100.00");
    expect(filas["Auxiliar se cobra por cada día de servicio"]).toBe("Sí");
    expect(filas["Viáticos y hotel se cobran por cada día de servicio"]).toBe("Sin configurar");
    expect(filas["Thermo / refrigeración"]).toBe("No aplica");
    // Otra versión conserva SUS valores: la configuración posterior no los altera.
    const f3 = Object.fromEntries(seccionesConfiguracionCosteo(V3).flatMap((x) => x.filas));
    expect(f3["Rendimiento (km/galón)"]).toBe("28"); expect(f3["Distancia (km)"]).toBe("203");
    const fuente = readFileSync("src/lib/tms/cotizacion-costeo-historial-ui.ts", "utf8");
    expect(fuente).not.toMatch(/fetch\(|obtenerPerfil|obtenerParametros|listarPerfiles|useEffect/); // nada de configuración viva
  });
  it("las tres secciones piden todo lo del ticket", () => {
    const [perfil, parametros, input] = seccionesConfiguracionCosteo(V2);
    expect(perfil.filas.map((f) => f[0])).toEqual(expect.arrayContaining(["Código", "Nombre", "Rendimiento (km/galón)", "GPS mensual", "Viajes por mes", "Seguro del vehículo mensual", "Costo cambio de aceite", "Intervalo de aceite (km)", "Precio por llanta", "Cantidad de llantas", "Vida útil de llantas (km)", "Valor del vehículo", "Años de depreciación", "Salario piloto mensual", "Salario auxiliar mensual", "Viáticos y hotel por viaje", "Auxiliar se cobra por cada día de servicio", "Viáticos y hotel se cobran por cada día de servicio", "Thermo / refrigeración"]));
    expect(parametros.filas.map((f) => f[0])).toEqual(expect.arrayContaining(["Precio de combustible global (Q/galón)", "IVA", "Margen objetivo predeterminado", "Seguro de mercadería anual", "Flota (camiones)", "Viajes anuales", "Días de depreciación por mes", "Días de gastos por mes", "Gastos de administración", "Gastos de mantenimiento", "Gastos de seguridad", "Gastos de predios", "Días laborales por mes"]));
    expect(input.filas.map((f) => f[0])).toEqual(expect.arrayContaining(["Distancia (km)", "Días de servicio", "Pilotos", "Auxiliares", "Incluir GPS", "Incluir seguro del vehículo", "Usar refrigeración", "Seguro de mercadería", "Precio de combustible usado (override)", "Viáticos y hotel (override)", "Margen objetivo (override)", "Otros costos"]));
    expect(Object.fromEntries(input.filas)["Margen objetivo (override)"]).toBe("30.00 %");
  });
  it("SOLO LECTURA: la configuración desplegada no tiene campos editables ni acciones de editar, borrar o recalcular", () => {
    const salida = html(createElement(TarjetaCosteo, { v: V2, editable: true, abiertoInicial: true, onUsar: vi.fn() }));
    expect(salida).toContain('data-solo-lectura="true"');
    expect(salida).not.toMatch(/<(input|textarea|select)\b/);
    expect(salida).not.toMatch(/Editar|Eliminar|Borrar|Recalcular|Actualizar costeo/);
    const botones = [...salida.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
    expect(botones).toEqual(["Ocultar configuración"]); // la seleccionada solo puede ocultarse
    expect([...html(createElement(TarjetaCosteo, { v: V3, editable: true, onUsar: vi.fn() })).matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])).toEqual(["Ver configuración", "Usar este costeo"]);
  });
  it("los componentes completos de la versión se listan en su resultado", () => {
    const salida = html(createElement(TarjetaCosteo, { v: V2, editable: false, abiertoInicial: true }));
    for (const c of V2.componentes) expect(salida).toContain(c.concepto);
  });
});

describe("G. Compatibilidad: V1, COSTEO_EXCEL_2026 y COSTEO_COTIZADOR_2026 se renderizan", () => {
  it.each([["V1", version(1, "V1", true)], ["EXCEL", version(1, "EXCEL", true)], ["COTIZADOR", version(1, "COTIZADOR", true)], ["V2", version(1, "V2", true)]] as const)("motor %s: tarjeta, configuración y resultado sin errores", (_n, v) => {
    const salida = html(createElement(TarjetaCosteo, { v, editable: true, abiertoInicial: true }));
    expect(salida).toContain("Costeo #1"); expect(salida).toContain(v.motorVersion);
    expect(salida).toContain("Datos del perfil usado"); expect(salida).toContain("Resumen de costeo"); // V1 usa el resumen original; V2 el detallado
    if (v.motorVersion === "COSTEO_V1") { expect(salida).not.toContain("Subtotal antes IVA"); expect(salida).toContain("Costo operativo"); }
    else { expect(salida).toContain("Subtotal antes IVA"); expect(salida).toContain("COSTO BASE"); }
  });
  it("snapshots antiguos sin campos nuevos (sin banderas, sin parámetros del Cotizador) muestran «—», no 0 ni errores", () => {
    const filas = Object.fromEntries(seccionesConfiguracionCosteo(version(1, "V1", true)).flatMap((x) => x.filas));
    expect(filas["Auxiliar se cobra por cada día de servicio"]).toBe("—");
    expect(filas["Seguro de mercadería anual"]).toBe("—"); expect(filas["Flota (camiones)"]).toBe("—");
    expect(filas["Viáticos y hotel por viaje"]).toBe("—");
    expect(filas["Viático piloto por día (motor anterior)"]).toBe("Q200.00"); // los globales viejos SÍ se muestran en el motor anterior
  });
  it("el motor nuevo no muestra los globales que ignora (piloto/viático/hotel por día)", () => {
    const etiquetas = seccionesConfiguracionCosteo(V2).flatMap((x) => x.filas.map((f) => f[0]));
    expect(etiquetas.filter((e) => /motor anterior/.test(e))).toEqual([]);
  });
  it("COSTEO_COTIZADOR_2026_V2: resumen detallado con valores a 2 decimales (sin llenar la pantalla de decimales) y sin globales del motor anterior", () => {
    const v = version(1, "V2", true);
    expect(v.resultado?.precision).toBeDefined(); // el snapshot guarda la precisión; la UI solo muestra 2 decimales
    const salida = html(createElement(TarjetaCosteo, { v, editable: false, abiertoInicial: true }));
    expect(salida).toContain("Motor: COSTEO_COTIZADOR_2026_V2"); expect(salida).toContain("Subtotal antes IVA"); expect(salida).toContain("TOTAL CON IVA");
    expect(salida).not.toMatch(/Q[\d,]+\.\d{3,}/); // ningún importe con más de 2 decimales
    expect(seccionesConfiguracionCosteo(v).flatMap((x) => x.filas.map((f) => f[0])).filter((e) => /motor anterior/.test(e))).toEqual([]);
  });
  it("el motor se toma del resultado persistido (el de la propia versión) cuando existe: la familia Cotizador no se muestra como «motor anterior»", () => {
    const v = version(1, "COTIZADOR", true, { motorVersion: "COSTEO_V1" }); // la columna no decide si el resultado persistido dice otra cosa
    expect(v.resultado?.motorVersion).toBe("COSTEO_COTIZADOR_2026");
    expect(seccionesConfiguracionCosteo(v).flatMap((x) => x.filas.map((f) => f[0])).filter((e) => /motor anterior/.test(e))).toEqual([]);
  });
  it("un único costeo antiguo (versión 1, seleccionado) funciona: tarjeta con badge y sin botón «Usar»", () => {
    const salida = html(HistorialCosteos({ versiones: [version(1, "V1", true)], editable: true, onUsar: vi.fn() }));
    expect(salida).toContain("Costeo #1"); expect(salida).toContain(">Seleccionado<"); expect(salida).not.toContain("Usar este costeo");
  });
  it("formatearFechaHoraCosteo: «2026-10-05 09:55:00» -> «05/10/2026 09:55»; vacío -> «—»; otro formato se conserva", () => {
    expect(formatearFechaHoraCosteo("2026-10-05 09:55:00")).toBe("05/10/2026 09:55");
    expect(formatearFechaHoraCosteo("2026-10-05T09:55:00.000Z")).toBe("05/10/2026 09:55");
    expect(formatearFechaHoraCosteo(null)).toBe("—"); expect(formatearFechaHoraCosteo("ayer")).toBe("ayer");
  });
});

describe("Panel: una cotización con costeos registrados", () => {
  it("consulta el historial (no el costeo único) y lo muestra; el formulario de un NUEVO costeo sigue disponible", async () => {
    fetchMock.mockImplementation(() => respuesta({ historial: [V2, V1] }));
    const p = props({ cotizacionId: 10 });
    ejecutar(() => CotizacionCosteoPanel(p)); hooks.efectos[1]();
    await vi.waitFor(() => expect(hooks.estados[5]).toHaveLength(2));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/empresas/kt/tms/cotizaciones/10/costeo/historial");
    const arbol = ejecutar(() => CotizacionCosteoPanel(p));
    const salida = html(arbol);
    expect(salida).toContain("Historial de costeos"); expect(salida).toContain("Costeo #2"); expect(salida).toContain("Costeo #1");
    expect(salida).toContain("tiene 2 costeos registrados"); expect(salida).toContain("no reemplaza al utilizado");
    expect(boton(arbol, "Calcular costeo")).toBeDefined(); expect(salida).toContain("Perfil de unidad");
    expect(salida).not.toContain("crea una nueva cotización");
  });
  it("cotización sin costeos: historial vacío, sin sección de historial, se puede costear", async () => {
    fetchMock.mockImplementation(() => respuesta({ historial: [] }));
    const p = props({ cotizacionId: 10 });
    ejecutar(() => CotizacionCosteoPanel(p)); hooks.efectos[1]();
    await vi.waitFor(() => expect(hooks.estados[5]).toEqual([]));
    const arbol = ejecutar(() => CotizacionCosteoPanel(p));
    expect(html(arbol)).not.toContain("Historial de costeos"); expect(boton(arbol, "Calcular costeo")).toBeDefined();
  });
  it("si el historial no se puede cargar (error del servidor) el panel no se cae: queda el formulario", async () => {
    fetchMock.mockImplementation(() => respuesta({ error: "x" }, false, 500));
    const p = props({ cotizacionId: 10 });
    ejecutar(() => CotizacionCosteoPanel(p)); hooks.efectos[1]();
    await vi.waitFor(() => expect(hooks.estados[5]).toBeNull());
    expect(boton(ejecutar(() => CotizacionCosteoPanel(p)), "Calcular costeo")).toBeDefined();
  });
  it("un alta (sin id) no consulta ningún historial", () => {
    ejecutar(() => CotizacionCosteoPanel(props())); hooks.efectos[1]();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("con historial, un cálculo vigente SÍ viaja para registrarse como una versión más (ya no se bloquea) y la casilla anuncia el número", async () => {
    conFormulario(); hooks.estados[5] = [V2, V1];
    fetchMock.mockImplementation(() => respuesta({ resultado: resultadoReal(5600), perfil: { id: 4 }, parametrosVigenteDesde: "2026-09-21" }));
    const p = props({ cotizacionId: 10 });
    let arbol = ejecutar(() => CotizacionCosteoPanel(p));
    (boton(arbol, "Calcular costeo")!.props.onClick as () => void)();
    await vi.waitFor(() => expect(hooks.estados[1]).not.toBeNull());
    arbol = ejecutar(() => CotizacionCosteoPanel(p)); hooks.efectos[0]();
    expect(p.onPayloadGuardar).toHaveBeenLastCalledWith(expect.objectContaining({ perfilId: 4, distanciaKm: 600 }));
    expect(html(arbol)).toContain("Registrar este costeo como versión 3 al guardar la cotización (queda inmutable)");
  });
  it("«Usar este costeo»: POST /costeo/seleccionar con el costeoId y recarga el historial", async () => {
    hooks.estados[5] = [V2, V1];
    const recargado = [{ ...V2, esSeleccionado: false }, { ...V1, esSeleccionado: true }];
    fetchMock.mockImplementationOnce(() => respuesta({ costeoId: 51, version: 1, cambio: true })).mockImplementationOnce(() => respuesta({ historial: recargado }));
    const p = props({ cotizacionId: 10 });
    const arbol = ejecutar(() => CotizacionCosteoPanel(p));
    const historial = elementos(arbol).find((e) => e.type === HistorialCosteos)!;
    (historial.props.onUsar as (id: number) => void)(51);
    await vi.waitFor(() => expect((hooks.estados[5] as SnapshotCosteo[])[1].esSeleccionado).toBe(true));
    const [[url1, init1], [url2]] = fetchMock.mock.calls;
    expect(url1).toBe("/api/empresas/kt/tms/cotizaciones/10/costeo/seleccionar");
    expect(init1).toMatchObject({ method: "POST" }); expect(JSON.parse(init1.body)).toEqual({ costeoId: 51 });
    expect(url2).toBe("/api/empresas/kt/tms/cotizaciones/10/costeo/historial");
    expect(hooks.estados[7]).toBe(""); expect(hooks.estados[6]).toBe(false);
  });
  it("si el servidor rechaza la selección (409), muestra el mensaje y NO cambia el historial", async () => {
    hooks.estados[5] = [V2, V1];
    fetchMock.mockImplementation(() => respuesta({ error: "Solo se puede cambiar el costeo utilizado mientras la cotización está en Borrador." }, false, 409));
    const p = props({ cotizacionId: 10 });
    const arbol = ejecutar(() => CotizacionCosteoPanel(p));
    (elementos(arbol).find((e) => e.type === HistorialCosteos)!.props.onUsar as (id: number) => void)(51);
    await vi.waitFor(() => expect(hooks.estados[7]).toBe("Solo se puede cambiar el costeo utilizado mientras la cotización está en Borrador."));
    expect(hooks.estados[5]).toEqual([V2, V1]); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(html(ejecutar(() => CotizacionCosteoPanel(p)))).toContain('role="alert"');
  });
  it("sin permiso de edición (editable=false) no existe la acción de seleccionar y un intento no llama al servidor", () => {
    hooks.estados[5] = [V2, V1];
    const p = props({ cotizacionId: 10, editable: false });
    const arbol = ejecutar(() => CotizacionCosteoPanel(p));
    expect(html(arbol)).not.toMatch(/<button[^>]*>Usar este costeo<\/button>/); // el aviso del panel menciona la acción; el BOTÓN no existe
    (elementos(arbol).find((e) => e.type === HistorialCosteos)!.props.onUsar as (id: number) => void)(51);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Detalle expandido del listado: historial en solo lectura", () => {
  it("«Ver costeo registrado» carga el historial y lo muestra SIN acciones de selección", async () => {
    fetchMock.mockImplementation(() => respuesta({ historial: [V2, V1] }));
    const arbol = ejecutar(() => CosteoRegistradoDetalle({ slug: "kt", cotizacionId: 10 }));
    (boton(arbol, "Ver costeo registrado")!.props.onClick as () => void)();
    await vi.waitFor(() => expect(hooks.estados[0]).toBe("listo"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/empresas/kt/tms/cotizaciones/10/costeo/historial");
    const salida = html(ejecutar(() => CosteoRegistradoDetalle({ slug: "kt", cotizacionId: 10 })));
    expect(salida).toContain("Costeo #2"); expect(salida).toContain("Costeo #1"); expect(salida).not.toContain("Usar este costeo");
  });
  it("sin costeos => «no tiene costeo registrado»; error => alerta", async () => {
    fetchMock.mockImplementationOnce(() => respuesta({ historial: [] }));
    let arbol = ejecutar(() => CosteoRegistradoDetalle({ slug: "kt", cotizacionId: 10 }));
    (boton(arbol, "Ver costeo registrado")!.props.onClick as () => void)();
    await vi.waitFor(() => expect(hooks.estados[0]).toBe("ausente"));
    expect(html(ejecutar(() => CosteoRegistradoDetalle({ slug: "kt", cotizacionId: 10 })))).toContain("no tiene costeo registrado");
    hooks.estados = []; fetchMock.mockImplementationOnce(() => respuesta({ error: "x" }, false, 500));
    arbol = ejecutar(() => CosteoRegistradoDetalle({ slug: "kt", cotizacionId: 10 }));
    (boton(arbol, "Ver costeo registrado")!.props.onClick as () => void)();
    await vi.waitFor(() => expect(hooks.estados[0]).toBe("error"));
    expect(html(ejecutar(() => CosteoRegistradoDetalle({ slug: "kt", cotizacionId: 10 })))).toContain('role="alert"');
  });
});

describe("ResumenCosteo", () => {
  it("muestra los 8 valores del resumen y el detalle, y omite renglones en 0", () => {
    const r = resultadoReal(5600);
    const salida = renderToStaticMarkup(ResumenCosteo({ datos: resumenDesdeResultado(r) }));
    for (const valor of [r.costoOperativo, r.iva, r.costoConIva, r.precioSugerido, r.utilidadEstimada!]) expect(salida).toContain(monedaCosteo(valor));
    expect(salida).toContain("Q5,600.00"); expect(salida).toContain("20.00 %");
    expect(salida).not.toContain("Depreciación"); expect(salida).toContain("no se mezcla");
  });
});

describe("La página cablea el precio sugerido solo por la acción explícita", () => {
  const pagina = readFileSync("src/app/e/[slug]/cotizaciones/page.tsx", "utf8");
  it("aplicarPrecioSugerido solo se invoca desde onUsarPrecioSugerido (nunca en un efecto ni al calcular)", () => {
    expect(pagina.match(/aplicarPrecioSugerido\(/g)).toHaveLength(1);
    expect(pagina).toContain("onUsarPrecioSugerido={(precio) => setForm((f) => aplicarPrecioSugerido(f, precio))}");
  });
  it("el costeo viaja al guardar solo si hay un payload vigente, y se limpia al abrir/guardar", () => {
    expect(pagina).toContain("...(costeoPayload ? { costeo: costeoPayload } : {})");
    expect(pagina.match(/setCosteoPayload\(null\)/g)!.length).toBeGreaterThanOrEqual(3);
  });
  it("el listado normal no muestra costeo; solo el detalle expandido, y solo con permiso confirmado por el backend", () => {
    expect(pagina).toContain('{costeoConfig.estado === "listo" ? <CosteoRegistradoDetalle');
    const listado = pagina.slice(pagina.indexOf("{cotizaciones.map((c) => ("), pagina.indexOf("{expandidoId === c.id ? ("));
    expect(listado).not.toMatch(/costeo|utilidad|margen/i);
  });
});
