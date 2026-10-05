import Decimal from "decimal.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COTIZACION_COSTEO_COTIZADOR_V2_VERSION, COTIZACION_COSTEO_COTIZADOR_VERSION, calcularCosteoServicio, esMotorCotizador2026,
  type InputCosteoServicio, type ParametrosEconomicosCosteo, type PerfilCosteoUnidad, type ResultadoCosteoServicio,
} from "./cotizacion-costeo";

/**
 * PARIDAD MATEMÁTICA EXACTA con «Cotizador 2026.xlsx» — COSTEO_COTIZADOR_2026_V2.
 *
 * LIBRO = valores leídos DIRECTAMENTE del archivo (openpyxl; fórmulas y valores en caché), hojas «Camion 1 ton», «Camion de 2.7», «Camion de 5», «Camion de 10» y «Cabezales »
 * (NO «COTIZADOR RUTAS»). Cada número de `excel` es la celda D16:O16 / P16 / Q16 / R16 / G3 / H3 tal como la calculó Excel (doble precisión). `literales` son las celdas escritas a mano
 * (no fórmulas) de la fila 12 que NO coinciden con el valor derivable: «Seguro merca» E12 = 6.34 (no el 6.3405797… de J7) en las cinco hojas, «Auxiliar» M12 = 302 en 2.7T y «Piloto» L12 = 339.38 en 5T.
 * El motor no las normaliza: las fixtures las reproducen con los mismos datos de entrada (seguro manual = total del servicio; salario mensual = diario escrito × 20).
 *
 * El libro NO redondea por componente: conserva la precisión y la celda solo muestra 2 decimales. V2 tampoco: calcula con Decimal de 40 dígitos y redondea a 2 decimales una sola vez.
 */
