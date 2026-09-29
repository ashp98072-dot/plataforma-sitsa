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

describe("ATRACCION-TALENTO-1 (corrección post-revisión) — closure de filtros en cargar()", () => {
  it("cargar() usa el helper puro construirParamsReporte (no arma los params inline)", () => {
    expect(src).toContain('from "@/lib/rrhh/entrevistas-reportes-filtros"');
    expect(src).toContain("construirParamsReporte({ fechaDesde, fechaHasta, puesto, estado, resultado, entrevistadorId })");
  });

  it("el useCallback de cargar() depende de TODOS los filtros que consume, no solo de slug", () => {
    const fn = src.slice(src.indexOf("const cargar = useCallback"), src.indexOf("useEffect", src.indexOf("const cargar = useCallback")));
    expect(fn).toMatch(/\},\s*\[slug, fechaDesde, fechaHasta, puesto, estado, resultado, entrevistadorId\]\);/);
  });

  it("6) el montaje inicial sigue siendo una sola carga: el useEffect que llama cargar() al montar tiene deps [] (no [cargar] ni filtros) — cambiar un filtro por sí solo NO dispara fetch", () => {
    const inicio = src.indexOf("useEffect(() => {\n    // eslint-disable-next-line react-hooks/set-state-in-effect\n    void cargar();");
    expect(inicio).toBeGreaterThan(-1);
    const bloque = src.slice(inicio, src.indexOf("}, []);", inicio) + "}, []);".length);
    expect(bloque).toContain("}, []);");
  });

  it("el botón 'Actualizar' solo dispara la carga al enviar el formulario (onSubmit), no hay onChange que llame cargar()", () => {
    expect(src).toContain('onSubmit={(e) => { e.preventDefault(); void cargar(); }}');
    expect(src).not.toMatch(/onChange=\{[^}]*cargar\(/);
  });
});

describe("ATRACCION-TALENTO-1 (corrección post-revisión) — filtro de entrevistador permite volver a 'Todos'", () => {
  it("EmpleadoPicker del filtro usa allowEmptySelection con emptyLabel 'Todos los entrevistadores'", () => {
    const bloque = src.slice(src.indexOf("<EmpleadoPicker"), src.indexOf("/>", src.indexOf("<EmpleadoPicker")) + 2);
    expect(bloque).toContain("allowEmptySelection");
    expect(bloque).toContain('emptyLabel="Todos los entrevistadores"');
  });

  it("no se modificó EmpleadoPicker globalmente (allowEmptySelection ya existía como prop opcional)", () => {
    const picker = readFileSync("src/components/rrhh/empleado-picker.tsx", "utf8");
    expect(picker).toContain("allowEmptySelection?: boolean;");
    expect(picker).toContain("allowEmptySelection = false,");
  });
});
