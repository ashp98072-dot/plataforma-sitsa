import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createM2MSecurity, requestBindingDigest, sanitizedSecurityRejection } from './m2m-security';
import { SecurityFailure, type IntegrationRecord, type VerifiedAssertion, type AbusePolicy, type ResourceTarget } from './security-contracts';
import { disabledHttpContract } from './transport';

// SIMULATED trusted ports only. No OAuth/PKI/Redis/MariaDB/HTTP or real cryptographic proof.
const now = 1_800_000_000_000;
const target: ResourceTarget = { environment: 'sandbox', tenantId: 1, clientId: 2, integrationId: 'PriceSmart', originClubReference: 'Club-A', externalOrderId: 'Order-A' };
const body = new TextEncoder().encode('{"externalOrderId":"Order-A"}');
const evidence = new Uint8Array([1,2,3]); // opaque bytes accepted ONLY by the explicitly injected test verifier
const policy: AbusePolicy = { maxEvidenceBytes: 100, maxBodyBytes: 100, requestsPerWindow: 2, windowMs: 1000,
  maxProofAgeMs: 5000, futureSkewMs: 100, replayRetentionMs: 5100 };
const record: IntegrationRecord = {
  integrationId: 'PriceSmart', tenantId: 1, clientId: 2, environment: 'sandbox', issuer: 'test-issuer', subject: 'test-subject', credentialReference: 'test-reference',
  revision: 1, status: 'ACTIVE', validFromMs: now-10000, validUntilMs: now+10000, credentialValidFromMs: now-10000, credentialValidUntilMs: now+10000, rotatedAtMs: now-10000,
  allowedClubs: ['Club-A','Club-B'], scopes: ['orders:create','orders:read','orders:cancel'],
};
const assertion: VerifiedAssertion = { environment: 'sandbox', issuer: record.issuer, subject: record.subject, credentialReference: record.credentialReference,
  validFromMs: now-1000, validUntilMs: now+8000, scopes: [...record.scopes],
  requestProof: { id: 'Proof-A', issuedAtMs: now-500, expiresAtMs: now+4000, bindingDigest: requestBindingDigest('orders:create', target, body) },
};
function fixture() {
  let time = now;
  const ports = {
    verifier: { verify: vi.fn(async (): Promise<unknown> => structuredClone(assertion)) },
    catalog: { findByCredential: vi.fn(async (): Promise<unknown[]> => [structuredClone(record)]) },
    revocation: { isRevoked: vi.fn(async (): Promise<boolean> => false) }, clock: { nowMs: () => time },
    counter: { consume: vi.fn(async (args: { nowMs: number; windowMs: number }) => ({ allowed: true, used: 1, resetAtMs: args.nowMs+args.windowMs, assurance: 'SIMULATED' as const })) },
    replay: { claim: vi.fn(async () => ({ status: 'CLAIMED' as 'CLAIMED'|'REUSED'|'COLLISION', assurance: 'SIMULATED' as const })) },
  };
  const engine = createM2MSecurity(ports, policy);
  return { ports, engine, time: (value: number) => { time = value; },
    assertion: (change: Partial<VerifiedAssertion>) => ports.verifier.verify.mockResolvedValue({ ...structuredClone(assertion), ...change }),
    record: (change: Partial<IntegrationRecord>) => ports.catalog.findByCredential.mockResolvedValue([{ ...structuredClone(record), ...change }]),
  };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('API-03 isolated M2M policy with SIMULATED ports', () => {
  it('authenticates only through the verifier and maps administrative identity', async () => {
    const f=fixture(); const handle=await f.engine.authenticate(evidence);
    expect(Object.keys(handle)).toEqual([]); expect(Object.isFrozen(handle)).toBe(true);
    expect(f.ports.verifier.verify).toHaveBeenCalledWith(evidence, { environment:'sandbox' });
    expect(await f.engine.authorize(handle,'orders:create',target)).toEqual({ environment:'sandbox',tenantId:1,clientId:2,integrationId:'PriceSmart',originClubReference:'Club-A',scopes:['orders:create'] });
  });
  it.each([null,undefined,'a.b.c',{},new Uint8Array()])('rejects missing or merely structured evidence %j', async value => {
    const f=fixture(); await expect(f.engine.authenticate(value)).rejects.toThrow('DENIED'); expect(f.ports.verifier.verify).not.toHaveBeenCalled();
  });
  it('rejects missing cryptographic verification even for nonempty evidence', async () => {
    const f=fixture(); f.ports.verifier.verify.mockResolvedValue(null); await expect(f.engine.authenticate(evidence)).rejects.toThrow('DENIED');
  });
  it.each([{}, { ...assertion, scopes:['superadmin'] }, { ...assertion, validUntilMs:now-2000 }, { ...assertion, credentialReference:'' }, { ...assertion, environment:'production' }])('rejects malformed verifier output %j', async value => {
    const f=fixture(); f.ports.verifier.verify.mockResolvedValue(value); await expect(f.engine.authenticate(evidence)).rejects.toThrow('DENIED');
  });
  it.each([{ matches:[] },{ matches:[record,record] }])('rejects unknown or ambiguous credential bindings', async ({ matches }) => {
    const f=fixture(); f.ports.catalog.findByCredential.mockResolvedValue(matches); await expect(f.engine.authenticate(evidence)).rejects.toThrow('DENIED');
  });
  it.each(['issuer','subject','credentialReference'] as const)('rejects a catalog collision/mismatch in %s', async key => {
    const f=fixture(); f.record({ [key]:'foreign' }); await expect(f.engine.authenticate(evidence)).rejects.toThrow('DENIED');
  });
  it.each([
    { validFromMs:now+1 }, { validUntilMs:now }, { status:'REVOKED' as const },
    { credentialValidUntilMs:now }, { credentialValidFromMs:now+1, rotatedAtMs:now+1 },
  ])('rejects expired/not-yet-valid/revoked administrative identity %j', async change => {
    const f=fixture(); f.record(change); await expect(f.engine.authenticate(evidence)).rejects.toThrow('DENIED');
  });
  it.each([{ validUntilMs:now },{ validFromMs:now+1 }])('rejects expired or future assertions %j', async change => {
    const f=fixture(); f.assertion(change); await expect(f.engine.authenticate(evidence)).rejects.toThrow('DENIED');
  });
  it('rechecks revocation on every authorization and denies after revocation', async () => {
    const f=fixture(); const handle=await f.engine.authenticate(evidence); f.ports.revocation.isRevoked.mockResolvedValue(true);
    await expect(f.engine.authorize(handle,'orders:read',target)).rejects.toThrow('DENIED'); expect(f.ports.revocation.isRevoked).toHaveBeenCalledTimes(2);
  });
  it('rejects a non-boolean revocation response', async () => {
    const f=fixture(); f.ports.revocation.isRevoked.mockResolvedValue(undefined as never); await expect(f.engine.authenticate(evidence)).rejects.toThrow('DENIED');
  });
  it('does not cache catalog scopes or club permissions', async () => {
    const f=fixture(); const handle=await f.engine.authenticate(evidence); f.record({ scopes:['orders:read'], allowedClubs:['Club-B'] });
    await expect(f.engine.authorize(handle,'orders:create',target)).rejects.toThrow('DENIED'); await expect(f.engine.authorize(handle,'orders:read',target)).rejects.toThrow('DENIED');
  });
  it.each(['orders:create','orders:read','orders:cancel'] as const)('authorizes exactly scope %s', async op => {
    const f=fixture(); const handle=await f.engine.authenticate(evidence); expect((await f.engine.authorize(handle,op,target)).scopes).toEqual([op]);
  });
  it.each(['orders:create','orders:read','orders:cancel'] as const)('denies missing verifier grant for %s', async op => {
    const f=fixture(); f.assertion({ scopes: record.scopes.filter(s=>s!==op) }); const handle=await f.engine.authenticate(evidence);
    await expect(f.engine.authorize(handle,op,target)).rejects.toThrow('DENIED');
  });
  it.each(['orders:create','orders:read','orders:cancel'] as const)('denies missing catalog grant for %s', async op => {
    const f=fixture(); f.record({ scopes:record.scopes.filter(s=>s!==op) }); const handle=await f.engine.authenticate(evidence);
    await expect(f.engine.authorize(handle,op,target)).rejects.toThrow('DENIED');
  });
  it.each([{ tenantId:9 },{ clientId:9 },{ integrationId:'Other' },{ environment:'production' },{ originClubReference:'Other' },{ originClubReference:'club-a' },{ tenantId:0 }])('denies foreign resource %j', async change => {
    const f=fixture(); const handle=await f.engine.authenticate(evidence); await expect(f.engine.authorize(handle,'orders:read',{ ...target,...change } as ResourceTarget)).rejects.toThrow('DENIED');
  });
  it('denies administrative tenant reassignment of an existing handle', async () => {
    const f=fixture(); const handle=await f.engine.authenticate(evidence); f.record({ tenantId:9 });
    await expect(f.engine.authorize(handle,'orders:read',{ ...target,tenantId:9 })).rejects.toThrow('DENIED');
  });
  it.each([{},record,assertion,null,{ ...target, scopes:['orders:create'] }])('denies fabricated identity handles', async handle => {
    const f=fixture(); await expect(f.engine.authorize(handle,'orders:create',target)).rejects.toThrow('DENIED');
  });
  it('denies copied handles and handles minted by another engine', async () => {
    const f=fixture(); const handle=await f.engine.authenticate(evidence); await expect(f.engine.authorize({ ...handle },'orders:create',target)).rejects.toThrow('DENIED');
    await expect(fixture().engine.authorize(handle,'orders:create',target)).rejects.toThrow('DENIED');
  });
  it('uses only the catalog mapping and rejects body/header-like tenant fields', async () => {
    const f=fixture(); f.ports.verifier.verify.mockResolvedValue({ ...assertion, tenantId:99, headers:{ 'x-tenant':99 } });
    await expect(f.engine.authenticate(evidence)).rejects.toThrow('DENIED');
  });
  it.each(['verifier','catalog','revocation'] as const)('sanitizes failure in %s and fails closed', async name => {
    const f=fixture(); const method=name==='verifier'?f.ports.verifier.verify:name==='catalog'?f.ports.catalog.findByCredential:f.ports.revocation.isRevoked;
    method.mockRejectedValue(new Error('SECRET SQL token credentials'));
    await expect(f.engine.authenticate(evidence)).rejects.toEqual(new SecurityFailure('UNAVAILABLE'));
  });
  it('expires identities while a trusted store is being awaited', async () => {
    const f=fixture(); f.ports.catalog.findByCredential.mockImplementation(async () => { f.time(now+20000); return [record]; });
    await expect(f.engine.authenticate(evidence)).rejects.toThrow('DENIED');
  });
  it('admits a bounded verified request with explicit SIMULATED assurance', async () => {
    const f=fixture(); const handle=await f.engine.authenticate(evidence); const admitted=await f.engine.admit(handle,'orders:create',target,body);
    expect(admitted.assurance).toBe('SIMULATED'); expect(admitted.correlationId).toMatch(/^[a-f0-9-]{36}$/);
    expect(f.ports.replay.claim).toHaveBeenCalledWith(expect.objectContaining({ proofId:'Proof-A', retainUntilMs:now+policy.replayRetentionMs }));
    expect(f.ports.counter.consume).toHaveBeenCalledWith(expect.objectContaining({ identityKey:JSON.stringify(['api03','sandbox',1,2,'PriceSmart']) }));
  });
  it('does not confuse reusable bearer identity with authenticated per-request replay proof', async () => {
    const f=fixture(); f.assertion({ requestProof:null }); const handle=await f.engine.authenticate(evidence);
    expect(await f.engine.authorize(handle,'orders:create',target)).toBeTruthy(); await expect(f.engine.admit(handle,'orders:create',target,body)).rejects.toThrow('DENIED');
    expect(f.ports.counter.consume).not.toHaveBeenCalled();
  });
  it.each([
    { issuedAtMs:now+101 },{ expiresAtMs:now },{ issuedAtMs:now-6000,expiresAtMs:now+1 },
    { expiresAtMs:now+6000 },{ bindingDigest:'b'.repeat(64) },
  ])('rejects stale/future/unbound cryptographic request proof %j', async change => {
    const f=fixture(); f.assertion({ requestProof:{ ...assertion.requestProof!,...change } }); const handle=await f.engine.authenticate(evidence);
    await expect(f.engine.admit(handle,'orders:create',target,body)).rejects.toThrow('DENIED'); expect(f.ports.counter.consume).not.toHaveBeenCalled();
  });
  it.each(['REUSED','COLLISION'] as const)('rejects proof identifier %s independently of order idempotency', async status => {
    const f=fixture(); f.ports.replay.claim.mockResolvedValue({ status,assurance:'SIMULATED' }); const handle=await f.engine.authenticate(evidence);
    await expect(f.engine.admit(handle,'orders:create',target,body)).rejects.toThrow('REPLAY_REJECTED');
  });
  it('binds operation, scope, club, resource id and exact wire body', () => {
    const initial=requestBindingDigest('orders:create',target,body);
    for(const changed of [{ tenantId:9 },{ clientId:9 },{ integrationId:'Other' },{ originClubReference:'Club-B' },{ externalOrderId:'order-a' }]) expect(requestBindingDigest('orders:create',{ ...target,...changed },body)).not.toBe(initial);
    expect(requestBindingDigest('orders:read',target,body)).not.toBe(initial);
    expect(requestBindingDigest('orders:create',target,new Uint8Array())).not.toBe(initial);
  });
  it('does not bypass rate limits with credential rotation', async () => {
    const f=fixture(); const handle=await f.engine.authenticate(evidence); await f.engine.admit(handle,'orders:create',target,body);
    f.assertion({ credentialReference:'rotated-reference' }); f.record({ credentialReference:'rotated-reference' });
    const rotated=await f.engine.authenticate(evidence); f.ports.counter.consume.mockResolvedValue({ allowed:false,used:2,resetAtMs:now+1000,assurance:'SIMULATED' });
    await expect(f.engine.admit(rotated,'orders:create',target,body)).rejects.toThrow('LIMITED');
    expect(f.ports.counter.consume.mock.calls[0][0]).toEqual(f.ports.counter.consume.mock.calls[1][0]);
  });
  it('simulates concurrent requests to test shared counter and nonce policy, not distributed guarantees', async () => {
    const f=fixture(); let count=0; const seen=new Set<string>();
    f.ports.counter.consume.mockImplementation(async () => ({ allowed:++count<=2,used:count,resetAtMs:now+1000,assurance:'SIMULATED' }));
    f.ports.replay.claim.mockImplementation(async (...args: unknown[]) => {
      const key=JSON.stringify(args); const reused=seen.has(key); seen.add(key); return { status:reused?'REUSED':'CLAIMED',assurance:'SIMULATED' };
    });
    const handle=await f.engine.authenticate(evidence); const results=await Promise.allSettled([1,2,3].map(()=>f.engine.admit(handle,'orders:create',target,body)));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected').map(r=>(r as PromiseRejectedResult).reason.code).sort()).toEqual(['LIMITED','REPLAY_REJECTED']);
  });
  it.each(['counter','replay'] as const)('fails closed and sanitizes %s store failures', async which => {
    const f=fixture(); (which==='counter'?f.ports.counter.consume:f.ports.replay.claim).mockRejectedValue(new Error('SQL SECRET Redis URI'));
    const handle=await f.engine.authenticate(evidence); await expect(f.engine.admit(handle,'orders:create',target,body)).rejects.toEqual(new SecurityFailure('UNAVAILABLE'));
    if(which==='counter') expect(f.ports.replay.claim).not.toHaveBeenCalled();
  });
  it('rechecks revocation after replay storage and returns no admission after revocation', async () => {
    const f=fixture(); f.ports.replay.claim.mockImplementation(async () => { f.ports.revocation.isRevoked.mockResolvedValue(true); return { status:'CLAIMED',assurance:'SIMULATED' }; });
    const handle=await f.engine.authenticate(evidence); await expect(f.engine.admit(handle,'orders:create',target,body)).rejects.toThrow('DENIED');
  });
  it('expires proof during a delayed counter without claiming a nonce', async () => {
    const f=fixture(); f.ports.counter.consume.mockImplementation(async args => { f.time(now+4000); return { allowed:true,used:1,resetAtMs:args.nowMs+1000,assurance:'SIMULATED' }; });
    const handle=await f.engine.authenticate(evidence); await expect(f.engine.admit(handle,'orders:create',target,body)).rejects.toThrow('DENIED'); expect(f.ports.replay.claim).not.toHaveBeenCalled();
  });
  it('bounds evidence and body before expensive ports and creates no bypass', async () => {
    const f=fixture(); await expect(f.engine.authenticate(new Uint8Array(101))).rejects.toThrow('TOO_LARGE'); expect(f.ports.verifier.verify).not.toHaveBeenCalled();
    const handle=await f.engine.authenticate(evidence); await expect(f.engine.admit(handle,'orders:create',target,new Uint8Array(101))).rejects.toThrow('TOO_LARGE'); expect(f.ports.counter.consume).not.toHaveBeenCalled();
  });
  it.each([{ requestsPerWindow:0 },{ windowMs:0 },{ replayRetentionMs:1 },{ maxBodyBytes:65537 },{ futureSkewMs:-1 }])('rejects invalid provisional policy %j', change => {
    const f=fixture(); expect(()=>createM2MSecurity(f.ports,{ ...policy,...change })).toThrow('UNAVAILABLE');
  });
  it('sanitizes unknown and forged error codes and generates fresh correlation ids', () => {
    const a=sanitizedSecurityRejection(new Error('SECRET token SQL')); const b=sanitizedSecurityRejection(new SecurityFailure('SECRET' as never));
    expect(a.code).toBe('UNAVAILABLE'); expect(b.code).toBe('UNAVAILABLE'); expect(a.correlationId).not.toBe(b.correlationId); expect(JSON.stringify(a)).not.toContain('SECRET');
  });
  it.each([NaN,-1,Infinity,1.5])('rejects invalid trusted clock value %s', async time => {
    const f=fixture(); f.time(time); await expect(f.engine.authenticate(evidence)).rejects.toThrow('UNAVAILABLE');
  });
  it.each([
    { allowed:true, used:0, resetAtMs:now+1000, assurance:'SIMULATED' },
    { allowed:true, used:3, resetAtMs:now+1000, assurance:'SIMULATED' },
    { allowed:true, used:1, resetAtMs:now, assurance:'SIMULATED' },
    { allowed:true, used:1, resetAtMs:now+1001, assurance:'SIMULATED' },
    { allowed:true, used:1, resetAtMs:now+1000, assurance:'LOCAL_MEMORY' },
  ])('rejects inconsistent counter response %j', async result => {
    const f=fixture(); f.ports.counter.consume.mockResolvedValue(result as never); const handle=await f.engine.authenticate(evidence);
    await expect(f.engine.admit(handle,'orders:create',target,body)).rejects.toThrow('UNAVAILABLE'); expect(f.ports.replay.claim).not.toHaveBeenCalled();
  });
  it('rejects malformed replay storage responses', async () => {
    const f=fixture(); f.ports.replay.claim.mockResolvedValue({ status:'OK',assurance:'LOCAL_MEMORY' } as never); const handle=await f.engine.authenticate(evidence);
    await expect(f.engine.admit(handle,'orders:create',target,body)).rejects.toThrow('UNAVAILABLE');
  });
  it('simulates quota exhaustion and renewal in a new temporal window', async () => {
    const f=fixture(); const counts=new Map<number,number>();
    f.ports.counter.consume.mockImplementation(async args => {
      const window=Math.floor(args.nowMs/args.windowMs); const used=(counts.get(window)??0)+1; counts.set(window,used);
      return { allowed:used<=2,used,resetAtMs:(window+1)*args.windowMs,assurance:'SIMULATED' };
    });
    for(let index=0;index<3;index++) {
      f.assertion({ requestProof:{ ...assertion.requestProof!,id:'Proof-'+index } }); const handle=await f.engine.authenticate(evidence);
      const admission=f.engine.admit(handle,'orders:create',target,body);
      if(index<2) expect((await admission).assurance).toBe('SIMULATED'); else await expect(admission).rejects.toThrow('LIMITED');
    }
    f.time(now+1000); f.assertion({ requestProof:{ ...assertion.requestProof!,id:'Proof-new-window' } });
    const renewed=await f.engine.authenticate(evidence); expect((await f.engine.admit(renewed,'orders:create',target,body)).assurance).toBe('SIMULATED');
  });
  it('sanitizes exported request binding validation without exposing input', () => {
    expect(()=>requestBindingDigest('admin' as never,target,body)).toThrow('DENIED');
    expect(()=>requestBindingDigest('orders:read',{ ...target,tenantId:0 },body)).toThrow('DENIED');
  });
  it('never returns a raw exception supplied by a trusted port', async () => {
    const f=fixture(); const error=new SecurityFailure('DENIED'); error.message='SECRET SQL';
    f.ports.verifier.verify.mockRejectedValue(error); await expect(f.engine.authenticate(evidence)).rejects.toEqual(new SecurityFailure('DENIED'));
  });
  it('keeps HTTP disabled even with an apparent activation environment variable', () => {
    vi.stubEnv('PRICESMART_ENABLED','true'); expect(disabledHttpContract()).toEqual({ status:503,body:{ code:'DISABLED' } });
  });
  it('has no network/DB/provider imports or side effects and no application wiring', async () => {
    vi.stubGlobal('fetch',vi.fn(()=>{ throw new Error('NETWORK FORBIDDEN'); }));
    for(const file of ['m2m-security.ts','security-contracts.ts']) {
      const source=readFileSync(join('src/lib/integrations/pricesmart',file),'utf8');
      expect(source).not.toMatch(/\bfetch\s*\(|console\.|process\.env|from\s+['"](?:mysql2|redis|next|node:(?:http|https|net|tls|fs|child_process))/);
    }
    const inspect=(dir:string)=>{ for(const entry of readdirSync(dir,{ withFileTypes:true })) { const path=join(dir,entry.name); if(entry.isDirectory()) inspect(path); else if(/\.[jt]sx?$/.test(path)) expect(readFileSync(path,'utf8')).not.toMatch(/m2m-security|createM2MSecurity/); } };
    inspect('src/app'); const f=fixture(); await f.engine.authenticate(evidence); expect(fetch).not.toHaveBeenCalled();
  });
});