const LIBRO = {
 "Camion 1 ton": {
  "inputs": {
   "combustible": 45,
   "km": 75,
   "dias": 1
  },
  "globales": {
   "seguroAnual": 70000,
   "camiones": 46,
   "gastos": [
    90586.01,
    34602.28,
    25826.24,
    52221.96
   ],
   "q7": 203236.49,
   "j7": 6.340579710144927
  },
  "perfil": {
   "valorCamion": 75892.85714285713,
   "pilotoMensual": 6787.685066666668,
   "auxMensual": 6039.965066666668,
   "gps": 100,
   "seguroVeh": 790,
   "aceite": 1750,
   "precioLlanta": 750,
   "cantLlantas": 4,
   "rendimiento": 30.0,
   "viaticos": 0
  },
  "literales": {
   "seguroMerc": 6.34,
   "piloto": 339.3842533333334,
   "auxiliar": 0,
   "N5": 339.3842533333334,
   "N6": 301.99825333333337
  },
  "margen": [
   0.15,
   0.15
  ],
  "fila15": {
   "D": 1,
   "E": 1,
   "F": 1,
   "G": 1,
   "H": 1,
   "I": 75,
   "J": 75,
   "K": 75,
   "L": 1,
   "M": 1,
   "N": 1
  },
  "formulas15": {
   "L": "=+E6",
   "M": "=+L15",
   "N": 1
  },
  "cached": {
   "D": 220.90922826086958,
   "E": 6.34,
   "F": 48.64926739926739,
   "G": 5,
   "H": 26.333333333333332,
   "I": 26.25,
   "J": 4.5,
   "K": 112.5,
   "L": 339.3842533333334,
   "M": 0,
   "N": 0,
   "O": 789.8660823268037
  },
  "margenes": {
   "P16": 118.47991234902055,
   "Q16": 118.47991234902055
  },
  "subtotal": 1026.8259070248448,
  "total": 1150.0450158678264,
  "precioKm": 15.333933544904351
 },
 "Camion de 2.7": {
  "inputs": {
   "combustible": 43,
   "km": 220,
   "dias": 1
  },
  "globales": {
   "seguroAnual": 70000,
   "camiones": 46,
   "gastos": [
    90586.01,
    34602.28,
    25826.24,
    52221.96
   ],
   "q7": 203236.49,
   "j7": 6.340579710144927
  },
  "perfil": {
   "valorCamion": 150000,
   "pilotoMensual": 6787.685066666668,
   "auxMensual": 6039.965066666668,
   "gps": 100,
   "seguroVeh": 950,
   "aceite": 1750,
   "precioLlanta": 850,
   "cantLlantas": 4,
   "rendimiento": 25.0,
   "viaticos": 200
  },
  "literales": {
   "seguroMerc": 6.34,
   "piloto": 339.3842533333334,
   "auxiliar": 302,
   "N5": 339.3842533333334,
   "N6": 301.99825333333337
  },
  "margen": [
   0.15,
   0.15
  ],
  "fila15": {
   "D": 1,
   "E": 1,
   "F": 1,
   "G": 1,
   "H": 1,
   "I": 220,
   "J": 220,
   "K": 220,
   "L": 1,
   "M": 1,
   "N": 1
  },
  "formulas15": {
   "L": "=+E6",
   "M": "=+L15",
   "N": "=+M15"
  },
  "cached": {
   "D": 220.90922826086958,
   "E": 6.34,
   "F": 96.15384615384616,
   "G": 5,
   "H": 31.666666666666668,
   "I": 77,
   "J": 14.96,
   "K": 378.40000000000003,
   "L": 339.3842533333334,
   "M": 302,
   "N": 200,
   "O": 1671.8139944147158
  },
  "margenes": {
   "P16": 250.77209916220735,
   "Q16": 250.77209916220735
  },
  "subtotal": 2173.3581927391306,
  "total": 2434.1611758678264,
  "precioKm": 11.064368981217394
 },
 "Camion de 5": {
  "inputs": {
   "combustible": 45,
   "km": 440,
   "dias": 1
  },
  "globales": {
   "seguroAnual": 70000,
   "camiones": 46,
   "gastos": [
    90586.01,
    34602.28,
    25826.24,
    52221.96
   ],
   "q7": 203236.49,
   "j7": 6.340579710144927
  },
  "perfil": {
   "valorCamion": 182142.86,
   "pilotoMensual": 6787.685066666668,
   "auxMensual": 6039.965066666668,
   "gps": 100,
   "seguroVeh": 1150,
   "aceite": 1750,
   "precioLlanta": 1150,
   "cantLlantas": 6,
   "rendimiento": 17.0,
   "viaticos": 300
  },
  "literales": {
   "seguroMerc": 6.34,
   "piloto": 339.38,
   "auxiliar": 301.99825333333337,
   "N5": 339.3842533333334,
   "N6": 301.99825333333337
  },
  "margen": [
   0.2,
   0.2
  ],
  "fila15": {
   "D": 1,
   "E": 1,
   "F": 1,
   "G": 1,
   "H": 1,
   "I": 440,
   "J": 440,
   "K": 440,
   "L": 1,
   "M": 1,
   "N": 1
  },
  "formulas15": {
   "L": "=+H15",
   "M": 1,
   "N": 1
  },
  "cached": {
   "D": 220.90922826086958,
   "E": 6.34,
   "F": 116.75824358974357,
   "G": 5,
   "H": 38.333333333333336,
   "I": 154,
   "J": 60.720000000000006,
   "K": 1164.7058823529412,
   "L": 339.38,
   "M": 301.99825333333337,
   "N": 300,
   "O": 2708.144940870221
  },
  "margenes": {
   "P16": 541.6289881740443,
   "Q16": 541.6289881740443
  },
  "subtotal": 3791.4029172183095,
  "total": 4246.371267284507,
  "precioKm": 9.65084378928297
 },
 "Camion de 10": {
  "inputs": {
   "combustible": 55,
   "km": 460,
   "dias": 1
  },
  "globales": {
   "seguroAnual": 70000,
   "camiones": 46,
   "gastos": [
    90586.01,
    34602.28,
    25826.24,
    52221.96
   ],
   "q7": 203236.49,
   "j7": 6.340579710144927
  },
  "perfil": {
   "valorCamion": 150000,
   "pilotoMensual": 7287.685066666668,
   "auxMensual": 6039.965066666668,
   "gps": 100,
   "seguroVeh": 1050,
   "aceite": 2100,
   "precioLlanta": 1490,
   "cantLlantas": 6,
   "rendimiento": 10.5,
   "viaticos": 300
  },
  "literales": {
   "seguroMerc": 6.34,
   "piloto": 364.3842533333334,
   "auxiliar": 301.99825333333337,
   "N5": 364.3842533333334,
   "N6": 301.99825333333337
  },
  "margen": [
   0.15,
   0.15
  ],
  "fila15": {
   "D": 1,
   "E": 1,
   "F": 1,
   "G": 1,
   "H": 1,
   "I": 460,
   "J": 460,
   "K": 460,
   "L": 1,
   "M": 1,
   "N": 1
  },
  "formulas15": {
   "L": "=+H15",
   "M": 1,
   "N": 1
  },
  "cached": {
   "D": 220.90922826086958,
   "E": 6.34,
   "F": 96.15384615384616,
   "G": 5,
   "H": 35,
   "I": 193.2,
   "J": 82.24799999999999,
   "K": 2409.5238095238096,
   "L": 364.3842533333334,
   "M": 301.99825333333337,
   "N": 300,
   "O": 4014.757390605192
  },
  "margenes": {
   "P16": 602.2136085907788,
   "Q16": 602.2136085907788
  },
  "subtotal": 5219.184607786749,
  "total": 5845.48676072116,
  "precioKm": 12.707579914611218
 },
 "Cabezales ": {
  "inputs": {
   "combustible": 55,
   "km": 1000,
   "dias": 1
  },
  "globales": {
   "seguroAnual": 70000,
   "camiones": 46,
   "gastos": [
    90586.01,
    34602.28,
    25826.24,
    52221.96
   ],
   "q7": 203236.49,
   "j7": 6.340579710144927
  },
  "perfil": {
   "valorCamion": 275000,
   "pilotoMensual": 9388.59,
   "auxMensual": 0,
   "gps": 100,
   "seguroVeh": 1250,
   "aceite": 2400,
   "precioLlanta": 1490,
   "cantLlantas": 18,
   "rendimiento": 7.0,
   "viaticos": 200
  },
  "literales": {
   "seguroMerc": 6.34,
   "piloto": 469.4295,
   "auxiliar": 0,
   "N5": 469.4295,
   "N6": 0
  },
  "margen": [
   0.2
  ],
  "fila15": {
   "D": 1,
   "E": 1,
   "F": 1,
   "G": 1,
   "H": 1,
   "I": 1000,
   "J": 1000,
   "K": 1000,
   "L": 1,
   "M": 1,
   "N": 1
  },
  "formulas15": {
   "L": "=+E6",
   "M": 1,
   "N": 1
  },
  "cached": {
   "D": 220.90922826086958,
   "E": 6.34,
   "F": 176.28205128205127,
   "G": 5,
   "H": 41.666666666666664,
   "I": 480,
   "J": 536.4,
   "K": 7857.142857142858,
   "L": 469.4295,
   "M": 0,
   "N": 200,
   "O": 9993.170303352445
  },
  "margenes": {
   "P16": 1998.634060670489,
   "Q16": 11991.804364022933
  },
  "subtotal": 11991.804364022933,
  "total": 13430.820887705686,
  "precioKm": 13.430820887705686
 }
} as const;

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
/** Formato de celda de Excel: 2 decimales (HALF_UP). */
const vis = (v: number | string) => new D(String(v)).toDecimalPlaces(2).toNumber();
const dif = (a: string | number, b: string | number) => new D(String(a)).minus(new D(String(b))).abs();
const TOL = new D("1e-9"); // Excel opera en doble precisión (~1e-13 de error); el motor, en Decimal exacto.

