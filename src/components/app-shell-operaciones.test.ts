import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OPERACIONES-UX-PLANES-SIMPLIFICADO-1 — reorganización visual del menú de
 * Operaciones (Rutas → Programación → Planes / Viajes → … → Reportes) y
 * ocultamiento del enlace "TMS / Logística" para usuarios operativos.
 *
 * app-shell.tsx es un componente cliente grande sin harness de render en
 * este repo; como guarda de regresión se verifica el código fuente:
 *   - no se elimina ningún enlace ni se toca el gating de permisos;
 *   - el link "TMS / Logística" solo se oculta (Admin lo conserva),
 *     nunca se borra la ruta/endpoint;
 *   - "Planes / Viajes" y "Reportes" quedan con el nombre entendible.
 */
const src = readFileSync(join(__dirname, "app-shell.tsx"), "utf-8");

describe("menú Operaciones — nombres y orden", () => {
  it("existe el enlace 'Planes / Viajes' apuntando a /planes", () => {
    expect(src).toMatch(/label: "Planes \/ Viajes"/);
    expect(src).toMatch(/href: `\$\{base\}\/planes`/);
  });

  it("ya no existe el enlace viejo 'Reportes de viajes' a /tms/reportes", () => {
    expect(src).not.toMatch(/label: "Reportes de viajes"/);
    expect(src).not.toMatch(/`\$\{base\}\/tms\/reportes`/);
  });

  it("'Reportes de gastos' se retituló a 'Reportes' (misma ruta /reportes/gastos)", () => {
    expect(src).toMatch(/href: `\$\{base\}\/reportes\/gastos`/); // ruta intacta
    expect(src).toMatch(/label: "Reportes",/); // nombre entendible
    expect(src).not.toMatch(/label: "Reportes de gastos"/);
  });

  it("orden del flujo: Rutas antes que Programación, Programación antes que Planes / Viajes", () => {
    const iRutas = src.indexOf('label: "Rutas"');
    const iProg = src.indexOf('label: "Programación"');
    const iPlanes = src.indexOf('label: "Planes / Viajes"');
    expect(iRutas).toBeGreaterThan(0);
    expect(iRutas).toBeLessThan(iProg);
    expect(iProg).toBeLessThan(iPlanes);
  });
});

describe("'TMS / Logística' — se oculta del menú, nunca se elimina", () => {
  it("el link del módulo tms se omite solo para no-Admin (continue), nunca se borra el push del resto de opsMods", () => {
    expect(src).toMatch(/if \(m === "tms" && !isAdmin\) continue;/);
    // el bucle que arma los enlaces por módulo sigue existiendo
    expect(src).toMatch(/for \(const m of opsMods\)/);
  });

  it("Planes / Viajes conserva el MISMO gating que Programación (puedeProgramacion) — sin permisos nuevos ni perdidos", () => {
    // el push de "planes" está dentro de un if (puedeProgramacion)
    const idx = src.indexOf('label: "Planes / Viajes"');
    const antes = src.slice(Math.max(0, idx - 400), idx);
    expect(antes).toMatch(/if \(puedeProgramacion\) \{/);
  });
});

describe("rutas TMS internas siguen intactas", () => {
  it("/e/[slug]/tms sigue teniendo su page.tsx (no se borró la pantalla técnica)", () => {
    const tmsPage = join(__dirname, "..", "app", "e", "[slug]", "tms", "page.tsx");
    expect(() => readFileSync(tmsPage, "utf-8")).not.toThrow();
  });

  it("/e/[slug]/tms/reportes ahora redirige a /planes (no es 404, no se pierde el enlace guardado)", () => {
    const redir = readFileSync(
      join(__dirname, "..", "app", "e", "[slug]", "tms", "reportes", "page.tsx"),
      "utf-8",
    );
    expect(redir).toMatch(/from "next\/navigation"/);
    expect(redir).toMatch(/redirect\(`\/e\/\$\{slug\}\/planes`\)/);
  });
});
