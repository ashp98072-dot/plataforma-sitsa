/**
 * COTIZACIONES — FASE 1 + FASE 2: modelo de costos parametrizable y motor
 * de costeo interno. Ver docs/COTIZACIONES-COSTEO-MOTOR.md.
 *
 * Es un motor PURO: no consulta base de datos, no lee fechas ni entorno, no
 * depende de React ni de ningún módulo de cotizaciones existente. Recibe
 * todo por `InputCosteoServicio` y devuelve el desglose completo. Cero
 * lógica por tipo de vehículo: un camión, un cabezal o un refrigerado solo
 * difieren en los PARÁMETROS de su `PerfilCosteoUnidad`.
 *
 * Precisión: los componentes se suman sin redondear (el redondeo es solo
 * de presentación y no vive aquí).
 */

/** Versión de las fórmulas; se persiste en cada snapshot (tms_cotizacion_costeos.motor_version). Cambiar una fórmula exige subirla. */
export const COTIZACION_COSTEO_MOTOR_VERSION = "COSTEO_V1";

// ---------------------------------------------------------------------------
// A. PARÁMETROS / INPUTS
// ---------------------------------------------------------------------------

/** Códigos de referencia de perfiles; el motor NO ramifica por ellos, solo por los parámetros del perfil. */
export const CODIGOS_PERFIL_COSTEO = [
  { codigo: "CAMION_2_7T", nombre: "Camión 2.7 toneladas" },
  { codigo: "CAMION_5T", nombre: "Camión 5 toneladas" },
  { codigo: "CAMION_5T_REFRIGERADO", nombre: "Camión 5 toneladas refrigerado" },
  { codigo: "CAMION_10T", nombre: "Camión 10 toneladas" },
  { codigo: "CABEZAL", nombre: "Cabezal" },
] as const;

/** Costo de un equipo que se deprecia linealmente (vehículo o equipo de refrigeración). */
export type DepreciacionCosteo = {
  valorBase: number;
  /** Años de vida contable. */
  anios: number;
  /** Días operativos del mes usados para llevar la depreciación mensual a diaria. */
  diasOperacionMes: number;
};

export type PerfilCosteoUnidad = {
  codigo: string;
  nombre: string;
  /** Informativo (no entra al cálculo): la depreciación se define en `depreciacion`. */
  costoAdquisicion?: number | null;
  /** Divisor mensual → diario de GPS y seguro del vehículo. */
  diasOperacionMes: number;
  gpsMensual: number;
  seguroVehiculoMensual: number;
  costoAceiteServicio: number;
  vidaUtilAceiteKm: number;
  /** Costo TOTAL del juego de llantas (ya integrando la cantidad de llantas). */
  costoJuegoLlantas: number;
  /** Km de vida útil del juego completo. */
  vidaUtilLlantasKm: number;
  rendimientoKmGalon: number;
  depreciacion?: DepreciacionCosteo | null;
  /** Equipo de refrigeración, costeado APARTE de la depreciación del vehículo. */
  costoRefrigeracion?: DepreciacionCosteo | null;
};

export type ParametrosEconomicosCosteo = {
  precioCombustibleGalon: number;
  /** Fracción, p. ej. 0.12. Siempre llega como parámetro. */
  ivaTasa: number;
  costoPilotoDia: number;
  costoAuxiliarDia: number;
  viaticoPilotoDia: number;
  viaticoAuxiliarDia: number;
  viaticoGuiaDia: number;
  hotelDia?: number;
  /** Fracción, p. ej. 0.20. El margen del input, si viene, prevalece. */
  margenObjetivo?: number;
};

export type OtroCostoCosteo = { concepto: string; monto: number };

export type InputCosteoServicio = {
  perfil: PerfilCosteoUnidad;
  parametros: ParametrosEconomicosCosteo;
  distanciaKm: number;
  diasServicio: number;
  cantidadPilotos: number;
  cantidadAuxiliares: number;
  cantidadGuias?: number;
  incluirGps: boolean;
  incluirSeguroVehiculo: boolean;
  /** Monto del servicio (no depende de días ni km). */
  seguroMercaderia?: number;
  usarRefrigeracion?: boolean;
  otrosCostos?: OtroCostoCosteo[];
  precioVenta?: number | null;
  margenObjetivo?: number | null;
  /**
   * Overrides explícitos (monto total del servicio). Prevalecen sobre el
   * cálculo automático; sirven para equivalencia histórica con el libro
   * cuyos viáticos no escalan con días ni con cantidad de personas.
   */
  viaticoPilotoTotal?: number;
  viaticoAuxiliarTotal?: number;
  viaticoGuiaTotal?: number;
  hotelTotal?: number;
};