type Hoja = keyof typeof LIBRO;
const HOJAS = Object.keys(LIBRO) as Hoja[];
const CELDA: Record<string, string> = { gastosGenerales: "D", seguroMercaderia: "E", depreciacion: "F", gps: "G", seguroVehiculo: "H", aceite: "I", llantas: "J", combustible: "K", piloto: "L", auxiliares: "M", viaticosHotel: "N" };
const CODIGO: Record<Hoja, string> = { "Camion 1 ton": "CAMION_1T", "Camion de 2.7": "CAMION_2_7T", "Camion de 5": "CAMION_5T", "Camion de 10": "CAMION_10T", "Cabezales ": "CABEZAL" };

/** Banderas por perfil, deducidas de la FILA 15 REAL del libro: M15 «=+L15» (auxiliar × días) y N15 «=+M15» (viáticos × días); un «1» escrito a mano = una sola vez. */
const banderas = (h: Hoja): [boolean, boolean] => [LIBRO[h].formulas15.M === "=+L15", LIBRO[h].formulas15.N === "=+M15"];

function perfilDe(h: Hoja): PerfilCosteoUnidad {
  const x = LIBRO[h], [aux, viat] = banderas(h);
  // Salario mensual = diario escrito × 20 cuando la celda de la fila 12 es un literal; si la fila 12 enlaza al salario (N5/N6), el salario mensual del libro (N3/N4).
  const pilotoMensual = x.literales.piloto === x.literales.N5 ? x.perfil.pilotoMensual : new D(String(x.literales.piloto)).mul(20).toNumber();
  const auxMensual = x.literales.auxiliar === x.literales.N6 ? x.perfil.auxMensual : new D(String(x.literales.auxiliar)).mul(20).toNumber();
  return {
    codigo: CODIGO[h], nombre: h.trim(), diasOperacionMes: 30, gpsMensual: x.perfil.gps, viajesMes: 20, seguroVehiculoMensual: x.perfil.seguroVeh,
    costoAceiteServicio: x.perfil.aceite, vidaUtilAceiteKm: 5000, costoJuegoLlantas: x.perfil.precioLlanta * x.perfil.cantLlantas, precioLlanta: x.perfil.precioLlanta,
    cantidadLlantas: x.perfil.cantLlantas, vidaUtilLlantasKm: 50000, rendimientoKmGalon: x.perfil.rendimiento,
    depreciacion: { valorBase: x.perfil.valorCamion, anios: 5, diasOperacionMes: 26 }, costoRefrigeracion: null,
    salarioPilotoMensual: pilotoMensual, salarioAuxiliarMensual: auxMensual, viaticosHotelViaje: x.perfil.viaticos,
    auxiliarMultiplicaDias: aux, viaticosHotelMultiplicaDias: viat,
  };
}
const parametrosDe = (h: Hoja): ParametrosEconomicosCosteo => ({
  precioCombustibleGalon: LIBRO[h].inputs.combustible, ivaTasa: 0.12, costoPilotoDia: 0, costoAuxiliarDia: 0, viaticoPilotoDia: 999, viaticoAuxiliarDia: 999, viaticoGuiaDia: 999, hotelDia: 999,
  seguroMercaderiaAnual: LIBRO[h].globales.seguroAnual, cantidadCamiones: LIBRO[h].globales.camiones, viajesAnuales: 240, diasDepreciacionMes: 26, diasGastosMes: 20, diasLaboralesMes: 20,
  gastosAdministracion: LIBRO[h].globales.gastos[0], gastosMantenimiento: LIBRO[h].globales.gastos[1], gastosSeguridad: LIBRO[h].globales.gastos[2], gastosPredios: LIBRO[h].globales.gastos[3],
});
/** Un solo margen = P11 + Q11 (15 % + 15 % => 30 %; 20 % + 20 % => 40 %); el Cabezal tiene solo P11 (20 %). */
const margenDe = (h: Hoja) => (LIBRO[h].margen as readonly number[]).reduce((s, m) => s.plus(String(m)), new D(0)).toNumber();

