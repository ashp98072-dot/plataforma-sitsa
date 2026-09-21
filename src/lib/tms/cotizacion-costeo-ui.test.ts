import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COSTEO_FORM_VACIO, aplicarPerfilCosteo, aplicarPrecioSugerido, componentesVisibles, construirPayloadCosteo, huellaCosteo, monedaCosteo, porcentajeCosteo,
  type CosteoFormState, type PerfilOpcion,
} from "./cotizacion-costeo-ui";

const CABEZAL: PerfilOpcion = { id: 4, codigo: "CABEZAL", nombre: "Cabezal", gpsMensual: 174.1, seguroVehiculoMensual: 1550, costoRefrigeracion: null };
const REFRIGERADO: PerfilOpcion = { id: 3, codigo: "CAMION_5T_REFRIGERADO", nombre: "5T refrigerado", gpsMensual: 0, seguroVehiculoMensual: 0, costoRefrigeracion: { valorBase: 1 } };
const form = (over: Partial<CosteoFormState> = {}): CosteoFormState => ({ ...COSTEO_FORM_VACIO, perfilId: 4, distanciaKm: "600", ...over });

describe("Valores iniciales al elegir perfil", () => {
  it("defaults razonables: 1 día, 1 piloto, 0 auxiliares, 0 guías, sin refrigeración, sin distancia inventada", () => {
    expect(COSTEO_FORM_VACIO).toMatchObject({ diasServicio: "1", cantidadPilotos: "1", cantidadAuxiliares: "0", cantidadGuias: "0", usarRefrigeracion: false, distanciaKm: "" });
  });
  it("la primera vez, GPS/seguro se sugieren si el perfil los tiene (> 0)", () => {
    expect(aplicarPerfilCosteo(COSTEO_FORM_VACIO, CABEZAL)).toMatchObject({ perfilId: 4, incluirGps: true, incluirSeguroVehiculo: true });
    expect(aplicarPerfilCosteo(COSTEO_FORM_VACIO, REFRIGERADO)).toMatchObject({ perfilId: 3, incluirGps: false, incluirSeguroVehiculo: false });
  });
  it("cambiar de perfil después NO sobrescribe lo que el usuario ya editó", () => {
    const editado = form({ incluirGps: false, incluirSeguroVehiculo: false, distanciaKm: "250", cantidadAuxiliares: "3", viaticoPilotoTotal: "150", margenObjetivoPct: "15" });
    const cambiado = aplicarPerfilCosteo(editado, CABEZAL);
    expect(cambiado).toMatchObject({ incluirGps: false, incluirSeguroVehiculo: false, distanciaKm: "250", cantidadAuxiliares: "3", viaticoPilotoTotal: "150", margenObjetivoPct: "15" });
  });
  it("un perfil sin refrigeración apaga 'usar refrigeración'; sin perfil se limpia la selección", () => {
    expect(aplicarPerfilCosteo(form({ usarRefrigeracion: true }), CABEZAL).usarRefrigeracion).toBe(false);
    expect(aplicarPerfilCosteo(form({ perfilId: 3, usarRefrigeracion: true }), REFRIGERADO).usarRefrigeracion).toBe(true);
    expect(aplicarPerfilCosteo(form(), null).perfilId).toBe(0);
  });
});

describe("construirPayloadCosteo", () => {
  it("convierte el formulario en datos operativos; margen % => fracción; sin parámetros económicos", () => {
    const r = construirPayloadCosteo(form({ diasServicio: "2", cantidadPilotos: "2", cantidadAuxiliares: "1", incluirGps: true, seguroMercaderia: "250", margenObjetivoPct: "20" }));
    expect(r).toEqual({ ok: true, payload: { perfilId: 4, distanciaKm: 600, diasServicio: 2, cantidadPilotos: 2, cantidadAuxiliares: 1, cantidadGuias: 0, incluirGps: true, incluirSeguroVehiculo: false, usarRefrigeracion: false, seguroMercaderia: 250, margenObjetivo: 0.2 } });
  });
  it("los overrides vacíos NO viajan (nunca 0 implícito); los escritos sí, incluido 0", () => {
    const vacio = construirPayloadCosteo(form());
    expect(vacio.ok && ["viaticoPilotoTotal", "viaticoAuxiliarTotal", "viaticoGuiaTotal", "hotelTotal", "seguroMercaderia", "otrosCostos", "margenObjetivo"].some((k) => k in vacio.payload)).toBe(false);
    const con = construirPayloadCosteo(form({ viaticoPilotoTotal: "0", hotelTotal: "300" }));
    expect(con.ok && con.payload).toMatchObject({ viaticoPilotoTotal: 0, hotelTotal: 300 });
  });
  it("otros costos: ignora renglones vacíos, recorta el concepto y valida", () => {
    const r = construirPayloadCosteo(form({ otrosCostos: [{ concepto: " Peaje ", monto: "100" }, { concepto: "", monto: "" }] }));
    expect(r.ok && r.payload.otrosCostos).toEqual([{ concepto: "Peaje", monto: 100 }]);
    expect(construirPayloadCosteo(form({ otrosCostos: [{ concepto: "Peaje", monto: "" }] })).ok).toBe(false);
    expect(construirPayloadCosteo(form({ otrosCostos: [{ concepto: "", monto: "5" }] })).ok).toBe(false);
  });
  it.each([
    [{ perfilId: 0 }, "perfil"], [{ distanciaKm: "" }, "distancia"], [{ distanciaKm: "-5" }, "distancia"], [{ diasServicio: "0" }, "días"],
    [{ cantidadPilotos: "-1" }, "cantidades"], [{ hotelTotal: "-3" }, "opcionales"], [{ margenObjetivoPct: "-1" }, "margen"], [{ distanciaKm: "abc" }, "distancia"],
  ] as [Partial<CosteoFormState>, string][])("rechaza datos inválidos %j sin llegar al servidor", (over) => {
    expect(construirPayloadCosteo(form(over)).ok).toBe(false);
  });
});

