import { describe, expect, it } from "vitest";
import {
  calcularCosteoServicio, costoCombustible, costoMensualProrrateado, costoPersonal, costoPorDesgasteKm, depreciacionServicio,
  ErrorCosteo, CODIGOS_PERFIL_COSTEO,
  type InputCosteoServicio, type ParametrosEconomicosCosteo, type PerfilCosteoUnidad,
} from "./cotizacion-costeo";

/**
 * Regresión contra COTIZADOR RUTAS.xlsx (hoja "Contenedores", cabezal). Los
 * valores esperados son los resultados en caché del libro; las entradas
 * (GPS 174.10/170.72, seguro 1550, aceite 1860/5000, llantas 38466 con vida
 * 50,000 km — el libro usa 38466/900000×18, que es lo mismo —, combustible
 * 29.89 a 9.3 km/gal, piloto 207.74, auxiliar 148.04) se leyeron de las
 * celdas. Los viáticos del libro NO escalan con días ni con personas, así que
 * estos escenarios usan los overrides explícitos (Fase 2, sección 12).
 */
const PARAMETROS: ParametrosEconomicosCosteo = {
  precioCombustibleGalon: 29.89, ivaTasa: 0.12, costoPilotoDia: 207.74, costoAuxiliarDia: 148.04,
  viaticoPilotoDia: 100, viaticoAuxiliarDia: 80, viaticoGuiaDia: 60,
};
// El libro no tiene hotel; los tests de hotel lo activan explícitamente.
const CON_HOTEL: ParametrosEconomicosCosteo = { ...PARAMETROS, hotelDia: 300 };
const perfil = (over: Partial<PerfilCosteoUnidad> = {}): PerfilCosteoUnidad => ({
  codigo: "CABEZAL", nombre: "Cabezal", diasOperacionMes: 30, gpsMensual: 174.1, seguroVehiculoMensual: 1550,
  costoAceiteServicio: 1860, vidaUtilAceiteKm: 5000, costoJuegoLlantas: 38466, vidaUtilLlantasKm: 50000, rendimientoKmGalon: 9.3, ...over,
});
const input = (over: Partial<InputCosteoServicio> = {}): InputCosteoServicio => ({
  perfil: perfil(), parametros: PARAMETROS, distanciaKm: 100, diasServicio: 1, cantidadPilotos: 1, cantidadAuxiliares: 1,
  incluirGps: true, incluirSeguroVehiculo: true, ...over,
});
const contenedor = (km: number, over: Partial<InputCosteoServicio> = {}) => input({
  distanciaKm: km, cantidadPilotos: 2, cantidadAuxiliares: 6,
  viaticoPilotoTotal: 150, viaticoGuiaTotal: 125, viaticoAuxiliarTotal: 200, ...over,
});

