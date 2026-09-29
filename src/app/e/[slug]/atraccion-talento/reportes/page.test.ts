import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ATRACCION-TALENTO-1 (corrección post-revisión) — verificación por código
 * fuente (client component grande, sin harness de render en este repo; mismo
 * criterio que entrevistas-page-client.test.ts).
 */
const src = readFileSync("src/app/e/[slug]/atraccion-talento/reportes/page.tsx", "utf8");

describe("Reportes de Atracción — selector de entrevistador usa el catálogo mínimo", () => {
  it("7) usa /rrhh/entrevistas/entrevistadores, no el endpoint general de empleados", () => {
    expect(src).toContain("/api/empresas/${slug}/rrhh/entrevistas/entrevistadores");
    expect(src).not.toContain("/api/empresas/${slug}/empleados?estado=Activo");
  });

  it("lee data.entrevistadores (no data.empleados) de la respuesta", () => {
    expect(src).toContain("data.entrevistadores ?? []");
  });
});
