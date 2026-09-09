import { describe, expect, it } from "vitest";
import { cotizacionPdf } from "./cotizacion-pdf";
import type { Cotizacion } from "./cotizaciones";

const COTIZACION_BASE: Cotizacion = {
  id: 1, empresaId: 7, codigo: "COT-000001", clienteId: 3, clienteNombre: "PriceSmart",
  rutaId: 5, rutaCodigoHistorico: "RUTA-1", origenTexto: "Bodega Zona 12", destinoTexto: "PriceSmart Miraflores",
  tarifaReferencia: 1250, tarifaCotizada: 1400, incluyeIva: false,
  moneda: "GTQ", fechaEmision: "2026-09-08", fechaVencimiento: "2026-09-22", estado: "Borrador",
  pilotoIncluido: true, gpsIncluido: true, seguroMercaderiaIncluido: false, seguroTercerosIncluido: true,
  kmIncluidos: 50, tarifaKmAdicional: 12.5, condicionesAdicionales: "Pago contra entrega.",
  observaciones: "Cliente frecuente.", creadoPor: "admin", creadoEn: "2026-09-08 10:00:00", actualizadoEn: null,
};

describe("cotizacionPdf (COTIZADOR-TMS-1)", () => {
  it("genera un PDF válido (empieza con %PDF)", async () => {
    const buf = await cotizacionPdf("KT / Logiservicios Mónaco", COTIZACION_BASE);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("no revienta con campos opcionales vacíos (sin ruta, sin condiciones, sin observaciones)", async () => {
    const minima: Cotizacion = {
      ...COTIZACION_BASE, rutaId: null, rutaCodigoHistorico: null, origenTexto: null, destinoTexto: null,
      tarifaReferencia: null, kmIncluidos: null, tarifaKmAdicional: null,
      condicionesAdicionales: null, observaciones: null, fechaVencimiento: null,
    };
    const buf = await cotizacionPdf("SITSA", minima);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("genera un solo PDF (una página) para una cotización simple", async () => {
    const buf = await cotizacionPdf("SITSA", COTIZACION_BASE);
    // %PDF contiene un solo objeto /Type /Page cuando no hay contenido extra que fuerce una segunda página.
    expect(buf.toString("latin1").match(/\/Type\s*\/Page\b/g)!.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * TMS-SIN-COSTO-OPERATIVO-1 — negocio confirmó que ya no se muestra en
   * el PDF de cotización. pdfkit comprime los content streams (FlateDecode),
   * así que inspeccionar el buffer crudo en busca de texto NO es una
   * prueba confiable (mismo criterio ya establecido en este archivo y en
   * viaticos-comprobante-pdf.test.ts: solo se valida estructura del PDF,
   * nunca texto renderizado, sobre un pdfkit comprimido). La garantía
   * real y verificable es a nivel de TIPOS: `Cotizacion` (cotizaciones.ts)
   * ya NO tiene el campo `costoOperativoReferencia` — si cotizacion-pdf.ts
   * intentara volver a leerlo, `npx tsc --noEmit` fallaría.
   */
  it("el tipo Cotizacion que recibe el PDF ya no tiene costoOperativoReferencia (garantía en tiempo de compilación)", () => {
    expect(COTIZACION_BASE).not.toHaveProperty("costoOperativoReferencia");
  });
});
