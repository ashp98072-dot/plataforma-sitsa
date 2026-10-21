import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { perteneceAlTableroProgramacion } from "./programacion-client";
import ProgramacionPage from "./page";
import { tieneAuxiliaresVista, tienePilotoVista } from "@/lib/tms/programacion-personal-vista";

const src = readFileSync("src/app/e/[slug]/programacion/programacion-client.tsx", "utf8");
const sf = ts.createSourceFile("programacion.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function encontrar(predicate: (n: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  function visit(n: ts.Node) {
    if (predicate(n)) result = n;
    ts.forEachChild(n, visit);
  }
  visit(sf);
  if (!result) throw new Error("No se encontró el wiring esperado");
  return result;
}
function funcion(nombre: string) {
  return encontrar((n) => ts.isFunctionDeclaration(n) && n.name?.text === nombre).getText(sf);
}
function callback(nombre: string) {
  const decl = encontrar((n) => ts.isVariableDeclaration(n) && n.name.getText(sf) === nombre) as ts.VariableDeclaration;
  return ((decl.initializer as ts.CallExpression).arguments[0]).getText(sf);
}
function evaluar(code: string, context: Record<string, unknown>) {
  const js = ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(js, context);
}

const base = { estado: "Programado", piloto: "Juan", pilotoExtraNombre: null, placa: "P-001", cliente: "Cliente A", auxiliares: [], tipo_viaje: "Propio", vehiculo_solicitado_nombre: "Camión solicitado" };
const planes = [
  { ...base, id: 1, fecha_plan: "2026-09-30" },
  { ...base, id: 2, fecha_plan: "2026-10-01", tipo_viaje: "Tercerizado", piloto: null, placa: null, piloto_externo_nombre: "Externo", unidad_externa_placa: "EXT-1" },
  { ...base, id: 3, fecha_plan: "2026-10-02", estado: "En ruta", piloto: "Pilar", placa: "P-002", cliente: "Cliente B" },
  { ...base, id: 4, fecha_plan: "2026-10-03" },
  { ...base, id: 5, fecha_plan: "2026-09-29" },
  { ...base, id: 6, fecha_plan: "2026-10-01", estado: "Cerrado" },
];
const defaults = { desde: "2026-09-30", hasta: "2026-10-02", errorRango: null, esRangoExplicito: true, filtroRapido: "todos", fPiloto: "", fUnidad: "", fCliente: "" };
function visibles(overrides: Record<string, unknown> = {}) {
  const ctx = { ...defaults, ...overrides };
  const enRango = evaluar(callback("enRango"), { ...ctx, planes, perteneceAlTableroProgramacion })();
  return evaluar(callback("visibles"), {
    ...ctx, baseFiltroRapido: ctx.filtroRapido === "PendienteCierre" ? [planes[0], planes[1], planes[4]] : enRango,
    tieneAuxiliaresVista, tienePilotoVista,
  })() as typeof planes;
}

