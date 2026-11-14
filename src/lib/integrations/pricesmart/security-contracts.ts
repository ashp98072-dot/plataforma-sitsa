import { z } from 'zod';
import { MAX_BODY_BYTES, reference } from './contracts';
import { environmentSchema, type Environment } from './environment';

export const operationSchema = z.enum(['orders:create', 'orders:read', 'orders:cancel']);
export type Operation = z.infer<typeof operationSchema>;
const milliseconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const opaqueReference = z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/);
const uniqueScopes = z.array(operationSchema).min(1).max(3).refine(v => new Set(v).size === v.length);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const targetSchema = z.object({
  environment: environmentSchema, tenantId: positive, clientId: positive, integrationId: reference,
  originClubReference: reference.max(64), externalOrderId: reference.optional(),
}).strict();
export type ResourceTarget = z.infer<typeof targetSchema>;

// Schema validates data returned by a trusted cryptographic verifier, NEVER a token.
export const assertionSchema = z.object({
  environment: environmentSchema,
  issuer: opaqueReference, subject: opaqueReference, credentialReference: opaqueReference,
  validFromMs: milliseconds, validUntilMs: milliseconds, scopes: uniqueScopes,
  requestProof: z.object({ id: reference, issuedAtMs: milliseconds, expiresAtMs: milliseconds, bindingDigest: digest }).strict().nullable(),
}).strict().refine(v => v.validUntilMs > v.validFromMs);
export type VerifiedAssertion = z.infer<typeof assertionSchema>;
export type CredentialBinding = Pick<VerifiedAssertion, 'issuer' | 'subject' | 'credentialReference'>;
export const integrationSchema = z.object({
  integrationId: reference, tenantId: positive, clientId: positive, environment: environmentSchema,
  issuer: opaqueReference, subject: opaqueReference, credentialReference: opaqueReference,
  revision: positive, status: z.enum(['ACTIVE', 'REVOKED']), validFromMs: milliseconds, validUntilMs: milliseconds,
  credentialValidFromMs: milliseconds, credentialValidUntilMs: milliseconds, rotatedAtMs: milliseconds,
  allowedClubs: z.array(reference.max(64)).min(1).max(1000).refine(v => new Set(v).size === v.length), scopes: uniqueScopes,
}).strict().refine(v => v.validUntilMs > v.validFromMs && v.credentialValidUntilMs > v.credentialValidFromMs && v.rotatedAtMs <= v.credentialValidFromMs);
export type IntegrationRecord = z.infer<typeof integrationSchema>;

export interface EvidenceVerifier {
  // Must verify authentic cryptographic evidence, trust anchor, audience, mechanism,
  // validity and any request binding BEFORE returning. No implementation/default here.
  verify(evidence: Uint8Array, context: { environment: Environment }): Promise<unknown | null>;
}
export interface IntegrationCatalog {
  // Authoritative fresh lookup by ALL binding fields; 0 or >1 matches must be denied.
  findByCredential(binding: CredentialBinding): Promise<unknown[]>;
}
export interface RevocationPort {
  isRevoked(input: CredentialBinding & Pick<IntegrationRecord, 'environment' | 'tenantId' | 'clientId' | 'integrationId' | 'revision'>): Promise<boolean>;
}
export interface TrustedClock { nowMs(): number }
export const policySchema = z.object({
  maxEvidenceBytes: positive.max(MAX_BODY_BYTES), maxBodyBytes: positive.max(MAX_BODY_BYTES),
  requestsPerWindow: positive, windowMs: positive,
  maxProofAgeMs: positive, futureSkewMs: milliseconds, replayRetentionMs: positive,
}).strict().refine(v => Number.isSafeInteger(v.maxProofAgeMs + v.futureSkewMs) && v.replayRetentionMs >= v.maxProofAgeMs + v.futureSkewMs);
export type AbusePolicy = z.infer<typeof policySchema>;
export const counterResultSchema = z.object({
  allowed: z.boolean(), used: milliseconds, resetAtMs: milliseconds,
  assurance: z.enum(['DISTRIBUTED_ATOMIC', 'SIMULATED']),
}).strict();
export interface AtomicCounterPort {
  // Atomic cross-process fixed window, authoritative time, bounded TTL. No in-memory implementation supplied.
  consume(input: { identityKey: string; limit: number; windowMs: number; nowMs: number }): Promise<z.infer<typeof counterResultSchema>>;
}
export const replayResultSchema = z.object({
  status: z.enum(['CLAIMED', 'REUSED', 'COLLISION']), assurance: z.enum(['DURABLE_ATOMIC', 'SIMULATED']),
}).strict();
export interface AtomicReplayPort {
  // Atomic set-if-absent across processes, durable through the full validity window.
  // Same nonce+same digest is REUSED; same nonce+different digest is COLLISION.
  claim(input: { identityKey: string; proofId: string; bindingDigest: string; retainUntilMs: number; nowMs: number }): Promise<z.infer<typeof replayResultSchema>>;
}
export type SecurityCode = 'DENIED' | 'TOO_LARGE' | 'LIMITED' | 'REPLAY_REJECTED' | 'UNAVAILABLE';
export class SecurityFailure extends Error {
  readonly code: SecurityCode;
  constructor(code: SecurityCode) {
    const safe = ['DENIED','TOO_LARGE','LIMITED','REPLAY_REJECTED','UNAVAILABLE'].includes(code) ? code : 'UNAVAILABLE';
    super(safe); this.code = safe;
  }
}
