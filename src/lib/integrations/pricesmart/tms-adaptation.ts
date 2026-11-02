import { createHash } from 'node:crypto';
import { adaptationScopeSchema, adaptationCommandSchema, sourceSnapshotSchema, resolutionSchema, linkSchema, jobSchema, observationSchema,
  AdaptationError, type AdaptationScope, type SourceSnapshot, type LogisticsCandidate, type AdaptationCommand,
  type AdaptationLink, type AdaptationJob, type AdaptationTransaction, type AdaptationRepository, type SourceOrderPort, type CandidateResolutionPort,
  type LogisticsObservation, type LocalDeliveryState } from './tms-adaptation-contracts';

export const adaptationNamespace = (scope:AdaptationScope) => JSON.stringify([scope.environment,scope.tenantId,scope.clientId,scope.integrationId]);
const sameScope=(a:AdaptationScope,b:AdaptationScope)=>adaptationNamespace(a)===adaptationNamespace(b)&&a.originClubReference===b.originClubReference;
const hash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function candidateFromSnapshot(input:SourceSnapshot):LogisticsCandidate {
  const parsed=sourceSnapshotSchema.safeParse(input);
  if(!parsed.success || parsed.data.input.originClubReference!==parsed.data.scope.originClubReference)throw new AdaptationError('INVALID_INPUT');
  const source=parsed.data;
  return { candidateId:'candidate:'+hash([adaptationNamespace(source.scope),source.scope.originClubReference,source.orderId]),scope:{...source.scope},orderId:source.orderId,
    externalOrderId:source.input.externalOrderId,payloadVersion:source.input.schemaVersion,materializable:false,readiness:'CONTRACT_PENDING',commercialData:null,requestedDate:null,tmsActor:null };
}
export function provisionalDeliveryState(input:LogisticsObservation):LocalDeliveryState {
  const parsed=observationSchema.safeParse(input);if(!parsed.success)throw new AdaptationError('INVALID_INPUT');const observation=parsed.data;
  if(observation.sharedJourney || observation.kind==='RESCHEDULE' || observation.state==='PARTIAL_UNCONFIRMED' || observation.state==='FAILED')return 'REVIEW_REQUIRED';
  if(observation.kind==='EVIDENCE' || observation.kind==='ATTEMPT')return 'DELIVERY_UNCONFIRMED';
  if(['CANCELADA','RECHAZADA','Cancelado'].includes(observation.state))return 'REVIEW_REQUIRED';
  if(observation.state==='En ruta')return 'IN_PROGRESS_UNCONFIRMED';
  if(['Descargado','Cerrado'].includes(observation.state))return 'DELIVERY_UNCONFIRMED';
  if(['PROGRAMADA','Programado','Cargado'].includes(observation.state))return 'SCHEDULED_UNCONFIRMED';
  return 'LOGISTICS_REVIEW';
}
/** Explicit calls only. No worker, timer, DB, HTTP, TMS service or operational writer. */
export function createTmsAdaptation(ports:{source:SourceOrderPort;resolver:CandidateResolutionPort;repository:AdaptationRepository;nowMs:()=>number},leaseMs:number) {
  if(!Number.isSafeInteger(leaseMs)||leaseMs<1)throw new AdaptationError('INVALID_INPUT');
  const time=()=>{const value=ports.nowMs();if(!Number.isSafeInteger(value)||value<0||!Number.isSafeInteger(value+leaseMs))throw new AdaptationError('UNAVAILABLE');return value;};
  const iso=()=>new Date(time()).toISOString();
  async function safe<T>(action:()=>Promise<T>):Promise<T>{try{return await action();}catch(error){throw new AdaptationError(error instanceof AdaptationError?error.code:'UNAVAILABLE');}}
  async function atomic<T>(scope:AdaptationScope,action:(tx:AdaptationTransaction)=>Promise<T>):Promise<T>{
    const committed=await ports.repository.runAtomic({...scope},action);if(!committed||committed.assurance!=='SIMULATED')throw new AdaptationError('UNAVAILABLE');return committed.value;
  }
  function scopeOf(input:AdaptationScope){const parsed=adaptationScopeSchema.safeParse(input);if(!parsed.success)throw new AdaptationError('INVALID_INPUT');return parsed.data;}
  async function sourceOf(scope:AdaptationScope,id:string){
    const raw=await ports.source.load({...scope},id);const parsed=sourceSnapshotSchema.safeParse(raw);
    if(!parsed.success||parsed.data.orderId!==id||!sameScope(parsed.data.scope,scope)||parsed.data.input.originClubReference!==scope.originClubReference)throw new AdaptationError('NOT_FOUND');
    return parsed.data;
  }
  function checkedLink(scope:AdaptationScope,link:AdaptationLink,source:SourceSnapshot){
    const parsed=linkSchema.safeParse(link);
    if(!parsed.success||!sameScope(parsed.data.scope,scope)||parsed.data.orderId!==source.orderId||parsed.data.externalOrderId!==source.input.externalOrderId||
      hash(parsed.data.candidate)!==hash(candidateFromSnapshot(source)))throw new AdaptationError('UNAVAILABLE');
    if(parsed.data.sourceVersion>source.version)throw new AdaptationError('CONFLICT');
    return parsed.data;
  }
  function checkedJob(raw:AdaptationJob|null,key:string,orderId:string,inputHash:string):AdaptationJob|null{
    if(raw===null)return null;const parsed=jobSchema.safeParse(raw);
    if(!parsed.success||parsed.data.key!==key||parsed.data.orderId!==orderId)throw new AdaptationError('UNAVAILABLE');
    if(parsed.data.inputHash!==inputHash)throw new AdaptationError('CONFLICT');return parsed.data;
  }
  function jobKey(scope:AdaptationScope,command:AdaptationCommand){return JSON.stringify([adaptationNamespace(scope),command.orderId,
    command.kind==='OBSERVE'?'OBSERVATION':'SOURCE',command.kind==='OBSERVE'?command.eventId:command.sourceVersion]);}
  return Object.freeze({
    async process(inputScope:AdaptationScope,inputCommand:AdaptationCommand):Promise<{value:AdaptationLink;assurance:'SIMULATED';replayed:boolean}> {
      return safe(async()=>{
        const scope=scopeOf(inputScope);const parsed=adaptationCommandSchema.safeParse(inputCommand);if(!parsed.success)throw new AdaptationError('INVALID_INPUT');
        const command=parsed.data;let source=await sourceOf(scope,command.orderId);
        if(source.version<command.sourceVersion||(command.kind==='CANCEL'&&(command.sourceVersion<2||command.reason!==source.cancellationReason||!['CANCELLATION_REQUESTED','CANCELLED'].includes(source.state))))throw new AdaptationError('CONFLICT');
        const key=jobKey(scope,command),inputHash=hash({...command,correlationId:null});
        const claim=await atomic<AdaptationJob>(scope,async tx=>{
          const existing=checkedJob(await tx.job(key),key,command.orderId,inputHash);
          if(existing?.status==='DONE'){
            await tx.appendTrace({jobKey:key,orderId:command.orderId,attempt:existing.attempt,phase:'REPLAY',correlationId:command.correlationId,recordedAt:iso(),failure:null,observation:null});return existing;
          }
          if(existing?.status==='PROCESSING'&&existing.leaseUntilMs>time())throw new AdaptationError('CONFLICT');
          const next:AdaptationJob={key,orderId:command.orderId,inputHash,version:(existing?.version??0)+1,attempt:(existing?.attempt??0)+1,status:'PROCESSING',leaseUntilMs:time()+leaseMs,result:null};
          await tx.saveJob(jobSchema.parse(next),existing?.version??null);
          await tx.appendTrace({jobKey:key,orderId:command.orderId,attempt:next.attempt,phase:existing?.status==='PROCESSING'?'LEASE_RECLAIMED':'STARTED',correlationId:command.correlationId,recordedAt:iso(),failure:null,observation:null});return next;
        });
        if(claim.status==='DONE'){
          if(!claim.result)throw new AdaptationError('UNAVAILABLE');return {value:checkedLink(scope,claim.result,source),assurance:'SIMULATED',replayed:true};
        }
        try {
          let resolved:string|null=null;
          if(command.kind==='RECEIVE'&&!['CANCELLATION_REQUESTED','CANCELLED'].includes(source.state)){
            const candidate=candidateFromSnapshot(source);const result=resolutionSchema.safeParse(await ports.resolver.resolve(structuredClone(candidate)));
            if(!result.success||!sameScope(result.data.scope,scope)||result.data.orderId!==source.orderId||result.data.candidateId!==candidate.candidateId)throw new AdaptationError('UNAVAILABLE');resolved=result.data.requestReference;
          }
          source=await sourceOf(scope,command.orderId);
          const result=await atomic<AdaptationLink>(scope,async tx=>{
            const current=checkedJob(await tx.job(key),key,command.orderId,inputHash);
            if(!current||current.status!=='PROCESSING'||current.version!==claim.version||current.leaseUntilMs<=time())throw new AdaptationError('CONFLICT');
            const rawPrevious=await tx.link(command.orderId);const previous=rawPrevious?checkedLink(scope,rawPrevious,source):null;
            if(command.kind==='OBSERVE'&&(!previous||previous.version!==command.expectedLinkVersion))throw new AdaptationError('CONFLICT');
            const link:AdaptationLink=previous?structuredClone(previous):{scope,orderId:source.orderId,externalOrderId:source.input.externalOrderId,candidate:candidateFromSnapshot(source),requestReference:null,tmsRequestId:null,
              version:0,sourceVersion:source.version,sourceState:source.state,localDeliveryState:'AWAITING_MAPPING',externalPriceSmartStatus:null,cancellationRequested:false,lastObservation:null,receivedAt:source.receivedAt,updatedAt:iso(),correlationId:source.correlationId,assurance:'SIMULATED'};
            if(command.kind==='RECEIVE'&&resolved&&!['CANCELLATION_REQUESTED','CANCELLED'].includes(source.state)){if(link.requestReference&&link.requestReference!==resolved)throw new AdaptationError('CONFLICT');link.requestReference=resolved;if(!previous)link.localDeliveryState='LOGISTICS_REVIEW';}
            if(command.kind==='OBSERVE'){
              if(command.observation.requestReference!==link.requestReference)throw new AdaptationError('NOT_FOUND');
              const late=link.lastObservation!==null&&Date.parse(command.observation.occurredAt)<Date.parse(link.lastObservation.occurredAt);
              const mapped=provisionalDeliveryState(command.observation);
              link.lastObservation=command.observation;link.localDeliveryState=late||link.localDeliveryState==='REVIEW_REQUIRED'?'REVIEW_REQUIRED':mapped;
            }
            if(command.kind==='CANCEL'||link.cancellationRequested||['CANCELLATION_REQUESTED','CANCELLED'].includes(source.state)){
              link.cancellationRequested=true;link.localDeliveryState='CANCELLATION_REVIEW';
            }
            link.version++;link.sourceVersion=Math.max(link.sourceVersion,source.version);link.sourceState=source.state;link.updatedAt=iso();link.correlationId=command.correlationId;
            const validated=linkSchema.parse(link);await tx.saveLink(validated,previous?.version??null);
            await tx.appendTrace({jobKey:key,orderId:command.orderId,attempt:claim.attempt,phase:'SUCCEEDED',correlationId:command.correlationId,recordedAt:iso(),failure:null,observation:command.kind==='OBSERVE'?command.observation:null});
            await tx.saveJob(jobSchema.parse({...current,version:current.version+1,status:'DONE',result:validated}),current.version);return validated;
          });
          return {value:checkedLink(scope,result,source),assurance:'SIMULATED',replayed:false};
        } catch(error) {
          // Separate transaction preserves failed attempts; failure here leaves a recoverable lease.
          await atomic(scope,async tx=>{const current=checkedJob(await tx.job(key),key,command.orderId,inputHash);if(!current||current.status!=='PROCESSING'||current.version!==claim.version)return;
            await tx.appendTrace({jobKey:key,orderId:command.orderId,attempt:claim.attempt,phase:'FAILED',correlationId:command.correlationId,recordedAt:iso(),failure:error instanceof AdaptationError&&['CONFLICT','NOT_FOUND'].includes(error.code)?error.code as 'CONFLICT'|'NOT_FOUND':'DEPENDENCY_FAILURE',observation:null});
            await tx.saveJob(jobSchema.parse({...current,version:current.version+1,status:error instanceof AdaptationError&&['CONFLICT','NOT_FOUND'].includes(error.code)?'REVIEW_REQUIRED':'RETRYABLE'}),current.version);
          });
          throw error;
        }
      });
    },
    async get(inputScope:AdaptationScope,orderId:string):Promise<{value:AdaptationLink;assurance:'SIMULATED'}>{
      return safe(async()=>{const scope=scopeOf(inputScope);const source=await sourceOf(scope,orderId);
        const value=await atomic<AdaptationLink|null>(scope,tx=>tx.link(orderId));if(!value)throw new AdaptationError('NOT_FOUND');
        const checked=checkedLink(scope,value,source);
        const cancellation=checked.cancellationRequested||['CANCELLATION_REQUESTED','CANCELLED'].includes(source.state);
        return {value:{...checked,sourceVersion:source.version,sourceState:source.state,cancellationRequested:cancellation,
          localDeliveryState:cancellation?'CANCELLATION_REVIEW':checked.localDeliveryState},assurance:'SIMULATED'};
      });
    },
  });
}