function entrada(h: Hoja, dias: number = LIBRO[h].inputs.dias, extra: Partial<InputCosteoServicio> = {}, version: string = COTIZACION_COSTEO_COTIZADOR_V2_VERSION): InputCosteoServicio {
  return {
    motorVersion: version, perfil: perfilDe(h), parametros: parametrosDe(h), distanciaKm: LIBRO[h].inputs.km, diasServicio: dias, cantidadPilotos: 1, cantidadAuxiliares: 1,
    incluirGps: true, incluirSeguroVehiculo: true, margenObjetivo: margenDe(h),
    // E12 (literal 6.34) × E15 (Días): el seguro es el literal de la hoja, escrito como total explícito del servicio.
    seguroMercaderia: new D("6.34").mul(dias).toNumber(), ...extra,
  };
}
const calcular = (h: Hoja, dias?: number, extra?: Partial<InputCosteoServicio>) => calcularCosteoServicio(entrada(h, dias, extra));
const prec = (r: ResultadoCosteoServicio) => r.precision!;
const comp = (r: ResultadoCosteoServicio, clave: string) => r.componentes.find((c) => c.clave === clave)!.monto;

/** Valores del TICKET (copiados tal cual): base, subtotal, total con IVA y precio/km de cada hoja. Deben coincidir con el libro y con el motor. */
const TICKET: Record<Hoja, { base: number; subtotal: number; total: number; precioKm: number; visible: { base: number; subtotal: number; total: number; precioKm: number } }> = {
  "Camion 1 ton": { base: 789.8660823268037, subtotal: 1026.8259070248448, total: 1150.0450158678264, precioKm: 15.333933544904351, visible: { base: 789.87, subtotal: 1026.83, total: 1150.05, precioKm: 15.33 } },
  "Camion de 2.7": { base: 1671.8139944147158, subtotal: 2173.3581927391306, total: 2434.1611758678264, precioKm: 11.064368981217394, visible: { base: 1671.81, subtotal: 2173.36, total: 2434.16, precioKm: 11.06 } },
  "Camion de 5": { base: 2708.144940870221, subtotal: 3791.4029172183095, total: 4246.371267284507, precioKm: 9.65084378928297, visible: { base: 2708.14, subtotal: 3791.4, total: 4246.37, precioKm: 9.65 } },
  "Camion de 10": { base: 4014.757390605192, subtotal: 5219.184607786749, total: 5845.48676072116, precioKm: 12.707579914611218, visible: { base: 4014.76, subtotal: 5219.18, total: 5845.49, precioKm: 12.71 } },
  "Cabezales ": { base: 9993.170303352445, subtotal: 11991.804364022933, total: 13430.820887705686, precioKm: 13.430820887705686, visible: { base: 9993.17, subtotal: 11991.8, total: 13430.82, precioKm: 13.43 } },
};

describe("Los datos del libro leído y los valores del ticket coinciden (la fuente es el archivo, no una captura)", () => {
  it.each(HOJAS)("%s: costo base, subtotal, total con IVA y precio/km del ticket = celdas O16 / R16 (Q16 en Cabezales) / G3 / H3", (h) => {
    const t = TICKET[h], x = LIBRO[h];
    expect(x.cached.O).toBe(t.base); expect(x.subtotal).toBe(t.subtotal); expect(x.total).toBe(t.total); expect(x.precioKm).toBe(t.precioKm);
  });
  it("las cinco hojas, en el orden del libro", () => { expect(HOJAS).toEqual(["Camion 1 ton", "Camion de 2.7", "Camion de 5", "Camion de 10", "Cabezales "]); });
  it("las celdas literales de la fila 12 son las del análisis: E12 = 6.34 (todas), M12 = 302 (2.7T), L12 = 339.38 (5T); el resto enlaza a N5/N6", () => {
    for (const h of HOJAS) expect(LIBRO[h].literales.seguroMerc).toBe(6.34);
    expect(LIBRO["Camion de 2.7"].literales.auxiliar).toBe(302);
    expect(LIBRO["Camion de 5"].literales.piloto).toBe(339.38);
    expect(LIBRO["Camion de 5"].literales.auxiliar).toBe(LIBRO["Camion de 5"].literales.N6);
    expect(LIBRO["Camion de 10"].literales.piloto).toBe(LIBRO["Camion de 10"].literales.N5);
    // J7 (6.3405797…) existe en el libro pero NO entra en la suma: E12 es un literal.
    expect(LIBRO["Camion de 2.7"].globales.j7).toBe(6.340579710144927);
  });
  it("la suma del libro (O16) usa 6.34 y no J7: lo demuestra la propia aritmética de las celdas", () => {
    for (const h of HOJAS) {
      const c = LIBRO[h].cached;
      const suma = (["D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"] as const).reduce((s, k) => s.plus(String(c[k])), new D(0));
      expect(dif(suma.toString(), c.O).lte(TOL)).toBe(true);
    }
  });
  it("fila 15 REAL del libro: piloto × días en las cinco; auxiliar × días solo 1T y 2.7T; viáticos × días solo 2.7T (coincide con las banderas por perfil)", () => {
    expect(HOJAS.map((h) => banderas(h))).toEqual([[true, false], [true, true], [false, false], [false, false], [false, false]]);
    for (const h of HOJAS) expect(["=+E6", "=+H15"]).toContain(LIBRO[h].formulas15.L); // piloto = Días (directo o encadenado)
  });
});