// ---------------------------------------------------------------------------
// C. RESULTADO DETALLADO
// ---------------------------------------------------------------------------

export type ComponenteCosteo = { clave: string; concepto: string; monto: number };

export type ResultadoCosteoServicio = {
  depreciacion: number;
  refrigeracion: number;
  gps: number;
  seguroVehiculo: number;
  seguroMercaderia: number;
  aceite: number;
  llantas: number;
  combustible: number;
  piloto: number;
  auxiliares: number;
  viaticoPiloto: number;
  viaticoAuxiliar: number;
  viaticoGuia: number;
  hotel: number;
  otrosCostos: number;
  /** Suma de los componentes de arriba; SIN IVA. Costo interno. */
  costoOperativo: number;
  iva: number;
  costoConIva: number;
  /** Margen objetivo aplicado (fracción) — el del input o, si no, el de los parámetros, o 0. */
  margenObjetivoAplicado: number;
  /** costoConIva × margenObjetivo. */
  margenObjetivoMonto: number;
  /** costoConIva × (1 + margenObjetivo). Es una SUGERENCIA interna, no la tarifa comercial. */
  precioSugerido: number;
  precioVenta: number | null;
  /** precioVenta − costoConIva. */
  utilidadEstimada: number | null;
  /** Margen SOBRE COSTO: utilidadEstimada / costoConIva (no es margen sobre venta). null si costoConIva = 0 o no hay precioVenta. */
  margenReal: number | null;
  /** Desglose para reportes/snapshot; la suma de `monto` = costoOperativo. Cada "otro costo" va como su propio renglón. */
  componentes: ComponenteCosteo[];
};

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

export class ErrorCosteo extends Error {
  constructor(public readonly campo: string, mensaje: string) {
    super(mensaje);
    this.name = "ErrorCosteo";
  }
}

function finito(campo: string, v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ErrorCosteo(campo, `${campo} debe ser un número finito.`);
  return v;
}
const noNegativo = (campo: string, v: unknown) => {
  if (finito(campo, v) < 0) throw new ErrorCosteo(campo, `${campo} no puede ser negativo.`);
  return v as number;
};
const positivo = (campo: string, v: unknown) => {
  if (finito(campo, v) <= 0) throw new ErrorCosteo(campo, `${campo} debe ser mayor que cero.`);
  return v as number;
};
const fraccion = (campo: string, v: unknown, max: number) => {
  const n = noNegativo(campo, v);
  if (n > max) throw new ErrorCosteo(campo, `${campo} debe ser una fracción entre 0 y ${max} (p. ej. 0.12 = 12%).`);
  return n;
};
/** IVA es una tasa (0–1). El margen es markup sobre costo: >= 0 sin tope, pero finito. */
const MAX_IVA_TASA = 1;
const MAX_MARGEN = 100;

function validarDepreciacion(campo: string, d: DepreciacionCosteo) {
  noNegativo(`${campo}.valorBase`, d.valorBase);
  positivo(`${campo}.anios`, d.anios);
  positivo(`${campo}.diasOperacionMes`, d.diasOperacionMes);
}

