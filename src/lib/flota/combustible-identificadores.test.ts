import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { normalizarIdentificador, normalizarPlacaImportada } from "./combustible-identificadores";
import { normalizarIdentificador as identificadorParser, normalizarPlacaImportada as placaParser } from "./combustible-importacion-parser";
import { normalizarPlacaImportada as placaC2c, normalizarVale } from "./combustible-c2c-shared";

// Oráculos congelados de 20918664: no reutilizan el helper refactorizado.
const identificadorBase = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase();
const placaBase = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase().replace(/[‐‑–—]/g, "-").replace(/\s*-\s*/g, "-");
const valeBase = (s: string | null | undefined) => String(s ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase();

describe("mantenimiento de identificadores C-2B/C-2C", () => {
  it("conserva los resultados anteriores en un corpus Unicode determinista", () => {
    const partes = ["", "0", "001", "C", "p", "ñ", "n\u0303", "ß", "İ", "á", "\t", "\n", "\u00a0", " ", "-", "‐", "‑", "–", "—", "１２"];
    for (const a of partes) for (const b of partes) for (const c of ["", " 001abc ", "\tÑ-1\n"]) {
      const valor = `${a}${b}${c}`;
      expect(normalizarIdentificador(valor)).toBe(identificadorBase(valor));
      expect(identificadorParser(valor)).toBe(identificadorBase(valor));
      expect(normalizarPlacaImportada(valor)).toBe(placaBase(valor));
      expect(placaParser(valor)).toBe(placaBase(valor));
      expect(placaC2c(valor)).toBe(placaBase(valor));
      expect(normalizarVale(valor)).toBe(valeBase(valor));
    }
  });

  it("mantiene null/undefined y no confunde ceros ni prefijos", () => {
    for (const valor of [null, undefined, "", "00157301", "157301", "C-001", "001", "a-1", "a1"]) expect(normalizarVale(valor)).toBe(valeBase(valor));
    expect(normalizarVale("00157301")).not.toBe(normalizarVale("157301"));
    expect(placaC2c("C-001")).not.toBe(placaC2c("001"));
  });

  it("mantiene las exportaciones públicas apuntando al mismo helper puro", () => {
    expect(identificadorParser).toBe(normalizarIdentificador);
    expect(placaParser).toBe(normalizarPlacaImportada);
    expect(placaC2c).toBe(normalizarPlacaImportada);
  });

  it("el grafo runtime compartido con cliente no arrastra parser, crypto, BD ni ExcelJS", () => {
    const visitados = new Set<string>(), externos = new Set<string>();
    function recorrer(archivo: string) {
      if (visitados.has(archivo)) return;
      visitados.add(archivo);
      const ast = ts.createSourceFile(archivo, readFileSync(archivo, "utf8"), ts.ScriptTarget.Latest, true);
      for (const nodo of ast.statements) {
        if (!(ts.isImportDeclaration(nodo) || ts.isExportDeclaration(nodo)) || !nodo.moduleSpecifier || !ts.isStringLiteral(nodo.moduleSpecifier)) continue;
        if (ts.isImportDeclaration(nodo) ? nodo.importClause?.isTypeOnly : nodo.isTypeOnly) continue;
        const modulo = nodo.moduleSpecifier.text;
        if (modulo.startsWith(".")) recorrer(resolve(dirname(archivo), `${modulo}.ts`));
        else externos.add(modulo);
      }
    }
    recorrer(resolve("src/lib/flota/combustible-c2c-shared.ts"));
    expect([...visitados].map(p => p.replaceAll("\\", "/").split("/").pop()).sort()).toEqual(["combustible-c2c-shared.ts", "combustible-identificadores.ts"]);
    expect([...externos]).toEqual(["decimal.js"]);
  });
});