describe("huella: un resultado solo es válido para los datos con los que se calculó", () => {
  const payload = (over: Partial<CosteoFormState> = {}) => { const r = construirPayloadCosteo(form(over)); if (!r.ok) throw new Error(r.error); return r.payload; };
  const ctx = { fechaEmision: "2026-09-21", tarifaCotizada: "5000", incluyeIva: false };
  it("cambia con cualquier dato operativo o comercial (fecha, tarifa, IVA)", () => {
    const base = huellaCosteo(payload(), ctx);
    expect(huellaCosteo(payload(), ctx)).toBe(base);
    expect(huellaCosteo(payload({ distanciaKm: "601" }), ctx)).not.toBe(base);
    expect(huellaCosteo(payload(), { ...ctx, fechaEmision: "2026-10-01" })).not.toBe(base);
    expect(huellaCosteo(payload(), { ...ctx, tarifaCotizada: "5500" })).not.toBe(base);
    expect(huellaCosteo(payload(), { ...ctx, incluyeIva: true })).not.toBe(base);
  });
});

describe("Usar precio sugerido", () => {
  it("pone la tarifa = precio sugerido (2 decimales) e incluyeIva = true, sin tocar el resto del formulario", () => {
    const antes = { tarifaCotizada: "1400", incluyeIva: false, clienteId: 3, observaciones: "x" };
    const despues = aplicarPrecioSugerido(antes, 5251.289026);
    expect(despues).toEqual({ tarifaCotizada: "5251.29", incluyeIva: true, clienteId: 3, observaciones: "x" });
    expect(antes).toEqual({ tarifaCotizada: "1400", incluyeIva: false, clienteId: 3, observaciones: "x" }); // inmutable
  });
  it("incluyeIva queda en true aunque ya lo estuviera o no", () => {
    expect(aplicarPrecioSugerido({ tarifaCotizada: "", incluyeIva: true }, 100).incluyeIva).toBe(true);
    expect(aplicarPrecioSugerido({ tarifaCotizada: "", incluyeIva: false }, 100).incluyeIva).toBe(true);
  });
  it("redondea a centavos sin errores de coma flotante", () => {
    expect(aplicarPrecioSugerido({ tarifaCotizada: "", incluyeIva: false }, 1.005).tarifaCotizada).toMatch(/^1\.0[01]$/);
    expect(aplicarPrecioSugerido({ tarifaCotizada: "", incluyeIva: false }, 4376.074188387097 * 1.2).tarifaCotizada).toBe("5251.29");
  });
});

describe("Presentación", () => {
  it("formatos de moneda y porcentaje", () => {
    expect(monedaCosteo(1234.5)).toBe("Q1,234.50"); expect(monedaCosteo(null)).toBe("—");
    expect(porcentajeCosteo(0.2)).toBe("20.00 %"); expect(porcentajeCosteo(null)).toBe("—");
  });
  it("en pantalla se omiten componentes en 0 (el snapshot guarda todos)", () => {
    const comps = [{ clave: "a", concepto: "A", monto: 0 }, { clave: "b", concepto: "B", monto: 5 }];
    expect(componentesVisibles(comps)).toEqual([comps[1]]);
  });
  it("el módulo de helpers es client-safe: sin imports de servidor ni de DB", () => {
    const fuente = readFileSync("src/lib/tms/cotizacion-costeo-ui.ts", "utf8");
    expect(fuente).not.toMatch(/@\/lib\/db|mysql|node:|next\/server|cotizaciones"|cotizacion-costeo-db|cotizacion-costeo-servicio/);
  });
});