function validarInput(input: InputCosteoServicio) {
  const { perfil: p, parametros: q } = input;
  positivo("perfil.diasOperacionMes", p.diasOperacionMes);
  noNegativo("perfil.gpsMensual", p.gpsMensual);
  noNegativo("perfil.seguroVehiculoMensual", p.seguroVehiculoMensual);
  noNegativo("perfil.costoAceiteServicio", p.costoAceiteServicio);
  positivo("perfil.vidaUtilAceiteKm", p.vidaUtilAceiteKm);
  noNegativo("perfil.costoJuegoLlantas", p.costoJuegoLlantas);
  positivo("perfil.vidaUtilLlantasKm", p.vidaUtilLlantasKm);
  positivo("perfil.rendimientoKmGalon", p.rendimientoKmGalon);
  if (p.depreciacion) validarDepreciacion("perfil.depreciacion", p.depreciacion);
  if (p.costoRefrigeracion) validarDepreciacion("perfil.costoRefrigeracion", p.costoRefrigeracion);

  noNegativo("parametros.precioCombustibleGalon", q.precioCombustibleGalon);
  fraccion("parametros.ivaTasa", q.ivaTasa, MAX_IVA_TASA);
  noNegativo("parametros.costoPilotoDia", q.costoPilotoDia);
  noNegativo("parametros.costoAuxiliarDia", q.costoAuxiliarDia);
  noNegativo("parametros.viaticoPilotoDia", q.viaticoPilotoDia);
  noNegativo("parametros.viaticoAuxiliarDia", q.viaticoAuxiliarDia);
  noNegativo("parametros.viaticoGuiaDia", q.viaticoGuiaDia);
  if (q.hotelDia != null) noNegativo("parametros.hotelDia", q.hotelDia);
  if (q.margenObjetivo != null) fraccion("parametros.margenObjetivo", q.margenObjetivo, MAX_MARGEN);

  noNegativo("distanciaKm", input.distanciaKm);
  positivo("diasServicio", input.diasServicio);
  noNegativo("cantidadPilotos", input.cantidadPilotos);
  noNegativo("cantidadAuxiliares", input.cantidadAuxiliares);
  if (input.cantidadGuias != null) noNegativo("cantidadGuias", input.cantidadGuias);
  if (input.seguroMercaderia != null) noNegativo("seguroMercaderia", input.seguroMercaderia);
  if (input.precioVenta != null) noNegativo("precioVenta", input.precioVenta);
  if (input.margenObjetivo != null) fraccion("margenObjetivo", input.margenObjetivo, MAX_MARGEN);
  for (const [campo, valor] of [
    ["viaticoPilotoTotal", input.viaticoPilotoTotal], ["viaticoAuxiliarTotal", input.viaticoAuxiliarTotal],
    ["viaticoGuiaTotal", input.viaticoGuiaTotal], ["hotelTotal", input.hotelTotal],
  ] as const) if (valor != null) noNegativo(campo, valor);
  (input.otrosCostos ?? []).forEach((o, i) => {
    if (typeof o.concepto !== "string" || !o.concepto.trim()) throw new ErrorCosteo(`otrosCostos[${i}].concepto`, "Cada otro costo necesita un concepto.");
    noNegativo(`otrosCostos[${i}].monto`, o.monto);
  });
  if (input.usarRefrigeracion && !p.costoRefrigeracion) {
    throw new ErrorCosteo("perfil.costoRefrigeracion", "El perfil no tiene costo de refrigeración configurado.");
  }
}

// ---------------------------------------------------------------------------
// B. MOTOR — funciones pequeñas, una fórmula por componente
// ---------------------------------------------------------------------------

/** valorBase / (anios × 12) → mensual; / diasOperacionMes → diaria; × diasServicio. */
export function depreciacionServicio(d: DepreciacionCosteo, diasServicio: number): number {
  const mensual = d.valorBase / (d.anios * 12);
  const diaria = mensual / d.diasOperacionMes;
  return diaria * diasServicio;
}

/** Costo mensual → diario (÷ diasOperacionMes) → × diasServicio. Sirve para GPS y seguro del vehículo. */
export function costoMensualProrrateado(mensual: number, diasOperacionMes: number, diasServicio: number): number {
  return (mensual / diasOperacionMes) * diasServicio;
}

/** (costo / vida útil en km) × distancia. Sirve para aceite y llantas. */
export function costoPorDesgasteKm(costo: number, vidaUtilKm: number, distanciaKm: number): number {
  return (costo / vidaUtilKm) * distanciaKm;
}

/** (distancia / rendimiento km por galón) × precio del galón. */
export function costoCombustible(distanciaKm: number, rendimientoKmGalon: number, precioGalon: number): number {
  return (distanciaKm / rendimientoKmGalon) * precioGalon;
}

/** Costo diario × días × cantidad de personas. */
export function costoPersonal(costoDia: number, diasServicio: number, cantidad: number): number {
  return costoDia * diasServicio * cantidad;
}

