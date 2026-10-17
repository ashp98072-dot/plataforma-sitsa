import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/app/e/[slug]/planes/planes-viajes-client.tsx", "utf8");

describe("Planes / Viajes — botón «Exportar Excel»", () => {
  it("está visible en la vista operativa (no solo en Reportes) y es un botón con estado de carga", () => {
    const i = src.indexOf("exportarExcel()");
    expect(i).toBeGreaterThan(-1);
    const bloque = src.slice(src.lastIndexOf("{!esReporte ? (", i), i + 700);
    expect(bloque).toContain("Exportar Excel");
    expect(bloque).toContain("disabled={exportando}");
  });

  it("exporta TODO el filtro: usa los MISMOS filtros/pestañas que la tabla y nunca page/pageSize", () => {
    const a = src.indexOf("const exportarExcel = useCallback");
    const cuerpo = src.slice(a, a + 1400);
    expect(cuerpo).toContain("/tms/reportes/viajes/export?formato=xlsx&vista=planes&${filtrosQueryString().toString()}");
    expect(cuerpo).not.toMatch(/pageSize|page=/);
    // La pestaña (Pendientes/Activos o Cerrados) y los filtros viajan en el mismo query string que usa el listado.
    const q = src.slice(src.indexOf("const filtrosQueryString = useCallback"), src.indexOf("/** Para exportar"));
    for (const k of ["fechaDesde", "fechaHasta", "clienteId", "pilotoId", "unidadId", "estado", "ruta", "estadoFacturacion", "estadoCobro", "soloPendientesCierre", "soloCerrados", "soloSinCerrar"]) {
      expect(q, k).toContain(`"${k}"`);
    }
  });

  it("descarga con el nombre que decide el servidor y muestra los errores (permiso, volumen) junto al botón", () => {
    const a = src.indexOf("const exportarExcel = useCallback");
    const cuerpo = src.slice(a, a + 1400);
    expect(cuerpo).toContain("Content-Disposition");
    expect(cuerpo).toContain("setErrorExportar(data.error");
    expect(src).toContain('role="alert" className="text-xs text-red-500">{errorExportar}');
  });

  it("el modo Reportes conserva sus botones de siempre", () => {
    expect(src).toContain("Exportar Excel (todo el filtro)");
    expect(src).toContain("Exportar PDF (todo el filtro)");
  });
});
