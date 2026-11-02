import { readFileSync } from 'node:fs';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { createTmsAdaptation,candidateFromSnapshot,provisionalDeliveryState } from './tms-adaptation';
import { AdaptationError,type AdaptationScope,type SourceSnapshot,type AdaptationCommand,type LogisticsObservation } from './tms-adaptation-contracts';
import { AdaptationModel } from './__tests__/tms-adaptation-model';
const id='11111111-1111-4111-8111-111111111111',correlation='22222222-2222-4222-8222-222222222222';
const now=1_800_000_000_000;
const scope:AdaptationScope={environment:'sandbox',tenantId:1,clientId:2,integrationId:'PriceSmart',originClubReference:'Club-A'};
const source:SourceSnapshot={scope,orderId:id,input:{schemaVersion:'api01-draft-1',externalOrderId:'Order-A',originClubReference:'Club-A'},state:'RECEIVED',version:1,correlationId:correlation,receivedAt:new Date(now).toISOString(),cancellationReason:null,assurance:'SIMULATED'};
const received:AdaptationCommand={kind:'RECEIVE',orderId:id,sourceVersion:1,correlationId:correlation};
const observation=(change:Partial<LogisticsObservation>={}):LogisticsObservation=>({synthetic:true,kind:'PLAN',state:'En ruta',requestReference:'qa-request',occurredAt:new Date(now).toISOString(),evidenceReference:null,attemptReference:null,sharedJourney:false,...change});
const observed=(change:Partial<Extract<AdaptationCommand,{kind:'OBSERVE'}>>={}):AdaptationCommand=>({kind:'OBSERVE',orderId:id,sourceVersion:1,correlationId:correlation,eventId:'observation-1',expectedLinkVersion:1,observation:observation(),...change});
function fixture(){
  let time=now;let snapshot=structuredClone(source);const repository=new AdaptationModel();
  const reader={load:vi.fn(async(context:AdaptationScope):Promise<unknown|null>=>{void context;return structuredClone(snapshot);})};
  const resolver={resolve:vi.fn(async(candidate:ReturnType<typeof candidateFromSnapshot>):Promise<unknown>=>({scope:candidate.scope,candidateId:candidate.candidateId,orderId:candidate.orderId,requestReference:'qa-request',assurance:'SIMULATED'}))};
  const adapter=createTmsAdaptation({source:reader,resolver,repository,nowMs:()=>time},1000);
  return {adapter,reader,resolver,repository,advance:(ms:number)=>{time+=ms;},source:(change:Partial<SourceSnapshot>)=>{snapshot={...snapshot,...change};}};
}
afterEach(()=>vi.restoreAllMocks());
describe('API-05 adaptation logic with SIMULATED repository/resolver only',()=>{
  it('builds a stable non-materializable candidate without invented commercial data or actor',()=>{
    const candidate=candidateFromSnapshot(source);expect(candidate).toEqual(candidateFromSnapshot(structuredClone(source)));
    expect(candidate).toMatchObject({commercialData:null,requestedDate:null,tmsActor:null,materializable:false,readiness:'CONTRACT_PENDING',externalOrderId:'Order-A'});
    expect(candidate.candidateId).not.toBe(id);expect(Object.keys(candidate)).not.toContain('recipient');expect(Object.keys(candidate)).not.toContain('stops');
  });
  it('resolves exactly one fictitious request reference, never a real TMS id',async()=>{
    const f=fixture();const result=await f.adapter.process(scope,received);expect(result.assurance).toBe('SIMULATED');expect(result.value).toMatchObject({requestReference:'qa-request',tmsRequestId:null,externalPriceSmartStatus:null,version:1,localDeliveryState:'LOGISTICS_REVIEW'});
    expect(f.repository.traces.map(t=>t.phase)).toEqual(['STARTED','SUCCEEDED']);
  });
  it('replays the immutable result after a new attempt correlation without invoking resolver again',async()=>{
    const f=fixture();const first=await f.adapter.process(scope,received);const second=await f.adapter.process(scope,{...received,correlationId:id});expect(second.replayed).toBe(true);expect(second.value).toEqual(first.value);expect(f.resolver.resolve).toHaveBeenCalledOnce();expect(f.repository.links.size).toBe(1);
  });
  it('records logistics changes and returns a separate scoped projection',async()=>{
    const f=fixture();await f.adapter.process(scope,received);const changed=await f.adapter.process(scope,observed());expect(changed.value.version).toBe(2);expect(changed.value.localDeliveryState).toBe('IN_PROGRESS_UNCONFIRMED');expect((await f.adapter.get(scope,id)).value).toEqual(changed.value);expect(changed.value.sourceState).toBe('RECEIVED');
  });
  it.each([{tenantId:99},{clientId:99},{integrationId:'Other'},{originClubReference:'Other'},{originClubReference:'club-a'}])('denies foreign scope %j for read and processing',async change=>{
    const f=fixture();await f.adapter.process(scope,received);await expect(f.adapter.get({...scope,...change},id)).rejects.toThrow('NOT_FOUND');await expect(f.adapter.process({...scope,...change},received)).rejects.toThrow('NOT_FOUND');expect(f.repository.links.size).toBe(1);
  });
  it('rejects wrong environment and fabricated/incomplete commands before writes',async()=>{
    const f=fixture();await expect(f.adapter.process({...scope,environment:'production'} as never,received)).rejects.toThrow('INVALID_INPUT');await expect(f.adapter.process(scope,{kind:'RECEIVE'} as never)).rejects.toThrow('INVALID_INPUT');expect(f.repository.calls).toBe(0);
  });
  it('rejects unknown/malformed/foreign source snapshots without disclosing them',async()=>{
    for(const value of [null,{}, {...source,scope:{...scope,tenantId:9}},{...source,input:{...source.input,originClubReference:'Other'}},{...source,assurance:'DURABLE'}]){const f=fixture();f.reader.load.mockResolvedValue(value);await expect(f.adapter.process(scope,received)).rejects.toThrow('NOT_FOUND');expect(f.resolver.resolve).not.toHaveBeenCalled();}
  });
  it('keeps identifiers case-sensitive and separates client namespaces for the same external id',()=>{
    expect(candidateFromSnapshot({...source,input:{...source.input,externalOrderId:'order-a'}}).externalOrderId).toBe('order-a');
    expect(candidateFromSnapshot({...source,scope:{...scope,clientId:9}}).candidateId).not.toBe(candidateFromSnapshot(source).candidateId);
  });
  it.each([{scope:{...scope,tenantId:9}},{scope:{...scope,clientId:9}},{scope:{...scope,originClubReference:'Other'}},{candidateId:'other'},{orderId:correlation},{assurance:'DURABLE'},{}])('rejects foreign or malformed candidate resolution %j and preserves retry job',async change=>{
    const f=fixture();f.resolver.resolve.mockImplementation(async c=>Object.keys(change).length?{scope:c.scope,candidateId:c.candidateId,orderId:c.orderId,requestReference:'qa-request',assurance:'SIMULATED',...change}:{});
    await expect(f.adapter.process(scope,received)).rejects.toThrow('UNAVAILABLE');expect([...f.repository.jobs.values()][0].status).toBe('RETRYABLE');expect(f.repository.links.size).toBe(0);expect(f.repository.traces.at(-1)?.failure).toBe('DEPENDENCY_FAILURE');
  });
  it('retains a failed attempt and retries in independent atomic units',async()=>{
    const f=fixture();f.resolver.resolve.mockRejectedValueOnce(new Error('SECRET SQL'));await expect(f.adapter.process(scope,received)).rejects.toEqual(new AdaptationError('UNAVAILABLE'));
    const retry=await f.adapter.process(scope,received);expect(retry.value.version).toBe(1);expect([...f.repository.jobs.values()][0].attempt).toBe(2);expect(f.repository.traces.map(t=>t.phase)).toEqual(['STARTED','FAILED','STARTED','SUCCEEDED']);expect(JSON.stringify(f.repository.traces)).not.toContain('SECRET');
  });
  it.each(['link','trace','job','commit'] as const)('rolls back final %s fault and retains retryable work',async point=>{
    const f=fixture();f.repository.failAt=point;f.repository.failTransaction=2;await expect(f.adapter.process(scope,received)).rejects.toThrow('UNAVAILABLE');expect(f.repository.links.size).toBe(0);expect([...f.repository.jobs.values()][0].status).toBe('RETRYABLE');
    await f.adapter.process(scope,received);expect(f.repository.links.size).toBe(1);expect([...f.repository.jobs.values()][0].attempt).toBe(2);
  });
  it('does not lose work when claim/audit fails before resolution',async()=>{
    const f=fixture();f.repository.failAt='trace';f.repository.failTransaction=1;await expect(f.adapter.process(scope,received)).rejects.toThrow('UNAVAILABLE');expect(f.repository.jobs.size).toBe(0);expect(f.resolver.resolve).not.toHaveBeenCalled();await f.adapter.process(scope,received);expect(f.repository.links.size).toBe(1);
  });
  it('recovers an abandoned lease if failure journaling also fails (simulated, not crash recovery)',async()=>{
    const f=fixture();f.resolver.resolve.mockRejectedValueOnce(new Error('SECRET'));f.repository.failAt='commit';f.repository.failTransaction=2;
    await expect(f.adapter.process(scope,received)).rejects.toThrow('UNAVAILABLE');expect([...f.repository.jobs.values()][0].status).toBe('PROCESSING');
    await expect(f.adapter.process(scope,received)).rejects.toThrow('CONFLICT');f.advance(1001);await f.adapter.process(scope,received);expect(f.repository.links.size).toBe(1);expect(f.repository.traces.map(t=>t.phase)).toContain('LEASE_RECLAIMED');
  });
  it('rejects a concurrent active claim instead of resolving twice',async()=>{
    const f=fixture();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});f.resolver.resolve.mockImplementationOnce(async c=>{await gate;return {scope:c.scope,candidateId:c.candidateId,orderId:c.orderId,requestReference:'qa-request',assurance:'SIMULATED'};});
    const first=f.adapter.process(scope,received);await vi.waitFor(()=>expect(f.resolver.resolve).toHaveBeenCalledOnce());await expect(f.adapter.process(scope,received)).rejects.toThrow('CONFLICT');release();await first;expect(f.repository.links.size).toBe(1);
  });
  it('fences a stale resolver after lease reclamation without overwriting the winner',async()=>{
    const f=fixture();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});f.resolver.resolve.mockImplementationOnce(async c=>{await gate;return {scope:c.scope,candidateId:c.candidateId,orderId:c.orderId,requestReference:'qa-stale',assurance:'SIMULATED'};});
    const first=f.adapter.process(scope,received);const rejection=expect(first).rejects.toThrow('CONFLICT');await vi.waitFor(()=>expect(f.resolver.resolve).toHaveBeenCalledOnce());f.advance(1001);await f.adapter.process(scope,received);release();await rejection;expect((await f.adapter.get(scope,id)).value.requestReference).toBe('qa-request');expect(f.repository.links.size).toBe(1);
  });
  it('rejects duplicate event id with different content and stale CAS without changing link',async()=>{
    const f=fixture();await f.adapter.process(scope,received);await f.adapter.process(scope,observed());await expect(f.adapter.process(scope,observed({observation:observation({state:'Cerrado'})}))).rejects.toThrow('CONFLICT');
    await expect(f.adapter.process(scope,observed({eventId:'next',expectedLinkVersion:1}))).rejects.toThrow('CONFLICT');expect((await f.adapter.get(scope,id)).value.version).toBe(2);
  });
  it('denies foreign synthetic request reference without changing logistics state',async()=>{
    const f=fixture();await f.adapter.process(scope,received);await expect(f.adapter.process(scope,observed({observation:observation({requestReference:'foreign'})}))).rejects.toThrow('NOT_FOUND');expect((await f.adapter.get(scope,id)).value.version).toBe(1);
  });
  it.each([
    ['REQUEST','SOLICITADA','LOGISTICS_REVIEW'],['REQUEST','EN_REVISION','LOGISTICS_REVIEW'],['REQUEST','PROGRAMADA','SCHEDULED_UNCONFIRMED'],['REQUEST','RECHAZADA','REVIEW_REQUIRED'],['REQUEST','CANCELADA','REVIEW_REQUIRED'],
    ['PLAN','Programado','SCHEDULED_UNCONFIRMED'],['PLAN','Cargado','SCHEDULED_UNCONFIRMED'],['PLAN','En ruta','IN_PROGRESS_UNCONFIRMED'],['PLAN','Descargado','DELIVERY_UNCONFIRMED'],['PLAN','Cerrado','DELIVERY_UNCONFIRMED'],['PLAN','Cancelado','REVIEW_REQUIRED'],
  ])('maps %s %s conservatively to %s, never contractual delivery', (kind,state,expected)=>{expect(provisionalDeliveryState(observation({kind:kind as LogisticsObservation['kind'],state:state as LogisticsObservation['state']}))).toBe(expected);});
  it('treats evidence, partial and multiple attempts as unconfirmed/review, not delivered',async()=>{
    const f=fixture();await f.adapter.process(scope,received);let version=1;
    for(const item of [observation({kind:'EVIDENCE',state:'UNCONFIRMED',evidenceReference:'qa-evidence'}),observation({kind:'ATTEMPT',state:'PARTIAL_UNCONFIRMED',attemptReference:'attempt-1'}),observation({kind:'ATTEMPT',state:'FAILED',attemptReference:'attempt-2'})]){await f.adapter.process(scope,observed({eventId:'event-'+version,expectedLinkVersion:version++,observation:item}));}
    const link=(await f.adapter.get(scope,id)).value;expect(link.externalPriceSmartStatus).toBeNull();expect(link.localDeliveryState).toBe('REVIEW_REQUIRED');expect(f.repository.traces.filter(t=>t.observation!==null)).toHaveLength(3);
  });
  it('retains review for shared journeys and reprogramming, even after another state',async()=>{
    const f=fixture();await f.adapter.process(scope,received);await f.adapter.process(scope,observed({observation:observation({sharedJourney:true})}));
    await f.adapter.process(scope,observed({eventId:'reschedule',expectedLinkVersion:2,observation:observation({kind:'RESCHEDULE',state:'UNCONFIRMED'})}));
    await f.adapter.process(scope,observed({eventId:'later',expectedLinkVersion:3}));expect((await f.adapter.get(scope,id)).value.localDeliveryState).toBe('REVIEW_REQUIRED');
  });
  it('marks late observations for review and rejects unknown/unconfirmed states',async()=>{
    const f=fixture();await f.adapter.process(scope,received);await f.adapter.process(scope,observed());await f.adapter.process(scope,observed({eventId:'late',expectedLinkVersion:2,observation:observation({occurredAt:new Date(now-1000).toISOString(),state:'Programado'})}));
    expect((await f.adapter.get(scope,id)).value.localDeliveryState).toBe('REVIEW_REQUIRED');await expect(f.adapter.process(scope,observed({eventId:'invalid',observation:observation({state:'DELIVERED' as never})}))).rejects.toThrow('INVALID_INPUT');
  });
  it('freezes cancellation without marking it completed or modifying a shared trip',async()=>{
    const f=fixture();await f.adapter.process(scope,received);await f.adapter.process(scope,observed({observation:observation({sharedJourney:true})}));f.source({state:'CANCELLATION_REQUESTED',version:2,cancellationReason:'ORIGIN_REQUEST'});
    const cancel:AdaptationCommand={kind:'CANCEL',orderId:id,sourceVersion:2,correlationId:id,reason:'ORIGIN_REQUEST'};const result=await f.adapter.process(scope,cancel);
    expect(result.value.localDeliveryState).toBe('CANCELLATION_REVIEW');expect(result.value.externalPriceSmartStatus).toBeNull();expect(result.value.sourceState).toBe('CANCELLATION_REQUESTED');expect((await f.adapter.process(scope,cancel)).replayed).toBe(true);
    await expect(f.adapter.process(scope,{...cancel,reason:'DUPLICATE'})).rejects.toThrow('CONFLICT');
  });
  it('reflects source cancellation on read before the adaptation cancellation event runs',async()=>{
    const f=fixture();await f.adapter.process(scope,received);f.source({state:'CANCELLATION_REQUESTED',version:2,cancellationReason:'ORIGIN_REQUEST'});expect((await f.adapter.get(scope,id)).value.localDeliveryState).toBe('CANCELLATION_REVIEW');
  });
  it('does not resurrect a candidate when cancellation arrives during resolution',async()=>{
    const f=fixture();f.resolver.resolve.mockImplementationOnce(async c=>{f.source({state:'CANCELLATION_REQUESTED',version:2,cancellationReason:'ORIGIN_REQUEST'});return {scope:c.scope,candidateId:c.candidateId,orderId:c.orderId,requestReference:'qa-request',assurance:'SIMULATED'};});
    const result=await f.adapter.process(scope,received);expect(result.value.requestReference).toBeNull();expect(result.value.localDeliveryState).toBe('CANCELLATION_REVIEW');
  });
  it('holds an early cancellation and refuses to resolve a later received event',async()=>{
    const f=fixture();f.source({state:'CANCELLATION_REQUESTED',version:2,cancellationReason:'ORIGIN_REQUEST'});await f.adapter.process(scope,{kind:'CANCEL',orderId:id,sourceVersion:2,correlationId:correlation,reason:'ORIGIN_REQUEST'});await f.adapter.process(scope,received);expect(f.resolver.resolve).not.toHaveBeenCalled();expect((await f.adapter.get(scope,id)).value.requestReference).toBeNull();
  });
  it('fails closed on source-store failure without consuming or losing a source event',async()=>{
    const f=fixture();f.reader.load.mockRejectedValueOnce(new Error('SECRET SOURCE SQL'));await expect(f.adapter.process(scope,received)).rejects.toEqual(new AdaptationError('UNAVAILABLE'));expect(f.repository.jobs.size).toBe(0);await f.adapter.process(scope,received);expect(f.repository.links.size).toBe(1);
  });
  it('rejects malformed or mismatched job records before resolving an order',async()=>{
    const f=fixture();await f.adapter.process(scope,received);const [key,job]=[...f.repository.jobs.entries()][0];
    f.repository.jobs.set(key,{...job,orderId:correlation});await expect(f.adapter.process(scope,received)).rejects.toThrow('UNAVAILABLE');f.repository.jobs.set(key,{...job,version:NaN});await expect(f.adapter.process(scope,received)).rejects.toThrow('UNAVAILABLE');expect(f.resolver.resolve).toHaveBeenCalledOnce();
  });
  it('retains an out-of-order observation for manual retry after its candidate exists',async()=>{
    const f=fixture();await expect(f.adapter.process(scope,observed())).rejects.toThrow('CONFLICT');expect([...f.repository.jobs.values()][0].status).toBe('REVIEW_REQUIRED');
    await f.adapter.process(scope,received);await f.adapter.process(scope,observed());expect((await f.adapter.get(scope,id)).value.localDeliveryState).toBe('IN_PROGRESS_UNCONFIRMED');
  });
  it('rejects a fictitious request-reference collision across orders instead of assuming shared fulfillment',async()=>{
    const f=fixture();await f.adapter.process(scope,received);f.source({orderId:correlation,input:{...source.input,externalOrderId:'Order-B'}});
    await expect(f.adapter.process(scope,{...received,orderId:correlation})).rejects.toThrow('CONFLICT');expect(f.repository.links.size).toBe(1);expect([...f.repository.jobs.values()].some(job=>job.status==='REVIEW_REQUIRED')).toBe(true);
  });
  it('refuses to journal a failure against a corrupted job belonging to another order',async()=>{
    const f=fixture();f.resolver.resolve.mockImplementationOnce(async()=>{const [key,job]=[...f.repository.jobs.entries()][0];f.repository.jobs.set(key,{...job,orderId:correlation});throw new Error('SECRET');});
    await expect(f.adapter.process(scope,received)).rejects.toThrow('UNAVAILABLE');expect(f.repository.traces.map(trace=>trace.phase)).toEqual(['STARTED']);expect([...f.repository.jobs.values()][0].status).toBe('PROCESSING');
  });
  it('does not let a source port mutate the authorized scope into another tenant',async()=>{
    const f=fixture();f.reader.load.mockImplementation(async context=>{context.tenantId=99;return {...source,scope:context};});
    await expect(f.adapter.process(scope,received)).rejects.toThrow('NOT_FOUND');expect(scope.tenantId).toBe(1);expect(f.repository.links.size).toBe(0);
  });
  it('does not let resolver input mutation redefine the expected candidate identity',async()=>{
    const f=fixture();f.resolver.resolve.mockImplementation(async candidate=>{candidate.candidateId='mutated';return {scope:candidate.scope,candidateId:candidate.candidateId,orderId:candidate.orderId,requestReference:'qa-request',assurance:'SIMULATED'};});
    await expect(f.adapter.process(scope,received)).rejects.toThrow('UNAVAILABLE');expect(f.repository.links.size).toBe(0);
  });
  it('has no live TMS/DB/network dependency, worker or timer',()=>{
    for(const name of ['tms-adaptation.ts','tms-adaptation-contracts.ts']){const text=readFileSync('src/lib/integrations/pricesmart/'+name,'utf8');expect(text).not.toMatch(/from\s+['"](?:mysql2|next|@\/lib\/(?:db|tms|flota)|node:(?:http|https|net|tls|fs|child_process))|\bfetch\s*\(|setInterval\s*\(|setTimeout\s*\(|console\.|process\.env/);}
  });
});
