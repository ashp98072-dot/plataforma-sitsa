import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CODIGOS_PERFIL_COSTEO, COTIZACION_COSTEO_COTIZADOR_VERSION, COTIZACION_COSTEO_EXCEL_VERSION, calcularCosteoServicio,
  type InputCosteoServicio, type ParametrosEconomicosCosteo, type PerfilCosteoUnidad, type ResultadoCosteoServicio,
} from "./cotizacion-costeo";

/**
 * PARIDAD ESTRICTA con «Cotizador 2026.xlsx» (hojas «Camion 1 ton», «Camion de 2.7», «Camion de 5», «Camion de 10», «Cabezales »).
 * Los números de cada ejemplo se copiaron literalmente del workbook (celdas D16:R16 de cada hoja). NO se usó «COTIZADOR RUTAS(3).xlsx».
 *
 * Política de redondeo del sistema (documentada en COSTEO_EXCEL_2026): cada concepto se redondea a 2 decimales y la suma no se vuelve
 * a redondear; el libro NO redondea por concepto. Por eso cada concepto coincide a 2 decimales y los totales, a ±Q0.01.
 *
 * CONSTANTES INFERIDAS (no son celdas de entrada del libro; salen de las fórmulas de la fila 14/16 y se usan solo para reproducir el
 * ejemplo): rendimiento km/galón = N de «(km/N)×diésel» (1T: 30, 2.7T: 25, 5T: 17, 10T: 10.5, Cabezal: 7); vida útil de llantas = 50,000 km
 * (=juego/50000); intervalo de aceite = 5,000 km (=aceite/5000). Los rendimientos configurados hoy en Novalvion NO se modifican ni se
 * afirman como fuente explícita del libro.
 *
 * DIFERENCIAS ENTRE HOJAS (se reproducen, no se normalizan): auxiliar × días solo en 1T y 2.7T; «Viáticos y hotel» × días solo en 2.7T. Son dos banderas
 * del PERFIL (auxiliarMultiplicaDias, viaticosHotelMultiplicaDias); las fixtures las configuran como la hoja fuente (en producción no se siembran).
 */
const cerca = (real: number, esperado: number, tolerancia = 0.005) => expect(Math.abs(real - esperado), `${real} vs ${esperado}`).toBeLessThanOrEqual(tolerancia);

// Globales del libro (hoja, celdas J3:J7 y Q3:Q7). En producción son DATOS CONFIGURABLES, no constantes del motor.
const GLOBALES = {
  seguroMercaderiaAnual: 70000, cantidadCamiones: 46, viajesAnuales: 240, diasDepreciacionMes: 26, diasGastosMes: 20, diasLaboralesMes: 20,
  gastosAdministracion: 90586.01, gastosMantenimiento: 34602.28, gastosSeguridad: 25826.24, gastosPredios: 52221.96,
};
const parametros = (combustible: number): ParametrosEconomicosCosteo => ({
  ...GLOBALES, precioCombustibleGalon: combustible, ivaTasa: 0.12,
  // Respaldos históricos del modelo anterior: el motor nuevo los IGNORA (valores absurdos a propósito).
  costoPilotoDia: 0, costoAuxiliarDia: 0, viaticoPilotoDia: 999, viaticoAuxiliarDia: 999, viaticoGuiaDia: 999, hotelDia: 999,
});

type Fila = { perfil: PerfilCosteoUnidad; combustible: number; km: number; margen: number; auxiliares: number; esperado: Record<string, number> };
const perfil = (p: Partial<PerfilCosteoUnidad> & Pick<PerfilCosteoUnidad, "codigo" | "nombre" | "seguroVehiculoMensual" | "costoAceiteServicio" | "rendimientoKmGalon"> & { valor: number; llanta: number; llantas: number }): PerfilCosteoUnidad => {
  const { valor, llanta, llantas, ...resto } = p;
  return {
    costoAdquisicion: null, diasOperacionMes: 30, gpsMensual: 100, viajesMes: 20, vidaUtilAceiteKm: 5000, vidaUtilLlantasKm: 50000, costoJuegoLlantas: llanta * llantas,
    precioLlanta: llanta, cantidadLlantas: llantas, depreciacion: { valorBase: valor, anios: 5, diasOperacionMes: 26 }, costoRefrigeracion: null,
    salarioPilotoMensual: 6787.685066666668, salarioAuxiliarMensual: 6039.965066666668, viaticosHotelViaje: 0, ...resto,
  };
};

