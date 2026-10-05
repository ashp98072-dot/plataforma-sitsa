import Decimal from "decimal.js";
import { ErrorCosteo, type InputCosteoServicio, type ResultadoCosteoServicio } from "./cotizacion-costeo";
import { CAMPOS_EXCEL_PARAMETROS, CAMPOS_EXCEL_PERFIL } from "./cotizacion-costeo-excel-campos";
import { dec, monto, positivo, q } from "./cotizacion-costeo-excel";

/**
 * COSTEO_COTIZADOR_2026 — paridad estricta con «Cotizador 2026.xlsx» (hojas 1 ton, 2.7, 5, 10 y Cabezales).
 *
 * Mismas fórmulas y misma política de redondeo que COSTEO_EXCEL_2026 (Decimal HALF_UP, cada concepto a 2 decimales y la suma
 * sin redondeo adicional), con UNA diferencia deliberada: el libro tiene una sola columna «VIATICOS Y HOTEL» con un valor directo
 * por viaje. Aquí «Viáticos y hotel» es:
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
export function calcularCosteoCotizador2026(i: InputCosteoServicio): ResultadoCosteoServicio {
  const p = i.perfil, e = i.parametros, km = dec(i.distanciaKm), dias = dec(i.diasServicio);
  const advertencias: string[] = [];
  if (i.seguroMercaderia == null && i.incluirSeguroMercaderia !== false && e.seguroMercaderiaAnual == null) {
    advertencias.push("Seguro de mercadería no configurado: no se incluyó. Configure el monto anual o ingrese un total explícito antes de usar este costeo.");
  }
  for (const campo of CAMPOS_EXCEL_PARAMETROS) if (e[campo.key] != null) monto(campo.key, e[campo.key]);
  for (const campo of CAMPOS_EXCEL_PERFIL) if (p[campo.key] != null) monto(campo.key, p[campo.key]);

  const depreciar = (equipo: NonNullable<typeof p.depreciacion>) =>
    q(dec(equipo.valorBase).div(equipo.anios).div(12).div(positivo("días depreciación", e.diasDepreciacionMes ?? equipo.diasOperacionMes)).mul(dias));
  const depreciacion = p.depreciacion ? depreciar(p.depreciacion) : 0;
  // Thermo: infraestructura conservada para perfiles refrigerados/personalizados; NO es una columna de las cinco hojas del libro.
  const refrigeracion = i.usarRefrigeracion && p.costoRefrigeracion ? depreciar(p.costoRefrigeracion) : 0;
  // GPS = (GPS mensual / viajes mensuales) × días (G16 = G15 × G14, con G15 = Días).
  const gps = i.incluirGps ? q(dec(p.gpsMensual).div(positivo("viajes mensuales GPS", p.viajesMes)).mul(dias)) : 0;
  const seguroVehiculo = i.incluirSeguroVehiculo ? q(dec(p.seguroVehiculoMensual).div(30).mul(dias)) : 0;
  const seguroMercaderia = i.seguroMercaderia != null ? q(dec(monto("seguro mercadería total", i.seguroMercaderia)))
    : i.incluirSeguroMercaderia === false || e.seguroMercaderiaAnual == null || e.seguroMercaderiaAnual === 0 ? 0
    // Automático: (anual / flota / viajes anuales) × días (E16 = E15 × E14, con E15 = Días). El total manual de arriba NO se multiplica.
    : q(dec(e.seguroMercaderiaAnual).div(positivo("cantidad camiones", e.cantidadCamiones)).div(positivo("viajes anuales", e.viajesAnuales)).mul(dias));

  const gastos = [e.gastosAdministracion, e.gastosMantenimiento, e.gastosSeguridad, e.gastosPredios];
  if (gastos.every((v) => v == null)) advertencias.push("Gastos generales no configurados: no se incluyeron. Complete los cuatro conceptos en Ajustes antes de usar este costeo; NULL no significa costo cero confirmado.");
  if (gastos.some((v) => v != null) && gastos.some((v) => v == null)) throw new ErrorCosteo("gastos generales", "Complete los cuatro conceptos de gastos globales (0 cuando no aplica).");
  const gastoMensual = gastos.reduce<Decimal>((s, v) => s.plus(v ?? 0), dec(0));
  const gastosGenerales = gastoMensual.isZero() ? 0 : q(gastoMensual.div(positivo("cantidad camiones", e.cantidadCamiones)).div(positivo("días gastos mensuales", e.diasGastosMes)).mul(dias));

  const aceite = q(dec(p.costoAceiteServicio).div(p.vidaUtilAceiteKm).mul(km));
  if ((p.precioLlanta == null) !== (p.cantidadLlantas == null)) throw new ErrorCosteo("llantas", "Complete precio por llanta y cantidad, o conserve el costo histórico del juego.");
  const juego = p.precioLlanta == null ? dec(p.costoJuegoLlantas) : dec(p.precioLlanta).mul(positivo("cantidad llantas", p.cantidadLlantas));
  if (p.cantidadLlantas != null && !Number.isInteger(p.cantidadLlantas)) throw new ErrorCosteo("cantidad llantas", "La cantidad de llantas debe ser entera.");
  if (e.cantidadCamiones != null && !Number.isInteger(e.cantidadCamiones)) throw new ErrorCosteo("cantidad camiones", "La cantidad de camiones debe ser entera.");
  const llantas = q(juego.div(p.vidaUtilLlantasKm).mul(km));
  const combustible = q(km.div(p.rendimientoKmGalon).mul(monto("combustible usado", i.precioCombustibleOverride ?? e.precioCombustibleGalon)));

  const diarioPiloto = p.salarioPilotoMensual == null ? dec(e.costoPilotoDia) : dec(p.salarioPilotoMensual).div(positivo("días laborales mes", e.diasLaboralesMes));
  const diarioAuxiliar = p.salarioAuxiliarMensual == null ? dec(e.costoAuxiliarDia) : dec(p.salarioAuxiliarMensual).div(positivo("días laborales mes", e.diasLaboralesMes));
  const piloto = q(diarioPiloto.mul(dias).mul(i.cantidadPilotos));
  // Auxiliar: base = diario × cantidad; × días solo si el perfil lo indica (sin configurar => por día, como el PR #406 y las hojas 1T y 2.7T).
  const auxiliarMultiplicaDias = p.auxiliarMultiplicaDias ?? true;
  const auxiliares = q(diarioAuxiliar.mul(i.cantidadAuxiliares).mul(auxiliarMultiplicaDias ? dias : 1));
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
    ? q(dec(monto("viáticos y hotel", i.viaticosHotelTotal)))
    : q(dec(monto("viáticos y hotel", p.viaticosHotelViaje ?? 0)).mul(viaticosHotelMultiplicaDias ? dias : 1));

  const otros = (i.otrosCostos ?? []).map((c, n) => ({ clave: `otro:${n}`, concepto: c.concepto.trim(), monto: q(dec(c.monto)) }));
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
    ...(otros.length ? otros : [{ clave: "otrosCostos", concepto: "Otros costos", monto: 0 }]),
  ];
  const base = componentes.reduce((s, c) => s.plus(c.monto), dec(0));

  // UN solo margen objetivo (p. ej. 15 % + 15 % del libro => 30 %). Sobre el costo base; el IVA va DESPUÉS.
  const margenObjetivo = i.margenObjetivo ?? e.margenObjetivo ?? 0;
  if (!Number.isFinite(margenObjetivo) || margenObjetivo < 0 || margenObjetivo > 5) throw new ErrorCosteo("margenObjetivo", "El margen objetivo debe estar entre 0 y 500%.");
  const margenValor = q(base.mul(margenObjetivo));
  const subtotal = base.plus(margenValor), iva = q(subtotal.mul(e.ivaTasa));
  const total = subtotal.plus(iva);
  if (total.greaterThan("9999999999.999999")) throw new ErrorCosteo("total costeo", "El resultado excede la precisión monetaria admitida por el snapshot.");
  const costoConIva = q(base.mul(dec(1).plus(e.ivaTasa)));
  const precioVenta = i.precioVenta ?? null;
  const utilidadEstimada = precioVenta == null ? null : q(dec(precioVenta).minus(costoConIva));
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
      viaticosHotelViaje: viaticosHotel, origenViaticosHotel, auxiliarMultiplicaDias, viaticosHotelMultiplicaDias,
    },
    motorVersion: "COSTEO_COTIZADOR_2026", depreciacion, refrigeracion, gps, seguroVehiculo, seguroMercaderia,
    gastosGenerales, aceite, llantas, combustible, piloto, auxiliares,
    // Los cuatro conceptos del PR #406 no existen en este motor.
    viaticoPiloto: 0, viaticoAuxiliar: 0, viaticoGuia: 0, hotel: 0, viaticosHotel,
    otrosCostos: q(otros.reduce((s, c) => s.plus(c.monto), dec(0))),
    costoOperativo: q(base), iva, costoConIva, margenObjetivoAplicado: margenObjetivo,
    margenObjetivoMonto: margenValor,
    subtotalComercial: q(subtotal), precioSugerido: q(total),
    precioPorKm: km.isZero() ? null : q(total.div(km)), precioVenta, utilidadEstimada,
    margenReal: utilidadEstimada == null || costoConIva === 0 ? null : dec(utilidadEstimada).div(costoConIva).toNumber(), componentes,
  };
}
