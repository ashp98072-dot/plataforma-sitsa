import { z } from 'zod';

export const MAX_BODY_BYTES = 65536;
export const reference = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const orderSchema = z.object({
  schemaVersion: z.literal('api01-draft-1'),
  externalOrderId: reference,
  originClubReference: reference.max(64),
}).strict();
export const cancellationSchema = z.object({ reason: z.enum(['ORIGIN_REQUEST', 'DUPLICATE']) }).strict();
export type OrderInput = z.infer<typeof orderSchema>;
export type CancellationInput = z.infer<typeof cancellationSchema>;
export type ErrorCode = 'DISABLED' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID_INPUT' | 'TOO_LARGE' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE';
export class OrderError extends Error {
  constructor(public readonly code: ErrorCode) { super(code); }
}
export function parseBody<T>(body: Uint8Array, schema: z.ZodType<T>): T {
  if (body.byteLength > MAX_BODY_BYTES) throw new OrderError('TOO_LARGE');
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
    const result = schema.parse(JSON.parse(text));
    // These provisional DTOs are flat string objects. Reject duplicate wire keys,
    // including escaped spellings, rather than accepting JSON.parse's last value.
    const seen = new Set<string>();
    for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
      if (!text.slice((token.index ?? 0) + token[0].length).trimStart().startsWith(':')) continue;
      const key = JSON.parse(token[0]) as string;
      if (seen.has(key)) throw new Error('duplicate');
      seen.add(key);
    }
    return result;
  } catch { throw new OrderError('INVALID_INPUT'); }
}
export const principalSchema = z.object({
  integrationId: reference, tenantId: z.number().int().positive(), clientId: z.number().int().positive(),
  environment: z.literal('sandbox'), originClubReference: reference.max(64),
  scopes: z.array(z.enum(['orders:create', 'orders:read', 'orders:cancel'])).max(3),
}).strict();
export type Principal = z.infer<typeof principalSchema>;
export type Scope = Pick<Principal, 'integrationId' | 'tenantId' | 'clientId' | 'environment'>;
export function scopeOf(p: Principal): Scope {
  return { integrationId: p.integrationId, tenantId: p.tenantId, clientId: p.clientId, environment: p.environment };
}
export const states = ['RECEIVED', 'REVIEW_REQUIRED', 'CANCELLATION_REQUESTED', 'CANCELLED'] as const;
export type State = typeof states[number];
export type OrderView = {
  externalOrderId: string; provisionalStatus: State; processingStatus: 'PENDING' | 'PAUSED' | 'CANCELLED';
  version: number; correlationId: string;
};
export function canTransition(from: State, to: State): boolean {
  return ({ RECEIVED: ['REVIEW_REQUIRED', 'CANCELLATION_REQUESTED'], REVIEW_REQUIRED: ['CANCELLATION_REQUESTED'], CANCELLATION_REQUESTED: ['CANCELLED'], CANCELLED: [] } as Record<State, State[]>)[from]?.includes(to) ?? false;
}