const HOJAS: Record<string, Fila> = {
  "Camion 1 ton": {
    perfil: perfil({ codigo: "CAMION_1T", auxiliarMultiplicaDias: true, viaticosHotelMultiplicaDias: false, nombre: "Camión 1 tonelada", valor: 75892.85714285713, seguroVehiculoMensual: 790, costoAceiteServicio: 1750, llanta: 750, llantas: 4, rendimientoKmGalon: 30, viaticosHotelViaje: 0 }),
    combustible: 45, km: 75, margen: 0.30, auxiliares: 0,
    esperado: { gastosGenerales: 220.90922826086958, seguroMercaderia: 6.34, depreciacion: 48.64926739926739, gps: 5, seguroVehiculo: 26.333333333333332, aceite: 26.25, llantas: 4.5, combustible: 112.5, piloto: 339.3842533333334, auxiliares: 0, viaticosHotel: 0, base: 789.8660823268037, subtotal: 1026.8259070248448 },
  },
  "Camion de 2.7": {
    perfil: perfil({ codigo: "CAMION_2_7T", auxiliarMultiplicaDias: true, viaticosHotelMultiplicaDias: true, nombre: "Camión 2.7 toneladas", valor: 150000, seguroVehiculoMensual: 950, costoAceiteServicio: 1750, llanta: 850, llantas: 4, rendimientoKmGalon: 25, viaticosHotelViaje: 200 }),
    combustible: 43, km: 220, margen: 0.30, auxiliares: 1,
    esperado: { gastosGenerales: 220.90922826086958, seguroMercaderia: 6.34, depreciacion: 96.15384615384616, gps: 5, seguroVehiculo: 31.666666666666668, aceite: 77, llantas: 14.96, combustible: 378.40000000000003, piloto: 339.3842533333334, auxiliares: 302, viaticosHotel: 200, base: 1671.8139944147158, subtotal: 2173.3581927391306 },
  },
  "Camion de 5": {
    perfil: perfil({ codigo: "CAMION_5T", auxiliarMultiplicaDias: false, viaticosHotelMultiplicaDias: false, nombre: "Camión 5 toneladas", valor: 182142.86, seguroVehiculoMensual: 1150, costoAceiteServicio: 1750, llanta: 1150, llantas: 6, rendimientoKmGalon: 17, viaticosHotelViaje: 300 }),
    combustible: 45, km: 440, margen: 0.40, auxiliares: 1, // 20 % + 20 % del libro => un único margen de 40 %
    esperado: { gastosGenerales: 220.90922826086958, seguroMercaderia: 6.34, depreciacion: 116.75824358974357, gps: 5, seguroVehiculo: 38.333333333333336, aceite: 154, llantas: 60.720000000000006, combustible: 1164.7058823529412, piloto: 339.38, auxiliares: 301.99825333333337, viaticosHotel: 300, base: 2708.144940870221, subtotal: 3791.4029172183095 },
  },
  "Camion de 10": {
    perfil: perfil({ codigo: "CAMION_10T", auxiliarMultiplicaDias: false, viaticosHotelMultiplicaDias: false, nombre: "Camión 10 toneladas", valor: 150000, seguroVehiculoMensual: 1050, costoAceiteServicio: 2100, llanta: 1490, llantas: 6, rendimientoKmGalon: 10.5, salarioPilotoMensual: 7287.685066666668, viaticosHotelViaje: 300 }),
    combustible: 55, km: 460, margen: 0.30, auxiliares: 1,
    esperado: { gastosGenerales: 220.90922826086958, seguroMercaderia: 6.34, depreciacion: 96.15384615384616, gps: 5, seguroVehiculo: 35, aceite: 193.2, llantas: 82.24799999999999, combustible: 2409.5238095238096, piloto: 364.3842533333334, auxiliares: 301.99825333333337, viaticosHotel: 300, base: 4014.757390605192, subtotal: 5219.184607786749 },
  },
  "Cabezales ": {
    perfil: perfil({ codigo: "CABEZAL", auxiliarMultiplicaDias: false, viaticosHotelMultiplicaDias: false, nombre: "Cabezal", valor: 275000, seguroVehiculoMensual: 1250, costoAceiteServicio: 2400, llanta: 1490, llantas: 18, rendimientoKmGalon: 7, salarioPilotoMensual: 9388.59, salarioAuxiliarMensual: 0, viaticosHotelViaje: 200 }),
    combustible: 55, km: 1000, margen: 0.20, auxiliares: 0,
    esperado: { gastosGenerales: 220.90922826086958, seguroMercaderia: 6.34, depreciacion: 176.28205128205127, gps: 5, seguroVehiculo: 41.666666666666664, aceite: 480, llantas: 536.4, combustible: 7857.142857142858, piloto: 469.4295, auxiliares: 0, viaticosHotel: 200, base: 9993.170303352445, subtotal: 11991.804364022933 },
  },
};

function calcular(f: Fila, extra: Partial<InputCosteoServicio> = {}): ResultadoCosteoServicio {
  return calcularCosteoServicio({
    motorVersion: COTIZACION_COSTEO_COTIZADOR_VERSION, perfil: f.perfil, parametros: parametros(f.combustible), distanciaKm: f.km, diasServicio: 1,
    cantidadPilotos: 1, cantidadAuxiliares: f.auxiliares, incluirGps: true, incluirSeguroVehiculo: true, margenObjetivo: f.margen, ...extra,
  });
}
const comp = (r: ResultadoCosteoServicio, clave: string) => r.componentes.find((c) => c.clave === clave)?.monto;

describe.each(Object.entries(HOJAS))("Paridad hoja «%s»", (_hoja, f) => {
  const r = calcular(f);
  it("cada concepto coincide con la fila 16 del libro (2 decimales)", () => {
    for (const k of ["gastosGenerales", "seguroMercaderia", "depreciacion", "gps", "seguroVehiculo", "aceite", "llantas", "combustible", "piloto", "auxiliares", "viaticosHotel"]) {
      cerca(comp(r, k) ?? NaN, f.esperado[k]);
    }
  });
  it("COSTO BASE y subtotal con el margen único (±Q0.01 por el redondeo por concepto)", () => {
    cerca(r.costoOperativo, f.esperado.base, 0.01);
    cerca(r.subtotalComercial ?? NaN, f.esperado.subtotal, 0.01);
    expect(r.margenObjetivoAplicado).toBe(f.margen);
    cerca(r.margenObjetivoMonto ?? NaN, r.costoOperativo * f.margen, 0.01); // valor del margen = base × margen (redondeado a centavos)
  });
  it("IVA DESPUÉS del margen: total = subtotal × 1.12 (el libro: G3 = R16 × 1.12) y precio/km", () => {
    cerca(r.precioSugerido, f.esperado.subtotal * 1.12, 0.02);
    cerca(r.iva, (r.subtotalComercial ?? 0) * 0.12, 0.005);
    cerca(r.precioPorKm ?? NaN, r.precioSugerido / f.km, 0.005);
  });
  it("motor COSTEO_COTIZADOR_2026 y «Viáticos y hotel» como UNA sola línea (sin viático piloto/auxiliar/guía ni hotel)", () => {
    expect(r.motorVersion).toBe("COSTEO_COTIZADOR_2026");
    const claves = r.componentes.map((c) => c.clave);
    expect(claves).toContain("viaticosHotel");
    for (const retirada of ["viaticoPiloto", "viaticoAuxiliar", "viaticoGuia", "hotel"]) expect(claves).not.toContain(retirada);
    expect([r.viaticoPiloto, r.viaticoAuxiliar, r.viaticoGuia, r.hotel]).toEqual([0, 0, 0, 0]);
    expect(r.viaticosHotel).toBe(f.esperado.viaticosHotel);
  });
  it("sin Thermo: el bloque «Deprec Thermo» del libro NO es una columna de estas hojas y no se suma", () => {
    expect(r.refrigeracion).toBe(0);
    expect(claves(r)).not.toContain("refrigeracion_nunca");
    expect(r.valoresUsados?.diasDepreciacionThermo).toBeNull();
  });
});
const claves = (r: ResultadoCosteoServicio) => r.componentes.map((c) => c.clave);

