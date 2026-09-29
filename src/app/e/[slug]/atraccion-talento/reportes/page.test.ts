import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ATRACCION-TALENTO-1/2 — verificación por código fuente (client component
 * grande, sin harness de render en este repo; mismo criterio que
 * entrevistas-page-client.test.ts).
 */
const src = readFileSync("src/app/e/[slug]/atraccion-talento/reportes/page.tsx", "utf8");

describe("ATRACCION-TALENTO-2 — filtro de entrevistador usa el catálogo de usuarios", () => {
  it("usa /rrhh/entrevistas/usuarios, no el catálogo de empleados ni el endpoint general de empleados", () => {
    expect(src).toContain("/api/empresas/${slug}/rrhh/entrevistas/usuarios");
    expect(src).not.toContain("/api/empresas/${slug}/rrhh/entrevistas/entrevistadores");
    expect(src).not.toContain("/api/empresas/${slug}/empleados?estado=Activo");
  });

  it("lee data.usuarios de la respuesta", () => {
    expect(src).toContain("data.usuarios ?? []");
  });

  it("25) usa /rrhh/entrevistas/puestos para el catálogo real de puestos del filtro", () => {
    expect(src).toContain("/api/empresas/${slug}/rrhh/entrevistas/puestos");
    expect(src).toContain("data.puestos ?? []");
  });
});

describe("ATRACCION-TALENTO-1/2 — closure de filtros en cargar()", () => {
  it("cargar() usa el helper puro construirParamsReporte (no arma los params inline)", () => {
    expect(src).toContain('from "@/lib/rrhh/entrevistas-reportes-filtros"');
    expect(src).toContain("construirParamsReporte({ fechaDesde, fechaHasta, puesto, estado, resultado, entrevistadorUsuarioId })");
  });

  it("el useCallback de cargar() depende de TODOS los filtros que consume, no solo de slug", () => {
    const fn = src.slice(src.indexOf("const cargar = useCallback"), src.indexOf("useEffect", src.indexOf("const cargar = useCallback")));
    expect(fn).toMatch(/\},\s*\[slug, fechaDesde, fechaHasta, puesto, estado, resultado, entrevistadorUsuarioId\]\);/);
  });

  it("38) el montaje inicial sigue siendo una sola carga: el useEffect que llama cargar() al montar tiene deps [] — cambiar un filtro por sí solo NO dispara fetch", () => {
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

describe("ATRACCION-TALENTO-2 — filtro de entrevistador permite volver a 'Todos'", () => {
  it("UsuarioEntrevistaPicker del filtro usa allowEmptySelection con emptyLabel 'Todos los entrevistadores'", () => {
    const bloque = src.slice(src.indexOf("<UsuarioEntrevistaPicker"), src.indexOf("/>", src.indexOf("<UsuarioEntrevistaPicker")) + 2);
    expect(bloque).toContain("allowEmptySelection");
    expect(bloque).toContain('emptyLabel="Todos los entrevistadores"');
  });
});

describe("ATRACCION-TALENTO-2 (sección 25) — filtro de puesto usa catálogo real + Otro puesto", () => {
  it("el select de puesto ofrece 'Todos los puestos', el catálogo real y 'Otro puesto…'", () => {
    expect(src).toContain("Todos los puestos");
    expect(src).toContain("puestos.map((p)");
    expect(src).toContain("Otro puesto…");
  });
});

describe("ATRACCION-TALENTO-2 (sección 17) — reorganización: header, filtros, KPIs, gráficas, tablas, listado", () => {
  it("el orden de los bloques respeta la jerarquía pedida", () => {
    const orden = [
      "Reportes de Atracción de Talento Humano", // 1) header
      '<form', // 2) filtros
      "grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5", // 3) KPIs
      "ENTREVISTAS POR ESTADO", // 4) gráficas
      "POR PUESTO", // 5) tablas de análisis
      "LISTADO DETALLADO", // 6) listado
    ].map((s) => src.indexOf(s));
    for (let i = 1; i < orden.length; i++) expect(orden[i]).toBeGreaterThan(orden[i - 1]);
  });
});

describe("ATRACCION-TALENTO-2 (secciones 19-23) — gráficas sin dependencias nuevas, accesibles", () => {
  it("usa GraficaBarras (CSS/divs) para estados, resultados y puestos — sin recharts/chart.js", () => {
    const ocurrencias = src.split("<GraficaBarras").length - 1;
    expect(ocurrencias).toBe(3);
    expect(src).not.toMatch(/recharts|chart\.js|react-chartjs/i);
  });

  it("gráfica de puestos usa top 10 y muestra la nota TOP 10 cuando hay más", () => {
    expect(src).toContain("topPuestos = [...porPuesto].sort");
    expect(src).toContain(".slice(0, 10)");
    expect(src).toContain("TOP 10");
  });

  it("gráfica de estados/resultados usa los datos ya filtrados del resumen (respeta los filtros actuales)", () => {
    expect(src).toContain("resumen.programadas");
    expect(src).toContain("resumen.aprobados");
  });
});

describe("ATRACCION-TALENTO-2 (sección 11) — auxiliar visible en el listado detallado", () => {
  it("la tabla de listado detallado tiene columna Auxiliar", () => {
    const bloque = src.slice(src.indexOf("LISTADO DETALLADO"));
    expect(bloque).toContain("<th className=\"px-2 py-1\">Auxiliar</th>");
    expect(bloque).toContain("d.auxiliarNombre ?? \"—\"");
  });

  it("marca 'Histórico' cuando el entrevistador del detalle viene del empleado histórico", () => {
    expect(src).toContain("d.entrevistadorHistorico ? (");
  });
});
