import Decimal from "decimal.js";
import {
  COTIZACION_COSTEO_COTIZADOR_V2_VERSION, COTIZACION_COSTEO_COTIZADOR_VERSION, ErrorCosteo,
  type InputCosteoServicio, type ResultadoCosteoServicio,
} from "./cotizacion-costeo";
import { CAMPOS_EXCEL_PARAMETROS, CAMPOS_EXCEL_PERFIL } from "./cotizacion-costeo-excel-campos";
import { dec, monto, positivo } from "./cotizacion-costeo-excel";

/**
 * Motor «Cotizador 2026» — paridad con «Cotizador 2026.xlsx» (hojas 1 ton, 2.7, 5, 10 y Cabezales). Una sola implementación de las fórmulas con DOS políticas de redondeo:
 *
 *  - "por_componente" → COSTEO_COTIZADOR_2026 (versión anterior, SOLO para leer/recalcular de forma pura lo ya guardado): cada concepto, el valor del margen y el IVA se redondean a
 *    2 decimales (HALF_UP) ANTES de seguir sumando. No coincide con el libro al centavo (p. ej. 2.7T daba Q2,434.15 en vez de Q2,434.16).
 *  - "al_final" → COSTEO_COTIZADOR_2026_V2 (cálculos NUEVOS): el libro NO redondea; conserva la precisión de las fórmulas y la celda solo da formato de 2 decimales. Aquí todo el cálculo
 *    (componentes, costo base, margen, subtotal, IVA, total, precio/km) se hace con Decimal de 40 dígitos SIN redondear, y se redondea a 2 decimales (HALF_UP) una sola vez, solo para
 *    presentar/persistir. Los valores de cálculo se conservan como cadenas decimales en `precision` (resultado_snapshot) para poder auditar el cálculo exactamente.
 *
 * Valores LITERALES del libro: el libro tiene celdas escritas a mano (no fórmulas) que difieren del valor derivable: «Seguro merca» = 6.34 (E12, no el 6.3405797… de J7) en las cinco
 * hojas, «Auxiliar» = 302 (M12) en 2.7T y «Piloto» = 339.38 (L12) en 5T. El motor NO los normaliza ni inventa reglas de redondeo para reproducirlos: se reproducen con los mismos datos de
 * entrada (seguro de mercadería manual = total del servicio; salario mensual del perfil / días laborales = el diario escrito), igual que el libro los tiene como valores de entrada.
 *
 * «VIATICOS Y HOTEL»: el libro tiene una sola columna con un valor directo por viaje. Aquí es:
 *     override manual de la cotización (TOTAL explícito, nunca se multiplica)  ??  perfil.viaticosHotelViaje [× días solo si el perfil lo indica]  ??  0 (con advertencia)
 * y nunca se multiplica por personas ni guías. Ya no existen viático piloto / auxiliar / guía ni hotel por persona-día:
 * los parámetros globales viaticoPilotoDia, viaticoAuxiliarDia, viaticoGuiaDia y hotelDia, los overrides de PR #406 y las guías se
 * IGNORAN (permanecen en BD solo por compatibilidad con snapshots históricos, que nunca se recalculan).
 *
 * Salarios: salario mensual del perfil / días laborales globales; si el perfil no lo tiene (NULL) se usa el costo diario global
 * como respaldo histórico. El piloto SIEMPRE es diario × personas × días (las cinco hojas lo multiplican por días).
 *
 * DIFERENCIAS ENTRE HOJAS (se reproducen sin normalizar y sin ramificar por código de perfil): el libro multiplica por días el auxiliar solo en
 * 1T y 2.7T, y «Viáticos y hotel» solo en 2.7T. Se modelan como dos banderas del perfil: `auxiliarMultiplicaDias` y `viaticosHotelMultiplicaDias`.
 *
 * VIAJES DE VARIOS DÍAS (fila 15 del libro: «=E6» = Días): se multiplican por días gastos generales, seguro de mercadería, depreciación,
 * GPS, seguro del vehículo y piloto; el auxiliar y «Viáticos y hotel» del perfil, según las banderas de arriba. Dependen de los km (no de los
 * días): aceite, llantas y combustible. Un total MANUAL (seguro de mercadería o «Viáticos y hotel») es el total del servicio que escribió el
 * usuario: se usa tal cual y no se vuelve a multiplicar.
 */
export type PoliticaRedondeoCosteo = "por_componente" | "al_final";

