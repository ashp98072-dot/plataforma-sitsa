import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * RRHH-INVENTARIO-CAMBIOS-1 (sección 1 del ticket) — hover de filas en
 * Inventario. Se verifica sobre el CÓDIGO FUENTE (no renderizado: la página
 * es un client component con fetch/estado, igual que el resto de páginas
 * "use client" de RRHH — se prueba por texto fuente, mismo criterio que
 * src/lib/compras/requerimiento-ui.test.ts) que:
 *  - las 3 tablas/listas usan el token de tema `--nav-hover` (nunca un color
 *    fijo tipo #hex o rgb(...) hardcodeado que solo se vea bien en un tema);
 *  - ese token está definido con valores DISTINTOS para claro y oscuro en
 *    globals.css (así confirmamos que realmente cambia según el tema, no
 *    que sea un color estático que coincide por casualidad).
 */
const fuentePagina = readFileSync("src/app/e/[slug]/rrhh/inventario/page.tsx", "utf8");
const fuenteGlobals = readFileSync("src/app/globals.css", "utf8");

describe("hover de filas — tema claro/oscuro", () => {
  it("1) tabla principal de artículos tiene hover con el token de tema", () => {
    expect(fuentePagina).toMatch(
      /items\.map\(\(it\) => \(\s*<tr key=\{it\.id\} className="transition-colors hover:bg-\[var\(--nav-hover\)\]">/,
    );
  });

  it("2) historial de entregas (tabla) tiene hover con el token de tema", () => {
    expect(fuentePagina).toContain('<tr className="transition-colors hover:bg-[var(--nav-hover)]">');
  });

  it("historial de movimientos del artículo (lista) también tiene hover", () => {
    expect(fuentePagina).toMatch(
      /movimientos\.map\(\(m\) => \(\s*<div\s+key=\{m\.id\}\s+className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-\[var\(--nav-hover\)\]"/,
    );
  });

  it("3) el hover NUNCA usa un color hardcodeado (#hex / rgb literal) en las 3 secciones — siempre el token --nav-hover", () => {
    const bloquesHover = fuentePagina.match(/hover:bg-\[[^\]]+\]/g) ?? [];
    expect(bloquesHover.length).toBeGreaterThan(0);
    for (const bloque of bloquesHover) {
      // Todo hover:bg-[...] en este archivo debe resolver a una variable de tema, nunca a un literal de color.
      expect(bloque).toMatch(/^hover:bg-\[var\(--[\w-]+\)\]$/);
    }
  });

  it("--nav-hover está definido con valores DISTINTOS para dark (raíz) y light (data-theme claro) — confirma que realmente es sensible al tema", () => {
    const valores = [...fuenteGlobals.matchAll(/--nav-hover:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(valores.length).toBeGreaterThanOrEqual(2);
    expect(new Set(valores).size).toBeGreaterThanOrEqual(2); // no son todos el mismo valor
  });
});
