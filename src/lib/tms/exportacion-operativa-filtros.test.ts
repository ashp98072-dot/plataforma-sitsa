import { describe, expect, it } from "vitest";
import { paramsExportarFondos, paramsExportarGastos, paramsListadoFondos, paramsListadoGastos } from "./exportacion-operativa-filtros";

it("Gastos traduce Mes+Año al mes completo y conserva todos los filtros", () => {
  const f = { fechaDesde: "2026-01-02", fechaHasta: "2026-01-03", mes: "9", anio: "2026", categoria: "Combustible", empleadoId: "2", vehiculoId: "3", clienteId: "4" };
  expect(Object.fromEntries(paramsListadoGastos(f))).toEqual({ fechaDesde: "2026-09-01", fechaHasta: "2026-09-30", categoria: "Combustible", empleadoId: "2", vehiculoId: "3", clienteId: "4" });
  expect(paramsExportarGastos(f, "pdf").get("tipo")).toBe("gastosDetalle");
});

it("Gastos permite rango libre y Excel no agrega formato", () => {
  const f = { fechaDesde: "2026-08-05", fechaHasta: "2026-08-20", mes: "", anio: "", categoria: "", empleadoId: "", vehiculoId: "", clienteId: "" };
  expect(paramsExportarGastos(f).toString()).toContain("fechaDesde=2026-08-05");
  expect(paramsExportarGastos(f).has("formato")).toBe(false);
});

describe("Fondos", () => {
  const mensual = { fechaDesde: "", fechaHasta: "", mes: "2", anio: "2024", estado: "Autorizada", requirenteUsuarioId: "7" };
  it("usa rango mensual completo y los nombres de parámetros de PR #237", () => {
    const p = paramsExportarFondos(mensual, "pdf");
    expect(p.get("tipo")).toBe("fondos");
    expect(p.get("fechaSolicitudDesde")).toBe("2024-02-01");
    expect(p.get("fechaSolicitudHasta")).toBe("2024-02-29");
    expect(p.get("estadoFondo")).toBe("Autorizada");
    expect(p.get("requirenteUsuarioId")).toBe("7");
    expect(p.get("formato")).toBe("pdf");
  });
  it("el listado usa su contrato existente y el export usa todo el universo filtrado", () => {
    expect(Object.fromEntries(paramsListadoFondos(mensual))).toEqual({ fechaDesde: "2024-02-01", fechaHasta: "2024-02-29", estado: "Autorizada" });
    expect(paramsExportarFondos(mensual).has("page")).toBe(false);
    expect(paramsExportarFondos(mensual).has("pageSize")).toBe(false);
  });
});
