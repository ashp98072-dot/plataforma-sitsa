import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ruta = "src/app/e/[slug]/rrhh/vacaciones/page.tsx";
const baseSHA = "303ef2720c98f67d94d5368d16bcdcf87cb7f478";
const textoHead = readFileSync(ruta, "utf8");
const normalizar = (s: string) => s.replace(/\r\n/g, "\n");
let textoBase: string | null = null;
try { textoBase = execFileSync("git", ["show", `${baseSHA}:${ruta}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
catch { /* Shallow: no hacer fetch desde una prueba. El wiring HEAD se verifica igualmente. */ }

type Emp = { id: number; codigo: string; nombre: string; dpi: string };
async function ejecutarCarga(texto: string, empleados: Emp[], empleadoId: number) {
  const source = ts.createSourceFile("page.tsx", texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Node | undefined;
  function visitar(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === "cargarEmpleados" && n.initializer && ts.isCallExpression(n.initializer)) {
      callback = n.initializer.arguments[0];
      expect(n.initializer.arguments[1].getText(source)).toBe("[slug, empleadoId]");
    }
    ts.forEachChild(n, visitar);
  }
  visitar(source);
  if (!callback) throw new Error("No se encontró cargarEmpleados");
  const javascript = ts.transpileModule(`exports.cargar = ${callback.getText(source)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const eventos: unknown[] = [], urls: string[] = [];
  const exports = {} as { cargar: () => Promise<void> };
  runInNewContext(javascript, { exports, slug: "empresa", empleadoId,
    fetch: async (url: string) => { urls.push(url); return { json: async () => ({ empleados }) }; },
    setEmpleados: (lista: Emp[]) => eventos.push(["empleados", lista.map(({ id, codigo, nombre, dpi }) => ({ id, codigo, nombre, dpi }))]),
    setEmpleadoId: (id: number) => eventos.push(["seleccion", id]),
  });
  await exports.cargar();
  return { eventos, urls };
}

describe("Vacaciones — wiring del catálogo ligero", () => {
  it("un solo request de catálogo; mismo orden de lista y selección inicial", async () => {
    const empleados = [{ id: 9, codigo: "H9", nombre: "Histórico", dpi: "123" }, { id: 2, codigo: "A2", nombre: "Activo", dpi: "456" }];
    expect(await ejecutarCarga(textoHead, empleados, 0)).toEqual({
      urls: ["/api/empresas/empresa/rrhh/vacaciones/empleados"],
      eventos: [["empleados", empleados], ["seleccion", 9]],
    });
  });

  it.skipIf(!textoBase)("la página completa permanece idéntica salvo la URL del catálogo", () => {
    expect(normalizar(textoHead).replace("/rrhh/vacaciones/empleados`", "/empleados`"))
      .toBe(normalizar(textoBase!));
  });

  it.each([
    { empleados: [], seleccionado: 0 },
    { empleados: [{ id: 7, codigo: "H7", nombre: "Baja", dpi: "" }], seleccionado: 0 },
    { empleados: [{ id: 7, codigo: "H7", nombre: "Baja", dpi: "" }], seleccionado: 7 },
    { empleados: [{ id: 8, codigo: "A8", nombre: "Activo", dpi: "123" }], seleccionado: 7 },
    { empleados: [], seleccionado: 7 },
  ])("mismos eventos de carga/selección que BASE: caso %#", async ({ empleados, seleccionado }) => {
    const head = await ejecutarCarga(textoHead, empleados, seleccionado);
    expect(head.urls).toHaveLength(1);
    if (textoBase) {
      const base = await ejecutarCarga(textoBase, empleados.map((e) => ({ ...e, docsCount: 5, tieneFoto: true })), seleccionado);
      expect(head.eventos).toEqual(base.eventos);
      expect(base.urls).toEqual(["/api/empresas/empresa/empleados"]);
    }
  });
});
