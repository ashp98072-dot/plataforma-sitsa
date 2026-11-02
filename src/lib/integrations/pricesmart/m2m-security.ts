import { createHash, randomUUID } from 'node:crypto';
import { MAX_BODY_BYTES, reference, principalSchema, type Principal } from './contracts';
import {
  assertionSchema, integrationSchema, targetSchema, operationSchema, policySchema,
  counterResultSchema, replayResultSchema, SecurityFailure,
  type EvidenceVerifier, type IntegrationCatalog, type RevocationPort, type TrustedClock,
  type AtomicCounterPort, type AtomicReplayPort, type AbusePolicy, type Operation,
  type ResourceTarget, type VerifiedAssertion, type IntegrationRecord,
} from './security-contracts';

declare const verifiedBrand: unique symbol;
export type VerifiedIdentity = Readonly<{ [verifiedBrand]: true }>;
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const namespace = (v: Pick<IntegrationRecord, 'environment' | 'tenantId' | 'clientId' | 'integrationId'>) =>
  JSON.stringify(['api03', v.environment, v.tenantId, v.clientId, v.integrationId]);

/** Cryptographic request-proof providers must use this exact versioned binding.
 * It is distinct from the canonical ORDER hash/idempotency in API-01. */
export function requestBindingDigest(operation: Operation, resource: ResourceTarget, body: Uint8Array): string {
  const op = operationSchema.safeParse(operation), target = targetSchema.safeParse(resource);
  if (!op.success || !target.success || !(body instanceof Uint8Array)) throw new SecurityFailure('DENIED');
  if (body.byteLength > MAX_BODY_BYTES) throw new SecurityFailure('TOO_LARGE');
  return sha256(JSON.stringify(['api03-request-v1', op.data, namespace(target.data), target.data.originClubReference,
    target.data.externalOrderId ?? null, sha256(body)]));
}
export function sanitizedSecurityRejection(error: unknown): { code: string; correlationId: string } {
  const code = error instanceof SecurityFailure && ['DENIED','TOO_LARGE','LIMITED','REPLAY_REJECTED','UNAVAILABLE'].includes(error.code) ? error.code : 'UNAVAILABLE';
  return { code, correlationId: randomUUID() };
}