describe("Regresión contra el libro (Contenedores)", () => {
  it("Puerto Barrios 600 km: componentes y totales", () => {
    const r = calcularCosteoServicio(contenedor(600, {
      perfil: perfil(), cantidadAuxiliares: 2, viaticoPilotoTotal: 200, viaticoGuiaTotal: 125, viaticoAuxiliarTotal: 200,
    }));
    expect(r.gps).toBeCloseTo(5.803333333333333, 9);
    expect(r.seguroVehiculo).toBeCloseTo(51.666666666666664, 9);
    expect(r.aceite).toBeCloseTo(223.2, 9);
    expect(r.llantas).toBeCloseTo(461.592, 9);
    expect(r.combustible).toBeCloseTo(1928.3870967741934, 9);
    expect(r.piloto).toBeCloseTo(415.48, 9);
    expect(r.auxiliares).toBeCloseTo(296.08, 9);
    expect([r.viaticoPiloto, r.viaticoGuia, r.viaticoAuxiliar]).toEqual([200, 125, 200]);
    expect(r.depreciacion).toBe(0); expect(r.refrigeracion).toBe(0);
    expect(r.costoOperativo).toBeCloseTo(3907.2090967741933, 6);
    expect(r.iva).toBeCloseTo(468.8650916129032, 6);
    expect(r.costoConIva).toBeCloseTo(4376.074188387097, 6);
  });

  it.each([
    ["Escuintla", 132, 174.1, [100, 75, 100], 2211.0894012903227, 265.3307281548387, 2476.4201294451614],
    ["Mazatenango", 324, 170.72, [150, 125, 200], 3247.1940455913978, 389.6632854709677, 3636.8573310623656],
    // Más celdas del mismo libro (mismos parámetros, auxiliares ×6, viáticos 150/125/200).
    ["Coatepeque", 502, 174.1, [150, 125, 200], 4022.5498443010756, 482.70598131612905, 4505.255825617205],
    ["Cobán", 437, 174.1, [150, 125, 200], 3739.4554421505372, 448.73465305806445, 4188.190095208602],
    ["Chiquimula", 356, 174.1, [150, 125, 200], 3386.6762640860215, 406.4011516903226, 3793.077415776344],
    ["Quetzaltenango", 392, 174.1, [150, 125, 200], 3543.4670098924726, 425.21604118709666, 3968.6830510795694],
  ] as const)("%s %i km reproduce costo, IVA y costo con IVA del libro", (_ruta, km, gps, [vPiloto, vGuia, vAux], costo, iva, conIva) => {
    const r = calcularCosteoServicio(contenedor(km, { perfil: perfil({ gpsMensual: gps }), viaticoPilotoTotal: vPiloto, viaticoGuiaTotal: vGuia, viaticoAuxiliarTotal: vAux }));
    expect(r.costoOperativo).toBeCloseTo(costo, 6);
    expect(r.iva).toBeCloseTo(iva, 6);
    expect(r.costoConIva).toBeCloseTo(conIva, 6);
  });

  it("Escuintla: aceite/llantas/combustible por km coinciden con las celdas del libro", () => {
    const r = calcularCosteoServicio(contenedor(132, { viaticoPilotoTotal: 100, viaticoGuiaTotal: 75, viaticoAuxiliarTotal: 100 }));
    expect(r.aceite).toBeCloseTo(49.104, 9); expect(r.llantas).toBeCloseTo(101.55024, 9); expect(r.combustible).toBeCloseTo(424.2451612903226, 9);
    expect(r.auxiliares).toBeCloseTo(888.24, 9);
  });

  it("Depreciación y Thermo (hoja COSTEO 5 TON): valor/60/26, cada equipo por separado", () => {
    // G14 = 182142.86 (camión), I14 = 100000 (Thermo), 5 años, 26 días → G17 = 116.75824358974357, I17 = 64.1025641025641.
    const conEquipos = perfil({
      depreciacion: { valorBase: 182142.86, anios: 5, diasOperacionMes: 26 },
      costoRefrigeracion: { valorBase: 100000, anios: 5, diasOperacionMes: 26 },
    });
    const r = calcularCosteoServicio(input({ perfil: conEquipos, usarRefrigeracion: true, distanciaKm: 0 }));
    expect(r.depreciacion).toBeCloseTo(116.75824358974357, 9);
    expect(r.refrigeracion).toBeCloseTo(64.1025641025641, 9);
    expect(r.depreciacion + r.refrigeracion).toBeCloseTo(180.86080769230767, 9); // J17 del libro
  });
});