export function calcularCosteoServicio(input: InputCosteoServicio): ResultadoCosteoServicio {
  validarInput(input);
  const { perfil, parametros } = input;
  const dias = input.diasServicio;
  const km = input.distanciaKm;
  const guias = input.cantidadGuias ?? 0;

  const depreciacion = perfil.depreciacion ? depreciacionServicio(perfil.depreciacion, dias) : 0;
  const refrigeracion = input.usarRefrigeracion && perfil.costoRefrigeracion ? depreciacionServicio(perfil.costoRefrigeracion, dias) : 0;
  const gps = input.incluirGps ? costoMensualProrrateado(perfil.gpsMensual, perfil.diasOperacionMes, dias) : 0;
  const seguroVehiculo = input.incluirSeguroVehiculo ? costoMensualProrrateado(perfil.seguroVehiculoMensual, perfil.diasOperacionMes, dias) : 0;
  const seguroMercaderia = input.seguroMercaderia ?? 0;
  const aceite = costoPorDesgasteKm(perfil.costoAceiteServicio, perfil.vidaUtilAceiteKm, km);
  const llantas = costoPorDesgasteKm(perfil.costoJuegoLlantas, perfil.vidaUtilLlantasKm, km);
  const combustible = costoCombustible(km, perfil.rendimientoKmGalon, parametros.precioCombustibleGalon);
  const piloto = costoPersonal(parametros.costoPilotoDia, dias, input.cantidadPilotos);
  const auxiliares = costoPersonal(parametros.costoAuxiliarDia, dias, input.cantidadAuxiliares);
  // Viáticos y hotel: override explícito > cálculo automático (día × días × cantidad; hotel por día de servicio).
  const viaticoPiloto = input.viaticoPilotoTotal ?? costoPersonal(parametros.viaticoPilotoDia, dias, input.cantidadPilotos);
  const viaticoAuxiliar = input.viaticoAuxiliarTotal ?? costoPersonal(parametros.viaticoAuxiliarDia, dias, input.cantidadAuxiliares);
  const viaticoGuia = input.viaticoGuiaTotal ?? costoPersonal(parametros.viaticoGuiaDia, dias, guias);
  const hotel = input.hotelTotal ?? (parametros.hotelDia ?? 0) * dias;
  const otros = input.otrosCostos ?? [];
  const otrosCostos = otros.reduce((suma, o) => suma + o.monto, 0);

  const componentes: ComponenteCosteo[] = [
    { clave: "depreciacion", concepto: "Depreciación del vehículo", monto: depreciacion },
    { clave: "refrigeracion", concepto: "Equipo de refrigeración", monto: refrigeracion },
    { clave: "gps", concepto: "GPS", monto: gps },
    { clave: "seguroVehiculo", concepto: "Seguro del vehículo", monto: seguroVehiculo },
    { clave: "seguroMercaderia", concepto: "Seguro de mercadería", monto: seguroMercaderia },
    { clave: "aceite", concepto: "Aceite", monto: aceite },
    { clave: "llantas", concepto: "Llantas", monto: llantas },
    { clave: "combustible", concepto: "Combustible", monto: combustible },
    { clave: "piloto", concepto: "Piloto", monto: piloto },
    { clave: "auxiliares", concepto: "Auxiliares", monto: auxiliares },
    { clave: "viaticoPiloto", concepto: "Viático piloto", monto: viaticoPiloto },
    { clave: "viaticoAuxiliar", concepto: "Viático auxiliar", monto: viaticoAuxiliar },
    { clave: "viaticoGuia", concepto: "Viático guía", monto: viaticoGuia },
    { clave: "hotel", concepto: "Hotel", monto: hotel },
    ...otros.map((o, i) => ({ clave: `otro:${i}`, concepto: o.concepto.trim(), monto: o.monto })),
  ];
  const costoOperativo = componentes.reduce((suma, c) => suma + c.monto, 0);

  const iva = costoOperativo * parametros.ivaTasa;
  const costoConIva = costoOperativo + iva;

  const margenObjetivoAplicado = input.margenObjetivo ?? parametros.margenObjetivo ?? 0;
  const margenObjetivoMonto = costoConIva * margenObjetivoAplicado;
  const precioSugerido = costoConIva * (1 + margenObjetivoAplicado);

  const precioVenta = input.precioVenta ?? null;
  const utilidadEstimada = precioVenta == null ? null : precioVenta - costoConIva;
  const margenReal = utilidadEstimada == null || costoConIva === 0 ? null : utilidadEstimada / costoConIva;

  return {
    depreciacion, refrigeracion, gps, seguroVehiculo, seguroMercaderia, aceite, llantas, combustible,
    piloto, auxiliares, viaticoPiloto, viaticoAuxiliar, viaticoGuia, hotel, otrosCostos,
    costoOperativo, iva, costoConIva, margenObjetivoAplicado, margenObjetivoMonto, precioSugerido,
    precioVenta, utilidadEstimada, margenReal, componentes,
  };
}
