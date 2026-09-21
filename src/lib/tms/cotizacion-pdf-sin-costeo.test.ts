import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cotizacionPdf } from "./cotizacion-pdf";
import type { Cotizacion } from "./cotizaciones";

/**
 * COTIZACIONES-COSTEO — el PDF comercial NO cambia y jamás contiene
 * información de costeo interno (costo operativo, precio sugerido,
 * utilidad, margen, componentes, perfil, combustible, salarios).
 */
const COTIZACION: Cotizacion = {
  id: 1, empresaId: 7, codigo: "COT-000001", clienteId: 3, clienteNombre: "PriceSmart", rutaId: 5, rutaCodigoHistorico: "RUTA-1",
  origenTexto: "Bodega Zona 12", destinoTexto: "Puerto Barrios", tarifaReferencia: 1250, tarifaCotizada: 5600, incluyeIva: true, moneda: "GTQ",
  fechaEmision: "2026-09-21", fechaVencimiento: "2026-10-05", estado: "Borrador", pilotoIncluido: true, gpsIncluido: true,
  seguroMercaderiaIncluido: true, seguroTercerosIncluido: true, kmIncluidos: 600, tarifaKmAdicional: 12.5,
  condicionesAdicionales: "Pago contra entrega.", observaciones: "Cliente frecuente.", creadoPor: "admin", creadoEn: "2026-09-21 10:00:00", actualizadoEn: null,
};
afterEach(() => vi.restoreAllMocks());

describe("PDF comercial sin costeo interno", () => {
  it("el texto del PDF no contiene ningún dato de costeo", async () => {
    const texto = vi.spyOn(PDFDocument.prototype, "text");
    const buf = await cotizacionPdf("KT / Logiservicios Mónaco", COTIZACION);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const contenido = texto.mock.calls.map((c) => String(c[0])).join("\n").toLowerCase();
    expect(contenido).toContain("cot-000001"); // sí es el PDF comercial de siempre
    for (const prohibido of [
      "costeo", "costo operativo", "costo con iva", "iva del costo", "precio sugerido", "utilidad", "margen", "perfil", "componente",
      "combustible", "salario", "depreciaci", "llantas", "aceite", "viático", "viatico", "cabezal", "costeo_v1",
    ]) expect(contenido, `el PDF no debe mencionar "${prohibido}"`).not.toContain(prohibido);
  });

  it("ni el módulo del PDF ni su endpoint referencian el costeo (ni importan sus módulos)", () => {
    for (const ruta of ["src/lib/tms/cotizacion-pdf.ts", "src/app/api/empresas/[slug]/tms/cotizaciones/[id]/pdf/route.ts"]) {
      const fuente = readFileSync(ruta, "utf8");
      expect(fuente, ruta).not.toMatch(/costeo/i);
      expect(fuente, ruta).not.toMatch(/snapshot/i);
    }
  });

  it("el endpoint del PDF sigue usando solo el guard comercial y obtenerCotizacion", () => {
    const fuente = readFileSync("src/app/api/empresas/[slug]/tms/cotizaciones/[id]/pdf/route.ts", "utf8");
    expect(fuente).toContain("requireTenantCotizaciones(slug, \"ver\")"); expect(fuente).toContain("obtenerCotizacion(");
  });

  it("el tipo Cotizacion (lo que llega al PDF, al listado y al GET normal) no tiene campos de costeo", () => {
    const fuente = readFileSync("src/lib/tms/cotizaciones.ts", "utf8");
    const tipo = fuente.slice(fuente.indexOf("export type Cotizacion = {"), fuente.indexOf("function mapRow"));
    expect(tipo).not.toMatch(/costeo|costoOperativo|precioSugerido|utilidad|margen/i);
    const select = fuente.slice(fuente.indexOf("const SELECT = `"), fuente.indexOf("export type FiltrosCotizaciones"));
    expect(select).not.toMatch(/costeo/i);
  });
});
