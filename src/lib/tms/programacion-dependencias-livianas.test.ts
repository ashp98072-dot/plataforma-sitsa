import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { textoCuadrilla } from "./cuadrilla-presentacion";
import { MAX_FILAS_EDICION_RAPIDA } from "./edicion-rapida-limites";
import * as cuadrilla from "./cuadrilla-contrato";
import * as edicion from "./edicion-rapida-schema";

const BASE = "9373adf493d7aaa27668bbeeb02fda9288ef2396";
const rutaCuadrilla = "src/lib/tms/cuadrilla-contrato.ts";
const rutaEdicion = "src/lib/tms/edicion-rapida-schema.ts";
const rutaCliente = "src/app/e/[slug]/programacion/programacion-client.tsx";
const rutaHelpers = "src/app/e/[slug]/programacion/edicion-rapida-helpers.ts";
const leer = (ruta: string) => readFileSync(ruta, "utf8");
const parsear = (texto: string) => ts.createSourceFile("modulo.tsx", texto.replace(/\r\n/g, "\n"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const emitir = (texto: string) => ts.transpileModule(texto, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function historico(ruta: string): string | null {
  try { return execFileSync("git", ["show", `${BASE}:${ruta}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; } // Checkout shallow: los contratos HEAD siguen ejecutándose, sin fetch desde tests.
}
const baseCuadrilla = historico(rutaCuadrilla);
const baseEdicion = historico(rutaEdicion);

/** Evalúa los esquemas BASE reales con la MISMA versión de Zod, sin BD ni API. */
function ejecutarBase<T>(texto: string): T {
  const exports = {};
  runInNewContext(emitir(texto), { exports, require: (nombre: string) => {
    if (nombre !== "zod") throw new Error(`Import inesperado en contrato BASE: ${nombre}`);
    return { z };
  } });
  return exports as T;
}

function variables(texto: string) {
  const fuente = parsear(texto);
  return fuente.statements.filter(ts.isVariableStatement)
    .filter((s) => !s.declarationList.declarations.some((d) => d.name.getText(fuente) === "MAX_FILAS_EDICION_RAPIDA"))
    .map((s) => s.getText(fuente));
}

function grafoInicial(inicio: string) {
  const paquetes = new Set<string>();
  const archivos = new Set<string>();
  function visitar(ruta: string) {
    if (archivos.has(ruta)) return;
    archivos.add(ruta);
    const fuente = parsear(leer(ruta));
    for (const nodo of fuente.statements) {
      if (!ts.isImportDeclaration(nodo) && !ts.isExportDeclaration(nodo)) continue;
      if (!nodo.moduleSpecifier || !ts.isStringLiteral(nodo.moduleSpecifier)) continue;
      if (ts.isExportDeclaration(nodo) && nodo.isTypeOnly) continue;
      if (ts.isImportDeclaration(nodo)) {
        if (nodo.importClause?.isTypeOnly) continue;
        const bindings = nodo.importClause?.namedBindings;
        if (!nodo.importClause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every((e) => e.isTypeOnly)) continue;
      }
      const nombre = nodo.moduleSpecifier.text;
      if (!nombre.startsWith(".") && !nombre.startsWith("@/")) { paquetes.add(nombre); continue; }
      const base = nombre.startsWith("@/") ? resolve("src", nombre.slice(2)) : resolve(dirname(ruta), nombre);
      const destino = [base + ".ts", base + ".tsx", resolve(base, "index.ts"), resolve(base, "index.tsx")].find(existsSync);
      if (!destino) throw new Error(`Import local no resuelto: ${nombre}`);
      visitar(destino);
    }
  }
  visitar(resolve(inicio));
  return { paquetes, archivos };
}

describe("Programación: dependencias iniciales livianas", () => {
  it("los módulos extraídos no emiten imports runtime y conservan sus reexports", () => {
    for (const ruta of ["src/lib/tms/cuadrilla-presentacion.ts", "src/lib/tms/edicion-rapida-limites.ts"]) {
      expect(emitir(leer(ruta))).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
    }
    expect(cuadrilla.textoCuadrilla).toBe(textoCuadrilla);
    expect(edicion.MAX_FILAS_EDICION_RAPIDA).toBe(MAX_FILAS_EDICION_RAPIDA);
    expect(MAX_FILAS_EDICION_RAPIDA).toBe(200);
  });

  it("ninguna cadena estática inicial del proyecto alcanza Zod ni los formularios diferidos", () => {
    const { paquetes, archivos } = grafoInicial(rutaCliente);
    expect(paquetes.has("zod")).toBe(false);
    expect(archivos.has(resolve(rutaCuadrilla))).toBe(false);
    expect(archivos.has(resolve(rutaEdicion))).toBe(false);
    expect(archivos.has(resolve("src/app/e/[slug]/programacion/plan-form.tsx"))).toBe(false);
    expect(archivos.has(resolve("src/app/e/[slug]/programacion/edicion-rapida.tsx"))).toBe(false);
  });

  it.each(([[], ["INTERNO"], ["EXTERNO"], ["INTERNO", "EXTERNO", "INTERNO"]] as const).map((tipos) => ({ tipos })))("mismos textos y orden: %j", ({ tipos }) => {
    const filas = tipos.map((tipo, i) => ({ tipo, empleadoId: tipo === "INTERNO" ? i + 1 : null, nombre: ` José ${i}\nÁlvarez `, identificacion: "DPI no visible", telefono: "123" }));
    const esperado = filas.map((f) => `${f.nombre} (${f.tipo === "INTERNO" ? "interno" : "externo"})`).join("\n");
    expect(textoCuadrilla(filas)).toBe(esperado);
    if (baseCuadrilla) expect(textoCuadrilla(filas)).toBe(ejecutarBase<typeof cuadrilla>(baseCuadrilla).textoCuadrilla(filas));
  });
});

describe.skipIf(!baseCuadrilla || !baseEdicion)("Equivalencia con BASE exacta (requiere objeto Git)", () => {
  it("todas las declaraciones de validación siguen textualmente intactas", () => {
    expect(variables(leer(rutaCuadrilla))).toEqual(variables(baseCuadrilla!));
    expect(variables(leer(rutaEdicion))).toEqual(variables(baseEdicion!));
    const obtenerFuncion = (texto: string) => parsear(texto).statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === "textoCuadrilla")!.getText();
    expect(emitir(obtenerFuncion(leer("src/lib/tms/cuadrilla-presentacion.ts"))))
      .toBe(emitir(obtenerFuncion(baseCuadrilla!)));
    expect(ejecutarBase<typeof edicion>(baseEdicion!).MAX_FILAS_EDICION_RAPIDA).toBe(MAX_FILAS_EDICION_RAPIDA);
  });

  it.each([rutaCliente, rutaHelpers])("%s: fuera de imports no cambia ninguna instrucción", (ruta) => {
    const antes = historico(ruta)!;
    const cuerpo = (texto: string) => parsear(texto).statements.filter((s) => !ts.isImportDeclaration(s)).map((s) => s.getText());
    expect(cuerpo(leer(ruta))).toEqual(cuerpo(antes));
  });

  it.each([
    [], [{ tipo: "INTERNO", empleadoId: 1 }], [{ tipo: "EXTERNO", nombre: "  José  " }],
    [{ tipo: "EXTERNO", nombre: "" }], [{ tipo: "INTERNO", empleadoId: 0 }],
    [{ tipo: "INTERNO", empleadoId: 1, nombre: "No confiar" }],
    [{ tipo: "EXTERNO", nombre: "Ana", empleadoId: 2 }],
    [{ tipo: "INTERNO", empleadoId: 1 }, { tipo: "INTERNO", empleadoId: 1 }],
    Array.from({ length: 200 }, (_, i) => ({ tipo: "INTERNO", empleadoId: i + 1 })),
    Array.from({ length: 201 }, (_, i) => ({ tipo: "INTERNO", empleadoId: i + 1 })),
  ].map((entrada) => ({ entrada })))("Cuadrilla real BASE/HEAD: caso %#", ({ entrada }) => {
    const anterior = ejecutarBase<typeof cuadrilla>(baseCuadrilla!);
    const resultado = (schema: typeof cuadrilla.cuadrillaSchema) => JSON.stringify(schema.safeParse(entrada));
    expect(resultado(cuadrilla.cuadrillaSchema)).toBe(resultado(anterior.cuadrillaSchema));
  });

  it.each([0, 1, 200, 201])("Edición rápida real BASE/HEAD: %i filas y mensajes idénticos", (n) => {
    const cambios = Array.from({ length: n }, (_, i) => ({ planId: i + 1,
      esperado: { estado: "Programado", fechaPlan: "2026-10-19", horaCarga: null, regresoEstimado: null, pilotoPersonalId: null, auxiliarPersonalIds: [], flotaVehiculoId: null, tcVehiculoId: null },
      nuevo: { pilotoPersonalId: null, auxiliarPersonalIds: [], flotaVehiculoId: null, tcVehiculoId: null },
    }));
    const anterior = ejecutarBase<typeof edicion>(baseEdicion!);
    const resultado = (schema: typeof edicion.validarEdicionRapidaSchema) => JSON.stringify(schema.safeParse({ cambios }));
    expect(resultado(edicion.validarEdicionRapidaSchema)).toBe(resultado(anterior.validarEdicionRapidaSchema));
    expect(edicion.validarEdicionRapidaSchema.safeParse({ cambios }).success).toBe(n > 0 && n <= 200);
  });
});