describe("Fórmulas por componente", () => {
  it("depreciación: valor / (años×12) / días operación × días de servicio", () => {
    expect(depreciacionServicio({ valorBase: 120000, anios: 5, diasOperacionMes: 25 }, 3)).toBeCloseTo((120000 / 60 / 25) * 3, 10);
  });
  it("GPS/seguro: mensual ÷ días de operación × días (usa el parámetro, no un 30 fijo)", () => {
    expect(costoMensualProrrateado(300, 30, 2)).toBeCloseTo(20, 10);
    expect(costoMensualProrrateado(300, 26, 2)).toBeCloseTo((300 / 26) * 2, 10);
    const r = calcularCosteoServicio(input({ perfil: perfil({ diasOperacionMes: 26, gpsMensual: 260, seguroVehiculoMensual: 520 }), diasServicio: 3 }));
    expect(r.gps).toBeCloseTo(30, 10); expect(r.seguroVehiculo).toBeCloseTo(60, 10);
  });
  it("aceite y llantas: (costo / vida útil) × km", () => {
    expect(costoPorDesgasteKm(1860, 5000, 600)).toBeCloseTo(223.2, 10);
    expect(costoPorDesgasteKm(38466, 50000, 600)).toBeCloseTo(461.592, 10);
  });
  it("combustible: (km / rendimiento) × precio del galón", () => {
    expect(costoCombustible(600, 9.3, 29.89)).toBeCloseTo(1928.3870967741934, 9);
    expect(costoCombustible(600, 12, 29.89)).toBeCloseTo(1494.5, 9);
  });
  it("personal: costo día × días × cantidad", () => {
    expect(costoPersonal(207.74, 3, 2)).toBeCloseTo(1246.44, 10);
  });
  it("viáticos automáticos: día × días × cantidad; hotel: día × días", () => {
    const r = calcularCosteoServicio(input({ parametros: CON_HOTEL, diasServicio: 3, cantidadPilotos: 2, cantidadAuxiliares: 3, cantidadGuias: 1 }));
    expect(r.viaticoPiloto).toBe(100 * 3 * 2); expect(r.viaticoAuxiliar).toBe(80 * 3 * 3); expect(r.viaticoGuia).toBe(60 * 3 * 1);
    expect(r.hotel).toBe(300 * 3);
  });
  it("los overrides prevalecen sobre el cálculo automático (incluido 0 y hotel)", () => {
    const r = calcularCosteoServicio(input({ parametros: CON_HOTEL, diasServicio: 3, cantidadPilotos: 2, viaticoPilotoTotal: 0, viaticoAuxiliarTotal: 10, viaticoGuiaTotal: 20, hotelTotal: 5 }));
    expect([r.viaticoPiloto, r.viaticoAuxiliar, r.viaticoGuia, r.hotel]).toEqual([0, 10, 20, 5]);
  });
  it("sin hotelDia ni override, el hotel es 0", () => {
    expect(calcularCosteoServicio(input()).hotel).toBe(0);
  });
});