describe("Valores puntuales citados en el ticket", () => {
  it("2.7T: costo base ≈ 1671.814, subtotal ≈ 2173.358 con 15 % + 15 % = un único 30 %", () => {
    const r = calcular(HOJAS["Camion de 2.7"]);
    cerca(r.costoOperativo, 1671.814, 0.01);
    cerca(r.subtotalComercial ?? NaN, 2173.358, 0.01);
    cerca(r.gps, 5); cerca(r.seguroVehiculo, 31.666); cerca(comp(r, "aceite") ?? NaN, 77); cerca(comp(r, "llantas") ?? NaN, 14.96);
    cerca(comp(r, "gastosGenerales") ?? NaN, 220.909); cerca(comp(r, "seguroMercaderia") ?? NaN, 6.34); cerca(comp(r, "depreciacion") ?? NaN, 96.1538);
    cerca(comp(r, "piloto") ?? NaN, 339.384); cerca(comp(r, "auxiliares") ?? NaN, 302);
  });
  it("5T: costo base ≈ 2708.145", () => {
    const r = calcular(HOJAS["Camion de 5"]);
    cerca(r.costoOperativo, 2708.145, 0.01);
    cerca(comp(r, "aceite") ?? NaN, 154); cerca(comp(r, "llantas") ?? NaN, 60.72); cerca(comp(r, "seguroVehiculo") ?? NaN, 38.333);
  });
  it("10T: costo base ≈ 4014.757, subtotal ≈ 5219.185", () => {
    const r = calcular(HOJAS["Camion de 10"]);
    cerca(r.costoOperativo, 4014.757, 0.01); cerca(r.subtotalComercial ?? NaN, 5219.185, 0.01);
    cerca(comp(r, "aceite") ?? NaN, 193.2); cerca(comp(r, "llantas") ?? NaN, 82.248); cerca(comp(r, "seguroVehiculo") ?? NaN, 35);
  });
  it("Cabezal: costo base ≈ 9993.17, subtotal ≈ 11991.804 con margen 20 %", () => {
    const r = calcular(HOJAS["Cabezales "]);
    cerca(r.costoOperativo, 9993.17, 0.01); cerca(r.subtotalComercial ?? NaN, 11991.804, 0.01);
    cerca(comp(r, "depreciacion") ?? NaN, 176.282); cerca(comp(r, "piloto") ?? NaN, 469.4295); expect(comp(r, "auxiliares")).toBe(0);
    cerca(comp(r, "llantas") ?? NaN, 536.4); cerca(comp(r, "aceite") ?? NaN, 480);
  });
  it("derivados globales: 203,236.49 / 46 / 20 = 220.909228… y 70,000 / 46 / 240 = 6.3405797…", () => {
    const suma = GLOBALES.gastosAdministracion + GLOBALES.gastosMantenimiento + GLOBALES.gastosSeguridad + GLOBALES.gastosPredios;
    cerca(suma, 203236.49, 0.0001);
    cerca(suma / 46, 4418.184565, 0.0001); cerca(suma / 46 / 20, 220.909228, 0.0001);
    cerca(70000 / 46 / 240, 6.340579710144927, 1e-9);
  });
});

describe("«Viáticos y hotel»: un solo valor (override manual = TOTAL explícito)", () => {
  const base = HOJAS["Camion de 5"];
  it("override manual de la cotización > valor predeterminado del perfil", () => {
    expect(comp(calcular(base, { viaticosHotelTotal: 450 }), "viaticosHotel")).toBe(450);
    expect(comp(calcular(base), "viaticosHotel")).toBe(300); // perfil
    expect(calcular(base, { viaticosHotelTotal: 450 }).valoresUsados?.origenViaticosHotel).toBe("override");
    expect(calcular(base).valoresUsados?.origenViaticosHotel).toBe("perfil");
  });
  it("un override de 0 prevalece sobre el perfil (0 manual no es «vacío»)", () => {
    expect(comp(calcular(base, { viaticosHotelTotal: 0 }), "viaticosHotel")).toBe(0);
  });
  it("NO se multiplica por pilotos, auxiliares ni guías; con la bandera en «No» (5T) tampoco por días", () => {
    const grande = calcular(base, { diasServicio: 3, cantidadPilotos: 2, cantidadAuxiliares: 4, cantidadGuias: 5 });
    expect(comp(grande, "viaticosHotel")).toBe(300);
    expect(comp(calcular(base, { diasServicio: 3, cantidadPilotos: 2, cantidadAuxiliares: 4, viaticosHotelTotal: 450 }), "viaticosHotel")).toBe(450);
  });
  it("ignora por completo el modelo anterior: viáticos/hotel globales, overrides de PR #406 y guías", () => {
    const r = calcular(base, { viaticoPilotoTotal: 555, viaticoAuxiliarTotal: 555, viaticoGuiaTotal: 555, hotelTotal: 777, cantidadGuias: 9 });
    expect(r.costoOperativo).toBe(calcular(base).costoOperativo);
    expect(comp(r, "viaticosHotel")).toBe(300);
  });
  it("perfil sin valor y sin override: Q0 con ADVERTENCIA visible (NULL no confirma costo cero)", () => {
    const sin = { ...base, perfil: { ...base.perfil, viaticosHotelViaje: null } };
    const r = calcular(sin);
    expect(comp(r, "viaticosHotel")).toBe(0);
    expect(r.advertencias?.join(" ")).toMatch(/Viáticos y hotel no configurados/);
    expect(r.valoresUsados?.origenViaticosHotel).toBe("sin_configurar");
    expect(calcular(sin, { viaticosHotelTotal: 100 }).advertencias?.join(" ") ?? "").not.toMatch(/Viáticos y hotel/);
  });
  it("un monto negativo se rechaza", () => {
    expect(() => calcular(base, { viaticosHotelTotal: -1 })).toThrow(/no negativo/);
  });
});

