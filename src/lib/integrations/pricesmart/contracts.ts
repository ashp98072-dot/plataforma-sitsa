import { z } from 'zod';
import { environmentSchema } from './environment';

export const MAX_BODY_BYTES = 65536;
export const reference = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const orderSchema = z.object({
  schemaVersion: z.literal('api01-draft-1'),
  externalOrderId: reference,
  originClubReference: reference.max(64),
}).strict();
export const cancellationSchema = z.object({ reason: z.enum(['ORIGIN_REQUEST', 'DUPLICATE']) }).strict();
export type OrderInput = z.infer<typeof orderSchema>;
/** API-12: extensión OPCIONAL (solo composiciones de laboratorio) para aceptar un contrato de orden distinto del borrador API-01. El valor por defecto no cambia nada. */
export type OrderContractOptions = {
  orderSchema: z.ZodType<{ schemaVersion: string; externalOrderId: string; originClubReference: string }>;
  /** Datos que definen la identidad de contenido de la orden (idempotencia): dos órdenes con el mismo id pero contenido distinto deben dar CONFLICT. */
  canonicalInput: (input: { schemaVersion: string; externalOrderId: string; originClubReference: string }) => unknown;
};
export type CancellationInput = z.infer<typeof cancellationSchema>;
export type ErrorCode = 'DISABLED' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID_INPUT' | 'TOO_LARGE' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE';
export class OrderError extends Error {
  constructor(public readonly code: ErrorCode) { super(code); }
}
/** Claves duplicadas dentro del MISMO objeto JSON (el texto ya es JSON válido). Compara las claves decodificadas, así `"a"` y `"a"` cuentan como la misma. */
export function hasDuplicateKeys(text: string): boolean {
  const stack: Array<Set<string> | null> = []; let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '{') { stack.push(new Set()); i++; } else if (c === '[') { stack.push(null); i++; } else if (c === '}' || c === ']') { stack.pop(); i++; }
    else if (c === '"') {
      let j = i + 1; while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const token = text.slice(i, j + 1); i = j + 1; let k = i; while (k < text.length && /\s/.test(text[k])) k++;
      const top = stack[stack.length - 1];
      if (text[k] === ':' && top) { const key = JSON.parse(token) as string; if (top.has(key)) return true; top.add(key); }
    } else i++;
  }
  return false;
}
export function parseBody<T>(body: Uint8Array, schema: z.ZodType<T>): T {
  if (body.byteLength > MAX_BODY_BYTES) throw new OrderError('TOO_LARGE');
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
    const result = schema.parse(JSON.parse(text));
    // API-27: la detección de claves duplicadas es POR OBJETO (antes era global: un arreglo de objetos con los mismos nombres de campo se rechazaba como «duplicado»). Se siguen rechazando las claves repetidas
    // dentro de un mismo objeto, incluidas las escritas con escapes (se comparan decodificadas) en cualquier nivel.
    if (hasDuplicateKeys(text)) throw new Error('duplicate');
    return result;
  } catch { throw new OrderError('INVALID_INPUT'); }
}
export const principalSchema = z.object({
  integrationId: reference, tenantId: z.number().int().positive(), clientId: z.number().int().positive(),
  environment: environmentSchema, originClubReference: reference.max(64),
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