describe("Escenarios", () => {
  it("0 km: no hay costos por distancia pero sí los costos por día", () => {
    const r = calcularCosteoServicio(input({ distanciaKm: 0 }));
    expect([r.aceite, r.llantas, r.combustible]).toEqual([0, 0, 0]);
    expect(r.gps).toBeGreaterThan(0); expect(r.piloto).toBeGreaterThan(0);
  });
  it("1 día vs varios días: lo diario escala, lo por km no", () => {
    const uno = calcularCosteoServicio(input({ diasServicio: 1 })); const cuatro = calcularCosteoServicio(input({ diasServicio: 4 }));
    expect(cuatro.gps).toBeCloseTo(uno.gps * 4, 10); expect(cuatro.piloto).toBeCloseTo(uno.piloto * 4, 10);
    expect(cuatro.combustible).toBe(uno.combustible);
  });
  it("sin GPS / sin seguro: esos componentes son 0", () => {
    const r = calcularCosteoServicio(input({ incluirGps: false, incluirSeguroVehiculo: false }));
    expect(r.gps).toBe(0); expect(r.seguroVehiculo).toBe(0);
  });
  it("seguro de mercadería entra como monto del servicio", () => {
    expect(calcularCosteoServicio(input({ seguroMercaderia: 250, diasServicio: 5 })).seguroMercaderia).toBe(250);
  });
  it("sin auxiliares / varios auxiliares", () => {
    expect(calcularCosteoServicio(input({ cantidadAuxiliares: 0 })).auxiliares).toBe(0);
    expect(calcularCosteoServicio(input({ cantidadAuxiliares: 3 })).auxiliares).toBeCloseTo(148.04 * 3, 10);
  });
  it("sin pilotos ni guías definidos: cantidades 0 dan 0", () => {
    const r = calcularCosteoServicio(input({ cantidadPilotos: 0, cantidadAuxiliares: 0 }));
    expect([r.piloto, r.viaticoPiloto, r.viaticoGuia]).toEqual([0, 0, 0]);
  });
  it("refrigeración off = 0 aunque el perfil la tenga; on usa el perfil y no toca la depreciación del vehículo", () => {
    const p = perfil({ depreciacion: { valorBase: 60000, anios: 5, diasOperacionMes: 25 }, costoRefrigeracion: { valorBase: 30000, anios: 5, diasOperacionMes: 25 } });
    const off = calcularCosteoServicio(input({ perfil: p, usarRefrigeracion: false })); const on = calcularCosteoServicio(input({ perfil: p, usarRefrigeracion: true }));
    expect(off.refrigeracion).toBe(0); expect(on.refrigeracion).toBeCloseTo(30000 / 60 / 25, 10);
    expect(on.depreciacion).toBe(off.depreciacion); expect(on.depreciacion).toBeCloseTo(60000 / 60 / 25, 10);
    expect(on.costoOperativo).toBeCloseTo(off.costoOperativo + on.refrigeracion, 10);
  });
  it("refrigeración solicitada sin configuración en el perfil es un error, no un 0 silencioso", () => {
    expect(() => calcularCosteoServicio(input({ usarRefrigeracion: true }))).toThrow(ErrorCosteo);
  });
  it("otros costos: suma, renglón propio en componentes y entra al costo operativo", () => {
    const base = calcularCosteoServicio(input());
    const r = calcularCosteoServicio(input({ otrosCostos: [{ concepto: "Peaje", monto: 100 }, { concepto: " Custodio ", monto: 250 }] }));
    expect(r.otrosCostos).toBe(350); expect(r.costoOperativo).toBeCloseTo(base.costoOperativo + 350, 10);
    expect(r.componentes.filter(c => c.clave.startsWith("otro:")).map(c => [c.concepto, c.monto])).toEqual([["Peaje", 100], ["Custodio", 250]]);
  });
  it("invariante: la suma de componentes es el costo operativo, antes del IVA", () => {
    const r = calcularCosteoServicio(contenedor(600, { otrosCostos: [{ concepto: "Peaje", monto: 37.5 }] }));
    expect(r.componentes.reduce((s, c) => s + c.monto, 0)).toBeCloseTo(r.costoOperativo, 10);
    expect(r.costoConIva).toBeCloseTo(r.costoOperativo * 1.12, 10);
  });
  it("combustible y rendimiento distintos cambian solo el combustible", () => {
    const base = calcularCosteoServicio(input()); const caro = calcularCosteoServicio(input({ parametros: { ...PARAMETROS, precioCombustibleGalon: 59.89 } }));
    const eficiente = calcularCosteoServicio(input({ perfil: perfil({ rendimientoKmGalon: 18.6 }) }));
    expect(caro.combustible).toBeCloseTo(base.combustible * (59.89 / 29.89), 9); expect(eficiente.combustible).toBeCloseTo(base.combustible / 2, 9);
    expect(caro.aceite).toBe(base.aceite);
  });
  it("IVA por parámetro (no fijo en el motor)", () => {
    const r = calcularCosteoServicio(input({ parametros: { ...PARAMETROS, ivaTasa: 0 } }));
    expect(r.iva).toBe(0); expect(r.costoConIva).toBe(r.costoOperativo);
  });
});

