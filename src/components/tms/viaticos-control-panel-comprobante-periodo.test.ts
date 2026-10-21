import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const src = readFileSync("src/components/tms/viaticos-control-panel.tsx", "utf8");
describe("Reporte de pestaña activa reemplaza período independiente", () => {
  it("usa título/estado dinámicos y conserva Todos", () => {
    expect(src).toContain("tituloReporte(estadoReporte)");
    expect(src).toContain('(fEstado || "TODOS")');
    expect(src).not.toContain("Comprobante de autorización — Período");
    expect(src).not.toContain("setTipoPeriodoComprobante");
  });
  it("envía todos los filtros visibles y agrupación", () => {
    for (const value of ["estado: estadoReporte", "busqueda: fBusqueda", "empleado: fEmpleado", "rol: fRol", "metodo: fMetodo",
      "fechaDesde: fFechaDesde", "fechaHasta: fFechaHasta", "agrupacion: modoAgrupacion"]) expect(src).toContain(value);
    expect(src).toContain('parametrosReporte("pdf")');
    expect(src).toContain("/tms/viaticos/reporte?");
  });
  it("comparte búsqueda; conserva permiso, blob, error inline y nombre del servidor", () => {
    for (const text of ["coincideFiltroReporte(r,", "{puedeComprobantes ? (", "URL.createObjectURL(blob)", "URL.revokeObjectURL(url)",
      "setErrorComprobante(data.error", 'res.headers.get("Content-Disposition")', "disabled={descargandoComprobante || loading}"]) expect(src).toContain(text);
    expect(src).not.toContain("window.open(");
  });
});
