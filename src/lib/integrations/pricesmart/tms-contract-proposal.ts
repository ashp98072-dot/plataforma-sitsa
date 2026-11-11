// PRICESMART API-10 — PROPUESTA de D05/D06/D08/D09 derivada de las reglas REALES del TMS (portal de solicitudes de clientes + programación de planes).
// ESTADO: PROPUESTA, NO RATIFICADA. Nada de esto crea solicitudes, viajes, cancelaciones ni publica estados hacia PriceSmart: son funciones puras de decisión/validación.
// Cada valor cita su fuente en el TMS; tms-contract-proposal.test.ts compara estas constantes con el código y el DDL reales para detectar deriva (si el TMS cambia, la prueba falla).

export const CONTRACT_STATUS = 'PROPOSED' as const;

/** Estados reales de tms_solicitudes_cliente (src/lib/tms/solicitudes-cliente.ts → ESTADOS_SOLICITUD_CLIENTE). */
export const SOLICITUD_STATES = ['SOLICITADA', 'EN_REVISION', 'PROGRAMADA', 'RECHAZADA', 'CANCELADA'] as const;
export type SolicitudState = typeof SOLICITUD_STATES[number];
/** Estados reales de tms_planes_viaje.estado (OPS-1 + Cargado; src/lib/tms/cierre-viaje-shared.ts, planes/route.ts). */
export const PLAN_STATES = ['Programado', 'Cargado', 'En ruta', 'Descargado', 'Cerrado', 'Cancelado'] as const;
export type PlanState = typeof PLAN_STATES[number];

/**
 * Límites reales (sql/schema.sql y validaciones del portal): referencia_cliente VARCHAR(120), observaciones VARCHAR(500), lugar_nombre VARCHAR(200),
 * referencia de parada VARCHAR(300), y el PATCH de planes admite como máximo 20 paradas (Carga + Entregas + Descarga ⇒ máximo 18 entregas).
 */
export const TMS_LIMITS = Object.freeze({ customerReferenceMax: 120, notesMax: 500, placeNameMax: 200, stopReferenceMax: 300, stopsMax: 20, deliveriesMin: 1, deliveriesMax: 18 });

/**
 * D05 (propuesta) — modelo de cumplimiento que el TMS SOPORTA hoy: una solicitud ↔ un plan (UNIQUE uq_tmssolicli_plan); Carga primero, ≥1 Entrega, Descarga última;
 * las paradas NO tienen estado propio (sólo `requiereEvidencia`), no hay entregas parciales, reintentos ni viaje compartido. Lo no soportado se retiene para revisión humana.
 */
export const FULFILLMENT_MODEL = Object.freeze({
  requestsPerOrder: 1, plansPerRequest: 1, perStopStatus: false,
  partialDelivery: 'UNSUPPORTED_REVIEW', deliveryRetries: 'UNSUPPORTED_REVIEW', sharedTrip: 'UNSUPPORTED_REVIEW',
} as const);

/** D08 (propuesta) — estados externos que PriceSmart vería. NINGUNO confirma entrega: `Descargado` es «el piloto terminó», no prueba de entrega aceptada. */
export const EXTERNAL_STATUSES = ['RECEIVED', 'IN_REVIEW', 'REJECTED', 'CANCELLED', 'SCHEDULED', 'LOADED', 'IN_TRANSIT', 'UNLOADED_UNCONFIRMED', 'CLOSED_ADMINISTRATIVE', 'REVIEW_REQUIRED'] as const;
export type ExternalStatus = typeof EXTERNAL_STATUSES[number];
const SOLICITUD_ONLY: Partial<Record<SolicitudState, ExternalStatus>> = { SOLICITADA: 'RECEIVED', EN_REVISION: 'IN_REVIEW', RECHAZADA: 'REJECTED', CANCELADA: 'CANCELLED' };
const PLAN_TO_EXTERNAL: Record<PlanState, ExternalStatus> = {
  Programado: 'SCHEDULED', Cargado: 'LOADED', 'En ruta': 'IN_TRANSIT', Descargado: 'UNLOADED_UNCONFIRMED', Cerrado: 'CLOSED_ADMINISTRATIVE', Cancelado: 'CANCELLED',
};
export type StatusProjection = { status: ExternalStatus; confirmsDelivery: false; publishable: false };

/** Proyección PURA solicitud(+plan) → estado externo propuesto. `publishable:false` siempre: la publicación hacia PriceSmart sigue bloqueada. Estados desconocidos o incoherentes ⇒ REVIEW_REQUIRED. */
export function projectExternalStatus(solicitud: string, plan: string | null): StatusProjection {
  const review = { status: 'REVIEW_REQUIRED', confirmsDelivery: false, publishable: false } as const;
  if (!(SOLICITUD_STATES as readonly string[]).includes(solicitud)) return review;
  const s = solicitud as SolicitudState;
  if (s !== 'PROGRAMADA') return plan === null ? { status: SOLICITUD_ONLY[s]!, confirmsDelivery: false, publishable: false } : review;
  if (plan === null || !(PLAN_STATES as readonly string[]).includes(plan)) return review;
  return { status: PLAN_TO_EXTERNAL[plan as PlanState], confirmsDelivery: false, publishable: false };
}

/**
 * D09 (propuesta) — qué puede hacerse con una cancelación pedida por PriceSmart según el estado REAL del TMS. NUNCA es automática (`automatic:false`): el TMS no tiene hoy un
 * escritor de CANCELADA para solicitudes (sólo existe `rechazarSolicitud`, de personal interno, motivo ≥ 5 caracteres) y cancelar un plan es una edición manual de Operaciones
 * (PATCH estado «Cancelado», permiso programacion:editar) que NO actualiza la solicitud, que queda PROGRAMADA.
 */
export type CancellationVerdict =
  | 'STAFF_REJECTION_BEFORE_SCHEDULING' | 'OPERATIONS_MAY_CANCEL_PLAN' | 'BLOCKED_IN_EXECUTION' | 'BLOCKED_COMPLETED' | 'ALREADY_CANCELLED' | 'ALREADY_TERMINAL' | 'REVIEW_REQUIRED';
export type CancellationAssessment = { verdict: CancellationVerdict; automatic: false };
export function assessCancellation(solicitud: string, plan: string | null): CancellationAssessment {
  const out = (verdict: CancellationVerdict): CancellationAssessment => ({ verdict, automatic: false });
  if (!(SOLICITUD_STATES as readonly string[]).includes(solicitud)) return out('REVIEW_REQUIRED');
  const s = solicitud as SolicitudState;
  if (s === 'SOLICITADA' || s === 'EN_REVISION') return plan === null ? out('STAFF_REJECTION_BEFORE_SCHEDULING') : out('REVIEW_REQUIRED');
  if (s === 'RECHAZADA') return plan === null ? out('ALREADY_TERMINAL') : out('REVIEW_REQUIRED');
  if (s === 'CANCELADA') return out('ALREADY_CANCELLED');
  if (plan === null || !(PLAN_STATES as readonly string[]).includes(plan)) return out('REVIEW_REQUIRED');   // PROGRAMADA siempre tiene plan
  switch (plan as PlanState) {
    case 'Programado': case 'Cargado': return out('OPERATIONS_MAY_CANCEL_PLAN');
    case 'En ruta': return out('BLOCKED_IN_EXECUTION');   // «En ruta» sólo admite notas (ESTADOS_SOLO_NOTAS)
    case 'Descargado': case 'Cerrado': return out('BLOCKED_COMPLETED');
    case 'Cancelado': return out('ALREADY_CANCELLED');
  }
}