describe("Margen, precio sugerido y rentabilidad", () => {
  it.each([[0, 1], [0.15, 1.15], [0.2, 1.2]])("margen %s: precio sugerido = costo con IVA × %s", (margen, factor) => {
    const r = calcularCosteoServicio(input({ margenObjetivo: margen }));
    expect(r.margenObjetivoAplicado).toBe(margen);
    expect(r.precioSugerido).toBeCloseTo(r.costoConIva * factor, 10);
    expect(r.margenObjetivoMonto).toBeCloseTo(r.costoConIva * margen, 10);
  });
  it("el margen del input prevalece sobre el de los parámetros; sin ninguno es 0", () => {
    expect(calcularCosteoServicio(input({ parametros: { ...PARAMETROS, margenObjetivo: 0.15 } })).margenObjetivoAplicado).toBe(0.15);
    expect(calcularCosteoServicio(input({ parametros: { ...PARAMETROS, margenObjetivo: 0.15 }, margenObjetivo: 0.2 })).margenObjetivoAplicado).toBe(0.2);
    expect(calcularCosteoServicio(input()).margenObjetivoAplicado).toBe(0);
  });
  it("precioVenta null/ausente: sin utilidad ni margen real", () => {
    for (const precioVenta of [null, undefined]) {
      const r = calcularCosteoServicio(input({ precioVenta }));
      expect([r.precioVenta, r.utilidadEstimada, r.margenReal]).toEqual([null, null, null]);
    }
  });
  it("precioVenta > costo: utilidad y margen real positivos (sobre costo con IVA)", () => {
    const base = calcularCosteoServicio(input()); const r = calcularCosteoServicio(input({ precioVenta: base.costoConIva * 1.25 }));
    expect(r.utilidadEstimada).toBeCloseTo(base.costoConIva * 0.25, 9); expect(r.margenReal).toBeCloseTo(0.25, 9);
  });
  it("precioVenta < costo: utilidad y margen real negativos", () => {
    const base = calcularCosteoServicio(input()); const r = calcularCosteoServicio(input({ precioVenta: base.costoConIva * 0.9 }));
    expect(r.utilidadEstimada).toBeLessThan(0); expect(r.margenReal).toBeCloseTo(-0.1, 9);
  });
  it("costo con IVA = 0: margenReal es null (sin dividir entre cero)", () => {
    const cero = input({
      distanciaKm: 0, incluirGps: false, incluirSeguroVehiculo: false, cantidadPilotos: 0, cantidadAuxiliares: 0,
      perfil: perfil({ costoAceiteServicio: 0, costoJuegoLlantas: 0 }), precioVenta: 500,
    });
    const r = calcularCosteoServicio(cero);
    expect(r.costoConIva).toBe(0); expect(r.margenReal).toBeNull(); expect(r.utilidadEstimada).toBe(500);
  });
});

