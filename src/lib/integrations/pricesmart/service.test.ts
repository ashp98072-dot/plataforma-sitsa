import { describe, it, expect, vi } from 'vitest';
import { canTransition, MAX_BODY_BYTES, orderSchema, parseBody, type Principal, type Scope } from './contracts';
import type { OrderRepository, Transaction } from './ports';
import { OrderApplication } from './service';
import { ModelRepository } from './__tests__/model-repository';
import { disabledHttpContract } from './transport';
const input = { schemaVersion: 'api01-draft-1', externalOrderId: 'QA-ORDER-01', originClubReference: 'QA-CLUB' };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const principal: Principal = { integrationId: 'qa-integration', tenantId: 1, clientId: 1, environment: 'sandbox', originClubReference: 'QA-CLUB', scopes: ['orders:create','orders:read','orders:cancel'] };
function setup(p: unknown = principal, repo = new ModelRepository()) {
  const identity = { resolve: vi.fn(async () => structuredClone(p)) };
  return { app: new OrderApplication(identity, repo), repo, identity };
}
describe('API-01 application with SIMULATED repository (not MariaDB acceptance)', () => {
  it('receives minimal DTO, projects safe fields and reports SIMULATED only', async () => {
    const { app, repo } = setup(); const result = await app.receive(bytes(input));
    expect(result.durability).toBe('SIMULATED'); expect(result.value.provisionalStatus).toBe('RECEIVED');
    expect(repo.orders.size).toBe(1); expect(repo.events).toHaveLength(1); expect(repo.outbox).toHaveLength(1); expect(repo.audits).toHaveLength(1);
    expect(Object.keys(result.value).sort()).toEqual(['externalOrderId','provisionalStatus','processingStatus','version','correlationId'].sort());
  });
  it.each([{}, { ...input, schemaVersion: 'approved' }, { ...input, empresa_id: 999 }, { ...input, externalOrderId: '' }, { ...input, externalOrderId: '../x' }, { ...input, externalOrderId: 'á' }, { ...input, originClubReference: 'x'.repeat(65) }, { ...input, password: 'synthetic' }, []])('rejects invalid payload %# before repository', async value => {
    const { app, repo } = setup(); await expect(app.receive(bytes(value))).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(repo.calls).toBe(0);
  });
  it('checks mandatory fields, exact bounds and byte limit', () => {
    for (const key of Object.keys(input)) { const v = { ...input } as Record<string, string>; delete v[key]; expect(() => parseBody(bytes(v), orderSchema)).toThrow(); }
    expect(parseBody(bytes({ ...input, externalOrderId: 'x'.repeat(120), originClubReference: 'x'.repeat(64) }), orderSchema)).toBeTruthy();
    expect(() => parseBody(bytes({ ...input, externalOrderId: 'x'.repeat(121) }), orderSchema)).toThrow();
    const valid = new TextDecoder().decode(bytes(input)); expect(parseBody(new TextEncoder().encode(valid.padEnd(MAX_BODY_BYTES)), orderSchema)).toEqual(input);
    expect(() => parseBody(new Uint8Array(MAX_BODY_BYTES + 1), orderSchema)).toThrow('TOO_LARGE');
  });
  it.each(['{', '{"schemaVersion":"api01-draft-1","externalOrderId":"a","externalOrderId":"b","originClubReference":"QA-CLUB"}', '{"schemaVersion":"api01-draft-1","externalOrderId":"a","externalOrder\\u0049d":"a","originClubReference":"QA-CLUB"}'])('rejects malformed/duplicate JSON %#', raw => {
    expect(() => parseBody(new TextEncoder().encode(raw), orderSchema)).toThrow('INVALID_INPUT');
  });
  it('rejects invalid UTF8', () => expect(() => parseBody(new Uint8Array([0xff]), orderSchema)).toThrow('INVALID_INPUT'));
  it('replays same content with reordered JSON without extra order/event/outbox', async () => {
    const { app, repo } = setup(); const a = await app.receive(bytes(input)); const b = await app.receive(bytes({ originClubReference: input.originClubReference, externalOrderId: input.externalOrderId, schemaVersion: input.schemaVersion }));
    expect(b).toEqual(a); expect(repo.orders.size).toBe(1); expect(repo.events).toHaveLength(1); expect(repo.outbox).toHaveLength(1); expect(repo.audits.at(-1)?.operation).toBe('REPLAY');
  });
  it('conflicts if same stable account ID changes club/content', async () => {
    const repo = new ModelRepository(); await setup(principal, repo).app.receive(bytes(input));
    await expect(setup({ ...principal, originClubReference: 'QA-OTHER' }, repo).app.receive(bytes({ ...input, originClubReference: 'QA-OTHER' }))).rejects.toMatchObject({ code: 'CONFLICT' }); expect(repo.orders.size).toBe(1);
  });
  it('models two concurrent creates and two concurrent cancellations', async () => {
    const { app, repo } = setup(); const [a,b] = await Promise.all([app.receive(bytes(input)),app.receive(bytes(input))]); expect(a).toEqual(b); expect(repo.orders.size).toBe(1);
    const [c,d] = await Promise.all([app.requestCancellation(input.externalOrderId,bytes({reason:'ORIGIN_REQUEST'})),app.requestCancellation(input.externalOrderId,bytes({reason:'ORIGIN_REQUEST'}))]);
    expect(c).toEqual(d); expect(repo.events).toHaveLength(2); expect(repo.outbox).toHaveLength(2);
  });
  it('models conflicting concurrent contents without a second order', async () => {
    const repo = new ModelRepository();
    const results = await Promise.allSettled([setup(principal,repo).app.receive(bytes(input)), setup({...principal,originClubReference:'QA-OTHER'},repo).app.receive(bytes({...input,originClubReference:'QA-OTHER'}))]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(x=>x.status==='rejected').map(x=>x.status==='rejected' ? x.reason.code : null)).toEqual(['CONFLICT']);
    expect(repo.orders.size).toBe(1); expect(repo.events).toHaveLength(1);
  });
  it('does not resolve receive until repository commit promise resolves', async () => {
    const model = new ModelRepository(); let release!: ()=>void; let entered!: ()=>void;
    const gate = new Promise<void>(resolve=>{release=resolve;}); const started = new Promise<void>(resolve=>{entered=resolve;});
    const repo: OrderRepository = { runAtomic: async <T>(scope: Scope, action: (tx:Transaction)=>Promise<T>) => {
      const result = await model.runAtomic(scope,action); entered(); await gate; return result;
    } };
    const app = new OrderApplication({resolve:async()=>principal},repo); let replied=false;
    const pending=app.receive(bytes(input)).then(result=>{replied=true;return result;}); await started; expect(replied).toBe(false); release(); expect((await pending).durability).toBe('SIMULATED');
  });
  it('isolates same external ID by tenant and client', async () => {
    const repo = new ModelRepository(); for (const p of [principal, { ...principal, tenantId: 2 }, { ...principal, clientId: 2 }]) await setup(p, repo).app.receive(bytes(input)); expect(repo.orders.size).toBe(3);
    expect((await setup({ ...principal, tenantId: 2 },repo).app.get(input.externalOrderId)).value.externalOrderId).toBe(input.externalOrderId);
  });
  it('keeps IDs case sensitive and stable integration identity independent of credential rotation', async () => {
    const { app, repo } = setup(); await app.receive(bytes(input)); await app.receive(bytes({ ...input, externalOrderId: input.externalOrderId.toLowerCase() })); expect(repo.orders.size).toBe(2);
    expect((await setup(principal,repo).app.receive(bytes(input))).value).toEqual((await app.receive(bytes(input))).value);
  });
  it.each([null, { ...principal, tenantId: -1 }, { ...principal, environment: 'production' }])('rejects absent/invalid authenticated identity %#', async p => {
    const { app, repo } = setup(p); await expect(app.receive(bytes(input))).rejects.toMatchObject({ code:'UNAUTHENTICATED' }); expect(repo.calls).toBe(0);
  });
  it('requires operation scope and trusted club before repository', async () => {
    const noScope = setup({ ...principal, scopes:[] }); await expect(noScope.app.receive(bytes(input))).rejects.toMatchObject({code:'FORBIDDEN'}); expect(noScope.repo.calls).toBe(0);
    const { app,repo }=setup(); await expect(app.receive(bytes({...input,originClubReference:'QA-OTHER'}))).rejects.toMatchObject({code:'FORBIDDEN'}); expect(repo.calls).toBe(0);
  });
  it('does not read/cancel another tenant or club; unknown is same NOT_FOUND', async () => {
    const repo = new ModelRepository(); await setup(principal,repo).app.receive(bytes(input));
    for (const p of [{...principal,tenantId:2},{...principal,originClubReference:'QA-OTHER'}]) {
      const app=setup(p,repo).app; await expect(app.get(input.externalOrderId)).rejects.toMatchObject({code:'NOT_FOUND'});
      await expect(app.requestCancellation(input.externalOrderId,bytes({reason:'ORIGIN_REQUEST'}))).rejects.toMatchObject({code:'NOT_FOUND'});
    }
    await expect(setup(principal,repo).app.get('missing')).rejects.toMatchObject({code:'NOT_FOUND'});
  });
  it('cancellation is idempotent and does not reactivate original creation receipt', async () => {
    const { app,repo }=setup(); const original=await app.receive(bytes(input)); const cancelled=await app.requestCancellation(input.externalOrderId,bytes({reason:'ORIGIN_REQUEST'}));
    expect(cancelled.value.provisionalStatus).toBe('CANCELLATION_REQUESTED'); expect((await app.requestCancellation(input.externalOrderId,bytes({reason:'ORIGIN_REQUEST'})))).toEqual(cancelled);
    await expect(app.requestCancellation(input.externalOrderId,bytes({reason:'DUPLICATE'}))).rejects.toMatchObject({code:'CONFLICT'});
    expect(await app.receive(bytes(input))).toEqual(original); expect((await app.get(input.externalOrderId)).value.provisionalStatus).toBe('CANCELLATION_REQUESTED'); expect(repo.events).toHaveLength(2);
  });
  it('rejects cancellation of unknown, invalid body, linked and terminal orders', async () => {
    const { app,repo }=setup(); await expect(app.requestCancellation('missing',bytes({reason:'ORIGIN_REQUEST'}))).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(app.requestCancellation('missing',bytes({reason:'unknown'}))).rejects.toMatchObject({code:'INVALID_INPUT'});
    await app.receive(bytes(input)); const row=[...repo.orders.values()][0]; row.tmsLinked=true; await expect(app.requestCancellation(input.externalOrderId,bytes({reason:'ORIGIN_REQUEST'}))).rejects.toMatchObject({code:'CONFLICT'});
    const terminal=[...repo.orders.values()][0]; terminal.tmsLinked=false; terminal.state='CANCELLED'; await expect(app.requestCancellation(input.externalOrderId,bytes({reason:'ORIGIN_REQUEST'}))).rejects.toMatchObject({code:'CONFLICT'});
  });
  it.each(['insert','event','audit','outbox','commit'] as const)('rolls back model failure at %s and sanitizes error', async point => {
    const { app,repo }=setup(); repo.failAt=point;
    await expect(app.receive(bytes(input))).rejects.toMatchObject({code:'UNAVAILABLE',message:'UNAVAILABLE'}); expect(repo.orders.size).toBe(0); expect(repo.events).toHaveLength(0); expect(repo.outbox).toHaveLength(0); expect(repo.audits).toHaveLength(0);
    await app.receive(bytes(input)); expect(repo.orders.size).toBe(1);
  });
  it('models unknown commit outcome: no successful reply, retry finds one order', async () => {
    const { app,repo }=setup(); repo.failAt='afterCommit'; await expect(app.receive(bytes(input))).rejects.toMatchObject({code:'UNAVAILABLE'}); expect(repo.orders.size).toBe(1); await app.receive(bytes(input)); expect(repo.orders.size).toBe(1); expect(repo.events).toHaveLength(1);
  });
  it('rolls back cancellation audit failure', async () => {
    const { app,repo }=setup(); await app.receive(bytes(input)); repo.failAt='audit'; await expect(app.requestCancellation(input.externalOrderId,bytes({reason:'ORIGIN_REQUEST'}))).rejects.toMatchObject({code:'UNAVAILABLE'}); expect((await app.get(input.externalOrderId)).value.version).toBe(1);
  });
  it('refetches identity for revocation and sanitizes identity failures', async () => {
    const { app,identity }=setup(); await app.receive(bytes(input)); identity.resolve.mockResolvedValue(null); await expect(app.get(input.externalOrderId)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
    identity.resolve.mockRejectedValue(new Error('SECRET')); await expect(app.get(input.externalOrderId)).rejects.toMatchObject({code:'UNAVAILABLE',message:'UNAVAILABLE'});
  });
  it('enumerates allowed transitions without assuming TMS/provider states', () => {
    expect(canTransition('RECEIVED','CANCELLATION_REQUESTED')).toBe(true); expect(canTransition('CANCELLATION_REQUESTED','CANCELLED')).toBe(true); expect(canTransition('CANCELLED','RECEIVED')).toBe(false); expect(canTransition('RECEIVED','CANCELLED')).toBe(false);
  });
  it('HTTP remains unconditionally disabled, including activation-looking environment', () => {
    vi.stubEnv('PRICESMART_ENABLED','true'); expect(disabledHttpContract()).toEqual({status:503,body:{code:'DISABLED'}});
  });
});
