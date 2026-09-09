import { describe, expect, it } from "vitest";
import { aplicarDefaultsRutaCotizacion } from "./cotizacion-defaults";

const vacio = { tarifaCotizada: "", origenTexto: "", destinoTexto: "" };
const ruta = { tarifaReferencia: 1250, origenTexto: "Bodega Zona 12", destinoTexto: "PriceSmart Miraflores" };

describe("defaults de ruta en el cotizador (COTIZADOR-TMS-1)", () => {
  it("precarga tarifa, origen y destino en campos vacíos", () => {
    expect(aplicarDefaultsRutaCotizacion(vacio, ruta)).toEqual({
      tarifaCotizada: "1250",
      origenTexto: "Bodega Zona 12",
      destinoTexto: "PriceSmart Miraflores",
    });
  });

  it("NO pisa una tarifa ya editada manualmente", () => {
    const actual = { ...vacio, tarifaCotizada: "999" };
    expect(aplicarDefaultsRutaCotizacion(actual, ruta).tarifaCotizada).toBe("999");
  });

  it("NO pisa origen/destino ya editados manualmente", () => {
    const actual = { tarifaCotizada: "", origenTexto: "Origen manual", destinoTexto: "Destino manual" };
    const r = aplicarDefaultsRutaCotizacion(actual, ruta);
    expect(r.origenTexto).toBe("Origen manual");
    expect(r.destinoTexto).toBe("Destino manual");
  });

  it("ruta sin tarifa/origen/destino capturados no inventa valores", () => {
    const rutaVacia = { tarifaReferencia: null, origenTexto: null, destinoTexto: null };
    expect(aplicarDefaultsRutaCotizacion(vacio, rutaVacia)).toEqual(vacio);
  });

  it("edita solo el campo vacío, preserva los demás ya capturados", () => {
    const actual = { tarifaCotizada: "500", origenTexto: "", destinoTexto: "Destino ya puesto" };
    const r = aplicarDefaultsRutaCotizacion(actual, ruta);
    expect(r).toEqual({ tarifaCotizada: "500", origenTexto: "Bodega Zona 12", destinoTexto: "Destino ya puesto" });
  });

  it("TMS-SIN-COSTO-OPERATIVO-1: RutaDefaultCotizacion ya no acepta/usa costoOperativo (campo retirado)", () => {
    const r = aplicarDefaultsRutaCotizacion(vacio, ruta);
    expect(r).not.toHaveProperty("costoOperativo");
  });
});