describe("Fórmulas configurables (sin constantes del libro dentro del motor)", () => {
  const f = HOJAS["Camion de 2.7"];
  it("GPS = GPS mensual / viajes mensuales del perfil (si cambia el perfil, cambia el GPS)", () => {
    expect(calcular(f).gps).toBe(5);
    expect(calcular({ ...f, perfil: { ...f.perfil, viajesMes: 25 } }).gps).toBe(4);
    expect(calcular({ ...f, perfil: { ...f.perfil, gpsMensual: 150 } }).gps).toBe(7.5);
  });
  it("aceite = costo / intervalo × km; llantas = precio × cantidad / vida × km (el intervalo y la vida son del perfil)", () => {
    expect(comp(calcular({ ...f, perfil: { ...f.perfil, vidaUtilAceiteKm: 10000 } }), "aceite")).toBe(38.5);
    expect(comp(calcular({ ...f, perfil: { ...f.perfil, cantidadLlantas: 6, costoJuegoLlantas: 5100 } }), "llantas")).toBe(22.44);
    expect(comp(calcular({ ...f, perfil: { ...f.perfil, vidaUtilLlantasKm: 100000 } }), "llantas")).toBe(7.48);
  });
  it("llantas: sin precio/cantidad se usa el juego histórico como respaldo interno", () => {
    const hist = { ...f, perfil: { ...f.perfil, precioLlanta: null, cantidadLlantas: null, costoJuegoLlantas: 3400 } };
    expect(comp(calcular(hist), "llantas")).toBe(14.96);
  });
  it("seguro del vehículo = mensual / 30 × días", () => {
    expect(calcular(f).seguroVehiculo).toBe(31.67);
    expect(calcular(f, { diasServicio: 3 }).seguroVehiculo).toBe(95);
  });
  it("seguro mercadería = anual / flota / viajes anuales; un total manual (incluso 0) prevalece; se puede excluir", () => {
    expect(comp(calcular(f), "seguroMercaderia")).toBe(6.34);
    expect(comp(calcular(f, { seguroMercaderia: 12.5 }), "seguroMercaderia")).toBe(12.5);
    expect(comp(calcular(f, { seguroMercaderia: 0 }), "seguroMercaderia")).toBe(0);
    expect(comp(calcular(f, { incluirSeguroMercaderia: false }), "seguroMercaderia")).toBe(0);
    const otra = calcularCosteoServicio({ ...baseInput(f), parametros: { ...parametros(43), cantidadCamiones: 10, viajesAnuales: 100 } });
    expect(comp(otra, "seguroMercaderia")).toBe(70);
  });
  it("gastos generales = (4 conceptos) / flota / días gastos × días; depreciación = valor / años / 12 / divisor × días", () => {
    expect(comp(calcular(f, { diasServicio: 2 }), "gastosGenerales")).toBe(441.82);
    expect(comp(calcular(f, { diasServicio: 2 }), "depreciacion")).toBe(192.31);
    const otro = calcularCosteoServicio({ ...baseInput(f), parametros: { ...parametros(43), diasDepreciacionMes: 30, diasGastosMes: 25, cantidadCamiones: 50 } });
    cerca(comp(otro, "depreciacion") ?? NaN, 150000 / 5 / 12 / 30, 0.005);
    cerca(comp(otro, "gastosGenerales") ?? NaN, 203236.49 / 50 / 25, 0.005);
  });
  it("salarios: mensual del perfil / días laborales globales; si el perfil no lo tiene, respaldo diario histórico; 0 configurado es 0", () => {
    expect(comp(calcular(f), "piloto")).toBe(339.38);
    const otro = calcularCosteoServicio({ ...baseInput(f), parametros: { ...parametros(43), diasLaboralesMes: 25 } });
    expect(comp(otro, "piloto")).toBe(271.51);
    const respaldo = calcularCosteoServicio({ ...baseInput({ ...f, perfil: { ...f.perfil, salarioPilotoMensual: null, salarioAuxiliarMensual: null } }), parametros: { ...parametros(43), costoPilotoDia: 207.74, costoAuxiliarDia: 148.04 } });
    expect([comp(respaldo, "piloto"), comp(respaldo, "auxiliares")]).toEqual([207.74, 148.04]);
    expect(comp(calcular({ ...f, perfil: { ...f.perfil, salarioAuxiliarMensual: 0 } }), "auxiliares")).toBe(0);
  });
  it("combustible = km / rendimiento × precio; el override de la cotización NO modifica el precio global", () => {
    const params = parametros(43);
    const r = calcularCosteoServicio({ ...baseInput(f), parametros: params, precioCombustibleOverride: 50 });
    expect(comp(r, "combustible")).toBe(440);
    expect(r.valoresUsados?.precioCombustibleGalon).toBe(50);
    expect(params.precioCombustibleGalon).toBe(43);
    expect(comp(calcular(f), "combustible")).toBe(378.4);
  });
  it("UN solo margen: valor = base × margen; subtotal = base + margen; el IVA va después", () => {
    const r = calcular(f, { margenObjetivo: 0.45 });
    cerca(r.margenObjetivoMonto ?? NaN, r.costoOperativo * 0.45, 0.005);
    cerca(r.subtotalComercial ?? NaN, r.costoOperativo * 1.45, 0.005);
    cerca(r.iva, (r.subtotalComercial ?? 0) * 0.12, 0.005);
    expect(Object.keys(r)).not.toContain("margen2");
  });
});
function baseInput(f: Fila): InputCosteoServicio {
  return { motorVersion: COTIZACION_COSTEO_COTIZADOR_VERSION, perfil: f.perfil, parametros: parametros(f.combustible), distanciaKm: f.km, diasServicio: 1, cantidadPilotos: 1, cantidadAuxiliares: f.auxiliares, incluirGps: true, incluirSeguroVehiculo: true, margenObjetivo: f.margen };
}

/**
 * VIAJES DE VARIOS DÍAS — la fila 15 de las cinco hojas es «=E6» (Días) para gastos, seguro de mercadería, depreciación, GPS y seguro del
 * vehículo (D16 = D15 × D14, …). Aceite/llantas/combustible dependen de km. Piloto: días en las cinco hojas; auxiliar y «Viáticos y hotel»: según la hoja (banderas).
 */