describe.each(HOJAS)("COSTEO_COTIZADOR_2026_V2 — paridad matemática hoja «%s» (1 día)", (h) => {
  const x = LIBRO[h];
  const r = calcular(h);
  it("motor V2 con precisión completa en el snapshot (política «al final»)", () => {
    expect(r.motorVersion).toBe(COTIZACION_COSTEO_COTIZADOR_V2_VERSION);
    expect(prec(r).politicaRedondeo).toBe("al_final");
    expect(esMotorCotizador2026(r.motorVersion)).toBe(true);
  });
  it.each(Object.entries(CELDA))("componente %s (celda %s16): valor INTERNO igual al de Excel", (clave, celda) => {
    const excel = x.cached[celda as keyof typeof x.cached];
    expect(dif(prec(r).componentes[clave], excel).lte(TOL), `${clave}: motor ${prec(r).componentes[clave]} vs Excel ${excel}`).toBe(true);
  });
  it.each(Object.entries(CELDA))("componente %s (celda %s16): valor VISIBLE (2 decimales) igual al de Excel", (clave, celda) => {
    expect(comp(r, clave)).toBe(vis(x.cached[celda as keyof typeof x.cached]));
  });
  it("refrigeración (Thermo) no entra en las cinco hojas: 0", () => { expect(r.refrigeracion).toBe(0); expect(comp(r, "refrigeracion")).toBe(0); });
  it("COSTO BASE: interno (O16) y visible", () => {
    expect(dif(prec(r).costoOperativo, x.cached.O).lte(TOL)).toBe(true);
    expect(r.costoOperativo).toBe(vis(x.cached.O));
  });
  it("MARGEN único = base × (P11 + Q11), sin redondear cada mitad: igual a P16 + Q16 del libro", () => {
    const esperado = (LIBRO[h].margen as readonly number[]).length === 2 ? new D(String(x.margenes.P16)).plus(String(x.margenes.Q16)) : new D(String(x.margenes.P16));
    expect(dif(prec(r).margenObjetivoMonto, esperado.toString()).lte(TOL)).toBe(true);
    expect(r.margenObjetivoMonto).toBe(vis(esperado.toString()));
  });
  it("SUBTOTAL antes de IVA: interno y visible", () => {
    expect(dif(prec(r).subtotalComercial, x.subtotal).lte(TOL)).toBe(true);
    expect(r.subtotalComercial).toBe(vis(x.subtotal));
  });
  it("IVA sobre el subtotal SIN redondear: total interno = subtotal × 1.12 (G3 = R16 × 1.12) y el IVA = total − subtotal", () => {
    expect(dif(prec(r).precioSugerido, x.total).lte(TOL)).toBe(true);
    expect(dif(prec(r).iva, new D(String(x.total)).minus(String(x.subtotal)).toString()).lte(TOL)).toBe(true);
    expect(dif(prec(r).precioSugerido, new D(prec(r).subtotalComercial).mul("1.12").toString()).lte(new D("1e-11"))).toBe(true);
  });
  it("TOTAL CON IVA visible = el de Excel al centavo", () => {
    expect(r.precioSugerido).toBe(vis(x.total));
    expect(r.precioSugerido).toBe(TICKET[h].visible.total);
  });
  it("PRECIO/KM = total INTERNO / km (H3 = G3 / E5): interno y visible", () => {
    expect(dif(prec(r).precioPorKm!, x.precioKm).lte(TOL)).toBe(true);
    expect(r.precioPorKm).toBe(vis(x.precioKm));
    expect(r.precioPorKm).toBe(TICKET[h].visible.precioKm);
  });
  it("valores visibles del ticket: base, subtotal, total y precio/km", () => {
    const t = TICKET[h].visible;
    expect([r.costoOperativo, r.subtotalComercial, r.precioSugerido, r.precioPorKm]).toEqual([t.base, t.subtotal, t.total, t.precioKm]);
  });
  it("los componentes persistibles suman el costo base con la precisión del cálculo (no la suma de los redondeados)", () => {
    const suma = Object.values(prec(r).componentes).reduce((s, v) => s.plus(v), new D(0));
    expect(dif(suma.toString(), prec(r).costoOperativo).lte(new D("1e-10"))).toBe(true);
  });
});