describe("Programación Rango — funciones reales de la pantalla", () => {
  it.each([
    [{}, [1, 2, 3]],
    [{ filtroRapido: "Programado" }, [1, 2]],
    [{ filtroRapido: "En ruta" }, [3]],
    [{ fPiloto: "Juan" }, [1]],
    [{ fUnidad: "P-001" }, [1]],
    [{ fCliente: "Cliente A" }, [1, 2]],
    [{ filtroRapido: "Programado", fPiloto: "Juan", fUnidad: "P-001", fCliente: "Cliente A" }, [1]],
    [{ filtroRapido: "PendienteCierre" }, [1, 2]],
    [{ desde: "2027-01-01", hasta: "2027-01-02" }, []],
    [{ errorRango: "Desde posterior a Hasta" }, []],
  ])("respeta rango/filtros %j", (filtros, ids) => {
    expect(visibles(filtros).map((p) => p.id)).toEqual(ids);
  });
  it("conserva Propio, Tercerizado y vehículo solicitado sin alterar filas", () => {
    expect(visibles()[0]).toBe(planes[0]);
    expect(visibles()[1]).toBe(planes[1]);
    expect(visibles()[0].vehiculo_solicitado_nombre).toBe("Camión solicitado");
  });
  it.each(["xlsx", "pdf"])("%s usa exactamente las fechas y filtros de pantalla", (formato) => {
    const qs = evaluar(funcion("reporteQueryString"), { ...defaults, URLSearchParams, filtroRapido: "PendienteCierre", fPiloto: "Juan", fUnidad: "P-001", fCliente: "Cliente A" })(formato);
    expect(Object.fromEntries(new URLSearchParams(qs))).toEqual({ formato, fechaDesde: defaults.desde, fechaHasta: defaults.hasta, rango: "1", estado: "PendienteCierre", piloto: "Juan", unidad: "P-001", cliente: "Cliente A" });
    const legacy = evaluar(funcion("reporteQueryString"), { ...defaults, URLSearchParams, esRangoExplicito: false })(formato);
    expect(new URLSearchParams(legacy).has("rango")).toBe(false);
  });
  it("PNG/JPG usa las mismas filas visibles y bloquea un rango inválido", async () => {
    expect(funcion("exportarImagen")).toContain("visibles.map((p)");
    expect(funcion("exportarImagen")).toContain('filtroRapido === "PendienteCierre" && !esRangoExplicito');
    const setExportandoImagen = vi.fn();
    await evaluar(funcion("exportarImagen"), { exportacionBloqueada: true, setExportandoImagen })("png");
    expect(setExportandoImagen).not.toHaveBeenCalled();
    expect(src).toContain("disabled={exportandoImagen || exportacionBloqueada}");
    expect(src).toContain('href={exportacionBloqueada ? undefined');
  });
  it("no exporta un conjunto anterior/truncado aunque un finally viejo quite loading", () => {
    const decl = encontrar((n) => ts.isVariableDeclaration(n) && n.name.getText(sf) === "exportacionBloqueada") as ts.VariableDeclaration;
    const code = decl.initializer!.getText(sf);
    const ctx = { ...defaults, loading: false, err: "", rangoCompleto: null };
    expect(evaluar(code, ctx)).toBe(true);
    expect(evaluar(code, { ...ctx, rangoCompleto: "2026-09-30/2026-10-02" })).toBe(false);
    expect(evaluar(code, { ...ctx, rangoCompleto: "2026-09-30/2026-10-01" })).toBe(true);
    expect(evaluar(code, { ...ctx, esRangoExplicito: false })).toBe(false);
  });
  it.each(["hoy", "semana", "rango"])("seleccionar %s pasa por confirmación y sincroniza la URL", (key) => {
    const handler = encontrar((n) => ts.isJsxAttribute(n) && n.name.getText(sf) === "onClick" && n.getText(sf).includes("setRango(key)")) as ts.JsxAttribute;
    const code = ((handler.initializer as ts.JsxExpression).expression!).getText(sf);
    for (const permitir of [false, true]) {
      const setRango = vi.fn(); const actualizarUrlRango = vi.fn();
      const intervalo = { desde: "2026-09-30", hasta: "2026-10-02" };
      const setLoading = vi.fn();
      evaluar(code, { key, rango: "hoy", intervalo, setRango, setLoading, actualizarUrlRango, setAvisoRango: vi.fn(), siSePuedenPerderCambios: (f: () => void) => { if (permitir) f(); } })();
      expect(setRango).toHaveBeenCalledTimes(permitir ? 1 : 0);
      expect(setLoading).toHaveBeenCalledTimes(permitir && key === "rango" ? 1 : 0);
      if (permitir) expect(actualizarUrlRango).toHaveBeenCalledWith(key === "rango" ? intervalo : null);
      else expect(actualizarUrlRango).not.toHaveBeenCalled();
    }
  });
  it("invalidar impide nuevas cargas y descarta respuestas anteriores con la secuencia existente", async () => {
    const obtenerProgramacion = vi.fn(); const iniciar = vi.fn(); const setLoading = vi.fn();
    await evaluar(funcion("ejecutarRefresh"), { errorRango: "Inválido", obtenerProgramacion, secuenciaCargas: { current: { iniciar } }, setLoading })(false);
    expect(obtenerProgramacion).not.toHaveBeenCalled();
    expect(iniciar).toHaveBeenCalledTimes(1);
    expect(setLoading).toHaveBeenCalledWith(false);
  });
  it("GET normal y pendientes comparten los extremos solo en Rango", async () => {
    for (const explicito of [false, true]) {
      const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ planes: [] }) });
      await evaluar(funcion("obtenerProgramacion"), { fetch })("tenant", defaults.desde, defaults.hasta, explicito);
      expect(fetch).toHaveBeenCalledTimes(2);
      const urls = fetch.mock.calls.map(([u]) => new URL(u, "http://local"));
      expect(urls[0].searchParams.get("rango")).toBe(explicito ? "1" : null);
      expect(urls[1].searchParams.get("fechaDesde")).toBe(explicito ? defaults.desde : null);
      expect(urls[1].searchParams.get("fechaHasta")).toBe(explicito ? defaults.hasta : null);
    }
  });
  it.each([false, true])("un fallo de pendientes no certifica el Rango; compatibilidad anterior=%s", async (explicito) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ planes: [] }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Pendientes no disponibles" }) });
    const result = await evaluar(funcion("obtenerProgramacion"), { fetch })("tenant", defaults.desde, defaults.hasta, explicito);
    expect(result.ok).toBe(!explicito);
    if (explicito) expect(result.error).toBe("Pendientes no disponibles");
    else expect(result.datos.pendientesCierre).toEqual([]);
  });
  it("inputs son obligatorios, muestran error y no cambian el borrador sin confirmación", () => {
    const handler = encontrar((n) => ts.isJsxAttribute(n) && n.name.getText(sf) === "onChange" && n.getText(sf).includes("setIntervalo(nuevo)")) as ts.JsxAttribute;
    const code = ((handler.initializer as ts.JsxExpression).expression!).getText(sf);
    const setIntervalo = vi.fn(); const actualizarUrlRango = vi.fn();
    evaluar(code, { extremo: "hasta", intervalo: defaults, setIntervalo, actualizarUrlRango, setAvisoRango: vi.fn(), siSePuedenPerderCambios: () => undefined })({ target: { value: "2026-10-04" } });
    expect(setIntervalo).not.toHaveBeenCalled();
    expect(actualizarUrlRango).not.toHaveBeenCalled();
    expect(src).toContain('aria-describedby={errorRango ? "error-rango-programacion" : undefined}');
    expect(src).toContain('role="alert"');
    expect(src).toMatch(/type="date"\s+required/);
  });
  it("recargar la página pasa el rango de la URL al estado inicial, sin perder plan", async () => {
    const page = await ProgramacionPage({ params: Promise.resolve({ slug: "tenant" }), searchParams: Promise.resolve({ plan: "31", desde: "2026-12-31", hasta: "2027-01-02" }) });
    expect(page.props.rangoInicial).toEqual({ desde: "2026-12-31", hasta: "2027-01-02" });
    expect(page.props.planInicialId).toBe(31);
    expect(src).toContain('useState<Rango>(rangoInicial ? "rango" : "manana")');
    expect(src).toContain('useState<IntervaloProgramacion>(rangoInicial ?? { desde: hoy, hasta: hoy })');
    const legacy = await ProgramacionPage({ params: Promise.resolve({ slug: "tenant" }), searchParams: Promise.resolve({}) });
    expect(legacy.props.rangoInicial).toBeUndefined();
  });
});