describe("Paridad MULTIDÍA con el libro (2.7T)", () => {
  const f = HOJAS["Camion de 2.7"];
  const uno = calcular(f);
  const dos = calcular(f, { diasServicio: 2 });
  it("2 días: GPS = Q100 / 20 × 2 = Q10", () => {
    expect(comp(dos, "gps")).toBe(10);
    expect(dos.gps).toBe(10);
  });
  it("2 días: seguro de mercadería automático = 70,000 / 46 / 240 × 2 ≈ Q12.68", () => {
    expect(comp(dos, "seguroMercaderia")).toBe(12.68);
    cerca(70000 / 46 / 240 * 2, 12.681159, 1e-5);
  });
  it("2 días: depreciación, seguro del vehículo y gastos generales = diario × 2", () => {
    expect(comp(dos, "depreciacion")).toBe(192.31); // 150000 / 5 / 12 / 26 × 2
    expect(comp(dos, "seguroVehiculo")).toBe(63.33); // 950 / 30 × 2
    expect(comp(dos, "gastosGenerales")).toBe(441.82); // 203,236.49 / 46 / 20 × 2
  });
  it("2 días: piloto y auxiliar = diario × personas × 2", () => {
    expect(comp(dos, "piloto")).toBe(678.77);
    expect(comp(dos, "auxiliares")).toBe(604);
    expect(comp(calcular(f, { diasServicio: 2, cantidadPilotos: 2 }), "piloto")).toBe(1357.54);
  });
  it("2 días: «Viáticos y hotel» de la hoja 2.7T (=M15 → Días) = Q200 × 2 = Q400", () => {
    expect(comp(dos, "viaticosHotel")).toBe(400);
    expect(comp(uno, "viaticosHotel")).toBe(200);
  });
  it("2 días: un override manual es el TOTAL explícito y no se multiplica (Q450 sigue siendo Q450)", () => {
    expect(comp(calcular(f, { diasServicio: 2, viaticosHotelTotal: 450 }), "viaticosHotel")).toBe(450);
  });
  it("2 días: aceite, llantas y combustible dependen de los km, no de los días", () => {
    for (const k of ["aceite", "llantas", "combustible"]) expect(comp(dos, k)).toBe(comp(uno, k));
    expect([comp(dos, "aceite"), comp(dos, "llantas"), comp(dos, "combustible")]).toEqual([77, 14.96, 378.4]);
  });
  it("2 días: el COSTO BASE es la suma de los conceptos (todos × 2 salvo aceite, llantas y combustible, que dependen de km)", () => {
    const esperado = [441.82, 12.68, 192.31, 10, 63.33, 77, 14.96, 378.4, 678.77, 604, 400].reduce((a, b) => a + b, 0);
    cerca(dos.costoOperativo, esperado, 0.005);
    expect(dos.componentes.reduce((a, c) => a + c.monto, 0)).toBeCloseTo(dos.costoOperativo, 6);
  });
  it("coincide EXACTAMENTE con las fórmulas de la hoja «Camion de 2.7» para 2 días (D16:H16, L16:N16 × Días): ±Q0.02", () => {
    const libro = 2 * (203236.49 / 46 / 20) + 2 * 6.34 + 2 * (150000 / 60 / 26) + 2 * (100 / 20) + 2 * (950 / 30)
      + 220 * (1750 / 5000) + 220 * ((850 * 4) / 50000) + (220 / 25) * 43 + 2 * (6787.685066666668 / 20) + 2 * 302 + 2 * 200;
    cerca(dos.costoOperativo, libro, 0.02);
  });
  it("1 día sigue igual (los casos existentes no cambian)", () => {
    expect(comp(uno, "gps")).toBe(5);
    expect(comp(uno, "seguroMercaderia")).toBe(6.34);
    cerca(uno.costoOperativo, 1671.814, 0.01);
  });
  it("3 días: GPS Q15 y seguro automático ≈ Q19.02; con GPS desactivado no se cobra aunque haya días", () => {
    const tres = calcular(f, { diasServicio: 3 });
    expect(comp(tres, "gps")).toBe(15);
    expect(comp(tres, "seguroMercaderia")).toBe(19.02);
    expect(comp(calcular(f, { diasServicio: 3, incluirGps: false }), "gps")).toBe(0);
    expect(comp(calcular(f, { diasServicio: 3, incluirSeguroMercaderia: false }), "seguroMercaderia")).toBe(0);
  });
  it("días fraccionarios escalan igual (1.5 días: GPS Q7.50)", () => {
    expect(comp(calcular(f, { diasServicio: 1.5 }), "gps")).toBe(7.5);
  });
  it("el GPS multidía sigue usando los viajes mensuales del perfil (no un 20 fijo)", () => {
    expect(comp(calcular({ ...f, perfil: { ...f.perfil, viajesMes: 25 } }, { diasServicio: 2 }), "gps")).toBe(8); // 100 / 25 × 2
  });
});

describe("Seguro de mercadería MANUAL: total explícito del servicio, no se multiplica por días", () => {
  const f = HOJAS["Camion de 2.7"];
  it("Q50 manual con 3 días => Q50 (no Q150)", () => {
    const r = calcular(f, { diasServicio: 3, seguroMercaderia: 50 });
    expect(comp(r, "seguroMercaderia")).toBe(50);
    expect(comp(r, "seguroMercaderia")).not.toBe(150);
  });
  it("un total manual de 0 con varios días sigue siendo 0; y no depende de la configuración anual", () => {
    expect(comp(calcular(f, { diasServicio: 4, seguroMercaderia: 0 }), "seguroMercaderia")).toBe(0);
    const sinAnual = calcularCosteoServicio({ ...baseInput(f), diasServicio: 3, seguroMercaderia: 50, parametros: { ...parametros(43), seguroMercaderiaAnual: null } });
    expect(comp(sinAnual, "seguroMercaderia")).toBe(50);
  });
  it("el mismo servicio de 1 y de 3 días con total manual da el mismo seguro", () => {
    expect(comp(calcular(f, { diasServicio: 1, seguroMercaderia: 80 }), "seguroMercaderia")).toBe(comp(calcular(f, { diasServicio: 3, seguroMercaderia: 80 }), "seguroMercaderia"));
  });
});

