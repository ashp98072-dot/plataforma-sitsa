import { z } from 'zod';
import { reference } from './contracts';
import { TMS_LIMITS } from './tms-contract-proposal';

// PRICESMART API-10 — D06 (propuesta): DTO de pedido enriquecido y su traducción al formato EXACTO que acepta hoy el alta de solicitudes del TMS (crearSolicitudCliente).
// PROPUESTA, NO RATIFICADA. Este módulo NO escribe nada: valida y produce un borrador. El DTO vigente de la API sigue siendo `api01-draft-1`; este esquema (`api10-proposal-1`)
// no está conectado a ningún endpoint ni a la recepción.
// Las reglas estructurales (Carga primera, ≥1 Entrega, Descarga última, fecha calendario válida y no pasada, hora HH:MM[:SS], límites de longitud) replican las del TMS y se
// verifican DIFERENCIALMENTE contra el código real en tms-solicitud-draft.test.ts (validarParadasSolicitud, normalizarHora).

const stop = z.object({
  placeName: z.string().trim().min(1).max(TMS_LIMITS.placeNameMax),
  reference: z.string().trim().max(TMS_LIMITS.stopReferenceMax).optional(),
}).strict();
export const orderDraftProposalSchema = z.object({
  schemaVersion: z.literal('api10-proposal-1'),
  externalOrderId: reference,
  originClubReference: reference.max(64),
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedTime: z.string().trim().max(8).optional(),
  pickup: stop,
  deliveries: z.array(stop).min(TMS_LIMITS.deliveriesMin).max(TMS_LIMITS.deliveriesMax),
  dropoff: stop,
  notes: z.string().trim().max(TMS_LIMITS.notesMax).optional(),
}).strict();
export type OrderDraftProposal = z.infer<typeof orderDraftProposalSchema>;

export type SolicitudStopDraft = { orden: number; tipo: 'Carga' | 'Entrega' | 'Descarga'; lugarNombre: string; referencia: string | null };
/** Forma de entrada de crearSolicitudCliente (src/lib/tms/solicitudes-cliente.ts) + las paradas ya ordenadas. SIN clienteUbicacionId: ese id interno del TMS no lo conoce PriceSmart (D04/D06). */
export type SolicitudDraft = {
  fechaSolicitada: string; horaSolicitada: string | null; referenciaCliente: string; observaciones: string | null;
  origen: { lugarNombre: string; referencia: string | null }; entregas: { lugarNombre: string; referencia: string | null }[]; destino: { lugarNombre: string; referencia: string | null };
  paradas: SolicitudStopDraft[];
};
export type DraftIssue = 'SCHEMA_INVALID' | 'DATE_INVALID' | 'DATE_IN_PAST' | 'TIME_INVALID' | 'STRUCTURE_INVALID';
export type DraftResult = { ok: true; draft: SolicitudDraft; materializable: false } | { ok: false; issues: DraftIssue[] };

/** Fecha calendario REAL (no solo el formato): 2026-02-31 y 2026-13-01 se rechazan, 2028-02-29 se acepta. */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, mo - 1, d)); return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}
/** Misma normalización que normalizarHora del TMS: H:MM[:SS] con rangos válidos → HH:MM:SS. */
export function normalizeTime(value: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim()); if (!m) return null;
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? '0')];
  if (h > 23 || mi > 59 || s > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
/** Reglas estructurales de paradas del TMS (validarParadasSolicitud), sobre la secuencia ya armada. */
export function stopsStructureValid(stops: { tipo: string }[]): boolean {
  if (!stops.length || stops.length > TMS_LIMITS.stopsMax) return false;
  const count = (t: string) => stops.filter(s => s.tipo === t).length;
  return count('Carga') === 1 && count('Entrega') >= 1 && count('Descarga') === 1 && stops[0].tipo === 'Carga' && stops[stops.length - 1].tipo === 'Descarga' && stops.every(s => ['Carga', 'Entrega', 'Descarga'].includes(s.tipo));
}

/** Valida y traduce. `today` (AAAA-MM-DD) lo inyecta quien llama: la regla del TMS (fecha ≥ hoy local) no puede depender de un reloj oculto. NUNCA devuelve `materializable:true`. */
export function toSolicitudDraft(input: unknown, today: string): DraftResult {
  const parsed = orderDraftProposalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: ['SCHEMA_INVALID'] };
  const d = parsed.data; const issues: DraftIssue[] = [];
  if (!isCalendarDate(d.requestedDate)) issues.push('DATE_INVALID'); else if (isCalendarDate(today) && d.requestedDate < today) issues.push('DATE_IN_PAST');
  let time: string | null = null;
  if (d.requestedTime !== undefined && d.requestedTime !== '') { time = normalizeTime(d.requestedTime); if (time === null) issues.push('TIME_INVALID'); }
  const clean = (s: { placeName: string; reference?: string }) => ({ lugarNombre: s.placeName, referencia: s.reference ? s.reference : null });
  const paradas: SolicitudStopDraft[] = [
    { orden: 1, tipo: 'Carga', ...clean(d.pickup) },
    ...d.deliveries.map((s, i) => ({ orden: i + 2, tipo: 'Entrega' as const, ...clean(s) })),
    { orden: d.deliveries.length + 2, tipo: 'Descarga', ...clean(d.dropoff) },
  ];
  if (!stopsStructureValid(paradas)) issues.push('STRUCTURE_INVALID');
  if (issues.length) return { ok: false, issues };
  return { ok: true, materializable: false, draft: {
    fechaSolicitada: d.requestedDate, horaSolicitada: time, referenciaCliente: d.externalOrderId, observaciones: d.notes ? d.notes : null,
    origen: clean(d.pickup), entregas: d.deliveries.map(clean), destino: clean(d.dropoff), paradas } };
}
