import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { configSchema } from "next/dist/server/config-schema";
import { defaultConfig } from "next/dist/server/config-shared";
import nextConfig from "../next.config";

const require = createRequire(import.meta.url);
const nextPackage = JSON.parse(readFileSync(require.resolve("next/package.json"), "utf8"));
const buildSource = readFileSync(require.resolve("next/dist/build/index.js"), "utf8");
const source = ts.createSourceFile("next-build.js", buildSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const selector = source.statements.find((s): s is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(s) && s.name?.text === "getNumberOfWorkers");
if (!selector) throw new Error("Cambió el selector de workers de Next: revisar compatibilidad antes de actualizar.");

/** Ejecuta el selector REAL instalado, sin editarlo ni cargar el build completo. */
function selectorNext(defaultCpus: number) {
  return runInNewContext(`(${selector!.getText(source)})`, {
    _configshared: { defaultConfig: { experimental: { ...defaultConfig.experimental, cpus: defaultCpus } } },
    _os: { default: { freemem: () => 64 * 1e9 } },
  }) as (config: { experimental: Record<string, unknown> }, maxTasks?: number) => number;
}

describe("Hostinger — límite de build verificado en Next 16.4.1", () => {
  it("la versión fijada y el esquema OFICIAL aceptan cpus=1 sin opciones desconocidas", () => {
    expect(nextPackage.version).toBe("16.4.1");
    expect(configSchema.safeParse(nextConfig).success).toBe(true);
    expect(nextConfig.experimental?.cpus).toBe(1);
  });

  it.each([11, 63])("el selector real cambia %i workers predeterminados a uno", (cpus) => {
    const seleccionar = selectorNext(cpus);
    const base = { experimental: { ...defaultConfig.experimental, cpus } };
    const head = { experimental: { ...base.experimental, ...nextConfig.experimental } };
    expect(seleccionar(base, 1000)).toBe(cpus);
    expect(seleccionar(head, 1000)).toBe(1);
    expect(seleccionar(head, 54)).toBe(1);
    expect(seleccionar(head, 1)).toBe(1);
  });

  it("no depende de que el default sea mayor que uno", () => {
    expect(selectorNext(1)({ experimental: { ...defaultConfig.experimental, ...nextConfig.experimental } }, 54)).toBe(1);
  });

  it("mantiene loaders, servidor, headers/compresión y comando de build", () => {
    expect(nextConfig.experimental).toEqual({ cpus: 1, turbopackPluginRuntimeStrategy: "workerThreads" });
    expect(nextConfig.compress).toBe(false);
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(nextConfig.serverExternalPackages).toEqual(["exceljs", "pdfkit"]);
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.build).toBe("next build");
    expect(pkg.dependencies.next).toBe("16.4.1");
  });
});
