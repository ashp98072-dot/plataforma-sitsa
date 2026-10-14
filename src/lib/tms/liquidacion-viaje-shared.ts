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

/** Estados que se muestran como «pendiente de liquidar» (amarillo en la UI de la Fase 2). */
export function esPendienteDeLiquidar(estado: EstadoLiquidacionViaje | null | undefined): boolean {
  return estado === "REPORTE_RECIBIDO" || estado === "EN_AJUSTE";
}
