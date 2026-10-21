import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const src = readFileSync("src/components/tms/viaticos-control-panel.tsx", "utf8");
describe("Excel comparte la selección del PDF", () => {
  it("mismos parámetros y endpoint con formato diferente", () => {
    expect(src).toContain('parametrosReporte("excel")');
    expect(src).toContain('parametrosReporte("pdf")');
    expect(src).not.toContain("/comprobante-autorizacion-excel?");
    expect(src).not.toContain("/comprobante-autorizacion-pdf?");
  });
  it("conserva botones, loading/error independientes y nombre del servidor", () => {
    expect(src).toContain('{descargandoComprobante ? "Generando…" : "Descargar PDF"}');
    expect(src).toContain('{descargandoComprobanteExcel ? "Generando…" : "Descargar Excel"}');
    expect(src).toContain("disabled={descargandoComprobanteExcel || loading}");
    expect(src).toContain("setErrorComprobanteExcel(data.error");
    expect(src).toContain('a.download = nombreServidor || `viaticos-${estadoReporte.toLowerCase()}.xlsx`');
  });
});