describe("Política anterior vs nueva (por qué existe la versión V2)", () => {
  it("COSTEO_COTIZADOR_2026 (redondeo por componente) NO coincide con Excel al centavo en 2.7T: Q2,434.15 vs Q2,434.16", () => {
    const anterior = calcularCosteoServicio(entrada("Camion de 2.7", 1, {}, COTIZACION_COSTEO_COTIZADOR_VERSION));
    expect(anterior.motorVersion).toBe(COTIZACION_COSTEO_COTIZADOR_VERSION);
    expect(anterior.precision).toBeUndefined(); // el motor anterior no guarda precisión
    expect(anterior.precioSugerido).toBe(2434.15);
    expect(calcular("Camion de 2.7").precioSugerido).toBe(2434.16);
  });
  it("el motor anterior se conserva sin cambios para las demás hojas (solo es distinto donde el redondeo por componente cambia el centavo)", () => {
    for (const h of HOJAS) {
      const anterior = calcularCosteoServicio(entrada(h, 1, {}, COTIZACION_COSTEO_COTIZADOR_VERSION));
      expect(Math.abs(anterior.precioSugerido - calcular(h).precioSugerido)).toBeLessThanOrEqual(0.02);
    }
  });
  it("«al final» no redondea ningún paso intermedio: el costo base interno NO es la suma de los componentes visibles", () => {
    const r = calcular("Camion de 2.7");
    const sumaVisibles = r.componentes.reduce((s, c) => s.plus(c.monto), new D(0));
    expect(sumaVisibles.toNumber()).toBe(1671.81); // 220.91 + 6.34 + 96.15 + 5 + 31.67 + 77 + 14.96 + 378.4 + 339.38 + 302 + 200
    expect(prec(r).costoOperativo.startsWith("1671.8139944")).toBe(true);
    expect(r.costoOperativo).toBe(1671.81);
  });
  it("precio/km usa el total sin redondear en toda una serie de distancias (no divide un total ya redondeado)", () => {
    for (let km = 20; km <= 500; km += 7) {
      const r = calcular("Camion de 2.7", 1, { distanciaKm: km });
      const esperado = new D(prec(r).precioSugerido).div(km).toDecimalPlaces(2).toNumber();
      expect(r.precioPorKm).toBe(esperado);
    }
  });
  it("el redondeo final es HALF_UP a 2 decimales (como el formato de celda)", () => {
    const r = calcular("Camion de 2.7", 1, { otrosCostos: [{ concepto: "ajuste", monto: 0.005 }] });
    expect(comp(r, "otro:0")).toBe(0.01); // 0.005 -> 0.01
    expect(new D(prec(r).componentes["otro:0"]).toNumber()).toBe(0.005); // pero internamente se conserva 0.005
  });
});

describe("Multidía contra las fórmulas REALES del libro (D16:N16 con la fila 15 de cada hoja)", () => {
  /** Evaluador independiente de las celdas del libro, en doble precisión, con la fila 15 de cada hoja (días en E6). */
  function libro(h: Hoja, dias: number) {
    const x = LIBRO[h], [auxD, viatD] = banderas(h), km = x.inputs.km;
    const pil = x.literales.piloto, aux = x.literales.auxiliar, viat = x.perfil.viaticos;
    const d = (x.globales.q7 / 46 / 20) * dias;
    const e = x.literales.seguroMerc * dias;
    const f = (x.perfil.valorCamion / 60 / 26) * dias;
    const g = (x.perfil.gps / 20) * dias;
    const hh = (x.perfil.seguroVeh / 30) * dias;
    const i = km * (x.perfil.aceite / 5000);
    const j = km * ((x.perfil.precioLlanta * x.perfil.cantLlantas) / 50000);
    const k = (km / x.perfil.rendimiento) * x.inputs.combustible;
    const l = pil * dias;
    const m = aux * (auxD ? dias : 1);
    const n = viat * (viatD ? dias : 1);
    const o = d + e + f + g + hh + i + j + k + l + m + n;
    const margen = (x.margen as readonly number[]).reduce((s, v) => s + v, 0);
    const subtotal = o + o * margen;
    return { comps: { gastosGenerales: d, seguroMercaderia: e, depreciacion: f, gps: g, seguroVehiculo: hh, aceite: i, llantas: j, combustible: k, piloto: l, auxiliares: m, viaticosHotel: n }, base: o, subtotal, total: subtotal * 1.12, precioKm: (subtotal * 1.12) / km };
  }
  it.each(HOJAS.flatMap((h) => [[h, 2], [h, 3]] as [Hoja, number][]))("«%s» con %i días: cada componente, base, subtotal, total y precio/km", (h, dias) => {
    const r = calcular(h, dias), e = libro(h, dias);
    for (const [clave, valor] of Object.entries(e.comps)) {
      expect(dif(prec(r).componentes[clave], valor).lte(TOL), `${clave}: ${prec(r).componentes[clave]} vs ${valor}`).toBe(true);
      expect(comp(r, clave)).toBe(vis(valor));
    }
    expect(dif(prec(r).costoOperativo, e.base).lte(TOL)).toBe(true);
    expect(dif(prec(r).subtotalComercial, e.subtotal).lte(TOL)).toBe(true);
    expect(dif(prec(r).precioSugerido, e.total).lte(TOL)).toBe(true);
    expect(r.precioSugerido).toBe(vis(e.total)); expect(r.precioPorKm).toBe(vis(e.precioKm));
    expect([r.costoOperativo, r.subtotalComercial]).toEqual([vis(e.base), vis(e.subtotal)]);
  });
  it("2 días, reglas de PR #407: GPS, seguro, gastos, depreciación, seguro del vehículo y piloto × días en TODAS las hojas", () => {
    for (const h of HOJAS) {
      const uno = calcular(h, 1), dos = calcular(h, 2);
      for (const clave of ["gastosGenerales", "depreciacion", "gps", "seguroVehiculo", "piloto"]) {
        expect(dif(prec(dos).componentes[clave], new D(prec(uno).componentes[clave]).mul(2).toString()).lte(TOL), `${h} ${clave}`).toBe(true);
      }
      for (const clave of ["aceite", "llantas", "combustible"]) expect(prec(dos).componentes[clave]).toBe(prec(uno).componentes[clave]); // km, no días
    }
  });
  it("auxiliar y viáticos del perfil siguen las banderas de cada hoja (2 días)", () => {
    const esperado: Record<Hoja, [number, number]> = { "Camion 1 ton": [0, 0], "Camion de 2.7": [604, 400], "Camion de 5": [301.99825333333337, 300], "Camion de 10": [301.99825333333337, 300], "Cabezales ": [0, 200] };
    for (const h of HOJAS) {
      const r = calcular(h, 2);
      expect([comp(r, "auxiliares"), comp(r, "viaticosHotel")]).toEqual(esperado[h].map(vis));
    }
  });
  it("overrides manuales = TOTAL explícito, no se multiplican: 2.7T, 3 días, perfil Q200, override de viáticos Q350 => Q350 (y seguro manual Q50 => Q50)", () => {
    const r = calcular("Camion de 2.7", 3, { viaticosHotelTotal: 350, seguroMercaderia: 50 });
    expect(comp(r, "viaticosHotel")).toBe(350);
    expect(comp(r, "seguroMercaderia")).toBe(50);
    expect(prec(r).componentes.viaticosHotel).toBe("350.000000000000");
    expect(comp(calcular("Camion de 2.7", 3, { viaticosHotelTotal: undefined }), "viaticosHotel")).toBe(600); // sin override: Q200 × 3
  });
  it("seguro de mercadería AUTOMÁTICO × días con precisión completa: (70,000 / 46 / 240) × 2 = 12.681159420…", () => {
    const sinSeguro: InputCosteoServicio = entrada("Camion de 2.7", 2);
    delete sinSeguro.seguroMercaderia; // automático: sin total manual
    const r = calcularCosteoServicio(sinSeguro as InputCosteoServicio);
    expect(prec(r).componentes.seguroMercaderia.startsWith("12.68115942")).toBe(true);
    expect(comp(r, "seguroMercaderia")).toBe(12.68);
  });
});

