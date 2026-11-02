import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIsolatedHttpTransport, PROVISIONAL_ORDERS_PATH as path, type HttpTransportLimits } from './http-transport';
import { createM2MSecurity, requestBindingDigest } from './m2m-security';
import { ModelRepository } from './__tests__/model-repository';
import { OrderError, type Scope } from './contracts';
import type { Committed, OrderRepository, Transaction } from './ports';
import type { AbusePolicy, IntegrationRecord, VerifiedAssertion, Operation } from './security-contracts';
import { disabledHttpContract } from './transport';

// SYNTHETIC Request/Response ONLY. No server, real token, SQL or durable storage.
// Positive 202 cases deliberately use a protocol double CLAIMING DURABLE and port
// attestations to test gating. This is NOT evidence of real persistence or security.
const now = 1_800_000_000_000;
const input = { schemaVersion:'api01-draft-1', externalOrderId:'Order-A', originClubReference:'Club-A' };
const wire = JSON.stringify(input);
const policy: AbusePolicy = { maxEvidenceBytes:1024,maxBodyBytes:1024,requestsPerWindow:100,windowMs:1000,maxProofAgeMs:5000,futureSkewMs:100,replayRetentionMs:5100 };
const limits: HttpTransportLimits = { originClubReference:'Club-A',timeoutMs:2000,maxHeaderBytes:4096,maxHeaderCount:20,maxUrlBytes:512,maxBodyChunks:32 };
const baseRecord: IntegrationRecord = { integrationId:'PriceSmart',tenantId:1,clientId:2,environment:'sandbox',issuer:'test-issuer',subject:'test-subject',credentialReference:'test-reference',revision:1,status:'ACTIVE',validFromMs:now-10000,validUntilMs:now+10000,credentialValidFromMs:now-10000,credentialValidUntilMs:now+10000,rotatedAtMs:now-10000,allowedClubs:['Club-A'],scopes:['orders:create','orders:read','orders:cancel'] };
function fixture(options: { limits?: Partial<HttpTransportLimits>; policy?: Partial<AbusePolicy> } = {}) {
  const trace: string[] = []; const model = new ModelRepository(); let sequence = 0;
  let record = structuredClone(baseRecord); const assertions = new Map<string, VerifiedAssertion>();
  const claims = new Map<string,string>(); let reportSimulated = false;
  const repository: OrderRepository = { runAtomic: vi.fn(async <T>(scope: Scope,action: (tx:Transaction)=>Promise<T>): Promise<Committed<T>> => {
    trace.push('repository'); const result = await model.runAtomic(scope,action); trace.push('commit-double');
    return { value:result.value,durability:reportSimulated?'SIMULATED':'DURABLE' };
  }) as OrderRepository['runAtomic'] };
  const security = {
    verifier:{ verify:vi.fn(async (bytes:Uint8Array):Promise<unknown> => { trace.push('verify'); return assertions.get(new TextDecoder().decode(bytes)) ?? null; }) },
    catalog:{ findByCredential:vi.fn(async ():Promise<unknown[]> => { trace.push('catalog'); return [structuredClone(record)]; }) },
    revocation:{ isRevoked:vi.fn(async ():Promise<boolean> => { trace.push('revocation'); return false; }) },clock:{ nowMs:() => now },
    counter:{ consume:vi.fn(async () => { trace.push('counter'); return { allowed:true,used:1,resetAtMs:now+1000,assurance:'DISTRIBUTED_ATOMIC' as 'DISTRIBUTED_ATOMIC'|'SIMULATED' }; }) },
    replay:{ claim:vi.fn(async (args:{ identityKey:string;proofId:string;bindingDigest:string }) => {
      trace.push('claim'); const key=JSON.stringify([args.identityKey,args.proofId]); const old=claims.get(key); claims.set(key,args.bindingDigest);
      return { status:old ? old===args.bindingDigest?'REUSED' as const:'COLLISION' as const:'CLAIMED' as const,assurance:'DURABLE_ATOMIC' as const };
    }) },
  };
  const evidence = { extract:vi.fn(async (metadata:{ headers:readonly (readonly [string,string])[] }):Promise<unknown> => {
    trace.push('extract'); const id=metadata.headers.find(([name])=>name==='x-fixture-id')?.[1]; return id?new TextEncoder().encode(id):null;
  }) };
  const handle = createIsolatedHttpTransport({ evidence,security,repository },{ ...policy,...options.policy },{ ...limits,...options.limits });
  function request(method='POST', pathname=path, content:string|Uint8Array=wire, headers:Record<string,string>={}, noEvidence=false):Request {
    const bytes=typeof content==='string'?new TextEncoder().encode(content):new Uint8Array(content);
    const id=String(++sequence); const operation:Operation=pathname.endsWith('/cancellation-requests')?'orders:cancel':method==='GET'?'orders:read':'orders:create';
    const externalId=operation==='orders:create'?'Order-A':pathname.slice(path.length+1).split('/')[0];
    if (/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(externalId)) assertions.set(id,{ environment:'sandbox',issuer:record.issuer,subject:record.subject,credentialReference:record.credentialReference,
      validFromMs:now-1000,validUntilMs:now+8000,scopes:[...record.scopes],requestProof:{ id:'Proof-'+id,issuedAtMs:now-500,expiresAtMs:now+4000,
        bindingDigest:requestBindingDigest(operation,{ environment:'sandbox',tenantId:record.tenantId,clientId:record.clientId,integrationId:record.integrationId,originClubReference:'Club-A',externalOrderId:externalId },method==='GET'?new Uint8Array():bytes) } });
    return new Request(`https://example.invalid${pathname}`,{ method,headers:{ ...(method==='GET'?{}:{ 'content-type':'application/json' }),...(!noEvidence?{ 'x-fixture-id':id }:{}),...headers },
      ...(method==='GET'||method==='HEAD'?{}:{ body:bytes.buffer as ArrayBuffer }) });
  }
  return { handle,request,repository,model,security,evidence,trace,assertions,record:(change:Partial<IntegrationRecord>)=>{ record={ ...record,...change }; },simulated:()=>{ reportSimulated=true; } };
}
afterEach(()=>{ vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers(); });
async function error(response:Response,status:number,code:string) {
  expect(response.status).toBe(status); const value=await response.json(); expect(value).toEqual({ code,correlationId:response.headers.get('x-correlation-id') });
  expect(value.correlationId).toMatch(/^[a-f0-9-]{36}$/); expect(response.headers.get('cache-control')).toBe('no-store, private');
  return value;
}
describe('API-04 isolated HTTP protocol; all dependencies SIMULATED',()=>{
  it('receives with concrete API-01 and only acknowledges declared DURABLE after commit double',async()=>{
    const f=fixture();const response=await f.handle(f.request());expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ externalOrderId:'Order-A',provisionalStatus:'RECEIVED',processingStatus:'PENDING',version:1 });
    expect(f.model.orders.size).toBe(1);expect(f.model.events).toHaveLength(1);expect(f.model.outbox).toHaveLength(1);expect(f.trace.at(-1)).toBe('commit-double');
    expect(response.headers.get('content-type')).toContain('application/json');expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('orders transport, authentication, authorization, antiabuse and application checks',async()=>{
    const f=fixture();await f.handle(f.request());
    expect(f.trace[0]).toBe('extract');expect(f.trace.indexOf('verify')).toBeLessThan(f.trace.indexOf('catalog'));
    expect(f.trace.indexOf('revocation')).toBeLessThan(f.trace.indexOf('counter'));expect(f.trace.indexOf('counter')).toBeLessThan(f.trace.indexOf('claim'));expect(f.trace.indexOf('claim')).toBeLessThan(f.trace.indexOf('repository'));
    expect(f.trace.slice(f.trace.indexOf('claim')+1,f.trace.indexOf('repository'))).toContain('revocation');
  });
  it('gets and requests provisional cancellation using scoped domain operations',async()=>{
    const f=fixture();await f.handle(f.request());const get=await f.handle(f.request('GET',`${path}/Order-A`));expect(get.status).toBe(200);expect((await get.json()).version).toBe(1);
    const cancel=await f.handle(f.request('POST',`${path}/Order-A/cancellation-requests`,'{"reason":"ORIGIN_REQUEST"}'));expect(cancel.status).toBe(202);expect(await cancel.json()).toMatchObject({ provisionalStatus:'CANCELLATION_REQUESTED',version:2 });
    expect(f.model.events).toHaveLength(2);expect(f.model.outbox).toHaveLength(2);
  });
  it('preserves immutable response on order replay with a fresh cryptographic proof id',async()=>{
    const f=fixture();const first=await f.handle(f.request());const receipt=await first.json();
    await f.handle(f.request('POST',`${path}/Order-A/cancellation-requests`,'{"reason":"ORIGIN_REQUEST"}'));
    const replay=await f.handle(f.request());expect(replay.status).toBe(202);expect(await replay.json()).toEqual(receipt);expect(f.model.orders.size).toBe(1);
    expect(replay.headers.get('x-correlation-id')).not.toBe(first.headers.get('x-correlation-id'));
  });
  it('preserves cancellation snapshot and rejects conflicting reason',async()=>{
    const f=fixture();await f.handle(f.request());const cancel=()=>f.request('POST',`${path}/Order-A/cancellation-requests`,'{"reason":"ORIGIN_REQUEST"}');
    const first=await f.handle(cancel()),again=await f.handle(cancel());expect(await again.json()).toEqual(await first.json());
    await error(await f.handle(f.request('POST',`${path}/Order-A/cancellation-requests`,'{"reason":"DUPLICATE"}')),409,'CONFLICT');
  });
  it('models concurrent creates without claiming database concurrency evidence',async()=>{
    const f=fixture();const responses=await Promise.all([f.handle(f.request()),f.handle(f.request())]);expect(responses.map(r=>r.status)).toEqual([202,202]);expect(await responses[0].json()).toEqual(await responses[1].json());expect(f.model.orders.size).toBe(1);expect(f.model.events).toHaveLength(1);
  });
  it('rejects SIMULATED persistence for all acknowledged operations',async()=>{
    const f=fixture();await f.handle(f.request());f.simulated();
    for(const req of [f.request(),f.request('GET',`${path}/Order-A`),f.request('POST',`${path}/Order-A/cancellation-requests`,'{"reason":"ORIGIN_REQUEST"}')]) await error(await f.handle(req),503,'UNAVAILABLE');
  });
  it('rejects simulated antiabuse guarantees before invoking repository',async()=>{
    const f=fixture();f.security.counter.consume.mockResolvedValue({ allowed:true,used:1,resetAtMs:now+1000,assurance:'SIMULATED' });await error(await f.handle(f.request()),503,'UNAVAILABLE');expect(f.repository.runAtomic).not.toHaveBeenCalled();
  });
  it.each(['{','[]','null','{"schemaVersion":"api01-draft-1"}',wire.replace('"Order-A"','"Order-A","externalOrderId":"Order-A"'),wire.replace('"Order-A"','"Order-A","external\\u004frderId":"Order-A"'),wire.slice(0,-1)+',"tenantId":9}'])('rejects malformed/duplicate/unknown JSON input %s',async content=>{
    const f=fixture();await error(await f.handle(f.request('POST',path,content)),400,'INVALID_INPUT');expect(f.repository.runAtomic).not.toHaveBeenCalled();
  });
  it.each([new Uint8Array([0xff,0xfe]),new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode(wire)])])('rejects invalid UTF-8 or BOM',async bytes=>{
    const f=fixture();await error(await f.handle(f.request('POST',path,bytes)),400,'INVALID_INPUT');expect(f.repository.runAtomic).not.toHaveBeenCalled();
  });
  it.each(['text/plain','application/json; charset=latin1','application/json; charset="utf-8"','application/json, application/json','application/json; extra=true'])('rejects unsupported content type %s before authentication',async type=>{
    const f=fixture();await error(await f.handle(f.request('POST',path,wire,{ 'content-type':type })),415,'UNSUPPORTED_FORMAT');expect(f.evidence.extract).not.toHaveBeenCalled();
  });
  it.each(['content-encoding','transfer-encoding'])('rejects encoded/ambiguous transfer %s',async name=>{
    const f=fixture();await error(await f.handle(f.request('POST',path,wire,{ [name]:'gzip' })),415,'UNSUPPORTED_FORMAT');expect(f.evidence.extract).not.toHaveBeenCalled();
  });
  it('rejects excessive actual or declared body before evidence extraction',async()=>{
    const f=fixture();await error(await f.handle(f.request('POST',path,'x'.repeat(1025))),413,'TOO_LARGE');await error(await f.handle(f.request('POST',path,wire,{ 'content-length':'1025' })),413,'TOO_LARGE');expect(f.evidence.extract).not.toHaveBeenCalled();
  });
  it.each(['-1','01','2,2','not-a-number','0'])('rejects ambiguous or mismatched length %s',async length=>{
    const f=fixture();await error(await f.handle(f.request('POST',path,wire,{ 'content-length':length })),400,'INVALID_INPUT');expect(f.evidence.extract).not.toHaveBeenCalled();
  });
  it.each([['GET',path,'POST'],['PUT',path,'POST'],['DELETE',`${path}/Order-A`,'GET'],['POST',`${path}/Order-A`,'GET'],['DELETE',`${path}/Order-A/cancellation-requests`,'POST'],['HEAD',`${path}/Order-A`,'GET'],['OPTIONS',path,'POST']])('rejects method %s on %s',async(method,url,allow)=>{
    const f=fixture();const response=await f.handle(f.request(method,url));await error(response,405,'METHOD_NOT_ALLOWED');expect(response.headers.get('allow')).toBe(allow);expect(f.evidence.extract).not.toHaveBeenCalled();
  });
  it.each([`${path}/Order%2FA`,`${path}/Order%2dA`,`${path}/Order%00`,`${path}/%FF`,`${path}/a%20b`])('rejects manipulated identifier %s',async url=>{
    const f=fixture();await error(await f.handle(f.request('GET',url)),400,'INVALID_INPUT');expect(f.evidence.extract).not.toHaveBeenCalled();
  });
  it.each([`${path}?tenant=9`,`${path}#secret`])('rejects query or fragment %s',async url=>{
    const f=fixture();await error(await f.handle(f.request('POST',url)),400,'INVALID_INPUT');
  });
  it('rejects unknown path without authentication and unsupported Accept',async()=>{
    const f=fixture();await error(await f.handle(f.request('GET','/not-installed')),404,'NOT_FOUND');await error(await f.handle(f.request('POST',path,wire,{ accept:'text/html' })),406,'NOT_ACCEPTABLE');expect(f.evidence.extract).not.toHaveBeenCalled();
  });
  it('enforces URL, header bytes and header count budgets before credentials',async()=>{
    const a=fixture({ limits:{ maxUrlBytes:30 } });await error(await a.handle(a.request()),414,'INVALID_INPUT');expect(a.evidence.extract).not.toHaveBeenCalled();
    const b=fixture({ limits:{ maxHeaderBytes:40 } });await error(await b.handle(b.request()),431,'INVALID_INPUT');expect(b.evidence.extract).not.toHaveBeenCalled();
    const c=fixture({ limits:{ maxHeaderCount:1 } });await error(await c.handle(c.request()),431,'INVALID_INPUT');expect(c.evidence.extract).not.toHaveBeenCalled();
  });
  it('rejects missing, expired and revoked credentials without application access',async()=>{
    const f=fixture();await error(await f.handle(f.request('POST',path,wire,{},true)),401,'UNAUTHENTICATED');
    f.security.verifier.verify.mockResolvedValue(null);await error(await f.handle(f.request()),401,'UNAUTHENTICATED');expect(f.repository.runAtomic).not.toHaveBeenCalled();
    const expired=fixture();expired.record({ validUntilMs:now });await error(await expired.handle(expired.request()),401,'UNAUTHENTICATED');
    const revoked=fixture();revoked.security.revocation.isRevoked.mockResolvedValue(true);await error(await revoked.handle(revoked.request()),401,'UNAUTHENTICATED');
  });
  it.each(['orders:create','orders:read','orders:cancel'] as const)('rejects insufficient scope %s',async op=>{
    const f=fixture();f.record({ scopes:baseRecord.scopes.filter(s=>s!==op) });
    const req=op==='orders:create'?f.request():op==='orders:read'?f.request('GET',`${path}/Order-A`):f.request('POST',`${path}/Order-A/cancellation-requests`,'{"reason":"ORIGIN_REQUEST"}');
    await error(await f.handle(req),403,'FORBIDDEN');expect(f.repository.runAtomic).not.toHaveBeenCalled();
  });
  it('rejects foreign club and prevents body or header tenant authority',async()=>{
    const f=fixture();await error(await f.handle(f.request('POST',path,wire.replace('Club-A','Club-B'))),403,'FORBIDDEN');expect(f.repository.runAtomic).not.toHaveBeenCalled();
    const response=await f.handle(f.request('POST',path,wire,{ 'x-tenant-id':'99','x-client-id':'99','x-club':'Other' }));expect(response.status).toBe(202);
    expect(f.repository.runAtomic).toHaveBeenCalledWith(expect.objectContaining({ tenantId:1,clientId:2 }),expect.any(Function));
  });
  it('makes foreign tenant/club orders indistinguishable from missing orders',async()=>{
    const f=fixture();await f.handle(f.request());f.record({ tenantId:99 });const foreign=await f.handle(f.request('GET',`${path}/Order-A`));const absent=await f.handle(f.request('GET',`${path}/Missing`));
    expect(foreign.status).toBe(404);expect(absent.status).toBe(404);expect((await foreign.json()).code).toBe('NOT_FOUND');expect((await absent.json()).code).toBe('NOT_FOUND');
    f.record({ tenantId:1 });for(const stored of f.model.orders.values()) stored.input.originClubReference='Club-B';await error(await f.handle(f.request('GET',`${path}/Order-A`)),404,'NOT_FOUND');
  });
  it('rejects request-proof replay independently of identical order idempotency',async()=>{
    const f=fixture();const original=f.request(),copy=original.clone();expect((await f.handle(original)).status).toBe(202);await error(await f.handle(copy),409,'REPLAY_REJECTED');expect(f.model.orders.size).toBe(1);
  });
  it('rejects exhausted frequency quota without invoking application',async()=>{
    const f=fixture();f.security.counter.consume.mockResolvedValue({ allowed:false,used:100,resetAtMs:now+1000,assurance:'DISTRIBUTED_ATOMIC' });await error(await f.handle(f.request()),429,'LIMITED');expect(f.repository.runAtomic).not.toHaveBeenCalled();
  });
  it.each(['evidence','verifier','catalog','revocation','counter','replay','repository'] as const)('fails closed on dependency failure %s',async point=>{
    const f=fixture();const fault=new Error('SECRET SQL stack bearer token');
    if(point==='evidence')f.evidence.extract.mockRejectedValue(fault);else if(point==='verifier')f.security.verifier.verify.mockRejectedValue(fault);else if(point==='catalog')f.security.catalog.findByCredential.mockRejectedValue(fault);else if(point==='revocation')f.security.revocation.isRevoked.mockRejectedValue(fault);else if(point==='counter')f.security.counter.consume.mockRejectedValue(fault);else if(point==='replay')f.security.replay.claim.mockRejectedValue(fault);else vi.mocked(f.repository.runAtomic).mockRejectedValue(fault);
    const response=await f.handle(f.request());const value=await error(response,503,'UNAVAILABLE');expect(JSON.stringify(value)).not.toMatch(/SECRET|SQL|stack|bearer/);if(point!=='repository')expect(f.repository.runAtomic).not.toHaveBeenCalled();
  });
  it.each(['insert','event','audit','outbox','commit','afterCommit'] as const)('does not acknowledge model repository fault %s (simulated)',async point=>{
    const f=fixture();f.model.failAt=point;await error(await f.handle(f.request()),503,'UNAVAILABLE');
  });
  it('recovers logically from uncertain simulated commit with a fresh proof and same order',async()=>{
    const f=fixture();f.model.failAt='afterCommit';await error(await f.handle(f.request()),503,'UNAVAILABLE');expect((await f.handle(f.request())).status).toBe(202);expect(f.model.orders.size).toBe(1);
  });
  it.each([undefined,null,{ durability:'DURABLE' },{ durability:'SIMULATED',value:{} },{ durability:'UNKNOWN',value:{} }])('rejects incomplete/unexpected repository envelope %j',async value=>{
    const f=fixture();vi.mocked(f.repository.runAtomic).mockResolvedValue(value as never);await error(await f.handle(f.request()),503,'UNAVAILABLE');
  });
  it('rejects extra secrets or mismatched ids in repository projections',async()=>{
    const f=fixture();const first=await f.handle(f.request());const value=await first.json();
    for(const changed of [{ ...value,sql:'SECRET' },{ ...value,externalOrderId:'Other' },{ ...value,version:0 },{ ...value,processingStatus:'DELIVERED' },{ ...value,correlationId:'untrusted' }]) {
      vi.mocked(f.repository.runAtomic).mockResolvedValue({ durability:'DURABLE',value:changed });await error(await f.handle(f.request()),503,'UNAVAILABLE');
    }
  });
  it('rejects malformed catalog, counter and replay output',async()=>{
    const a=fixture();a.security.catalog.findByCredential.mockResolvedValue([{}]);await error(await a.handle(a.request()),401,'UNAUTHENTICATED');
    const b=fixture();b.security.counter.consume.mockResolvedValue({ allowed:true } as never);await error(await b.handle(b.request()),503,'UNAVAILABLE');
    const c=fixture();c.security.replay.claim.mockResolvedValue({ status:'OK' } as never);await error(await c.handle(c.request()),503,'UNAVAILABLE');
  });
  it('generates safe correlation ids and never reflects secrets or incoming correlation',async()=>{
    const f=fixture();const request=f.request('POST',path,'{',{ authorization:'SECRET','x-correlation-id':'attacker-value' });
    const response=await f.handle(request);await error(response,400,'INVALID_INPUT');expect(response.headers.get('x-correlation-id')).not.toBe('attacker-value');expect(response.headers.get('authorization')).toBeNull();
  });
  it('rejects forged OrderError codes without prototype lookup surprises',async()=>{
    const f=fixture();vi.mocked(f.repository.runAtomic).mockRejectedValue(new OrderError('constructor' as never));await error(await f.handle(f.request()),503,'UNAVAILABLE');
  });
  it('derives a target only from the verified catalog, not an arbitrary Principal',async()=>{
    const f=fixture();f.request();const security=createM2MSecurity(f.security,policy);const identity=await security.authenticate(new TextEncoder().encode('1'));
    expect(await security.resourceTarget(identity,'Club-A','Order-A')).toEqual({ environment:'sandbox',tenantId:1,clientId:2,integrationId:'PriceSmart',originClubReference:'Club-A',externalOrderId:'Order-A' });
    await expect(security.resourceTarget({ ...baseRecord },'Club-A','Order-A')).rejects.toThrow('DENIED');
  });
  it('rejects invalid club/id and tenant remapping during target derivation',async()=>{
    const f=fixture();f.request();const security=createM2MSecurity(f.security,policy);const identity=await security.authenticate(new TextEncoder().encode('1'));
    await expect(security.resourceTarget(identity,'Club-B','Order-A')).rejects.toThrow('DENIED');await expect(security.resourceTarget(identity,'Club-A','../Order-A')).rejects.toThrow('DENIED');
    f.record({ tenantId:9 });await expect(security.resourceTarget(identity,'Club-A','Order-A')).rejects.toThrow('DENIED');
  });
  it('waits for the repository completion promise before returning 202 (commit double)',async()=>{
    const f=fixture();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let reached=false;
    vi.mocked(f.repository.runAtomic).mockImplementation(async function<T>(scope:Scope,action:(tx:Transaction)=>Promise<T>):Promise<Committed<T>>{
      const result=await f.model.runAtomic(scope,action);reached=true;await gate;return { value:result.value,durability:'DURABLE' };
    });
    let responded=false;const response=f.handle(f.request()).then(value=>{responded=true;return value;});
    await vi.waitFor(()=>expect(reached).toBe(true));expect(responded).toBe(false);release();expect((await response).status).toBe(202);
  });
  it('times out a stalled body without invoking identity ports and cancels its reader',async()=>{
    const f=fixture({ limits:{ timeoutMs:25 } });let canceled=false;
    const stream=new ReadableStream<Uint8Array>({ cancel(){canceled=true;} });
    const req=new Request('https://example.invalid'+path,{ method:'POST',headers:{ 'content-type':'application/json' },body:stream,duplex:'half' } as RequestInit);
    await error(await f.handle(req),408,'REQUEST_TIMEOUT');expect(canceled).toBe(true);expect(f.evidence.extract).not.toHaveBeenCalled();
  });
  it('does not start catalog/application work after an authentication timeout',async()=>{
    const f=fixture({ limits:{ timeoutMs:25 } });let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let finished=false;
    f.security.verifier.verify.mockImplementation(async bytes=>{await gate;finished=true;return f.assertions.get(new TextDecoder().decode(bytes));});
    await error(await f.handle(f.request()),503,'UNAVAILABLE');release();await vi.waitFor(()=>expect(finished).toBe(true));
    expect(f.security.catalog.findByCredential).not.toHaveBeenCalled();expect(f.repository.runAtomic).not.toHaveBeenCalled();
  });
  it('returns 503 for timed-out commit promise even if a late simulated commit completes',async()=>{
    const f=fixture({ limits:{ timeoutMs:50 } });let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let finished=false;
    vi.mocked(f.repository.runAtomic).mockImplementation(async function<T>(scope:Scope,action:(tx:Transaction)=>Promise<T>):Promise<Committed<T>>{
      const result=await f.model.runAtomic(scope,action);await gate;finished=true;return { value:result.value,durability:'DURABLE' };
    });
    const response=await f.handle(f.request());await error(response,503,'UNAVAILABLE');expect(f.model.orders.size).toBe(1);release();await vi.waitFor(()=>expect(finished).toBe(true));expect(response.status).toBe(503);expect(f.repository.runAtomic).toHaveBeenCalledOnce();
  });
  it('aborts before domain work when the Request signal is canceled',async()=>{
    const f=fixture();const controller=new AbortController();const req=new Request(f.request(),{ signal:controller.signal });controller.abort();
    await error(await f.handle(req),408,'REQUEST_TIMEOUT');expect(f.repository.runAtomic).not.toHaveBeenCalled();
  });
  it('bounds chunk count including zero-byte chunks before authentication',async()=>{
    const f=fixture();const stream=new ReadableStream<Uint8Array>({start(controller){for(let n=0;n<33;n++)controller.enqueue(new Uint8Array());controller.close();}});
    const req=new Request('https://example.invalid'+path,{ method:'POST',headers:{ 'content-type':'application/json' },body:stream,duplex:'half' } as RequestInit);
    await error(await f.handle(req),413,'TOO_LARGE');expect(f.evidence.extract).not.toHaveBeenCalled();
  });
  it('sanitizes broken body streams and rejects previously consumed requests',async()=>{
    const f=fixture();const stream=new ReadableStream<Uint8Array>({start(controller){controller.error(new Error('SECRET IO'));}});
    const req=new Request('https://example.invalid'+path,{ method:'POST',headers:{ 'content-type':'application/json' },body:stream,duplex:'half' } as RequestInit);
    await error(await f.handle(req),400,'INVALID_INPUT');const used=f.request();await used.text();await error(await f.handle(used),400,'INVALID_INPUT');expect(f.evidence.extract).not.toHaveBeenCalled();
  });
  it('rejects an immutable order identity conflict without exposing payload',async()=>{
    const f=fixture();await f.handle(f.request());for(const stored of f.model.orders.values())stored.inputHash='b'.repeat(64);
    await error(await f.handle(f.request()),409,'CONFLICT');expect(f.model.orders.size).toBe(1);
  });
  it('rejects expired verified assertions at the HTTP boundary',async()=>{
    const f=fixture();const req=f.request();for(const assertion of f.assertions.values())assertion.validUntilMs=now;
    await error(await f.handle(req),401,'UNAUTHENTICATED');expect(f.repository.runAtomic).not.toHaveBeenCalled();
  });
  it('denies unknown and ambiguous integration catalogs uniformly',async()=>{
    for(const matches of [[],[baseRecord,baseRecord]]){const f=fixture();f.security.catalog.findByCredential.mockResolvedValue(matches);await error(await f.handle(f.request()),401,'UNAUTHENTICATED');expect(f.repository.runAtomic).not.toHaveBeenCalled();}
  });
  it('denies revocation after claim and before application',async()=>{
    const f=fixture();f.security.replay.claim.mockImplementation(async()=>{f.security.revocation.isRevoked.mockResolvedValue(true);return { status:'CLAIMED',assurance:'DURABLE_ATOMIC' };});
    await error(await f.handle(f.request()),403,'FORBIDDEN');expect(f.repository.runAtomic).not.toHaveBeenCalled();
  });
  it('revalidates IdentityPort after admission and denies fresh revocation before repository',async()=>{
    const f=fixture();let count=0;f.security.revocation.isRevoked.mockImplementation(async()=>count++>=5);
    await error(await f.handle(f.request()),403,'FORBIDDEN');expect(count).toBe(6);expect(f.repository.runAtomic).not.toHaveBeenCalled();
  });
  it('cancels an unread malicious body even on early header rejection',async()=>{
    const f=fixture({limits:{maxHeaderCount:1}});let canceled=false;const stream=new ReadableStream<Uint8Array>({cancel(){canceled=true;}});
    const req=new Request('https://example.invalid'+path,{method:'POST',headers:{'content-type':'application/json','x-extra':'excess'},body:stream,duplex:'half'} as RequestInit);
    await error(await f.handle(req),431,'INVALID_INPUT');expect(canceled).toBe(true);expect(f.evidence.extract).not.toHaveBeenCalled();
  });
  it('rejects a cancellation receipt with an impossible initial version',async()=>{
    const f=fixture();const first=await f.handle(f.request());const receipt=await first.json();
    vi.mocked(f.repository.runAtomic).mockResolvedValue({durability:'DURABLE',value:{...receipt,provisionalStatus:'CANCELLATION_REQUESTED',processingStatus:'PAUSED',version:1}});
    await error(await f.handle(f.request('POST',path+'/Order-A/cancellation-requests','{"reason":"ORIGIN_REQUEST"}')),503,'UNAVAILABLE');
  });
  it('checks monotonic deadline even before a delayed timer callback can run',async()=>{
    const f=fixture({limits:{timeoutMs:25}});const realNow=performance.now.bind(performance);let extra=0;
    vi.spyOn(performance,'now').mockImplementation(()=>realNow()+extra);
    f.security.verifier.verify.mockImplementation(async bytes=>{extra=1000;return f.assertions.get(new TextDecoder().decode(bytes));});
    await error(await f.handle(f.request()),503,'UNAVAILABLE');expect(f.security.catalog.findByCredential).not.toHaveBeenCalled();expect(f.repository.runAtomic).not.toHaveBeenCalled();
  });
  it('keeps Next HTTP disabled and does not import or call network/database clients',async()=>{
    vi.stubEnv('PRICESMART_ENABLED','true');expect(disabledHttpContract()).toEqual({ status:503,body:{ code:'DISABLED' } });
    for(const name of ['http-transport.ts'])expect(readFileSync(join('src/lib/integrations/pricesmart',name),'utf8')).not.toMatch(/\bfetch\s*\(|console\.|process\.env|from\s+['"](?:next|mysql2|redis|node:(?:http|https|net|tls|fs|child_process))/);
    const inspect=(dir:string)=>{for(const entry of readdirSync(dir,{ withFileTypes:true })){const file=join(dir,entry.name);if(entry.isDirectory())inspect(file);else if(/\.[jt]sx?$/.test(file))expect(readFileSync(file,'utf8')).not.toMatch(/createIsolatedHttpTransport|http-transport/);}};inspect('src/app');
    vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('NETWORK FORBIDDEN');}));const f=fixture();await f.handle(f.request());expect(fetch).not.toHaveBeenCalled();
  });
});
