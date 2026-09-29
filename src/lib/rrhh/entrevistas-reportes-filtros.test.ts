import { describe, expect, it } from "vitest";
import { construirParamsReporte, type FiltrosReporte } from "./entrevistas-reportes-filtros";

const base: FiltrosReporte = {
  fechaDesde: "2026-09-01",
  fechaHasta: "2026-09-30",
  puesto: "",
  estado: "",
  resultado: "",
  entrevistadorId: 0,
};

describe("ATRACCION-TALENTO-1 (corrección post-revisión) — construirParamsReporte", () => {
  it("1) cambiar fechaDesde se refleja en los params", () => {
    const p = construirParamsReporte({ ...base, fechaDesde: "2026-08-15" });
    expect(p.get("fechaDesde")).toBe("2026-08-15");
  });

  it("cambiar fechaHasta se refleja en los params", () => {
    const p = construirParamsReporte({ ...base, fechaHasta: "2026-10-05" });
    expect(p.get("fechaHasta")).toBe("2026-10-05");
  });

  it("2) cambiar estado se refleja en los params", () => {
    const p = construirParamsReporte({ ...base, estado: "Realizada" });
    expect(p.get("estado")).toBe("Realizada");
  });

  it("estado vacío ('Todos') no manda el parámetro", () => {
    const p = construirParamsReporte(base);
    expect(p.has("estado")).toBe(false);
  });

  it("3) cambiar resultado se refleja en los params", () => {
    const p = construirParamsReporte({ ...base, resultado: "Aprobado" });
    expect(p.get("resultado")).toBe("Aprobado");
  });

  it("4) seleccionar un entrevistador manda su id", () => {
    const p = construirParamsReporte({ ...base, entrevistadorId: 55 });
    expect(p.get("entrevistadorEmpleadoId")).toBe("55");
  });

  it("5) entrevistadorId = 0 ('Todos los entrevistadores') NO manda entrevistadorEmpleadoId", () => {
    const p = construirParamsReporte({ ...base, entrevistadorId: 0 });
    expect(p.has("entrevistadorEmpleadoId")).toBe(false);
  });

  it("puesto se recorta (trim) y solo se manda si queda contenido", () => {
    expect(construirParamsReporte({ ...base, puesto: "  Piloto  " }).get("puesto")).toBe("Piloto");
    expect(construirParamsReporte({ ...base, puesto: "   " }).has("puesto")).toBe(false);
  });
});
