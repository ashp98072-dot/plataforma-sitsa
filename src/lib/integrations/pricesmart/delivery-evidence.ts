// PRICESMART API-25 — evaluación INTERNA de la evidencia de entrega, derivada de lo que el TMS REALMENTE registra hoy (TMS-ENTREGA-PILOTO-1: `tms_parada_confirmaciones`).
// Función pura (sin base de datos, sin reloj). NO publica nada hacia PriceSmart y NO confirma entrega externamente: la política de «entrega aceptada» es D13 y sigue PENDIENTE.
//
// Hechos del TMS que se usan (y los que NO se suponen):
//  · Una orden = una solicitud = un plan (D05 interno). Las paradas «Entrega» del plan son las entregas al cliente; «Carga» y «Descarga» (centro de distribución) no lo son.
//  · «Descargado» = el piloto terminó de descargar; «Cerrado» = cierre administrativo. NINGUNO prueba entrega aceptada: no se usan aquí.
//  · La única evidencia de entrega que existe es la confirmación POR PARADA del piloto (ENTREGADA_POR_PILOTO) con una evidencia vinculada (foto de la parada). PARCIAL, RECHAZADA e INCIDENCIA nacen con
//    revisión humana PENDIENTE: mientras haya alguna, el resultado es REVIEW_REQUIRED (nunca «entregada»).
//  · Aun con todas las entregas confirmadas por el piloto, `officialAcceptance` es siempre «NOT_ACCEPTED_BY_PRICESMART» y `confirmsDelivery`/`publishable` son false: lo que ve PriceSmart no cambia hasta que
//    D13 defina la evidencia mínima, el actor autorizado y las entregas parciales.
export type StopFact = { id: number; type: string };
export type ConfirmationFact = { stopId: number; result: string; revision: string; hasEvidence: boolean };

export const DELIVERY_EVIDENCE_LEVELS = ['NONE', 'PARTIAL', 'PILOT_CONFIRMED_ALL', 'REVIEW_REQUIRED'] as const;
export type DeliveryEvidenceLevel = typeof DELIVERY_EVIDENCE_LEVELS[number];
export type DeliveryEvidence = {
  level: DeliveryEvidenceLevel; deliveryStops: number; pilotConfirmed: number; pendingReview: number;
  officialAcceptance: 'NOT_ACCEPTED_BY_PRICESMART'; confirmsDelivery: false; publishable: false; blockedBy: readonly ['D13_PENDING'];
};
/** La tabla de confirmaciones aún no existe en este entorno (migración «PARA REVISIÓN»): se informa «no disponible», nunca «sin entregas». */
export type DeliveryEvidenceUnavailable = { level: 'UNAVAILABLE'; confirmsDelivery: false; publishable: false; blockedBy: readonly ['D13_PENDING'] };

const BLOCKED_BY = ['D13_PENDING'] as const;
const RESULTS = ['ENTREGADA_POR_PILOTO', 'PARCIAL', 'RECHAZADA', 'INCIDENCIA'];
export const deliveryEvidenceUnavailable = (): DeliveryEvidenceUnavailable => ({ level: 'UNAVAILABLE', confirmsDelivery: false, publishable: false, blockedBy: BLOCKED_BY });

export function assessDeliveryEvidence(stops: readonly StopFact[], confirmations: readonly ConfirmationFact[]): DeliveryEvidence {
  const base = { officialAcceptance: 'NOT_ACCEPTED_BY_PRICESMART', confirmsDelivery: false, publishable: false, blockedBy: BLOCKED_BY } as const;
  const deliveries = new Map<number, true>(); for (const s of stops) if (s.type === 'Entrega') deliveries.set(s.id, true);
  const review = (n: number, c: number, p: number): DeliveryEvidence => ({ level: 'REVIEW_REQUIRED', deliveryStops: n, pilotConfirmed: c, pendingReview: p, ...base });
  if (deliveries.size === 0) return review(0, 0, 0);   // un plan sin paradas de entrega es incoherente: revisión, no «sin entregas»
  const confirmed = new Set<number>(); const pending = new Set<number>(); let incoherent = false;
  for (const c of confirmations) {
    if (!RESULTS.includes(c.result) || !['NO_REQUERIDA', 'PENDIENTE'].includes(c.revision)) { incoherent = true; continue; }
    if (!deliveries.has(c.stopId)) { incoherent = true; continue; }   // confirmación de una parada que no es una entrega de este plan
    if (c.revision === 'PENDIENTE') pending.add(c.stopId);
    else if (c.result === 'ENTREGADA_POR_PILOTO') { if (c.hasEvidence) confirmed.add(c.stopId); else incoherent = true; }   // sin evidencia no hay confirmación válida
    else incoherent = true;   // PARCIAL/RECHAZADA/INCIDENCIA sin revisión pendiente contradice el diseño
  }
  if (incoherent || pending.size > 0) return review(deliveries.size, confirmed.size, pending.size);
  const level: DeliveryEvidenceLevel = confirmed.size === deliveries.size ? 'PILOT_CONFIRMED_ALL' : confirmed.size > 0 ? 'PARTIAL' : 'NONE';
  return { level, deliveryStops: deliveries.size, pilotConfirmed: confirmed.size, pendingReview: 0, ...base };
}
