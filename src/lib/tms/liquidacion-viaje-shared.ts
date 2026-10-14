/**
 * TMS — LIQUIDACIÓN DE VIAJES, FASE 1 (parte PURA, sin BD; importable desde UI/servidor).
 *
 * La liquidación es una dimensión SEPARADA del estado operativo del viaje (`tms_planes_viaje.estado`): este módulo no lo
 * modifica ni lo reinterpreta. La AUSENCIA de fila en `tms_viaje_liquidaciones` significa «sin liquidación registrada»
 * (incluye todo el histórico): nunca se infiere «liquidado».
 *
 * FASE 1 NO cambia el cierre: nada aquí lo importa `cierre-viaje*`. La Fase 5 consultará `liquidacionExigidaParaPlan`.
 */

export const ESTADOS_LIQUIDACION_VIAJE = ["REPORTE_RECIBIDO", "LIQUIDADO", "EN_AJUSTE"] as const;
export type EstadoLiquidacionViaje = (typeof ESTADOS_LIQUIDACION_VIAJE)[number];

export const TIPOS_EVENTO_LIQUIDACION = ["REPORTE_RECIBIDO", "LIQUIDADO", "REABIERTO", "RELIQUIDADO"] as const;
export type TipoEventoLiquidacion = (typeof TIPOS_EVENTO_LIQUIDACION)[number];

/**
 * Estados del plan que NO admiten CONFIRMAR el reporte (el reporte se recibe antes del cierre; lo cancelado no se liquida).
 * Ojo: esto NO decide cuándo se puede LIQUIDAR (ver ESTADO_PLAN_LIQUIDABLE) ni REABRIR (ver ESTADOS_PLAN_SIN_REAPERTURA).
 */
export const ESTADOS_PLAN_SIN_LIQUIDACION = ["Cerrado", "Cancelado"] as const;

/**
 * Secuencia real de Operaciones: viaje realizado → reporte recibido → ajustes/cargos → CERRAR → LIQUIDAR → facturación/reportes.
 * Solo un viaje CERRADO puede pasar a LIQUIDADO / RELIQUIDADO (la validación definitiva es del servidor).
 */
export const ESTADO_PLAN_LIQUIDABLE = "Cerrado" as const;

/** Estados desde los que NO se puede reabrir una liquidación. Un viaje Cerrado SÍ (la liquidación ocurre ya cerrado). */
export const ESTADOS_PLAN_SIN_REAPERTURA = ["Cancelado"] as const;

/** null si el viaje puede liquidarse según su estado operativo; si no, el motivo legible. */
export function motivoPlanNoLiquidable(estadoPlan: string): string | null {
  if (estadoPlan === ESTADO_PLAN_LIQUIDABLE) return null;
  if (estadoPlan === "Cancelado") return "Un viaje cancelado no se liquida.";
  return `El viaje debe estar Cerrado antes de liquidarse (estado actual: ${estadoPlan}).`;
}

export function puedeLiquidarSegunPlan(estadoPlan: string): boolean {
  return motivoPlanNoLiquidable(estadoPlan) === null;
}

export const MOTIVO_REAPERTURA_MIN = 5;
export const MOTIVO_REAPERTURA_MAX = 500;
export const OBSERVACION_REPORTE_MAX = 500;