describe("Los motores anteriores NO cambian con la corrección multidía", () => {
  const f = HOJAS["Camion de 2.7"];
  it("COSTEO_EXCEL_2026 (PR #406) conserva GPS y seguro de mercadería por viaje, aunque haya varios días", () => {
    const r = calcularCosteoServicio({ ...baseInput(f), motorVersion: COTIZACION_COSTEO_EXCEL_VERSION, diasServicio: 3 });
    expect(r.gps).toBe(5);
    expect(comp(r, "seguroMercaderia")).toBe(6.34);
    expect(comp(r, "gastosGenerales")).toBe(662.73); // ya escalaba por días
  });
  it("el motor V1 (sin versión) tampoco se altera", () => {
    const v1 = (dias: number) => calcularCosteoServicio({ ...baseInput(f), motorVersion: undefined, perfil: { ...f.perfil, depreciacion: null }, diasServicio: dias });
    expect(v1(1).motorVersion).toBeUndefined();
    expect(v1(3).gps).toBeCloseTo(v1(1).gps * 3, 6); // V1: GPS diario (mensual / días de operación × días), sin cambios
  });
});

const FLAGS_HOJA: Record<string, [boolean, boolean]> = {
  "Camion 1 ton": [true, false], "Camion de 2.7": [true, true], "Camion de 5": [false, false], "Camion de 10": [false, false], "Cabezales ": [false, false],
};

/**
 * DECISIÓN POR PERFIL: el comportamiento de cada hoja se reproduce con dos banderas del perfil, sin normalizarlo y sin ramificar por código.
 * Piloto: SIEMPRE × días. Auxiliar: × días si auxiliarMultiplicaDias. Viáticos y hotel DEL PERFIL: × días si viaticosHotelMultiplicaDias.
 */
describe.each(Object.entries(HOJAS))("Banderas por perfil — multidía (2 días) — hoja «%s»", (hoja, f) => {
  const [aux, viat] = FLAGS_HOJA[hoja];
  // 1T y Cabezal traen 0 auxiliares / Q0 viáticos en el ejemplo del libro: se usa 1 auxiliar y Q150 para que la comparación tenga sentido.
  const perfilPrueba = { ...f, perfil: { ...f.perfil, viaticosHotelViaje: f.perfil.viaticosHotelViaje || 150 } };
  const uno = calcular(perfilPrueba, { cantidadAuxiliares: 1 });
  const dos = calcular(perfilPrueba, { diasServicio: 2, cantidadAuxiliares: 1 });
  it("la configuración de referencia del perfil es la de la hoja fuente", () => {
    expect([f.perfil.auxiliarMultiplicaDias, f.perfil.viaticosHotelMultiplicaDias]).toEqual([aux, viat]);
  });
  it("piloto SIEMPRE = diario × 2 (las cinco hojas)", () => {
    cerca(comp(dos, "piloto") ?? NaN, (comp(uno, "piloto") ?? 0) * 2, 0.011);
  });
  it(aux ? "auxiliar = diario × cantidad × 2" : "auxiliar = diario × cantidad, UNA sola vez", () => {
    cerca(comp(dos, "auxiliares") ?? NaN, (comp(uno, "auxiliares") ?? 0) * (aux ? 2 : 1), 0.011);
    expect(dos.valoresUsados?.auxiliarMultiplicaDias).toBe(aux);
  });
  it(viat ? "viáticos y hotel del perfil × 2" : "viáticos y hotel del perfil UNA sola vez", () => {
    expect(comp(dos, "viaticosHotel")).toBe((comp(uno, "viaticosHotel") ?? 0) * (viat ? 2 : 1));
    expect(dos.valoresUsados?.viaticosHotelMultiplicaDias).toBe(viat);
  });
  it("sin advertencias de configuración (la bandera está configurada)", () => {
    expect((dos.advertencias ?? []).join(" ")).not.toMatch(/no indica si/);
  });
});

describe("Banderas por perfil — valores citados en la decisión", () => {
  it("1T, 2 días, 1 auxiliar: auxiliar = diario × 2 y viáticos UNA vez", () => {
    const f = HOJAS["Camion 1 ton"];
    const r = calcular({ ...f, perfil: { ...f.perfil, viaticosHotelViaje: 150 } }, { diasServicio: 2, cantidadAuxiliares: 1 });
    expect(comp(r, "auxiliares")).toBe(604); // 6039.965 / 20 × 2
    expect(comp(r, "viaticosHotel")).toBe(150);
  });
  it("2.7T, 2 días: auxiliar × 2 y viáticos Q200 × 2 = Q400", () => {
    const r = calcular(HOJAS["Camion de 2.7"], { diasServicio: 2 });
    expect(comp(r, "auxiliares")).toBe(604);
    expect(comp(r, "viaticosHotel")).toBe(400);
  });
  it("5T, 2 días: piloto × 2, auxiliar UNA vez (diario) y viáticos Q300 una vez", () => {
    const r = calcular(HOJAS["Camion de 5"], { diasServicio: 2 });
    expect(comp(r, "piloto")).toBe(678.77);
    expect(comp(r, "auxiliares")).toBe(302);
    expect(comp(r, "viaticosHotel")).toBe(300);
  });
  it("10T, 2 días: mismo patrón que 5T (piloto × 2, auxiliar una vez, viáticos Q300 una vez)", () => {
    const r = calcular(HOJAS["Camion de 10"], { diasServicio: 2 });
    expect(comp(r, "piloto")).toBe(728.77);
    expect(comp(r, "auxiliares")).toBe(302);
    expect(comp(r, "viaticosHotel")).toBe(300);
  });
  it("Cabezal, 2 días: piloto × 2, auxiliar permanece Q0 y viáticos Q200 una vez", () => {
    const r = calcular(HOJAS["Cabezales "], { diasServicio: 2 });
    expect(comp(r, "piloto")).toBe(938.86);
    expect(comp(r, "auxiliares")).toBe(0);
    expect(comp(r, "viaticosHotel")).toBe(200);
  });
  it("GPS y seguro de mercadería automático siguen × días en TODOS los perfiles (independiente de las banderas)", () => {
    for (const f of Object.values(HOJAS)) {
      const r = calcular(f, { diasServicio: 2 });
      expect(comp(r, "gps")).toBe(10);
      expect(comp(r, "seguroMercaderia")).toBe(12.68);
    }
  });
  it("1 día: las banderas no cambian nada (todas las hojas conservan sus totales)", () => {
    for (const f of Object.values(HOJAS)) cerca(calcular(f).costoOperativo, f.esperado.base, 0.01);
  });
});