describe("Validación", () => {
  const falla = (over: Partial<InputCosteoServicio>, campo: string) => {
    try { calcularCosteoServicio(input(over)); } catch (e) { expect(e).toBeInstanceOf(ErrorCosteo); expect((e as ErrorCosteo).campo).toBe(campo); return; }
    throw new Error(`Se esperaba ErrorCosteo en ${campo}`);
  };
  it("NaN e Infinity se rechazan en cualquier número", () => {
    falla({ distanciaKm: NaN }, "distanciaKm"); falla({ distanciaKm: Infinity }, "distanciaKm");
    falla({ diasServicio: NaN }, "diasServicio"); falla({ precioVenta: Infinity }, "precioVenta");
    falla({ parametros: { ...PARAMETROS, precioCombustibleGalon: NaN } }, "parametros.precioCombustibleGalon");
    falla({ perfil: perfil({ gpsMensual: Infinity }) }, "perfil.gpsMensual");
    falla({ cantidadPilotos: NaN }, "cantidadPilotos");
  });
  it("valores no numéricos se rechazan", () => {
    falla({ distanciaKm: "100" as unknown as number }, "distanciaKm");
  });
  it("distancia negativa; días 0 o negativos", () => {
    falla({ distanciaKm: -1 }, "distanciaKm"); falla({ diasServicio: 0 }, "diasServicio"); falla({ diasServicio: -2 }, "diasServicio");
  });
  it("vida útil 0 (aceite y llantas) y rendimiento 0 → error", () => {
    falla({ perfil: perfil({ vidaUtilAceiteKm: 0 }) }, "perfil.vidaUtilAceiteKm");
    falla({ perfil: perfil({ vidaUtilLlantasKm: 0 }) }, "perfil.vidaUtilLlantasKm");
    falla({ perfil: perfil({ rendimientoKmGalon: 0 }) }, "perfil.rendimientoKmGalon");
    falla({ perfil: perfil({ diasOperacionMes: 0 }) }, "perfil.diasOperacionMes");
  });
  it("cantidades de personal negativas", () => {
    falla({ cantidadPilotos: -1 }, "cantidadPilotos"); falla({ cantidadAuxiliares: -1 }, "cantidadAuxiliares"); falla({ cantidadGuias: -1 }, "cantidadGuias");
  });
  it("porcentajes inválidos: IVA fuera de 0–1 o negativo; margen negativo", () => {
    falla({ parametros: { ...PARAMETROS, ivaTasa: 12 } }, "parametros.ivaTasa");
    falla({ parametros: { ...PARAMETROS, ivaTasa: -0.1 } }, "parametros.ivaTasa");
    falla({ margenObjetivo: -0.1 }, "margenObjetivo");
  });
  it("depreciación con años o días inválidos; otros costos sin concepto o negativos; overrides negativos", () => {
    falla({ perfil: perfil({ depreciacion: { valorBase: 1000, anios: 0, diasOperacionMes: 26 } }) }, "perfil.depreciacion.anios");
    falla({ perfil: perfil({ depreciacion: { valorBase: 1000, anios: 5, diasOperacionMes: 0 } }) }, "perfil.depreciacion.diasOperacionMes");
    falla({ otrosCostos: [{ concepto: "  ", monto: 1 }] }, "otrosCostos[0].concepto");
    falla({ otrosCostos: [{ concepto: "Peaje", monto: -1 }] }, "otrosCostos[0].monto");
    falla({ viaticoPilotoTotal: -5 }, "viaticoPilotoTotal");
  });
});

describe("Pureza", () => {
  it("es determinista y no muta su entrada", () => {
    const entrada = contenedor(600, { otrosCostos: [{ concepto: "Peaje", monto: 10 }] });
    const copia = structuredClone(entrada);
    const a = calcularCosteoServicio(entrada); const b = calcularCosteoServicio(entrada);
    expect(a).toEqual(b); expect(entrada).toEqual(copia);
  });
  it("no redondea: conserva la precisión completa", () => {
    const r = calcularCosteoServicio(contenedor(600));
    expect(r.combustible).not.toBe(Math.round(r.combustible * 100) / 100);
    expect(r.gps).not.toBe(Math.round(r.gps * 100) / 100);
  });
  it("el motor no depende de DB, React ni de cotizaciones.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const fuente = readFileSync("src/lib/tms/cotizacion-costeo.ts", "utf8");
    expect(fuente).not.toMatch(/^import /m); expect(fuente).not.toMatch(/Date\.now|new Date\(|process\.env|@\/lib\/db|from "react"/);
  });
  it("catálogo de códigos de perfil (solo referencia; sin valores económicos)", () => {
    expect(CODIGOS_PERFIL_COSTEO.map(p => p.codigo)).toEqual(["CAMION_2_7T", "CAMION_5T", "CAMION_5T_REFRIGERADO", "CAMION_10T", "CABEZAL"]);
  });
});
