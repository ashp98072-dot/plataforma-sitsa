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

/** Estados del plan que NO admiten transiciones de liquidación (el cierre es final; lo cancelado no se liquida). */
export const ESTADOS_PLAN_SIN_LIQUIDACION = ["Cerrado", "Cancelado"] as const;

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
