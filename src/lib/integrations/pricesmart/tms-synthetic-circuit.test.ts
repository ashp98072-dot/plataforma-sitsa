import { describe,expect,it,vi } from 'vitest';
import { createIsolatedHttpTransport,PROVISIONAL_ORDERS_PATH as path } from './http-transport';
import { requestBindingDigest } from './m2m-security';
import { OrderApplication } from './service';
import { ModelRepository } from './__tests__/model-repository';
import { AdaptationModel } from './__tests__/tms-adaptation-model';
import { createTmsAdaptation } from './tms-adaptation';
import type { Event } from './ports';
import type { VerifiedAssertion,IntegrationRecord,ResourceTarget } from './security-contracts';
import type { AdaptationScope,AdaptationCommand,LogisticsCandidate,LogisticsObservation } from './tms-adaptation-contracts';

// ALL SIMULATED. Native Request/Response only, no listener, SQL, real identity or TMS.
// Security doubles declare attestations to exercise the API-04 domain branch;
// persistence is the UNMODIFIED ModelRepository and ALWAYS returns SIMULATED.
// Every valid receipt/read/cancellation therefore stays HTTP 503, NEVER 2xx.
const scope:AdaptationScope={environment:'sandbox',tenantId:1,clientId:2,integrationId:'PriceSmart',originClubReference:'Club-A'};
const now=1_800_000_000_000;
const input={schemaVersion:'api01-draft-1',externalOrderId:'Order-A',originClubReference:'Club-A'};
function fixture(){
  const orders=new ModelRepository(),journal=new AdaptationModel();const assertions=new Map<string,VerifiedAssertion>();let sequence=0;
  let record:IntegrationRecord={environment:scope.environment,tenantId:scope.tenantId,clientId:scope.clientId,integrationId:scope.integrationId,issuer:'qa-issuer',subject:'qa-subject',credentialReference:'qa-reference',revision:1,status:'ACTIVE',validFromMs:now-10000,validUntilMs:now+10000,credentialValidFromMs:now-10000,credentialValidUntilMs:now+10000,rotatedAtMs:now-10000,allowedClubs:['Club-A'],scopes:['orders:create','orders:read','orders:cancel']};
  const security={verifier:{verify:async(evidence:Uint8Array)=>assertions.get(new TextDecoder().decode(evidence))??null},
    catalog:{findByCredential:async()=>[record]},revocation:{isRevoked:async()=>false},clock:{nowMs:()=>now},
    counter:{consume:vi.fn(async()=>({allowed:true,used:1,resetAtMs:now+1000,assurance:'DISTRIBUTED_ATOMIC' as 'DISTRIBUTED_ATOMIC'|'SIMULATED'}))},
    replay:{claim:async()=>({status:'CLAIMED' as const,assurance:'DURABLE_ATOMIC' as const})}};
  const http=createIsolatedHttpTransport({evidence:{extract:async metadata=>{const id=metadata.headers.find(([key])=>key==='x-fixture-id')?.[1];return id?new TextEncoder().encode(id):null;}},security,repository:orders},
    {maxEvidenceBytes:1024,maxBodyBytes:1024,requestsPerWindow:100,windowMs:1000,maxProofAgeMs:5000,futureSkewMs:100,replayRetentionMs:5100},
    {originClubReference:'Club-A',timeoutMs:2000,maxHeaderBytes:4096,maxHeaderCount:20,maxUrlBytes:512,maxBodyChunks:32});
  const resolver={resolve:vi.fn(async(c:LogisticsCandidate):Promise<unknown>=>({scope:c.scope,candidateId:c.candidateId,orderId:c.orderId,requestReference:'qa-request:'+c.orderId,assurance:'SIMULATED'}))};
  const adaptation=createTmsAdaptation({resolver,repository:journal,nowMs:()=>now,source:{load:async(context,id)=>{
    const order=[...orders.orders.values()].find(row=>row.id===id&&orders.orders.get(orders.key(context,row.input.externalOrderId))?.id===id&&row.input.originClubReference===context.originClubReference);
    return order?{scope:{...context},orderId:order.id,input:order.input,state:order.state,version:order.version,correlationId:order.correlationId,receivedAt:order.receivedAt,cancellationReason:order.cancellationReason,assurance:'SIMULATED'}:null;
  }}},1000);
  const app=new OrderApplication({resolve:async()=>({...scope,scopes:['orders:create','orders:read','orders:cancel']})},orders);
  function request(method='POST',url=path,body=JSON.stringify(input)){
    const bytes=new TextEncoder().encode(method==='GET'?'':body);const fixtureId=String(++sequence);const op=url.endsWith('/cancellation-requests')?'orders:cancel':method==='GET'?'orders:read':'orders:create';
    const target:ResourceTarget={environment:'sandbox',tenantId:record.tenantId,clientId:record.clientId,integrationId:record.integrationId,originClubReference:'Club-A',externalOrderId:'Order-A'};
    assertions.set(fixtureId,{environment:'sandbox',issuer:record.issuer,subject:record.subject,credentialReference:record.credentialReference,validFromMs:now-1000,validUntilMs:now+8000,scopes:record.scopes,
      requestProof:{id:'proof-'+fixtureId,issuedAtMs:now-500,expiresAtMs:now+4000,bindingDigest:requestBindingDigest(op,target,bytes)}});
    return new Request('https://example.invalid'+url,{method,headers:{'x-fixture-id':fixtureId,...(method==='GET'?{}:{'content-type':'application/json'})},...(method==='GET'?{}:{body:bytes.buffer as ArrayBuffer})});
  }
  const command=(event:Event):AdaptationCommand=>event.type==='RECEIVED'?{kind:'RECEIVE',orderId:event.orderId,sourceVersion:1,correlationId:event.correlationId}:{kind:'CANCEL',orderId:event.orderId,sourceVersion:event.version,correlationId:event.correlationId,reason:event.reason!};
  return {orders,journal,http,request,adaptation,resolver,app,command,foreignIdentity:()=>{record={...record,tenantId:99};},security};
}
const observation=(reference:string,state:LogisticsObservation['state']):LogisticsObservation=>({synthetic:true,kind:'PLAN',state,requestReference:reference,occurredAt:new Date(now).toISOString(),evidenceReference:null,attemptReference:null,sharedJourney:false});
describe('API-05 full logical circuit, persistence SIMULATED: no successful HTTP reception',()=>{
  it('represents all stages with explicit 503, pending source events and separate unconfirmed logistics projection',async()=>{
    const f=fixture();const response=await f.http(f.request());expect(response.status).toBe(503);expect((await response.json()).code).toBe('UNAVAILABLE');
    expect(f.orders.orders.size).toBe(1);expect(f.orders.events).toHaveLength(1);expect(f.orders.audits).toHaveLength(1);expect(f.orders.outbox).toHaveLength(1);
    const event=f.orders.outbox[0];const prepared=await f.adaptation.process(scope,f.command(event));expect(prepared.assurance).toBe('SIMULATED');expect(prepared.value.candidate.materializable).toBe(false);expect(prepared.value.tmsRequestId).toBeNull();
    let version=prepared.value.version;
    for(const state of ['Programado','En ruta','Cerrado'] as const){await f.adaptation.process(scope,{kind:'OBSERVE',orderId:event.orderId,sourceVersion:1,correlationId:event.correlationId,eventId:'state-'+version,expectedLinkVersion:version++,observation:observation(prepared.value.requestReference!,state)});}
    const logistics=await f.adaptation.get(scope,event.orderId);expect(logistics.value.localDeliveryState).toBe('DELIVERY_UNCONFIRMED');expect(logistics.value.externalPriceSmartStatus).toBeNull();
    expect((await f.app.get('Order-A')).durability).toBe('SIMULATED');expect((await f.app.get('Order-A')).value.provisionalStatus).toBe('RECEIVED');expect((await f.http(f.request('GET',path+'/Order-A'))).status).toBe(503);
    expect((await f.http(f.request('POST',path+'/Order-A/cancellation-requests','{"reason":"ORIGIN_REQUEST"}'))).status).toBe(503);
    const canceled=await f.adaptation.process(scope,f.command(f.orders.outbox[1]));expect(canceled.value.localDeliveryState).toBe('CANCELLATION_REVIEW');expect(canceled.value.sourceState).toBe('CANCELLATION_REQUESTED');expect(canceled.value.externalPriceSmartStatus).toBeNull();
    expect((await f.http(f.request('POST',path+'/Order-A/cancellation-requests','{"reason":"DUPLICATE"}'))).status).toBe(409);expect(f.orders.outbox).toHaveLength(2);expect(f.orders.events).toHaveLength(2);
    expect([...f.orders.orders.values()][0].tmsLinked).toBe(false);expect([...f.orders.orders.values()][0].state).not.toBe('CANCELLED');
  });
  it('retains the pending source event and attempt journal across resolver failure/retry',async()=>{
    const f=fixture();expect((await f.http(f.request())).status).toBe(503);const command=f.command(f.orders.outbox[0]);f.resolver.resolve.mockRejectedValueOnce(new Error('SECRET SQL'));
    await expect(f.adaptation.process(scope,command)).rejects.toThrow('UNAVAILABLE');expect([...f.journal.jobs.values()][0].status).toBe('RETRYABLE');expect(f.orders.outbox).toHaveLength(1);
    const retry=await f.adaptation.process(scope,command);expect(retry.assurance).toBe('SIMULATED');expect([...f.journal.jobs.values()][0].attempt).toBe(2);expect(f.journal.links.size).toBe(1);expect(f.orders.outbox).toHaveLength(1);
  });
  it('deduplicates simulated concurrent HTTP attempts and repeated adaptation without false 202',async()=>{
    const f=fixture();const responses=await Promise.all([f.http(f.request()),f.http(f.request())]);expect(responses.map(r=>r.status)).toEqual([503,503]);expect(f.orders.orders.size).toBe(1);expect(f.orders.outbox).toHaveLength(1);
    const command=f.command(f.orders.outbox[0]);const first=await f.adaptation.process(scope,command),second=await f.adaptation.process(scope,command);expect(second.replayed).toBe(true);expect(second.value).toEqual(first.value);expect(f.resolver.resolve).toHaveBeenCalledOnce();
  });
  it('denies foreign tenant and club at both logical HTTP and adaptation boundaries',async()=>{
    const f=fixture();await f.http(f.request());const event=f.orders.outbox[0];await f.adaptation.process(scope,f.command(event));
    await expect(f.adaptation.get({...scope,tenantId:99},event.orderId)).rejects.toThrow('NOT_FOUND');await expect(f.adaptation.get({...scope,originClubReference:'Other'},event.orderId)).rejects.toThrow('NOT_FOUND');
    expect((await f.http(f.request('POST',path,JSON.stringify({...input,originClubReference:'Other'})))).status).toBe(403);
    f.foreignIdentity();expect((await f.http(f.request('GET',path+'/Order-A'))).status).toBe(404);expect(f.orders.orders.size).toBe(1);expect(f.journal.links.size).toBe(1);
  });
  it('preserves API-04 denial before persistence when security itself reports SIMULATED',async()=>{
    const f=fixture();f.security.counter.consume.mockResolvedValue({allowed:true,used:1,resetAtMs:now+1000,assurance:'SIMULATED'});expect((await f.http(f.request())).status).toBe(503);expect(f.orders.orders.size).toBe(0);expect(f.orders.outbox).toHaveLength(0);
  });
  it('holds cancellation before candidate processing and never promotes the source domain into TMS',async()=>{
    const f=fixture();await f.http(f.request());await f.http(f.request('POST',path+'/Order-A/cancellation-requests','{"reason":"ORIGIN_REQUEST"}'));
    const cancel=await f.adaptation.process(scope,f.command(f.orders.outbox[1]));await f.adaptation.process(scope,f.command(f.orders.outbox[0]));expect(cancel.value.requestReference).toBeNull();expect(f.resolver.resolve).not.toHaveBeenCalled();expect(f.orders.outbox).toHaveLength(2);expect([...f.orders.orders.values()][0].tmsLinked).toBe(false);
  });
});
