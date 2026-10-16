import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { ReactElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ruta = "src/components/flota/vehiculo-documentos.tsx";
// Nodo JSX original de 31338b251d2fbdaabc5476820ec81f658f7fdffd, incluidas sus líneas/espacios.
const BASE_JSX = "\n                Título (para \"Otro\")\n                ";

function textoJsxActual(): string {
  const ast = ts.createSourceFile(ruta, readFileSync(ruta, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const textos: string[] = [];
  function visitar(nodo: ts.Node) {
    if (ts.isJsxText(nodo) && nodo.text.includes("Título (para ")) textos.push(nodo.getFullText(ast));
    ts.forEachChild(nodo, visitar);
  }
  visitar(ast);
  if (textos.length !== 1) throw new Error("Se esperaba un único nodo JSX del título para Otro.");
  return textos[0];
}

function representar(jsx: string) {
  const contexto = {
    exports: {} as { texto?: ReactElement<{ children: string }> },
    require: (id: string) => {
      if (id !== "react/jsx-runtime") throw new Error("Import no permitido en la prueba de texto.");
      return jsxRuntime;
    },
  };
  const { outputText } = ts.transpileModule(`export const texto = <>${jsx}</>;`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  });
  runInNewContext(outputText, contexto, { timeout: 1000 });
  const elemento = contexto.exports.texto;
  if (!elemento) throw new Error("No se generó el fragmento React.");
  return { texto: elemento.props.children, html: renderToStaticMarkup(elemento) };
}

describe("VehiculoDocumentos — escape JSX sin cambios visibles", () => {
  it("congela el texto y HTML renderizado originales, con comillas ASCII y espacios exactos", () => {
    expect(representar(BASE_JSX)).toEqual({
      texto: 'Título (para "Otro")',
      html: "Título (para &quot;Otro&quot;)",
    });
  });

  it("el nodo real del componente renderiza exactamente lo mismo que BASE", () => {
    expect(representar(textoJsxActual())).toEqual(representar(BASE_JSX));
  });
});
