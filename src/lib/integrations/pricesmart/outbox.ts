import { z } from 'zod';
import { reference } from './contracts';

// PRICESMART API-07 — despachador de la outbox (ps_api01_outbox). Lógica pura sobre puertos: no abre conexiones, no crea temporizadores periódicos y no
// está conectado a ninguna ruta, proceso ni arranque. `runOnce()` procesa UN lote y devuelve; quien lo invoque (un worker futuro, hoy inexistente) decide cuándo.
//
// Reglas (docs/integraciones/pricesmart/api01/PERSISTENCIA.md §10):
//  - consumidor idempotente con LEASE atómico con vencimiento: un worker caído no retiene eventos, vencida la lease otro los reclama;
//  - FENCING: cada reclamación incrementa `attempts`; solo el titular del intento vigente puede cerrar el evento (DONE/RETRY/REVIEW). Un worker rezagado nunca pisa a otro;
//  - NUNCA se marca DONE salvo que el handler lo confirme explícitamente; ante una salida inválida se pasa a REVIEW (nunca a DONE);
//  - agotar los intentos NO descarta la orden: pasa a REVIEW durable;
//  - backoff exponencial acotado entre intentos.
// Los valores de DEFAULT_OUTBOX_POLICY son PROVISIONALES (afinables); no dependen de D01–D16.

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const outboxScopeSchema = z.object({
  environment: z.literal('sandbox'), tenantId: positive, clientId: positive, integrationId: reference, originClubReference: reference.max(64),
}).strict();
export const outboxEventSchema = z.object({
  scope: outboxScopeSchema, orderId: z.uuid(), version: positive, type: z.enum(['RECEIVED', 'CANCELLATION_REQUESTED']),
  reason: z.enum(['ORIGIN_REQUEST', 'DUPLICATE']).nullable(), correlationId: z.uuid(),
}).strict().refine(v => (v.type === 'RECEIVED') === (v.reason === null));
export type OutboxEvent = z.infer<typeof outboxEventSchema>;
/** Evento reclamado + ficha de fencing (`attempt` = valor de `attempts` tras reclamarlo). */
export type OutboxClaim = { event: OutboxEvent; attempt: number };

export const outboxOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('DONE') }).strict(),
  z.object({ kind: z.literal('RETRY'), reason: z.string().max(200) }).strict(),
  z.object({ kind: z.literal('REVIEW'), reason: z.string().max(200) }).strict(),
]);
export type OutboxOutcome = z.infer<typeof outboxOutcomeSchema>;

export class OutboxStoreError extends Error {
  constructor(public readonly code: 'RETRYABLE' | 'UNAVAILABLE') { super(code); }
}
/** Todas las operaciones son atómicas. Las de cierre devuelven false si el fencing falla (otro worker reclamó el evento o ya no está LEASED). */
export interface OutboxStore {
  claim(limit: number, leaseMs: number): Promise<OutboxClaim[]>;
  complete(claim: OutboxClaim): Promise<boolean>;
  retry(claim: OutboxClaim, delayMs: number): Promise<boolean>;
  review(claim: OutboxClaim): Promise<boolean>;
}
/** Debe ser idempotente: la entrega es al-menos-una-vez (lease vencida, caída antes de cerrar, etc.). Devuelve un OutboxOutcome; cualquier otra cosa se trata como REVIEW. */
export interface OutboxHandler { handle(event: OutboxEvent): Promise<unknown> }

export type OutboxPolicy = { batchSize: number; leaseMs: number; maxAttempts: number; backoffBaseMs: number; backoffMaxMs: number };
export const DEFAULT_OUTBOX_POLICY: OutboxPolicy = Object.freeze({ batchSize: 10, leaseMs: 30_000, maxAttempts: 8, backoffBaseMs: 1_000, backoffMaxMs: 300_000 });
export function validatePolicy(input: OutboxPolicy): OutboxPolicy {
  const int = (v: unknown, min: number, max: number) => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
  if (!input || !int(input.batchSize, 1, 100) || !int(input.leaseMs, 1_000, 3_600_000) || !int(input.maxAttempts, 1, 100) ||
      !int(input.backoffBaseMs, 1, 86_400_000) || !int(input.backoffMaxMs, 1, 86_400_000) || input.backoffBaseMs > input.backoffMaxMs) throw new OutboxStoreError('UNAVAILABLE');
  return { ...input };
}
/** Espera antes del intento siguiente tras el intento `attempt` (≥ 1): base · 2^(attempt−1), acotada. */
export function backoffMs(policy: OutboxPolicy, attempt: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new OutboxStoreError('UNAVAILABLE');
  return Math.min(policy.backoffMaxMs, policy.backoffBaseMs * 2 ** Math.min(attempt - 1, 40));
}