describe("Banderas por perfil — override manual de «Viáticos y hotel» = TOTAL explícito", () => {
  const f = HOJAS["Camion de 2.7"]; // viaticosHotelMultiplicaDias = true
  it("2.7T, 3 días, perfil Q200, override Q350 => Q350 (no Q1,050 ni Q600)", () => {
    const r = calcular(f, { diasServicio: 3, viaticosHotelTotal: 350 });
    expect(comp(r, "viaticosHotel")).toBe(350);
    expect(r.valoresUsados?.origenViaticosHotel).toBe("override");
    expect(comp(calcular(f, { diasServicio: 3 }), "viaticosHotel")).toBe(600); // sin override: Q200 × 3
  });
  it("un override de 0 con la bandera activa sigue siendo 0 (no cae al perfil)", () => {
    expect(comp(calcular(f, { diasServicio: 3, viaticosHotelTotal: 0 }), "viaticosHotel")).toBe(0);
  });
  it("un override negativo se rechaza aunque haya varios días", () => {
    expect(() => calcular(f, { diasServicio: 3, viaticosHotelTotal: -1 })).toThrow(/no negativo/);
  });
  it("el mismo override da el mismo total con 1 o con 3 días (igual que el seguro de mercadería manual)", () => {
    expect(comp(calcular(f, { diasServicio: 1, viaticosHotelTotal: 350 }), "viaticosHotel")).toBe(comp(calcular(f, { diasServicio: 3, viaticosHotelTotal: 350 }), "viaticosHotel"));
  });
});

describe("Banderas por perfil — sin configurar (NULL): predeterminado anterior + advertencia visible", () => {
  const f = HOJAS["Camion de 2.7"];
  const sin = { ...f, perfil: { ...f.perfil, auxiliarMultiplicaDias: null, viaticosHotelMultiplicaDias: null } };
  it("auxiliar sin configurar: se cobra por día (como el PR #406) y avisa; viáticos del perfil sin configurar: una vez y avisa", () => {
    const r = calcular(sin, { diasServicio: 2 });
    expect(comp(r, "auxiliares")).toBe(604);
    expect(comp(r, "viaticosHotel")).toBe(200);
    expect(r.valoresUsados?.auxiliarMultiplicaDias).toBe(true);
    expect(r.valoresUsados?.viaticosHotelMultiplicaDias).toBe(false);
    const adv = (r.advertencias ?? []).join(" ");
    expect(adv).toMatch(/auxiliar se cobra por cada día/);
    expect(adv).toMatch(/«Viáticos y hotel» se cobra por cada día/);
  });
  it("un perfil de datos viejos (propiedades ausentes) se trata igual que NULL", () => {
    const viejo: PerfilCosteoUnidad = { ...f.perfil };
    delete viejo.auxiliarMultiplicaDias;
    delete viejo.viaticosHotelMultiplicaDias;
    expect(comp(calcular({ ...f, perfil: viejo }, { diasServicio: 2 }), "auxiliares")).toBe(604);
  });
  it("con 1 día no hay advertencia (no hay nada que multiplicar)", () => {
    expect((calcular(sin).advertencias ?? []).join(" ")).not.toMatch(/no indica si/);
  });
  it("sin valor que escalar tampoco avisa: auxiliar con 0 auxiliares y viáticos con override manual o en Q0", () => {
    expect((calcular(sin, { diasServicio: 2, cantidadAuxiliares: 0, viaticosHotelTotal: 100 }).advertencias ?? []).join(" ")).not.toMatch(/no indica si/);
    const cero = { ...sin, perfil: { ...sin.perfil, viaticosHotelViaje: 0, salarioAuxiliarMensual: 0 } };
    expect((calcular(cero, { diasServicio: 2 }).advertencias ?? []).join(" ")).not.toMatch(/no indica si/);
  });
  it("false configurado NO es «sin configurar»: respeta el No (auxiliar una vez) sin advertencia", () => {
    const no = { ...f, perfil: { ...f.perfil, auxiliarMultiplicaDias: false, viaticosHotelMultiplicaDias: false } };
    const r = calcular(no, { diasServicio: 2 });
    expect(comp(r, "auxiliares")).toBe(302);
    expect(comp(r, "viaticosHotel")).toBe(200);
    expect((r.advertencias ?? []).join(" ")).not.toMatch(/no indica si/);
  });
});

describe("Banderas por perfil — el motor no ramifica por código de perfil", () => {
  const codigoMotor = readFileSync("src/lib/tms/cotizacion-costeo-cotizador-2026.ts", "utf8")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
  it("sin CAMION_1T / CAMION_2_7T / CAMION_5T / CAMION_10T / CABEZAL ni comparaciones con perfil.codigo", () => {
    for (const c of ["CAMION_1T", "CAMION_2_7T", "CAMION_5T", "CAMION_10T", "CABEZAL"]) expect(codigoMotor).not.toContain(c);
    expect(codigoMotor).not.toMatch(/p(?:erfil)?\.codigo/);
  });
  it("dos perfiles con el mismo código pero banderas distintas dan resultados distintos: manda la configuración, no el código", () => {
    const f = HOJAS["Camion de 5"];
    const a = calcular({ ...f, perfil: { ...f.perfil, auxiliarMultiplicaDias: true, viaticosHotelMultiplicaDias: true } }, { diasServicio: 2 });
    expect([comp(a, "auxiliares"), comp(a, "viaticosHotel")]).toEqual([604, 600]);
  });
});

describe("Banderas por perfil — históricos intactos", () => {
  const f = HOJAS["Camion de 2.7"];
  it("COSTEO_EXCEL_2026 y COSTEO_V1 ignoran las banderas (su fórmula no cambia)", () => {
    const flags = { ...f.perfil, auxiliarMultiplicaDias: false, viaticosHotelMultiplicaDias: true };
    const sinFlags = { ...f.perfil, auxiliarMultiplicaDias: null, viaticosHotelMultiplicaDias: null };
    const excel = (perfil: PerfilCosteoUnidad) => calcularCosteoServicio({ ...baseInput(f), motorVersion: COTIZACION_COSTEO_EXCEL_VERSION, diasServicio: 3, perfil });
    expect(excel(flags).costoOperativo).toBe(excel(sinFlags).costoOperativo);
    const v1 = (perfil: PerfilCosteoUnidad) => calcularCosteoServicio({ ...baseInput(f), motorVersion: undefined, diasServicio: 3, perfil: { ...perfil, depreciacion: null } });
    expect(v1(flags).costoOperativo).toBe(v1(sinFlags).costoOperativo);
    expect(excel(flags).valoresUsados?.auxiliarMultiplicaDias).toBeUndefined();
  });
});

