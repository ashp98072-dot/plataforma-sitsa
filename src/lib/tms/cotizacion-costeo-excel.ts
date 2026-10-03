import Decimal from "decimal.js";
import { ErrorCosteo, type InputCosteoServicio, type ResultadoCosteoServicio } from "./cotizacion-costeo";
import { CAMPOS_EXCEL_PARAMETROS, CAMPOS_EXCEL_PERFIL } from "./cotizacion-costeo-excel-campos";

// Aritmética decimal local: no modifica la configuración global de Decimal.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const dec = (v: number) => new D(String(v));
const q = (v: Decimal) => v.toDecimalPlaces(2).toNumber();
/** mysql2 recibe texto decimal, nunca representación binaria para los nuevos importes. */
export const decimalCosteoSql = (v: number | null, escala = 6): string | null =>
  v == null ? null : dec(v).toFixed(escala);
function positivo(campo: string, v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v) || v <= 0) throw new ErrorCosteo(campo, `Configure ${campo} con un valor mayor a cero.`);
  return v;
}
function monto(campo: string, v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v) || v < 0) throw new ErrorCosteo(campo, `${campo} debe ser un monto no negativo.`);
  return v;
}
export function calcularCosteoExcel(i: InputCosteoServicio): ResultadoCosteoServicio {
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
  const refrigeracion = i.usarRefrigeracion && p.costoRefrigeracion ? depreciar(p.costoRefrigeracion) : 0;
  const gps = i.incluirGps ? q(dec(p.gpsMensual).div(positivo("viajes mensuales GPS", p.viajesMes))) : 0;
  const seguroVehiculo = i.incluirSeguroVehiculo ? q(dec(p.seguroVehiculoMensual).div(30).mul(dias)) : 0;
  const seguroMercaderia = i.seguroMercaderia != null ? q(dec(monto("seguro mercadería total", i.seguroMercaderia)))
    : i.incluirSeguroMercaderia === false || e.seguroMercaderiaAnual == null || e.seguroMercaderiaAnual === 0 ? 0
    : q(dec(e.seguroMercaderiaAnual).div(positivo("cantidad camiones", e.cantidadCamiones)).div(positivo("viajes anuales", e.viajesAnuales)));
  const gastos = [e.gastosAdministracion, e.gastosMantenimiento, e.gastosSeguridad, e.gastosPredios];
  if (gastos.every(v => v == null)) advertencias.push("Gastos generales no configurados: no se incluyeron. Complete los cuatro conceptos en Ajustes antes de usar este costeo; NULL no significa costo cero confirmado.");
  if (gastos.some(v => v != null) && gastos.some(v => v == null)) throw new ErrorCosteo("gastos generales", "Complete los cuatro conceptos de gastos globales (0 cuando no aplica).");
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
  const auxiliares = q(diarioAuxiliar.mul(dias).mul(i.cantidadAuxiliares));
  const viatico = (override: number | undefined, diario: number, cantidad: number) => override == null ? q(dec(diario).mul(dias).mul(cantidad)) : q(dec(override));
  const viaticoPiloto = viatico(i.viaticoPilotoTotal, e.viaticoPilotoDia, i.cantidadPilotos);
  const viaticoAuxiliar = viatico(i.viaticoAuxiliarTotal, e.viaticoAuxiliarDia, i.cantidadAuxiliares);
  const viaticoGuia = viatico(i.viaticoGuiaTotal, e.viaticoGuiaDia, i.cantidadGuias ?? 0);
  const hotel = q(i.hotelTotal == null
    ? dec(e.hotelDia ?? 0).mul(dias).mul(dec(i.cantidadPilotos).plus(i.cantidadAuxiliares).plus(i.cantidadGuias ?? 0))
    : dec(i.hotelTotal));
  const otros = (i.otrosCostos ?? []).map((c, n) => ({ clave: `otro:${n}`, concepto: c.concepto.trim(), monto: q(dec(c.monto)) }));
  const componentes = [
    { clave: "gastosGenerales", concepto: "Gastos generales", monto: gastosGenerales },
    { clave: "seguroMercaderia", concepto: "Seguro de mercadería", monto: seguroMercaderia },
    { clave: "depreciacion", concepto: "Depreciación del vehículo", monto: depreciacion },
    { clave: "gps", concepto: "GPS por viaje", monto: gps },
    { clave: "seguroVehiculo", concepto: "Seguro del vehículo", monto: seguroVehiculo },
    { clave: "aceite", concepto: "Aceite", monto: aceite },
    { clave: "llantas", concepto: "Llantas", monto: llantas },
    { clave: "combustible", concepto: "Combustible", monto: combustible },
    { clave: "piloto", concepto: "Piloto", monto: piloto },
    { clave: "auxiliares", concepto: "Auxiliares", monto: auxiliares },
    { clave: "viaticoPiloto", concepto: "Viático piloto", monto: viaticoPiloto },
    { clave: "viaticoAuxiliar", concepto: "Viático auxiliar", monto: viaticoAuxiliar },
    { clave: "viaticoGuia", concepto: "Viático guía", monto: viaticoGuia },
    { clave: "hotel", concepto: "Hotel", monto: hotel },
    { clave: "refrigeracion", concepto: "Equipo de refrigeración / Thermo", monto: refrigeracion },
    ...(otros.length ? otros : [{clave:"otrosCostos",concepto:"Otros costos",monto:0}]),
  ];
  const base = componentes.reduce((s, c) => s.plus(c.monto), dec(0));
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
    },
    motorVersion: "COSTEO_EXCEL_2026", depreciacion, refrigeracion, gps, seguroVehiculo, seguroMercaderia,
    gastosGenerales, aceite, llantas, combustible, piloto, auxiliares, viaticoPiloto, viaticoAuxiliar,
    viaticoGuia, hotel, otrosCostos: q(otros.reduce((s,c) => s.plus(c.monto), dec(0))),
    costoOperativo: q(base), iva, costoConIva, margenObjetivoAplicado: margenObjetivo,
    margenObjetivoMonto: margenValor,
    subtotalComercial: q(subtotal), precioSugerido: q(total),
    precioPorKm: km.isZero() ? null : q(total.div(km)), precioVenta, utilidadEstimada,
    margenReal: utilidadEstimada == null || costoConIva === 0 ? null : dec(utilidadEstimada).div(costoConIva).toNumber(), componentes,
  };
}