export function calcularCosteoCotizador2026(i: InputCosteoServicio, politica: PoliticaRedondeoCosteo = "por_componente"): ResultadoCosteoServicio {
  const p = i.perfil, e = i.parametros, km = dec(i.distanciaKm), dias = dec(i.diasServicio);
  const alFinal = politica === "al_final";
  /** Redondeo de PRESENTACIÓN/persistencia: 2 decimales HALF_UP (como el formato de celda del libro). */
  const r2 = (v: Decimal): Decimal => v.toDecimalPlaces(2);
  /** Valor de CÁLCULO: con "al_final" se conserva la precisión completa; con "por_componente" se redondea ya (política anterior). */
  const calc = (v: Decimal): Decimal => (alFinal ? v : r2(v));
  const n2 = (v: Decimal): number => r2(v).toNumber();
  const CERO = dec(0);
  const advertencias: string[] = [];
  if (i.seguroMercaderia == null && i.incluirSeguroMercaderia !== false && e.seguroMercaderiaAnual == null) {
    advertencias.push("Seguro de mercadería no configurado: no se incluyó. Configure el monto anual o ingrese un total explícito antes de usar este costeo.");
  }
  for (const campo of CAMPOS_EXCEL_PARAMETROS) if (e[campo.key] != null) monto(campo.key, e[campo.key]);
  for (const campo of CAMPOS_EXCEL_PERFIL) if (p[campo.key] != null) monto(campo.key, p[campo.key]);

  const depreciar = (equipo: NonNullable<typeof p.depreciacion>) =>
    calc(dec(equipo.valorBase).div(equipo.anios).div(12).div(positivo("días depreciación", e.diasDepreciacionMes ?? equipo.diasOperacionMes)).mul(dias));
  const depreciacion = p.depreciacion ? depreciar(p.depreciacion) : CERO;
  // Thermo: infraestructura conservada para perfiles refrigerados/personalizados; NO es una columna de las cinco hojas del libro.
  const refrigeracion = i.usarRefrigeracion && p.costoRefrigeracion ? depreciar(p.costoRefrigeracion) : CERO;
  // GPS = (GPS mensual / viajes mensuales) × días (G16 = G15 × G14, con G15 = Días).
  const gps = i.incluirGps ? calc(dec(p.gpsMensual).div(positivo("viajes mensuales GPS", p.viajesMes)).mul(dias)) : CERO;
  const seguroVehiculo = i.incluirSeguroVehiculo ? calc(dec(p.seguroVehiculoMensual).div(30).mul(dias)) : CERO;
  const seguroMercaderia = i.seguroMercaderia != null ? calc(dec(monto("seguro mercadería total", i.seguroMercaderia)))
    : i.incluirSeguroMercaderia === false || e.seguroMercaderiaAnual == null || e.seguroMercaderiaAnual === 0 ? CERO
    // Automático: (anual / flota / viajes anuales) × días (E16 = E15 × E14, con E15 = Días). El total manual de arriba NO se multiplica.
    : calc(dec(e.seguroMercaderiaAnual).div(positivo("cantidad camiones", e.cantidadCamiones)).div(positivo("viajes anuales", e.viajesAnuales)).mul(dias));

  const gastos = [e.gastosAdministracion, e.gastosMantenimiento, e.gastosSeguridad, e.gastosPredios];
  if (gastos.every((v) => v == null)) advertencias.push("Gastos generales no configurados: no se incluyeron. Complete los cuatro conceptos en Ajustes antes de usar este costeo; NULL no significa costo cero confirmado.");
  if (gastos.some((v) => v != null) && gastos.some((v) => v == null)) throw new ErrorCosteo("gastos generales", "Complete los cuatro conceptos de gastos globales (0 cuando no aplica).");
  const gastoMensual = gastos.reduce<Decimal>((s, v) => s.plus(v ?? 0), dec(0));
  const gastosGenerales = gastoMensual.isZero() ? CERO : calc(gastoMensual.div(positivo("cantidad camiones", e.cantidadCamiones)).div(positivo("días gastos mensuales", e.diasGastosMes)).mul(dias));

  const aceite = calc(dec(p.costoAceiteServicio).div(p.vidaUtilAceiteKm).mul(km));
  if ((p.precioLlanta == null) !== (p.cantidadLlantas == null)) throw new ErrorCosteo("llantas", "Complete precio por llanta y cantidad, o conserve el costo histórico del juego.");
  const juego = p.precioLlanta == null ? dec(p.costoJuegoLlantas) : dec(p.precioLlanta).mul(positivo("cantidad llantas", p.cantidadLlantas));
  if (p.cantidadLlantas != null && !Number.isInteger(p.cantidadLlantas)) throw new ErrorCosteo("cantidad llantas", "La cantidad de llantas debe ser entera.");
  if (e.cantidadCamiones != null && !Number.isInteger(e.cantidadCamiones)) throw new ErrorCosteo("cantidad camiones", "La cantidad de camiones debe ser entera.");
  const llantas = calc(juego.div(p.vidaUtilLlantasKm).mul(km));
  const combustible = calc(km.div(p.rendimientoKmGalon).mul(monto("combustible usado", i.precioCombustibleOverride ?? e.precioCombustibleGalon)));

  const diarioPiloto = p.salarioPilotoMensual == null ? dec(e.costoPilotoDia) : dec(p.salarioPilotoMensual).div(positivo("días laborales mes", e.diasLaboralesMes));
  const diarioAuxiliar = p.salarioAuxiliarMensual == null ? dec(e.costoAuxiliarDia) : dec(p.salarioAuxiliarMensual).div(positivo("días laborales mes", e.diasLaboralesMes));
  const piloto = calc(diarioPiloto.mul(dias).mul(i.cantidadPilotos));
  // Auxiliar: base = diario × cantidad; × días solo si el perfil lo indica (sin configurar => por día, como el PR #406 y las hojas 1T y 2.7T).
  const auxiliarMultiplicaDias = p.auxiliarMultiplicaDias ?? true;
  const auxiliares = calc(diarioAuxiliar.mul(i.cantidadAuxiliares).mul(auxiliarMultiplicaDias ? dias : 1));
  if (p.auxiliarMultiplicaDias == null && i.diasServicio > 1 && i.cantidadAuxiliares > 0 && !diarioAuxiliar.isZero()) {
    advertencias.push("El perfil no indica si el auxiliar se cobra por cada día de servicio: se cobró por día. Configúrelo en Ajustes para igualar la hoja del Cotizador 2026.");
  }

  // «VIATICOS Y HOTEL»: UN valor por viaje. Override de la cotización > valor del perfil > 0 (advertido). No se multiplica por nada.
  // El override manual es el TOTAL explícito del servicio (no se multiplica); el valor del PERFIL se multiplica por días solo si el perfil lo indica.
  const origenViaticosHotel: "override" | "perfil" | "sin_configurar" = i.viaticosHotelTotal != null ? "override" : p.viaticosHotelViaje != null ? "perfil" : "sin_configurar";
  if (origenViaticosHotel === "sin_configurar") advertencias.push("Viáticos y hotel no configurados en el perfil: se usó Q0. Configure el valor del perfil o ingrese el monto de esta cotización.");
  const viaticosHotelMultiplicaDias = p.viaticosHotelMultiplicaDias ?? false;
  if (origenViaticosHotel === "perfil" && p.viaticosHotelMultiplicaDias == null && i.diasServicio > 1 && (p.viaticosHotelViaje ?? 0) > 0) {
    advertencias.push("El perfil no indica si «Viáticos y hotel» se cobra por cada día de servicio: se cobró una sola vez. Configúrelo en Ajustes para igualar la hoja del Cotizador 2026.");
  }
  const viaticosHotel = i.viaticosHotelTotal != null
    ? calc(dec(monto("viáticos y hotel", i.viaticosHotelTotal)))
    : calc(dec(monto("viáticos y hotel", p.viaticosHotelViaje ?? 0)).mul(viaticosHotelMultiplicaDias ? dias : 1));

  const otros = (i.otrosCostos ?? []).map((c, n) => ({ clave: `otro:${n}`, concepto: c.concepto.trim(), monto: calc(dec(c.monto)) }));
  const componentes = [
    { clave: "gastosGenerales", concepto: "Gastos varios / gastos generales", monto: gastosGenerales },
    { clave: "seguroMercaderia", concepto: "Seguro mercadería", monto: seguroMercaderia },
    { clave: "depreciacion", concepto: "Depreciación", monto: depreciacion },
    { clave: "gps", concepto: "GPS", monto: gps },
    { clave: "seguroVehiculo", concepto: "Seguro vehículo", monto: seguroVehiculo },
    { clave: "aceite", concepto: "Aceite", monto: aceite },
    { clave: "llantas", concepto: "Llantas", monto: llantas },
    { clave: "combustible", concepto: "Combustible", monto: combustible },
    { clave: "piloto", concepto: "Piloto", monto: piloto },
    { clave: "auxiliares", concepto: "Auxiliar", monto: auxiliares },
    { clave: "viaticosHotel", concepto: "Viáticos y hotel", monto: viaticosHotel },
    { clave: "refrigeracion", concepto: "Equipo de refrigeración / Thermo", monto: refrigeracion },
    ...(otros.length ? otros : [{ clave: "otrosCostos", concepto: "Otros costos", monto: CERO }]),
  ];
  const base = componentes.reduce((s, c) => s.plus(c.monto), dec(0));

  // UN solo margen objetivo (p. ej. 15 % + 15 % del libro => 30 %). Sobre el costo base; el IVA va DESPUÉS.
  // base × 0.15 + base × 0.15 = base × 0.30 (misma cantidad, sin redondear cada mitad cuando la política es «al final»).
  const margenObjetivo = i.margenObjetivo ?? e.margenObjetivo ?? 0;
  if (!Number.isFinite(margenObjetivo) || margenObjetivo < 0 || margenObjetivo > 5) throw new ErrorCosteo("margenObjetivo", "El margen objetivo debe estar entre 0 y 500%.");
  const margenValor = calc(base.mul(margenObjetivo));
  const subtotal = base.plus(margenValor), iva = calc(subtotal.mul(e.ivaTasa));
  const total = subtotal.plus(iva);
  if (total.greaterThan("9999999999.999999")) throw new ErrorCosteo("total costeo", "El resultado excede la precisión monetaria admitida por el snapshot.");
  const costoConIva = calc(base.mul(dec(1).plus(e.ivaTasa)));
  const precioVenta = i.precioVenta ?? null;
  const utilidad = precioVenta == null ? null : calc(dec(precioVenta).minus(costoConIva));
  const precioPorKm = km.isZero() ? null : total.div(km);
  // Presentación/persistencia con «al final»: un único redondeo a 2 decimales por valor mostrado, a partir del valor de cálculo.
  const s12 = (v: Decimal) => v.toFixed(12);
  return {
    advertencias,
    valoresUsados: {
      precioCombustibleGalon: i.precioCombustibleOverride ?? e.precioCombustibleGalon,
      rendimientoKmGalon: p.rendimientoKmGalon, viajesMes: p.viajesMes ?? null,
      diasDepreciacionVehiculo: p.depreciacion ? e.diasDepreciacionMes ?? p.depreciacion.diasOperacionMes : null,
      diasDepreciacionThermo: i.usarRefrigeracion && p.costoRefrigeracion ? e.diasDepreciacionMes ?? p.costoRefrigeracion.diasOperacionMes : null,
      costoJuegoLlantas: juego.toNumber(),
      salarioPilotoMensual: p.salarioPilotoMensual ?? null,
      salarioAuxiliarMensual: p.salarioAuxiliarMensual ?? null,
      costoPilotoDia: diarioPiloto.toNumber(), costoAuxiliarDia: diarioAuxiliar.toNumber(),
      diasLaboralesMes: e.diasLaboralesMes ?? null,
      viaticosHotelViaje: n2(viaticosHotel), origenViaticosHotel, auxiliarMultiplicaDias, viaticosHotelMultiplicaDias,
    },
    motorVersion: alFinal ? COTIZACION_COSTEO_COTIZADOR_V2_VERSION : COTIZACION_COSTEO_COTIZADOR_VERSION,
    depreciacion: n2(depreciacion), refrigeracion: n2(refrigeracion), gps: n2(gps), seguroVehiculo: n2(seguroVehiculo), seguroMercaderia: n2(seguroMercaderia),
    gastosGenerales: n2(gastosGenerales), aceite: n2(aceite), llantas: n2(llantas), combustible: n2(combustible), piloto: n2(piloto), auxiliares: n2(auxiliares),
    // Los cuatro conceptos del PR #406 no existen en este motor.
    viaticoPiloto: 0, viaticoAuxiliar: 0, viaticoGuia: 0, hotel: 0, viaticosHotel: n2(viaticosHotel),
    otrosCostos: n2(otros.reduce((s, c) => s.plus(c.monto), dec(0))),
    costoOperativo: n2(base), iva: n2(iva), costoConIva: n2(costoConIva), margenObjetivoAplicado: margenObjetivo,
    margenObjetivoMonto: n2(margenValor),
    subtotalComercial: n2(subtotal), precioSugerido: n2(total),
    precioPorKm: precioPorKm == null ? null : n2(precioPorKm), precioVenta, utilidadEstimada: utilidad == null ? null : n2(utilidad),
    margenReal: utilidad == null || costoConIva.isZero() ? null : utilidad.div(costoConIva).toNumber(),
    componentes: componentes.map((c) => ({ clave: c.clave, concepto: c.concepto, monto: n2(c.monto) })),
    ...(alFinal ? {
      precision: {
        politicaRedondeo: "al_final" as const,
        componentes: Object.fromEntries(componentes.map((c) => [c.clave, s12(c.monto)])),
        costoOperativo: s12(base), margenObjetivoMonto: s12(margenValor), subtotalComercial: s12(subtotal), iva: s12(iva), costoConIva: s12(costoConIva),
        precioSugerido: s12(total), precioPorKm: precioPorKm == null ? null : s12(precioPorKm),
      },
    } : {}),
  };
}