describe("Thermo / refrigeración: infraestructura conservada, fuera de las cinco hojas", () => {
  const f = HOJAS["Camion de 5"];
  const refrigerado = { ...f.perfil, codigo: "CAMION_5T_REFRIGERADO", costoRefrigeracion: { valorBase: 100000, anios: 5, diasOperacionMes: 26 } };
  it("un perfil refrigerado/personalizado SÍ puede usar Thermo cuando se solicita (100000 / 5 / 12 / 26 = 64.10 por día)", () => {
    const r = calcular({ ...f, perfil: refrigerado }, { usarRefrigeracion: true });
    expect(r.refrigeracion).toBe(64.1);
    expect(comp(r, "refrigeracion")).toBe(64.1);
  });
  it("sin solicitarlo no se suma; pedir Thermo en un perfil normal (sin Thermo configurado) se rechaza en vez de ignorarse", () => {
    expect(calcular({ ...f, perfil: refrigerado }).refrigeracion).toBe(0);
    expect(calcular(f).refrigeracion).toBe(0);
    expect(() => calcular(f, { usarRefrigeracion: true })).toThrow(/refrigeración/);
  });
});

describe("Versionado del motor y compatibilidad de históricos", () => {
  const f = HOJAS["Camion de 2.7"];
  it("tres versiones coexisten: V1 (sin selector), COSTEO_EXCEL_2026 (PR #406) y COSTEO_COTIZADOR_2026 (nuevo)", () => {
    expect(COTIZACION_COSTEO_EXCEL_VERSION).toBe("COSTEO_EXCEL_2026");
    expect(COTIZACION_COSTEO_COTIZADOR_VERSION).toBe("COSTEO_COTIZADOR_2026");
    expect(calcular(f).motorVersion).toBe("COSTEO_COTIZADOR_2026");
    expect(calcularCosteoServicio({ ...baseInput(f), motorVersion: COTIZACION_COSTEO_EXCEL_VERSION }).motorVersion).toBe("COSTEO_EXCEL_2026");
    expect(calcularCosteoServicio({ ...baseInput(f), motorVersion: undefined, perfil: { ...f.perfil, depreciacion: null } }).motorVersion).toBeUndefined();
  });
  it("COSTEO_EXCEL_2026 conserva su fórmula del PR #406 (hotel por persona/día y viáticos por rol), sin reinterpretarse", () => {
    const r = calcularCosteoServicio({
      ...baseInput(f), motorVersion: COTIZACION_COSTEO_EXCEL_VERSION, diasServicio: 2, cantidadAuxiliares: 1,
      parametros: { ...parametros(43), hotelDia: 300, viaticoPilotoDia: 0, viaticoAuxiliarDia: 0, viaticoGuiaDia: 0 },
    });
    expect(r.hotel).toBe(1200); // Q300 × 2 días × (1 piloto + 1 auxiliar)
    expect(r.viaticosHotel).toBeUndefined();
    expect(r.componentes.map((c) => c.clave)).toContain("hotel");
  });
  it("el motor V1 (sin versión) no se ve afectado por viaticosHotelViaje ni por el campo nuevo", () => {
    const sinVersion = (extra: Partial<PerfilCosteoUnidad>) => calcularCosteoServicio({ ...baseInput(f), motorVersion: undefined, perfil: { ...f.perfil, depreciacion: null, ...extra } }).costoOperativo;
    expect(sinVersion({ viaticosHotelViaje: 999 })).toBe(sinVersion({ viaticosHotelViaje: null }));
    expect(sinVersion({ auxiliarMultiplicaDias: false, viaticosHotelMultiplicaDias: true })).toBe(sinVersion({ auxiliarMultiplicaDias: null, viaticosHotelMultiplicaDias: null }));
  });
});

describe("Perfiles reconocidos y sin datos inventados", () => {
  it("los cinco perfiles fuente del libro están disponibles como códigos; CAMION_12T y CAMION_5T_REFRIGERADO se conservan sin datos del libro", () => {
    const codigos = CODIGOS_PERFIL_COSTEO.map((c) => c.codigo);
    for (const c of ["CAMION_1T", "CAMION_2_7T", "CAMION_5T", "CAMION_10T", "CABEZAL"]) expect(codigos).toContain(c);
    for (const c of ["CAMION_12T", "CAMION_5T_REFRIGERADO"]) expect(codigos).toContain(c);
    expect(Object.values(HOJAS).map((h) => h.perfil.codigo)).not.toContain("CAMION_12T");
    expect(Object.values(HOJAS).map((h) => h.perfil.codigo)).not.toContain("CAMION_5T_REFRIGERADO");
  });
  it("ningún valor del libro se siembra: no hay INSERT de perfiles/parámetros en el SQL de esta paridad ni en schema.sql", () => {
    const sql = ["sql/migrate-2026-10-cotizaciones-paridad-cotizador-2026.sql", "sql/preflight-2026-10-cotizaciones-paridad-cotizador-2026.sql"].map((p) => readFileSync(p, "utf8"));
    for (const s of sql) expect(s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")).not.toMatch(/\bINSERT\b/i);
    expect(readFileSync("sql/schema.sql", "utf8")).not.toMatch(/INSERT INTO tms_cotizacion_costeo/i);
  });
});

describe("El motor no hardcodea los valores del libro", () => {
  const codigo = readFileSync("src/lib/tms/cotizacion-costeo-cotizador-2026.ts", "utf8")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
  it("sin 20 (viajes/días laborales/gastos), 26, 46, 240, 5000, 50000, 70000 ni los montos de gastos", () => {
    for (const literal of ["20", "26", "46", "240", "5000", "50000", "70000", "90586", "34602", "25826", "52221", "203236", "6.34", "100"]) {
      expect(new RegExp(`(?<![\\w.])${literal.replace(".", "\\.")}(?![\\w])`).test(codigo), `literal ${literal} en el motor`).toBe(false);
    }
  });
  it("las únicas constantes numéricas son las del cálculo del libro: 30 (seguro del vehículo mensual → diario) y 12 (meses)", () => {
    expect(codigo).toMatch(/\.div\(30\)/);
    expect(codigo).toMatch(/\.div\(12\)/);
  });
});
