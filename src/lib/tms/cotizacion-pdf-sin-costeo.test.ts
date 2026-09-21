import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cotizacionPdf } from "./cotizacion-pdf";
import { COTIZACION_DOC } from "./cotizacion-documento.fixture";
import type { Cotizacion } from "./cotizaciones";

/**
 * COTIZACIONES-COSTEO / FASE 6 — el PDF comercial jamás contiene información de costeo interno (costo operativo,
 * precio sugerido, utilidad, margen, componentes, perfil, combustible, salarios). La separación se garantiza en
 * tres niveles: (1) el tipo de entrada no tiene esos campos, (2) el código del PDF no los referencia ni importa
 * módulos de costeo y (3) el texto renderizado no los contiene, para las dos plantillas.
 */
const COTIZACION: Cotizacion = { ...COTIZACION_DOC, incluyeIva: true, tarifaCotizada: 5600 };
afterEach(() => vi.restoreAllMocks());

const PROHIBIDAS = [
  "costeo", "costo operativo", "costo con iva", "iva del costo", "precio sugerido", "utilidad", "margen", "perfil", "componente",
  "combustible", "salario", "depreciaci", "llantas", "aceite", "viático", "viatico", "cabezal", "costeo_v1", "thermo", "gps mensual", "seguro del vehículo",
];

describe("PDF comercial sin costeo interno", () => {
  it.each(["KUIQTRANS", "MONACO"] as const)("el texto del PDF (%s) no contiene ningún dato de costeo", async (documentoEmisor) => {
    const texto = vi.spyOn(PDFDocument.prototype, "text");
    const buf = await cotizacionPdf({ ...COTIZACION, documentoEmisor });
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const contenido = texto.mock.calls.map((c) => String(c[0])).join("\n").toLowerCase();
    expect(contenido).toContain("cot-000123"); // sí es el PDF comercial
    expect(contenido).toContain("q5,600.00"); // el precio es tarifa_cotizada
    for (const prohibido of PROHIBIDAS) expect(contenido, `el PDF no debe mencionar "${prohibido}"`).not.toContain(prohibido);
  });

  it("aunque el usuario tenga un costeo guardado, el PDF imprime solo la tarifa cotizada confirmada (no el precio sugerido)", async () => {
    // Un objeto con campos de costeo "colados" (p. ej. por un cast) no puede filtrarse: el documento se arma campo por campo.
    const contaminada = { ...COTIZACION, precioSugerido: 7777.77, utilidad: 999, margenReal: 0.31, costoOperativo: 4321.1, combustible: 1500 } as unknown as Cotizacion;
    const texto = vi.spyOn(PDFDocument.prototype, "text");
    await cotizacionPdf(contaminada);
    const contenido = texto.mock.calls.map((c) => String(c[0])).join("\n");
    for (const dato of ["7,777.77", "7777.77", "999", "0.31", "4,321.10", "1,500.00"]) expect(contenido).not.toContain(dato);
    expect(contenido).toContain("Q5,600.00");
  });

  it("ni los módulos del PDF ni su endpoint referencian el costeo (ni importan sus módulos)", () => {
    for (const ruta of [
      "src/lib/tms/cotizacion-pdf.ts", "src/lib/tms/cotizacion-pdf-kuiqtrans.ts", "src/lib/tms/cotizacion-pdf-monaco.ts",
      "src/lib/tms/cotizacion-pdf-layout.ts", "src/lib/tms/cotizacion-documento.ts",
      "src/app/api/empresas/[slug]/tms/cotizaciones/[id]/pdf/route.ts",
    ]) {
      const fuente = readFileSync(ruta, "utf8");
      expect(fuente, ruta).not.toMatch(/costeo/i);
      expect(fuente, ruta).not.toMatch(/snapshot/i);
      expect(fuente, ruta).not.toMatch(/\b(precioSugerido|precio_sugerido|utilidad|margen)\b/i);
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