export type OutboxRunSummary = { claimed: number; done: number; retried: number; review: number; lostLease: number; unrecorded: number };
export type OutboxLogEntry = { orderId: string; version: number; attempt: number; outcome: 'DONE' | 'RETRY' | 'REVIEW' | 'LOST_LEASE' | 'UNRECORDED'; code: string };
const safeCode = (reason: string) => (/^[A-Z][A-Z0-9_]{0,39}$/.test(reason) ? reason : 'UNSPECIFIED');   // solo códigos; nunca texto libre (puede contener datos)

export class OutboxDispatcher {
  private readonly policy: OutboxPolicy;
  constructor(private readonly store: OutboxStore, private readonly handler: OutboxHandler, policy: OutboxPolicy = DEFAULT_OUTBOX_POLICY, private readonly log: (entry: OutboxLogEntry) => void = () => {}) {
    this.policy = validatePolicy(policy);
  }
  /** Procesa un lote. Un fallo al RECLAMAR se propaga (nada se perdió: no hay nada reclamado). Un fallo al CERRAR un evento se cuenta como `unrecorded`: la lease vencerá y se reintentará. */
  async runOnce(): Promise<OutboxRunSummary> {
    const claims = await this.store.claim(this.policy.batchSize, this.policy.leaseMs);
    if (!Array.isArray(claims) || claims.length > this.policy.batchSize) throw new OutboxStoreError('UNAVAILABLE');
    const checked = claims.map(c => {
      const event = outboxEventSchema.safeParse(c?.event);
      if (!event.success || !Number.isSafeInteger(c.attempt) || c.attempt < 1) throw new OutboxStoreError('UNAVAILABLE');   // respuesta corrupta del almacén: no se procesa nada
      return { event: event.data, attempt: c.attempt } satisfies OutboxClaim;
    });
    const summary: OutboxRunSummary = { claimed: 0, done: 0, retried: 0, review: 0, lostLease: 0, unrecorded: 0 };
    for (const claim of checked) {
      summary.claimed++;
      let outcome: OutboxOutcome;
      try {
        const parsed = outboxOutcomeSchema.safeParse(await this.withDeadline(this.handler.handle(structuredClone(claim.event))));
        outcome = parsed.success ? parsed.data : { kind: 'REVIEW', reason: 'INVALID_OUTCOME' };
      } catch (error) {
        outcome = { kind: 'RETRY', reason: error instanceof DeadlineError ? 'HANDLER_TIMEOUT' : 'HANDLER_ERROR' };   // el mensaje del error NO se conserva (puede traer datos)
      }
      if (outcome.kind === 'RETRY' && claim.attempt >= this.policy.maxAttempts) outcome = { kind: 'REVIEW', reason: 'MAX_ATTEMPTS' };
      const entry = (o: OutboxLogEntry['outcome'], code: string): OutboxLogEntry => ({ orderId: claim.event.orderId, version: claim.event.version, attempt: claim.attempt, outcome: o, code });
      try {
        const recorded = outcome.kind === 'DONE' ? await this.store.complete(claim)
          : outcome.kind === 'RETRY' ? await this.store.retry(claim, backoffMs(this.policy, claim.attempt))
          : await this.store.review(claim);
        if (!recorded) { summary.lostLease++; this.log(entry('LOST_LEASE', 'FENCING')); continue; }
        if (outcome.kind === 'DONE') { summary.done++; this.log(entry('DONE', 'OK')); }
        else if (outcome.kind === 'RETRY') { summary.retried++; this.log(entry('RETRY', safeCode(outcome.reason))); }
        else { summary.review++; this.log(entry('REVIEW', safeCode(outcome.reason))); }
      } catch { summary.unrecorded++; this.log(entry('UNRECORDED', 'STORE_ERROR')); }
    }
    return summary;
  }
  private withDeadline<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DeadlineError()), this.policy.leaseMs); });
    return Promise.race([promise, deadline]).finally(() => { if (timer) clearTimeout(timer); });
  }
}
class DeadlineError extends Error {}
