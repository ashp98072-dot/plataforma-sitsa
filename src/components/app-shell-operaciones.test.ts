import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tienePermiso, type PermisoModulo } from "@/lib/permisos-shared";

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

describe("Compras — accesos directos sin padre redundante", () => {
  // Ejecutar el bloque real con el evaluador real, sin refactorizar navegación
  // productiva ni duplicar sus condiciones de permisos en el test.
  const bloque = src.match(/    if \(\(isAdmin && modulos\.includes\("tms"\)\)[\s\S]*?\n    \}/)?.[0];
  function enlaces(requerimientos: boolean, proveedores: boolean, rol = "Operaciones", modulos = ["tms"]) {
    expect(bloque).toBeDefined();
    const permisos: PermisoModulo[] = [
      { modulo: "compras_requerimientos", puedeVer: requerimientos, puedeCrear: false, puedeEditar: false, puedeEliminar: false },
      { modulo: "compras_proveedores", puedeVer: proveedores, puedeCrear: false, puedeEditar: false, puedeEliminar: false },
    ];
    return new Function("isAdmin", "modulos", "permisos", "tienePermiso", "base", `const opsLinks = []; ${bloque}; return opsLinks;`)(
      rol === "Admin", modulos, permisos, tienePermiso, "/e/kt-monaco",
    ) as { href: string; label: string; key: string }[];
  }
  it("elimina únicamente el enlace clicable Compras / Repuestos", () => {
    expect(src).not.toContain('label: "Compras / Repuestos"');
    expect(enlaces(true, true)).toEqual([
      { href: "/e/kt-monaco/compras/requerimientos", label: "Requerimientos de compra", key: "compras-requerimientos" },
      { href: "/e/kt-monaco/compras/proveedores", label: "Proveedores comerciales", key: "compras-proveedores" },
    ]);
  });
  it.each([[true, false], [false, true], [false, false]])("permisos independientes ver requerimientos=%s, proveedores=%s", (req, prov) => {
    const links = enlaces(req, prov);
    expect(links.some(l => l.key === "compras-requerimientos")).toBe(req);
    expect(links.some(l => l.key === "compras-proveedores")).toBe(prov);
  });
  it("Admin conserva acceso con Operaciones habilitado y no añade acceso sin módulo", () => {
    expect(enlaces(false, false, "Admin")).toHaveLength(2);
    expect(enlaces(false, false, "Admin", [])).toEqual([]);
  });
});

describe("menú Operaciones — nombres y orden", () => {
  it("muestra Ajustes de costeo solo con su permiso explícito y la ruta correcta", () => {
    expect(src).toContain('tienePermiso(permisos, "cotizaciones_ajustes", "ver")');
    expect(src).toContain('href: `${base}/cotizaciones/ajustes`');
    expect(src).toContain('label: "Ajustes de costeo"');
    const bloque = src.match(/const puedeAjustesCotizaciones =[\s\S]*?\n    \}/)?.[0] ?? "";
    expect(bloque).not.toContain("permisos.length === 0");
    expect(bloque).not.toContain('"cotizaciones_costeo"');
  });
  it("existe el enlace 'Planes / Viajes' apuntando a /planes", () => {
    expect(src).toMatch(/label: "Planes \/ Viajes"/);
    expect(src).toMatch(/href: `\$\{base\}\/planes`/);
  });

  it("ya no existe el enlace viejo 'Reportes de viajes' a /tms/reportes", () => {
    expect(src).not.toMatch(/label: "Reportes de viajes"/);
    expect(src).not.toMatch(/`\$\{base\}\/tms\/reportes`/);
  });

  it("'Reportes' apunta a la ruta actual /reportes", () => {
    expect(src).toMatch(/href: `\$\{base\}\/reportes`/);
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
