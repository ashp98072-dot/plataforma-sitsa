import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RRHH_NAV, type PermisoModulo } from "@/lib/permisos-shared";
import { tienePermisoBase } from "@/lib/permisos-catalogo";

/**
 * ATRACCION-TALENTO-1 — el grupo "RRHH" se renombra visualmente a
 * "Gestión de Talento Humano"; "Entrevistas" sale de ese grupo y pasa a un
 * grupo nuevo e independiente "Atracción de Talento Humano" (junto con
 * "Reportes"), reutilizando el permiso `entrevistas` ya existente.
 *
 * Mismo criterio que app-shell-operaciones.test.ts: app-shell.tsx es un
 * componente cliente grande sin harness de render en este repo — se
 * extrae el bloque REAL de construcción del grupo y se evalúa con el
 * evaluador real (tienePermisoBase real, sin duplicar su lógica aquí).
 */
const src = readFileSync(join(__dirname, "app-shell.tsx"), "utf-8");

describe("navegación: RRHH -> Gestión de Talento Humano / Atracción de Talento Humano", () => {
  it("1) el grupo dice 'Gestión de Talento Humano'", () => {
    expect(src).toContain('label: "Gestión de Talento Humano"');
  });

  it("2) ya no existe 'RRHH' como label del grupo (id interno 'rrhh' se conserva)", () => {
    expect(src).not.toMatch(/label:\s*"RRHH"/);
    expect(src).toContain('id: "rrhh"'); // key interna intacta, solo cambió el texto
  });

  it("3) 'Entrevistas' ya no vive en RRHH_NAV (el array que arma el grupo Gestión de Talento Humano)", () => {
    expect(RRHH_NAV.some((item) => item.sub === "entrevistas")).toBe(false);
    // El resto de RRHH_NAV sigue intacto (mismo tamaño menos 1, mismos labels de siempre).
    expect(RRHH_NAV.some((item) => item.sub === "empleados")).toBe(true);
    expect(RRHH_NAV.some((item) => item.sub === "vacaciones")).toBe(true);
  });

  it("4) existe el grupo 'Atracción de Talento Humano'", () => {
    expect(src).toContain('label: "Atracción de Talento Humano"');
  });

  // new Function() ejecuta JS plano — se despoja la única anotación de tipo TS del bloque (": NavLink[]").
  const bloque = src
    .slice(src.indexOf("const atraccionLinks: NavLink[] = [];"), src.indexOf("if (atraccionLinks.length)"))
    .replace(": NavLink[]", "");

  function enlaces(rol: string, modulos: string[], entrevistasVer: boolean) {
    expect(bloque).toBeDefined();
    const permisos: PermisoModulo[] = entrevistasVer
      ? [{ modulo: "entrevistas", puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false }]
      : [{ modulo: "entrevistas", puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: false }];
    return new Function(
      "isAdmin", "modulos", "permisos", "tienePermisoBase", "base", "dominioEmpresa",
      `${bloque}; return atraccionLinks;`,
    )(rol === "Admin", modulos, permisos, tienePermisoBase, "/e/kt-monaco", false) as { href: string; label: string; key: string }[];
  }

  it("5/6) el grupo contiene Entrevistas y Reportes cuando hay permiso entrevistas:ver", () => {
    const links = enlaces("RRHH", ["rrhh"], true);
    expect(links).toEqual([
      { href: "/e/kt-monaco/atraccion-talento/entrevistas", label: "Entrevistas", key: "atraccion-entrevistas" },
      { href: "/e/kt-monaco/atraccion-talento/reportes", label: "Reportes", key: "atraccion-reportes" },
    ]);
  });

  it("7) sin permiso entrevistas:ver (matriz configurada, no Admin) el grupo queda vacío", () => {
    expect(enlaces("RRHH", ["rrhh"], false)).toEqual([]);
  });

  it("Admin siempre ve el grupo, sin importar la matriz de permisos", () => {
    const links = enlaces("Admin", ["rrhh"], false);
    expect(links).toHaveLength(2);
  });

  it("sin el módulo de empresa 'rrhh' el grupo no aparece, incluso con el permiso concedido", () => {
    expect(enlaces("RRHH", [], true)).toEqual([]);
  });

  it("usa el mismo permiso RrhhSubmodulo 'entrevistas' ya existente — no crea 'atraccion_talento' ni 'atraccion_reportes'", () => {
    expect(bloque).toContain('"entrevistas"');
    expect(src).not.toContain("atraccion_talento");
    expect(src).not.toContain("atraccion_reportes");
  });
});