/** No transport, credentials, SQL, provider client or activation flag. Trusted ports only. */
export function createM2MSecurity(ports: {
  verifier: EvidenceVerifier; catalog: IntegrationCatalog; revocation: RevocationPort;
  clock: TrustedClock; counter: AtomicCounterPort; replay: AtomicReplayPort;
}, proposedPolicy: AbusePolicy) {
  // No quota defaults: this is a proposed test/composition policy, not D10-D12 approval.
  const parsedPolicy = policySchema.safeParse(proposedPolicy);
  if (!parsedPolicy.success) throw new SecurityFailure('UNAVAILABLE');
  const policy = Object.freeze(parsedPolicy.data);
  // This WeakMap only proves local handle provenance, NOT replay protection or a rate limiter.
  const identities = new WeakMap<object, { assertion: VerifiedAssertion; namespace: string }>();
  const now = () => {
    const value = ports.clock.nowMs();
    if (!Number.isSafeInteger(value) || value < 0) throw new SecurityFailure('UNAVAILABLE');
    return value;
  };
  async function safe<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) { if (error instanceof SecurityFailure) throw new SecurityFailure(error.code); throw new SecurityFailure('UNAVAILABLE'); }
  }
  function validAt(assertion: VerifiedAssertion, record: IntegrationRecord, time: number) {
    if (assertion.validFromMs > time || assertion.validUntilMs <= time || record.status !== 'ACTIVE' ||
        record.validFromMs > time || record.validUntilMs <= time || record.credentialValidFromMs > time ||
        record.credentialValidUntilMs <= time) throw new SecurityFailure('DENIED');
  }
  async function current(assertion: VerifiedAssertion): Promise<IntegrationRecord> {
    const time = now();
    if (assertion.validFromMs > time || assertion.validUntilMs <= time) throw new SecurityFailure('DENIED');
    const binding = { issuer: assertion.issuer, subject: assertion.subject, credentialReference: assertion.credentialReference };
    const matches = await ports.catalog.findByCredential(binding);
    if (!Array.isArray(matches) || matches.length !== 1) throw new SecurityFailure('DENIED');
    const parsed = integrationSchema.safeParse(matches[0]);
    if (!parsed.success) throw new SecurityFailure('DENIED');
    const record = parsed.data;
    if (record.issuer !== binding.issuer || record.subject !== binding.subject || record.credentialReference !== binding.credentialReference) throw new SecurityFailure('DENIED');
    validAt(assertion, record, now());
    const revoked = await ports.revocation.isRevoked({ ...binding, environment: record.environment,
      tenantId: record.tenantId, clientId: record.clientId, integrationId: record.integrationId, revision: record.revision });
    if (revoked !== false) throw new SecurityFailure('DENIED');
    validAt(assertion, record, now());
    return record;
  }
  function owned(identity: unknown) {
    const stored = identity !== null && typeof identity === 'object' ? identities.get(identity) : undefined;
    if (!stored) throw new SecurityFailure('DENIED');
    return stored;
  }
  async function authorize(identity: unknown, operation: Operation, resource: ResourceTarget): Promise<Principal> {
    return safe(async () => {
      const stored = owned(identity);
      const op = operationSchema.safeParse(operation), target = targetSchema.safeParse(resource);
      if (!op.success || !target.success) throw new SecurityFailure('DENIED');
      const record = await current(stored.assertion);
      if (namespace(record) !== stored.namespace || namespace(record) !== namespace(target.data) ||
          !record.allowedClubs.includes(target.data.originClubReference) || !record.scopes.includes(op.data) ||
          !stored.assertion.scopes.includes(op.data)) throw new SecurityFailure('DENIED');
      // Identity comes exclusively from verified assertion + administrative catalog.
      // Requested resource is a comparison, never a source of tenant authority.
      return principalSchema.parse({ environment: record.environment, tenantId: record.tenantId, clientId: record.clientId,
        integrationId: record.integrationId, originClubReference: target.data.originClubReference, scopes: [op.data] });
    });
  }
  return Object.freeze({
    async authenticate(evidence: unknown): Promise<VerifiedIdentity> {
      return safe(async () => {
        if (!(evidence instanceof Uint8Array) || evidence.byteLength === 0) throw new SecurityFailure('DENIED');
        if (evidence.byteLength > policy.maxEvidenceBytes) throw new SecurityFailure('TOO_LARGE');
        const result = await ports.verifier.verify(new Uint8Array(evidence), { environment: 'sandbox' });
        const assertion = assertionSchema.safeParse(result);
        if (!assertion.success) throw new SecurityFailure('DENIED');
        const record = await current(assertion.data);
        const handle = Object.freeze(Object.create(null)) as VerifiedIdentity;
        identities.set(handle, { assertion: assertion.data, namespace: namespace(record) });
        return handle;
      });
    },
    // Namespace is derived only from the freshly verified administrative catalog.
    async resourceTarget(identity: unknown, club: string, externalOrderId: string): Promise<ResourceTarget> {
      return safe(async () => {
        const stored = owned(identity);
        const parsedClub = reference.max(64).safeParse(club), parsedId = reference.safeParse(externalOrderId);
        if (!parsedClub.success || !parsedId.success) throw new SecurityFailure('DENIED');
        const record = await current(stored.assertion);
        if (namespace(record) !== stored.namespace || !record.allowedClubs.includes(parsedClub.data)) throw new SecurityFailure('DENIED');
        return { environment: record.environment, tenantId: record.tenantId, clientId: record.clientId,
          integrationId: record.integrationId, originClubReference: parsedClub.data, externalOrderId: parsedId.data };
      });
    },
    authorize,
    async admit(identity: unknown, operation: Operation, resource: ResourceTarget, requestBody: Uint8Array) {
      return safe(async () => {
        // Snapshot caller-owned mutable data before asynchronous port calls.
        const target = targetSchema.safeParse(resource);
        if (!target.success || !(requestBody instanceof Uint8Array)) throw new SecurityFailure('DENIED');
        if (requestBody.byteLength > policy.maxBodyBytes) throw new SecurityFailure('TOO_LARGE');
        const bindingDigest = requestBindingDigest(operation, target.data, requestBody);
        const principal = await authorize(identity, operation, target.data);
        const proof = owned(identity).assertion.requestProof;
        const checkProof = (time: number) => {
          if (!proof || proof.bindingDigest !== bindingDigest || proof.issuedAtMs > time + policy.futureSkewMs ||
              proof.expiresAtMs <= time || proof.expiresAtMs <= proof.issuedAtMs ||
              time - proof.issuedAtMs > policy.maxProofAgeMs || proof.expiresAtMs - proof.issuedAtMs > policy.maxProofAgeMs) {
            throw new SecurityFailure('DENIED');
          }
        };
        const time = now(); checkProof(time);
        const identityKey = namespace(principal);
        const counted = counterResultSchema.safeParse(await ports.counter.consume({ identityKey,
          limit: policy.requestsPerWindow, windowMs: policy.windowMs, nowMs: time }));
        if (!counted.success || counted.data.resetAtMs <= time || counted.data.resetAtMs > time + policy.windowMs ||
            (counted.data.allowed && (counted.data.used < 1 || counted.data.used > policy.requestsPerWindow))) throw new SecurityFailure('UNAVAILABLE');
        if (!counted.data.allowed) throw new SecurityFailure('LIMITED');
        const claimTime = now(); checkProof(claimTime);
        const retainUntilMs = claimTime + policy.replayRetentionMs;
        if (!Number.isSafeInteger(retainUntilMs)) throw new SecurityFailure('UNAVAILABLE');
        const claimed = replayResultSchema.safeParse(await ports.replay.claim({ identityKey, proofId: proof!.id,
          bindingDigest, retainUntilMs, nowMs: claimTime }));
        if (!claimed.success) throw new SecurityFailure('UNAVAILABLE');
        if (claimed.data.status !== 'CLAIMED') throw new SecurityFailure('REPLAY_REJECTED');
        // Recheck catalog and revocation after waiting on both security stores.
        await authorize(identity, operation, target.data); checkProof(now());
        return { principal, correlationId: randomUUID(),
          assurance: counted.data.assurance === 'SIMULATED' || claimed.data.assurance === 'SIMULATED'
            ? 'SIMULATED' as const : 'PORT_ATTESTED' as const };
      });
    },
  });
}
