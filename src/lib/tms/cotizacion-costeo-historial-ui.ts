import { esMotorCotizador2026 } from "./cotizacion-costeo";
import type { SnapshotCosteo } from "./cotizacion-costeo-db";
import { monedaCosteo, porcentajeCosteo } from "./cotizacion-costeo-ui";

/**
 * COTIZACIONES — HISTORIAL DE COSTEOS (presentación, solo lectura). Todo sale del snapshot persistido de ESA versión (perfil_snapshot,
 * parametros_snapshot, input_snapshot, resultado_snapshot); nunca de la configuración viva. Los snapshots antiguos (COSTEO_V1 / COSTEO_EXCEL_2026)
 * no tienen todos los campos: lo ausente se muestra como «—», no como 0.
 */

export type FilaConfiguracion = [etiqueta: string, valor: string];
export type SeccionConfiguracion = { titulo: string; filas: FilaConfiguracion[] };

const NA = "—";
const numero = (n: number | null | undefined, decimales = 2) =>
  n == null ? NA : n.toLocaleString("es-GT", { minimumFractionDigits: 0, maximumFractionDigits: decimales });
const dinero = (n: number | null | undefined) => (n == null ? NA : monedaCosteo(n));
const siNo = (v: boolean | null | undefined) => (v == null ? NA : v ? "Sí" : "No");
/** Banderas del perfil «se cobra por cada día de servicio»: null = sin configurar (distinto de «No»); ausente = snapshot anterior a estas banderas. */
const banderaPerfil = (v: boolean | null | undefined) => (v === undefined ? NA : v === null ? "Sin configurar" : v ? "Sí" : "No");

/** «2026-10-05 09:55:00» → «05/10/2026 09:55». Sin conversión de zona horaria (la BD ya guarda la hora local). Otro formato se devuelve tal cual. */
export function formatearFechaHoraCosteo(valor: string | null | undefined): string {
  if (!valor) return NA;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(valor);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : valor;
}

