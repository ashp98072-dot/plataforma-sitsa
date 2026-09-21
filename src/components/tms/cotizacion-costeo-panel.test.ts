import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
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
import { CotizacionCosteoPanel, ResumenCosteo, useCosteoConfig, type ConfigCosteo, type CotizacionCosteoPanelProps } from "./cotizacion-costeo-panel";
import { calcularCosteoServicio } from "@/lib/tms/cotizacion-costeo";
import { COSTEO_FORM_VACIO, monedaCosteo, resumenDesdeResultado } from "@/lib/tms/cotizacion-costeo-ui";

const fetchMock = vi.fn();
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
      ejecutar(() => useCosteoConfig("kt")); hooks.efectos[0]();
      await vi.waitFor(() => expect(hooks.estados[0]).toEqual({ estado: "sin-permiso" }));
      expect(fetchMock.mock.calls[0][0]).toBe("/api/empresas/kt/tms/cotizaciones/costeo/config");
    }
  });
  it("useCosteoConfig: 200 => listo con perfiles y margen; 409 (sin parámetros) => error visible dentro de la sección; sin permiso jamás", async () => {
    fetchMock.mockImplementation(() => respuesta({ perfiles: LISTO.perfiles, parametros: { vigenteDesde: "2026-09-21", margenObjetivo: 0.2 } }));
    ejecutar(() => useCosteoConfig("kt")); hooks.efectos[0]();
    await vi.waitFor(() => expect(hooks.estados[0]).toMatchObject({ estado: "listo", margenObjetivo: 0.2, vigenteDesde: "2026-09-21" }));
    hooks.estados = []; fetchMock.mockReset();
    fetchMock.mockImplementation(() => respuesta({ error: "No hay parámetros de costeo vigentes para la fecha indicada." }, false, 409));
    ejecutar(() => useCosteoConfig("kt")); hooks.efectos[0]();
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
    expect(pagina).toContain("useCosteoConfig(slug)"); expect(pagina).toContain('costeoConfig.estado === "listo"');
    expect(pagina).not.toMatch(/costeoConfig[^\n]*setError|setError[^\n]*costeoConfig/);
  });
});

describe("Sección COSTEO INTERNO (con permiso)", () => {
  it("se diferencia de la parte comercial y muestra todos los campos pedidos", () => {
    const salida = html(ejecutar(() => CotizacionCosteoPanel(props())));
    for (const v of ["Costeo interno", "Confidencial", "no aparece en el PDF ni en el listado", "Perfil de unidad", "Distancia (km)", "Días de servicio", "Pilotos", "Auxiliares", "Guías",
      "Incluir GPS", "Incluir seguro del vehículo", "Seguro de mercadería (Q)", "Usar refrigeración", "Viático piloto total (Q)", "Viático auxiliar total (Q)", "Viático guía total (Q)",
      "Hotel total (Q)", "Otros costos", "Margen objetivo (%)", "Calcular costeo", "border-amber-500/50", "Cabezal"]) expect(salida).toContain(v);
    // La tarifa comercial NO es un input del costeo.
    expect(salida).not.toContain("Tarifa cotizada");
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
    expect(cuerpo).toEqual({ perfilId: 4, distanciaKm: 600, diasServicio: 1, cantidadPilotos: 2, cantidadAuxiliares: 2, cantidadGuias: 0, incluirGps: true, incluirSeguroVehiculo: true, usarRefrigeracion: false, fechaEmision: "2026-09-21", tarifaCotizada: 5000, incluyeIva: false });
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

describe("Cotización que ya tiene costeo: registro inmutable", () => {
  it("con snapshot: mensaje, solo lectura (sin formulario ni botón Calcular) y nada que guardar", async () => {
    const snap = { perfilNombre: "Cabezal", motorVersion: "COSTEO_V1", creadoEn: "2026-09-21 10:00:00", ...resumenDesdeResultado(resultadoReal(5600)) };
    fetchMock.mockImplementation(() => respuesta({ costeo: snap }));
    const p = props({ cotizacionId: 10 });
    ejecutar(() => CotizacionCosteoPanel(p)); hooks.efectos[1]();
    await vi.waitFor(() => expect(hooks.estados[5]).toMatchObject({ motorVersion: "COSTEO_V1" }));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/empresas/kt/tms/cotizaciones/10/costeo");
    const arbol = ejecutar(() => CotizacionCosteoPanel(p));
    const salida = html(arbol);
    expect(salida).toContain("Esta cotización ya tiene un costeo registrado."); expect(salida).toContain("COSTEO_V1"); expect(salida).toContain("Resumen de costeo");
    expect(boton(arbol, "Calcular costeo")).toBeUndefined(); expect(salida).not.toContain("Perfil de unidad");
    hooks.efectos[0](); expect(p.onPayloadGuardar).toHaveBeenLastCalledWith(null);
  });
  it("cotización existente SIN snapshot (404): se puede costear normalmente", async () => {
    fetchMock.mockImplementation(() => respuesta({ error: "Esta cotización no tiene costeo registrado." }, false, 404));
    const p = props({ cotizacionId: 10 });
    ejecutar(() => CotizacionCosteoPanel(p)); hooks.efectos[1]();
    await vi.waitFor(() => expect(hooks.estados[5]).toBeNull());
    expect(boton(ejecutar(() => CotizacionCosteoPanel(p)), "Calcular costeo")).toBeDefined();
  });
  it("un alta (sin id) no consulta ningún snapshot", () => {
    ejecutar(() => CotizacionCosteoPanel(props())); hooks.efectos[1]();
    expect(fetchMock).not.toHaveBeenCalled();
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
