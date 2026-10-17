import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const src = readFileSync("src/app/e/[slug]/planes/planes-viajes-client.tsx", "utf8");
const sf = ts.createSourceFile("planes.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function encontrar(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (predicate(node)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!found) throw new Error("Wiring de Planes no encontrado");
  return found;
}
const llamada = encontrar((n) => ts.isCallExpression(n) && n.expression.getText(sf) === "useEffect"
  && n.arguments[0]?.getText(sf).includes("setClientesCat")) as ts.CallExpression;

// Efecto BASE: contrato anterior con /tms/catalogos (sin importar el componente React completo).
const baseEffect = `() => {
  fetch(\`/api/empresas/\${slug}/tms/catalogos\`)
    .then((r) => r.json())
    .then((data) => {
      setClientesCat(data.clientes ?? []);
      setUnidadesCat(data.unidades ?? []);
      setPilotosCat((data.personal ?? []).filter((p) => p.tipo === "Piloto"));
    }).catch(() => undefined);
}`;
async function ejecutarEfecto(code: string, datos: unknown, slug = "tenant", fallo = false) {
  const state: Record<string, unknown> = {};
  const fetch = vi.fn().mockImplementation(() => fallo
    ? Promise.reject(new Error("offline")) : Promise.resolve({ json: async () => datos }));
  const js = ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const effect = runInNewContext(js, {
    slug, fetch,
    setClientesCat: (v: unknown) => { state.clientes = v; },
    setUnidadesCat: (v: unknown) => { state.unidades = v; },
    setPilotosCat: (v: unknown) => { state.pilotos = v; },
  });
  effect();
  expect(state).toEqual({}); // El catálogo no cambia el estado antes de resolver fetch/json.
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { state, fetch };
}

describe("Planes — consumo ligero sin cambiar filtros", () => {
  it("aplica las mismas opciones y una sola petición por ejecución del efecto", async () => {
    const clientes = [{ id: 3, nombre: "Cliente histórico" }];
    const unidades = [{ id: 50, placa: "P-123" }];
    const pilotos = [{ id: 5, nombre: "Piloto inactivo" }];
    const base = await ejecutarEfecto(baseEffect, { clientes, unidades, personal: [
      { ...pilotos[0], tipo: "Piloto" }, { id: 6, nombre: "Auxiliar", tipo: "Auxiliar" },
    ] });
    const head = await ejecutarEfecto(llamada.arguments[0].getText(sf), { clientes, unidades, pilotos });
    expect(head.state).toEqual({ clientes: base.state.clientes, unidades: base.state.unidades, pilotos });
    expect(base.fetch).toHaveBeenCalledTimes(1);
    expect(head.fetch).toHaveBeenCalledExactlyOnceWith("/api/empresas/tenant/tms/planes/catalogos");
    // Ni filtros seleccionados ni listado/paginación/exportación se escriben desde este efecto.
    const setters = llamada.arguments[0].getText(sf).match(/\bset\w+(?=\()/g);
    expect(setters).toEqual(["setClientesCat", "setUnidadesCat", "setPilotosCat"]);
  });

  it("conserva fallback vacío y comportamiento ante error", async () => {
    for (const fallo of [false, true]) {
      const base = await ejecutarEfecto(baseEffect, {}, "tenant", fallo);
      const head = await ejecutarEfecto(llamada.arguments[0].getText(sf), {}, "tenant", fallo);
      expect(head.state).toEqual(base.state);
    }
  });

  it("recarga el catálogo por slug, no por filtros; usa la nueva empresa en la URL", async () => {
    expect(llamada.arguments[1].getText(sf)).toBe("[slug]");
    const head = await ejecutarEfecto(llamada.arguments[0].getText(sf), {}, "otra-empresa");
    expect(head.fetch).toHaveBeenCalledExactlyOnceWith("/api/empresas/otra-empresa/tms/planes/catalogos");
    expect(src).not.toContain("fetch(`/api/empresas/${slug}/tms/catalogos`)");
  });

  it("conserva ids y todos los filtros compartidos con Excel, incluso ruta libre/facturación/cobro", () => {
    const declaration = encontrar((n) => ts.isVariableDeclaration(n) && n.name.getText(sf) === "filtrosQueryString") as ts.VariableDeclaration;
    const callback = (declaration.initializer as ts.CallExpression).arguments[0];
    const js = ts.transpileModule(`(${callback.getText(sf)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const values = {
      URLSearchParams, planFocoId: null,
      fDesde: "2026-10-01", fHasta: "2026-10-17", fCliente: "3", fPiloto: "5", fUnidad: "50",
      fEstado: "En ruta", fRuta: "  XELA  ", fEstadoFacturacion: "Facturado", fEstadoCobro: "Pendiente",
      soloPendientes: false, soloCerrados: false, soloSinCerrar: true,
    };
    const query = runInNewContext(js, values)();
    expect(Object.fromEntries(query)).toEqual({
      fechaDesde: values.fDesde, fechaHasta: values.fHasta, clienteId: "3", pilotoId: "5", unidadId: "50",
      estado: "En ruta", ruta: "XELA", estadoFacturacion: "Facturado", estadoCobro: "Pendiente", soloSinCerrar: "1",
    });
    expect(src).toContain('exportQueryString = useCallback(() => filtrosQueryString().toString()');
    expect(src).toContain('/tms/reportes/viajes/export?formato=xlsx&vista=planes&${filtrosQueryString().toString()}');
    expect(src).toContain('resaltadoDesdeParams(searchParams)');
    expect(Object.fromEntries(runInNewContext(js, { ...values, planFocoId: 31 })())).toEqual({ planId: "31" });
  });

  it("limpiar conserva los resets existentes de los seis filtros y la pestaña operativa", () => {
    const limpiar = encontrar((n) => ts.isFunctionDeclaration(n) && n.name?.text === "limpiarFiltros");
    const code = limpiar.getText(sf);
    for (const setter of ["setFCliente", "setFPiloto", "setFUnidad", "setFRuta", "setFEstadoFacturacion", "setFEstadoCobro"]) {
      expect(code).toContain(`${setter}("")`);
    }
    expect(code).toContain("aplicarFiltrosDeVista(vista)");
    expect(code).toContain("setPlanFocoId(null)");
  });
});
