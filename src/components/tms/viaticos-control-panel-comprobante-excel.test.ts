import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * VIATICOS-COMPROBANTE-ADMIN-1 — botón "Descargar Excel" junto al "Descargar PDF" existente, mismo período/
 * valor seleccionados, mismo patrón fetch+blob (duplicado de descargarComprobante(), ver
 * viaticos-control-panel-comprobante-periodo.test.ts para los tests equivalentes del botón PDF). Mismo criterio
 * de este repo: sin harness de componentes, se verifica el código fuente directamente.
 */
const src = readFileSync("src/components/tms/viaticos-control-panel.tsx", "utf8").replace(/\r\n/g, "\n");

function cuerpoDe(nombreFuncion: string): string {
  const inicio = src.indexOf(`async function ${nombreFuncion}`);
  expect(inicio).toBeGreaterThan(-1);
  return src.slice(inicio, src.indexOf("\n  }", inicio));
}

describe("VIATICOS-COMPROBANTE-ADMIN-1 — botón Excel junto al PDF", () => {
  it("43) existen ambos botones, 'Descargar PDF' y 'Descargar Excel', en el mismo bloque", () => {
    expect(src).toContain('{descargandoComprobante ? "Generando…" : "Descargar PDF"}');
    expect(src).toContain('{descargandoComprobanteExcel ? "Generando…" : "Descargar Excel"}');
  });

  it("44) descargarComprobanteExcel usa el MISMO tipoPeriodoComprobante/valorPeriodoComprobante que el PDF — ningún estado de período duplicado", () => {
    const fn = cuerpoDe("descargarComprobanteExcel");
    expect(fn).toContain("periodo: tipoPeriodoComprobante, valor: valorPeriodoComprobante");
    expect(src).not.toMatch(/tipoPeriodoComprobanteExcel|valorPeriodoComprobanteExcel/);
  });

  it("apunta al endpoint de Excel, no al de PDF", () => {
    const fn = cuerpoDe("descargarComprobanteExcel");
    expect(fn).toContain("fetch(`/api/empresas/${slug}/tms/viaticos/comprobante-autorizacion-excel?");
  });

  it("46) si la respuesta no es OK, el error queda en su PROPIO estado (errorComprobanteExcel), nunca pisa errorComprobante del PDF", () => {
    const fn = cuerpoDe("descargarComprobanteExcel");
    expect(fn).toContain("if (!res.ok)");
    expect(fn).toContain("setErrorComprobanteExcel(data.error");
    expect(fn).not.toContain("setErrorComprobante(data.error"); // ese es el del PDF, en su propia función
  });

  it("45) loading independiente: el botón Excel se deshabilita con SU PROPIO estado, no con descargandoComprobante del PDF", () => {
    expect(src).toMatch(/disabled=\{descargandoComprobanteExcel \|\| !valorPeriodoComprobante\}/);
  });

  it("47) nunca navega directo al endpoint de Excel (window.open/window.location ni <a href> crudo)", () => {
    expect(src).not.toMatch(/<a\s+href=\{`\/api\/empresas\/\$\{slug\}\/tms\/viaticos\/comprobante-autorizacion-excel/);
  });

  it("el blob de Excel se descarga con el mismo patrón createObjectURL + <a download> sintético + revokeObjectURL", () => {
    const fn = cuerpoDe("descargarComprobanteExcel");
    expect(fn).toContain("const blob = await res.blob()");
    expect(fn).toContain("URL.createObjectURL(blob)");
    expect(fn).toContain("URL.revokeObjectURL(url)");
    expect(fn).toContain("a.download = nombreServidor || `viaticos-autorizados-${valorPeriodoComprobante}.xlsx`");
  });

  it("cambiar el tipo de período limpia el error de AMBOS botones (PDF y Excel)", () => {
    const fn = src.slice(src.indexOf("function cambiarTipoPeriodoComprobante"), src.indexOf("\n  }", src.indexOf("function cambiarTipoPeriodoComprobante")));
    expect(fn).toContain("setErrorComprobante(\"\")");
    expect(fn).toContain("setErrorComprobanteExcel(\"\")");
  });

  it("48) ambos botones muestran su error inline por separado, ninguno se pisa", () => {
    expect(src).toContain("{errorComprobante ? <p className=\"w-full text-xs text-red-300\">{errorComprobante}</p> : null}");
    expect(src).toContain("{errorComprobanteExcel ? <p className=\"w-full text-xs text-red-300\">{errorComprobanteExcel}</p> : null}");
  });
});
