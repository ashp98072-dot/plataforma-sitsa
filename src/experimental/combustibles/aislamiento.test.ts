import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { expect, it } from "vitest";

it("cierra el grafo del prototipo a contratos/fixtures/React/Zod, sin DB ni servicios", () => {
  const dir = resolve("src/experimental/combustibles");
  const permitidos = new Set(["react", "zod", "./contratos", "./fixtures"]);
  for (const file of ["contratos.ts", "fixtures.ts", "prototipo.tsx"]) {
    const source = readFileSync(join(dir, file), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(m => m[1]);
    for (const imported of imports) expect(permitidos.has(imported), `${file}: ${imported}`).toBe(true);
    expect(source).not.toMatch(/\b(fetch|XMLHttpRequest|indexedDB|localStorage|sessionStorage|require|eval)\b|import\s*\(|["']use server["']/);
  }
});
it("ningún módulo operativo incorpora el laboratorio directa o indirectamente", () => {
  function revisar(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "experimental") revisar(path);
      else if (/\.[cm]?[jt]sx?$/.test(path)) expect(readFileSync(path, "utf8"), path).not.toMatch(/experimental\/combustibles|PrototipoExternos/);
    }
  }
  revisar(resolve("src"));
});