describe("Thermo / refrigeración (si aplica): infraestructura conservada con la misma precisión", () => {
  it("el bloque «Deprec Thermo» del libro (O3:O6 = 100000 / 60 / 26 = 64.1025641025641) se calcula igual cuando un perfil refrigerado lo usa, y no entra en las cinco hojas", () => {
    const base = entrada("Camion de 5", 1, { usarRefrigeracion: true });
    const r = calcularCosteoServicio({ ...base, perfil: { ...base.perfil, codigo: "CAMION_5T_REFRIGERADO", costoRefrigeracion: { valorBase: 100000, anios: 5, diasOperacionMes: 26 } } });
    expect(dif(prec(r).componentes.refrigeracion, "64.1025641025641").lte(TOL)).toBe(true);
    expect(comp(r, "refrigeracion")).toBe(64.1);
    expect(dif(prec(r).costoOperativo, new D(String(LIBRO["Camion de 5"].cached.O)).plus(prec(r).componentes.refrigeracion).toString()).lte(TOL)).toBe(true);
  });
});

describe("Configuración de producción (sin los literales del libro): diferencia residual documentada", () => {
  /** Con el seguro AUTOMÁTICO (6.3405797…) y los salarios mensuales del libro (N3/N4), 2.7T usa 301.998 en vez del 302 literal y 5T usa 339.384 en vez del 339.38 literal. */
  function produccion(h: Hoja) {
    const x = LIBRO[h], base = entrada(h);
    const sinSeguro: InputCosteoServicio = { ...base };
    delete sinSeguro.seguroMercaderia; // automático: sin total manual
    // 1T no lleva auxiliar (M12 = 0): la cotización usa 0 auxiliares.
    return calcularCosteoServicio({ ...sinSeguro, cantidadAuxiliares: x.literales.auxiliar === 0 ? 0 : 1, perfil: { ...base.perfil, salarioPilotoMensual: x.perfil.pilotoMensual, salarioAuxiliarMensual: x.perfil.auxMensual } } as InputCosteoServicio);
  }
  it("con el seguro automático y los salarios completos, el total visible coincide con Excel en 1T, 2.7T, 10T y Cabezal; 5T difiere Q0.01 SOLO por el literal L12 = 339.38 del libro", () => {
    for (const h of ["Camion 1 ton", "Camion de 2.7", "Camion de 10", "Cabezales "] as Hoja[]) expect(produccion(h).precioSugerido, h).toBe(TICKET[h].visible.total);
    // 5T: el libro escribe a mano el piloto (339.38) en vez de enlazar N5 (339.3842533…): Δ piloto 0.0042533 × 1.4 × 1.12 = +0.0067 => 4246.3779 => Q4,246.38 (Excel: Q4,246.37).
    expect(produccion("Camion de 5").precioSugerido).toBe(4246.38);
    expect(TICKET["Camion de 5"].visible.total).toBe(4246.37);
    // Con el literal del libro como dato (salario mensual 6787.6 => 339.38) la paridad es exacta (ver la sección de paridad por hoja).
    expect(calcular("Camion de 5").precioSugerido).toBe(4246.37);
  });
  it("la diferencia interna del total es de fracciones de centavo y se debe SOLO a los literales (6.34, 302, 339.38), no al redondeo", () => {
    for (const h of HOJAS) {
      const d = dif(prec(produccion(h)).precioSugerido, LIBRO[h].total);
      expect(d.lt("0.02"), `${h}: ${d.toString()}`).toBe(true);
    }
    // Cabezal y 10T: la única diferencia es el seguro automático (6.3405797… vs 6.34): Δ total = 0.000579710… × 1.2 × 1.12.
    expect(dif(prec(produccion("Cabezales ")).precioSugerido, LIBRO["Cabezales "].total).toFixed(6)).toBe(new D("0.000579710145").mul("1.2").mul("1.12").toFixed(6));
  });
});