const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` válida (calendario real) o null. */
export function normalizarFechaIso(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const m = FECHA_RE.exec(valor.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Regla de activación: la liquidación se exige solo si la empresa tiene fecha de activación Y `fecha_plan >= activación`.
 * Sin fecha de activación (o fechas inválidas) devuelve FALSE: el comportamiento actual no cambia. Es la única función que
 * la Fase 5 debe consultar para decidir si el cierre exige liquidación.
 */
export function liquidacionExigidaParaPlan(fechaActivacion: string | null | undefined, fechaPlan: string | null | undefined): boolean {
  const activacion = normalizarFechaIso(fechaActivacion);
  const plan = normalizarFechaIso(fechaPlan);
  if (!activacion || !plan) return false;
  return plan >= activacion;
}

/** Etiqueta visible por estado (para la UI de fases posteriores). */
export const ETIQUETA_ESTADO_LIQUIDACION: Record<EstadoLiquidacionViaje, string> = {
  REPORTE_RECIBIDO: "Reporte recibido",
  LIQUIDADO: "Liquidado",
  EN_AJUSTE: "En ajuste",
};

/** Estados pendientes de liquidar; no determina por sí solo el color visual de la fila. */
export function esPendienteDeLiquidar(estado: EstadoLiquidacionViaje | null | undefined): boolean {
  return estado === "REPORTE_RECIBIDO" || estado === "EN_AJUSTE";
}

// ───────────────────────────── FASE 2: reporte recibido + presentación en Planes/Viajes ─────────────────────────────

/** Advertencias NO bloqueantes al confirmar el reporte (decisión D02: advertir, no bloquear; el usuario las reconoce). */
export const ADVERTENCIAS_REPORTE = {
  SIN_SALIDA_REGISTRADA: "Este viaje no tiene salida registrada por el piloto. Puede confirmar el reporte de todas formas.",
  SIN_LLEGADA_REGISTRADA: "Este viaje no tiene llegada registrada por el piloto. Puede confirmar el reporte de todas formas.",
} as const;
export type CodigoAdvertenciaReporte = keyof typeof ADVERTENCIAS_REPORTE;
export type AdvertenciaReporte = { codigo: CodigoAdvertenciaReporte; mensaje: string };

/** Resumen de la liquidación VIGENTE que viaja en cada fila de Planes/Viajes (null = sin liquidación registrada). */
export type ResumenLiquidacionFila = { estado: EstadoLiquidacionViaje; version: number };

/**
 * ¿El viaje todavía debe liquidarse? Todo viaje ACTIVO (ni Cerrado ni Cancelado) cuya liquidación no está LIQUIDADO:
 * sin liquidación registrada, REPORTE_RECIBIDO o EN_AJUSTE. Un viaje Cerrado/Cancelado SIN liquidación es histórico o no
 * aplica: no se pinta «pendiente» (nunca se infiere «liquidado» ni «pendiente» del pasado).
 */
export function estaPendienteDeLiquidacion(
  l: ResumenLiquidacionFila | null | undefined,
  estadoPlan: string,
): boolean {
  if (l) return esPendienteDeLiquidar(l.estado);
  return !(ESTADOS_PLAN_SIN_LIQUIDACION as readonly string[]).includes(estadoPlan);
}

/** Amarillo = sin reporte confirmado o en ajuste; reporte recibido/liquidado = superficie normal. */
export function claseFilaLiquidacion(
  l: ResumenLiquidacionFila | null | undefined,
  estadoPlan: string,
): "pendiente" | "normal" {
  if (l?.estado === "REPORTE_RECIBIDO") return "normal";
  return estaPendienteDeLiquidacion(l, estadoPlan) ? "pendiente" : "normal";
}

export type BadgeLiquidacion = { texto: string; clase: string; titulo: string } | null;

/**
 * Badge de TEXTO de la columna «Liquidación» (el color nunca es el único portador de significado). Clases con texto blanco y
 * contraste ≥ 4.5:1. null = «—» (viaje Cerrado/Cancelado sin liquidación registrada: histórico/no aplica).
 */
export function badgeLiquidacion(
  l: ResumenLiquidacionFila | null | undefined,
  estadoPlan: string,
): BadgeLiquidacion {
  if (!l) {
    if (!estaPendienteDeLiquidacion(null, estadoPlan)) return null;
    return { texto: "Pendiente", clase: "bg-slate-600", titulo: "Viaje pendiente de liquidación (sin reporte recibido)." };
  }
  if (l.estado === "REPORTE_RECIBIDO") return { texto: "Reporte recibido", clase: "bg-amber-700", titulo: "Reporte del piloto recibido; pendiente de liquidar." };
  if (l.estado === "EN_AJUSTE") return { texto: "En ajuste", clase: "bg-orange-700", titulo: "Liquidación reabierta para ajustes; pendiente de liquidar de nuevo." };
  return { texto: "Liquidado", clase: "bg-emerald-700", titulo: "Viaje liquidado." };
}

/**
 * ¿Se ofrece «Confirmar reporte» en la fila? Solo en la vista operativa, con permiso, sin liquidación registrada y mientras
 * el viaje no esté Cerrado/Cancelado. NO depende de la llegada (solo advierte, ver ADVERTENCIAS_REPORTE) ni toca el cierre.
 */
export function puedeOfrecerConfirmarReporte(entrada: {
  estadoPlan: string;
  liquidacion: ResumenLiquidacionFila | null | undefined;
  tienePermiso: boolean;
  soloConsulta: boolean;
}): boolean {
  if (entrada.soloConsulta || !entrada.tienePermiso) return false;
  if ((ESTADOS_PLAN_SIN_LIQUIDACION as readonly string[]).includes(entrada.estadoPlan)) return false;
  return entrada.liquidacion == null;
}

// ───────────────────────────── FASE 3: liquidar / reabrir ─────────────────────────────

export const OBSERVACION_LIQUIDACION_MAX = 500;

/**
 * Fotografía OPERATIVA inmutable que se guarda en `snapshot_json` del evento LIQUIDADO/RELIQUIDADO: cómo estaba operado el
 * viaje en ese momento (evidencia histórica; NO es una fuente mutable ni reemplaza a Programación). Solo datos que existen
 * físicamente hoy; lo que no existe se lista en `noDisponible`. Sin datos sensibles innecesarios (no incluye teléfonos ni
 * documentos de identidad de la cuadrilla), sin costos; incluye los cargos adicionales VIGENTES (Fase 4, opcional).
 */
export type SnapshotOperativoViaje = {
  version: 1;
  plan: { id: number; codigo: string; fechaPlan: string | null; estado: string; tipoViaje: string; referenciaCliente: string | null };
  cliente: { id: number | null; nombre: string | null };
  ruta: { codigo: string | null; origen: string | null; destino: string | null };
  tarifa: { comercial: string | null; tarifaId: number | null; nombre: string | null; montoCatalogo: string | null; moneda: string | null };
  unidad: { id: number | null; placa: string | null };
  tc: { placa: string | null; origen: "INTERNO" | "EXTERNO" | null };
  piloto: { personalId: number | null; nombre: string | null };
  pilotosExtra: { personalId: number; nombre: string }[];
  auxiliares: { personalId: number; nombre: string }[];
  /** Cuadrilla REGISTRADA en el viaje al liquidar (programada/ajustada en Programación); NO es una «cuadrilla real» separada. */
  cuadrilla: { tipo: "INTERNO" | "EXTERNO"; empleadoId: number | null; nombre: string }[];
  tercerizado: {
    pilotoExterno: string | null;
    auxiliaresExternos: string | null;
    unidadExternaPlaca: string | null;
    unidadExternaDescripcion: string | null;
    transportistaExterno: string | null;
  } | null;
  /** Último registro físico del piloto en Flota (km/horas); null si el piloto no registró nada. */
  viajeFisico: {
    estado: string | null;
    kmSalida: number | null;
    kmLlegada: number | null;
    kmRecorridos: number | null;
    horaSalida: string | null;
    horaLlegada: string | null;
  } | null;
  /**
   * Cargos adicionales VIGENTES (activos) al liquidar (Fase 4). Campo OPCIONAL y aditivo: los snapshots anteriores no lo traen
   * (`undefined`); `null` = la tabla de cargos aún no está instalada. Solo conceptos y montos del cliente — nunca costos
   * internos — y SIN tratamiento de IVA (pendiente de definición de negocio/fiscal).
   */
  cargos?: {
    vigentes: { cargoId: number; concepto: string; monto: string; observacion: string | null }[];
    total: string;
    ivaPendiente: true;
  } | null;
  /** Conceptos que NO existen físicamente en el modelo actual (no se inventan). */
  noDisponible: string[];
};

export const CONCEPTOS_NO_DISPONIBLES_SNAPSHOT = [
  "costos reales (combustible, viáticos, gastos): módulos aparte, fuera de la Fase 3",
  "tratamiento de IVA de los cargos adicionales: pendiente de definición de negocio/fiscal",
  "incidencias estructuradas",
  "cuadrilla real distinta de la registrada en el viaje",
  "kilometraje confirmado por Operaciones (solo el registrado por el piloto en Flota)",
] as const;

export type SnapshotEventoLiquidacion = {
  planEstado: string;
  fechaPlan: string | null;
  tarifaComercial: string | null;
  /** Solo en LIQUIDADO/RELIQUIDADO. */
  operativo?: SnapshotOperativoViaje;
  liquidacion?: {
    version: number;
    transicion: "LIQUIDADO" | "RELIQUIDADO";
    estadoAntes: EstadoLiquidacionViaje;
    liquidadoPor: number;
    liquidadoPorUsuario: string;
    reporteRecibidoEn: string;
    reporteRecibidoPor: number;
    /** Reapertura que originó esta re-liquidación (solo RELIQUIDADO): su motivo se preserva aquí y en el evento REABIERTO. */
    reaperturaPrevia: { version: number; actorId: number; motivo: string | null; creadoEn: string } | null;
  };
};

export type AccionesLiquidacionFila = {
  /** Confirmar reporte (Fase 2): sin liquidación registrada y viaje aún no cerrado/cancelado. */
  confirmarReporte: boolean;
  /** «Liquidar viaje» (REPORTE_RECIBIDO) o «Liquidar nuevamente» (EN_AJUSTE): SOLO con el viaje Cerrado. */
  liquidar: boolean;
  etiquetaLiquidar: "Liquidar viaje" | "Liquidar nuevamente" | null;
  /** «Reabrir liquidación» (LIQUIDADO). La liquidación ocurre con el viaje ya Cerrado, que permanece Cerrado. */
  reabrir: boolean;
  /** Hay liquidación pendiente pero el viaje sigue abierto: se informa «cerrar primero»; no se ofrece liquidar. */
  requiereCierre: boolean;
};

/**
 * Acciones de liquidación de una fila de la vista operativa. Cada acción exige SU permiso, separado del cierre.
 *  - Sin liquidación: solo confirmar reporte (con el viaje abierto); nunca liquidar.
 *  - REPORTE_RECIBIDO / EN_AJUSTE: liquidar / liquidar nuevamente SOLO si el viaje está Cerrado; abierto ⇒ `requiereCierre`.
 *  - LIQUIDADO: reabrir (el viaje sigue Cerrado). Cancelado y la vista de consulta: ninguna.
 */
export function accionesLiquidacionFila(entrada: {
  estadoPlan: string;
  liquidacion: ResumenLiquidacionFila | null | undefined;
  puedeConfirmarReporte: boolean;
  puedeLiquidar: boolean;
  puedeReabrir: boolean;
  soloConsulta: boolean;
}): AccionesLiquidacionFila {
  const ninguna: AccionesLiquidacionFila = { confirmarReporte: false, liquidar: false, etiquetaLiquidar: null, reabrir: false, requiereCierre: false };
  if (entrada.soloConsulta) return ninguna;
  if ((ESTADOS_PLAN_SIN_REAPERTURA as readonly string[]).includes(entrada.estadoPlan)) return ninguna; // Cancelado
  const cerrado = puedeLiquidarSegunPlan(entrada.estadoPlan);
  const l = entrada.liquidacion;
  if (!l) {
    // Sin reporte: solo se confirma con el viaje abierto (un Cerrado sin reporte no se liquida: decisión de negocio abierta).
    return cerrado ? ninguna : { ...ninguna, confirmarReporte: entrada.puedeConfirmarReporte };
  }
  if (l.estado === "LIQUIDADO") return { ...ninguna, reabrir: entrada.puedeReabrir };
  const etiqueta = l.estado === "EN_AJUSTE" ? "Liquidar nuevamente" : "Liquidar viaje";
  if (!cerrado) return { ...ninguna, requiereCierre: true };
  return { ...ninguna, liquidar: entrada.puedeLiquidar, etiquetaLiquidar: entrada.puedeLiquidar ? etiqueta : null };
}