/** Secciones de «Ver configuración»: perfil usado, parámetros económicos usados e input de esa cotización. El resultado se muestra aparte (ResumenCosteo). */
export function seccionesConfiguracionCosteo(v: SnapshotCosteo): SeccionConfiguracion[] {
  const p = v.perfil;
  const par = v.parametros;
  const i = v.input;
  const conDesglose = p.precioLlanta != null && p.cantidadLlantas != null;
  // El motor sale del resultado persistido cuando existe (la columna motor_version es VARCHAR(20) y COSTEO_COTIZADOR_2026 tiene 21 caracteres).
  const motorAnterior = !esMotorCotizador2026(v.resultado?.motorVersion ?? v.motorVersion);

  const perfil: FilaConfiguracion[] = [
    ["Código", v.perfilCodigo],
    ["Nombre", v.perfilNombre],
    ["Rendimiento (km/galón)", numero(p.rendimientoKmGalon, 3)],
    ["GPS mensual", dinero(p.gpsMensual)],
    ["Viajes por mes", numero(p.viajesMes)],
    ["Seguro del vehículo mensual", dinero(p.seguroVehiculoMensual)],
    ["Costo cambio de aceite", dinero(p.costoAceiteServicio)],
    ["Intervalo de aceite (km)", numero(p.vidaUtilAceiteKm)],
    ["Precio por llanta", dinero(p.precioLlanta)],
    ["Cantidad de llantas", numero(p.cantidadLlantas)],
    ...(conDesglose ? [] : [["Costo del juego de llantas", dinero(p.costoJuegoLlantas)] as FilaConfiguracion]),
    ["Vida útil de llantas (km)", numero(p.vidaUtilLlantasKm)],
    ["Valor del vehículo", dinero(p.depreciacion?.valorBase)],
    ["Años de depreciación", numero(p.depreciacion?.anios)],
    ["Salario piloto mensual", dinero(p.salarioPilotoMensual)],
    ["Salario auxiliar mensual", dinero(p.salarioAuxiliarMensual)],
    ["Viáticos y hotel por viaje", dinero(p.viaticosHotelViaje)],
    ["Auxiliar se cobra por cada día de servicio", banderaPerfil(p.auxiliarMultiplicaDias)],
    ["Viáticos y hotel se cobran por cada día de servicio", banderaPerfil(p.viaticosHotelMultiplicaDias)],
    ["Thermo / refrigeración", p.costoRefrigeracion ? `${dinero(p.costoRefrigeracion.valorBase)} · ${numero(p.costoRefrigeracion.anios)} años` : "No aplica"],
  ];

  const parametros: FilaConfiguracion[] = [
    ["Precio de combustible global (Q/galón)", dinero(par.precioCombustibleGalon)],
    ["IVA", porcentajeCosteo(par.ivaTasa)],
    ["Margen objetivo predeterminado", par.margenObjetivo == null ? NA : porcentajeCosteo(par.margenObjetivo)],
    ["Seguro de mercadería anual", dinero(par.seguroMercaderiaAnual)],
    ["Flota (camiones)", numero(par.cantidadCamiones)],
    ["Viajes anuales", numero(par.viajesAnuales)],
    ["Días de depreciación por mes", numero(par.diasDepreciacionMes)],
    ["Días de gastos por mes", numero(par.diasGastosMes)],
    ["Gastos de administración", dinero(par.gastosAdministracion)],
    ["Gastos de mantenimiento", dinero(par.gastosMantenimiento)],
    ["Gastos de seguridad", dinero(par.gastosSeguridad)],
    ["Gastos de predios", dinero(par.gastosPredios)],
    ["Días laborales por mes", numero(par.diasLaboralesMes)],
    // Estos globales solo los consumen los motores anteriores; el Cotizador 2026 los ignora y se omiten para no confundir.
    ...(motorAnterior
      ? ([
          ["Costo piloto por día (motor anterior)", dinero(par.costoPilotoDia)],
          ["Costo auxiliar por día (motor anterior)", dinero(par.costoAuxiliarDia)],
          ["Viático piloto por día (motor anterior)", dinero(par.viaticoPilotoDia)],
          ["Viático auxiliar por día (motor anterior)", dinero(par.viaticoAuxiliarDia)],
          ["Viático guía por día (motor anterior)", dinero(par.viaticoGuiaDia)],
          ["Hotel por persona/día (motor anterior)", dinero(par.hotelDia)],
        ] as FilaConfiguracion[])
      : []),
  ];

  const seguroMercaderia =
    i.incluirSeguroMercaderia === false ? "No incluido"
    : i.seguroMercaderia != null ? `Manual: ${dinero(i.seguroMercaderia)} (total del servicio)`
    : "Prorrateo global";
  const otros = i.otrosCostos ?? [];
  const input: FilaConfiguracion[] = [
    ["Distancia (km)", numero(i.distanciaKm)],
    ["Días de servicio", numero(i.diasServicio)],
    ["Pilotos", numero(i.cantidadPilotos)],
    ["Auxiliares", numero(i.cantidadAuxiliares)],
    ["Incluir GPS", siNo(i.incluirGps)],
    ["Incluir seguro del vehículo", siNo(i.incluirSeguroVehiculo)],
    ["Usar refrigeración", siNo(i.usarRefrigeracion ?? false)],
    ["Seguro de mercadería", seguroMercaderia],
    ["Precio de combustible usado (override)", i.precioCombustibleOverride != null ? dinero(i.precioCombustibleOverride) : "Global vigente"],
    ["Viáticos y hotel (override)", i.viaticosHotelTotal != null ? `${dinero(i.viaticosHotelTotal)} (total del servicio)` : "Valor del perfil"],
    ["Margen objetivo (override)", i.margenObjetivo != null ? porcentajeCosteo(i.margenObjetivo) : "Predeterminado"],
    ["Otros costos", otros.length ? otros.map((o) => `${o.concepto}: ${dinero(o.monto)}`).join(" · ") : "Ninguno"],
  ];

  return [
    { titulo: "Datos del perfil usado", filas: perfil },
    { titulo: "Parámetros económicos usados", filas: parametros },
    { titulo: "Input de esta cotización", filas: input },
  ];
}