describe("Versionado y persistencia", () => {
  it("motor_version es VARCHAR(40) en schema.sql (igual que producción) y los nombres de motor caben: COSTEO_COTIZADOR_2026 (21) y COSTEO_COTIZADOR_2026_V2 (24)", () => {
    const schema = readFileSync("sql/schema.sql", "utf8");
    const ancho = Number(/motor_version VARCHAR\((\d+)\) NOT NULL/.exec(schema)![1]);
    expect(ancho).toBe(40);
    expect(COTIZACION_COSTEO_COTIZADOR_V2_VERSION).toBe("COSTEO_COTIZADOR_2026_V2");
    expect(COTIZACION_COSTEO_COTIZADOR_V2_VERSION.length).toBe(24);
    for (const motor of ["COSTEO_V1", "COSTEO_EXCEL_2026", COTIZACION_COSTEO_COTIZADOR_VERSION, COTIZACION_COSTEO_COTIZADOR_V2_VERSION]) expect(motor.length).toBeLessThanOrEqual(ancho);
  });
  it("la migración de motor_version YA fue aplicada en producción: el archivo la registra (un solo ALTER, sin diagnóstico pendiente ni reparación) y avisa que no se vuelva a ejecutar", () => {
    const sql = readFileSync("sql/migrate-2026-10-cotizaciones-motor-version.sql", "utf8").replace(/\r\n/g, "\n");
    expect(sql).toContain("YA APLICADA MANUALMENTE EN PRODUCCIÓN");
    expect(sql).toContain("NO volver a ejecutar");
    expect(sql).not.toMatch(/PROPUESTA|propuesta|pendiente/);
    const activas = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(";").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    expect(activas).toEqual(["ALTER TABLE tms_cotizacion_costeos MODIFY COLUMN motor_version VARCHAR(40) NOT NULL"]);
    expect(() => readFileSync("sql/propuesta-2026-10-cotizaciones-motor-version.sql", "utf8")).toThrow(); // ya no existe como propuesta pendiente
  });
  it("tres motores distintos coexisten y COSTEO_COTIZADOR_2026 sigue calculándose igual que antes para snapshots/pruebas antiguos", () => {
    expect(COTIZACION_COSTEO_COTIZADOR_VERSION).toBe("COSTEO_COTIZADOR_2026");
    expect(COTIZACION_COSTEO_COTIZADOR_V2_VERSION).toBe("COSTEO_COTIZADOR_2026_V2");
    expect(esMotorCotizador2026("COSTEO_COTIZADOR_2026")).toBe(true);
    expect(esMotorCotizador2026("COSTEO_EXCEL_2026")).toBe(false);
    expect(esMotorCotizador2026(undefined)).toBe(false);
  });
  it("el resultado de V2 es serializable a JSON (resultado_snapshot) sin perder la precisión: componentes, base, margen, subtotal, IVA, total y precio/km", () => {
    const r = calcular("Camion de 2.7");
    const vuelta = JSON.parse(JSON.stringify(r)) as ResultadoCosteoServicio;
    expect(vuelta.precision).toEqual(r.precision);
    expect(Object.keys(vuelta.precision!).sort()).toEqual(["componentes", "costoConIva", "costoOperativo", "iva", "margenObjetivoMonto", "politicaRedondeo", "precioPorKm", "precioSugerido", "subtotalComercial"]);
    expect(vuelta.precision!.precioSugerido).toMatch(/^2434\.1611758678/);
    expect(vuelta.motorVersion).toBe(COTIZACION_COSTEO_COTIZADOR_V2_VERSION);
  });
  it("sin Decimal.js en el código nuevo: el motor sigue calculando con Decimal (nada de aritmética de punto flotante en los importes)", () => {
    const fuente = readFileSync("src/lib/tms/cotizacion-costeo-cotizador-2026.ts", "utf8");
    expect(fuente).toContain('import Decimal from "decimal.js"');
    expect(fuente.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n")).not.toMatch(/Math\.round|\.toFixed\(2\)|parseFloat/);
  });
});
