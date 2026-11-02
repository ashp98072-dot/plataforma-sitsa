import { z } from 'zod';
import { cancellationSchema, orderSchema, reference, states } from './contracts';

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const adaptationScopeSchema = z.object({ environment:z.literal('sandbox'), tenantId:positive, clientId:positive,
  integrationId:reference, originClubReference:reference.max(64) }).strict();
export type AdaptationScope = z.infer<typeof adaptationScopeSchema>;
export const sourceSnapshotSchema = z.object({ scope:adaptationScopeSchema, orderId:z.uuid(), input:orderSchema,
  state:z.enum(states), version:positive, correlationId:z.uuid(), receivedAt:z.iso.datetime(), cancellationReason:cancellationSchema.shape.reason.nullable(), assurance:z.literal('SIMULATED') }).strict().refine(v=>['CANCELLATION_REQUESTED','CANCELLED'].includes(v.state)===(v.cancellationReason!==null));
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export const requestStates = ['SOLICITADA','EN_REVISION','PROGRAMADA','RECHAZADA','CANCELADA'] as const;
export const planStates = ['Programado','Cargado','En ruta','Descargado','Cerrado','Cancelado'] as const;
export const observationSchema = z.object({
  synthetic:z.literal(true), kind:z.enum(['REQUEST','PLAN','EVIDENCE','RESCHEDULE','ATTEMPT']),
  state:z.enum([...requestStates,...planStates,'UNCONFIRMED','FAILED','PARTIAL_UNCONFIRMED']),
  requestReference:reference, occurredAt:z.iso.datetime(), evidenceReference:reference.nullable(),
  attemptReference:reference.nullable(), sharedJourney:z.boolean(),
}).strict().refine(v => {
  if(v.kind==='REQUEST')return (requestStates as readonly string[]).includes(v.state);
  if(v.kind==='PLAN')return (planStates as readonly string[]).includes(v.state);
  if(v.kind==='EVIDENCE')return v.state==='UNCONFIRMED' && v.evidenceReference!==null;
  if(v.kind==='RESCHEDULE')return v.state==='UNCONFIRMED';
  return ['UNCONFIRMED','FAILED','PARTIAL_UNCONFIRMED'].includes(v.state) && v.attemptReference!==null;
});
export type LogisticsObservation = z.infer<typeof observationSchema>;
const sourceCommand = { orderId:z.uuid(), sourceVersion:positive, correlationId:z.uuid() };
export const adaptationCommandSchema = z.discriminatedUnion('kind',[
  z.object({ kind:z.literal('RECEIVE'), ...sourceCommand, sourceVersion:z.literal(1) }).strict(),
  z.object({ kind:z.literal('CANCEL'), ...sourceCommand, reason:cancellationSchema.shape.reason }).strict(),
  z.object({ kind:z.literal('OBSERVE'), ...sourceCommand, eventId:reference, expectedLinkVersion:positive, observation:observationSchema }).strict(),
]);
export type AdaptationCommand = z.infer<typeof adaptationCommandSchema>;
export const candidateSchema = z.object({ candidateId:reference, scope:adaptationScopeSchema, orderId:z.uuid(),
  externalOrderId:reference, payloadVersion:z.literal('api01-draft-1'), materializable:z.literal(false),
  readiness:z.literal('CONTRACT_PENDING'), commercialData:z.null(), requestedDate:z.null(), tmsActor:z.null() }).strict();
export type LogisticsCandidate = z.infer<typeof candidateSchema>;
export const localDeliveryStates = ['AWAITING_MAPPING','LOGISTICS_REVIEW','SCHEDULED_UNCONFIRMED','IN_PROGRESS_UNCONFIRMED',
  'DELIVERY_UNCONFIRMED','REVIEW_REQUIRED','CANCELLATION_REVIEW'] as const;
export type LocalDeliveryState = typeof localDeliveryStates[number];
export const linkSchema = z.object({ scope:adaptationScopeSchema, orderId:z.uuid(), externalOrderId:reference, candidate:candidateSchema,
  requestReference:reference.nullable(), tmsRequestId:z.null(), version:positive, sourceVersion:positive, sourceState:z.enum(states),
  localDeliveryState:z.enum(localDeliveryStates), externalPriceSmartStatus:z.null(), cancellationRequested:z.boolean(),
  lastObservation:observationSchema.nullable(), receivedAt:z.iso.datetime(), updatedAt:z.iso.datetime(), correlationId:z.uuid(),
  assurance:z.literal('SIMULATED') }).strict().refine(v=>v.cancellationRequested===(v.localDeliveryState==='CANCELLATION_REVIEW'));
export type AdaptationLink = z.infer<typeof linkSchema>;
export const jobSchema=z.object({key:z.string().min(1).max(2048),orderId:z.uuid(),inputHash:z.string().regex(/^[a-f0-9]{64}$/),version:positive,attempt:positive,
  status:z.enum(['PROCESSING','RETRYABLE','REVIEW_REQUIRED','DONE']),leaseUntilMs:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),result:linkSchema.nullable()}).strict().refine(v=>(v.status==='DONE')===(v.result!==null));
export type AdaptationJob=z.infer<typeof jobSchema>;
export type AdaptationTrace = { jobKey:string; orderId:string; attempt:number; phase:'STARTED'|'LEASE_RECLAIMED'|'SUCCEEDED'|'FAILED'|'REPLAY';
  correlationId:string; recordedAt:string; failure:'DEPENDENCY_FAILURE'|'CONFLICT'|'NOT_FOUND'|null; observation:LogisticsObservation|null };
export interface SourceOrderPort { load(scope:AdaptationScope, orderId:string):Promise<unknown|null> }
export interface CandidateResolutionPort {
  // Pure/idempotent synthetic resolution only. NEVER creates an operational TMS request.
  resolve(candidate:LogisticsCandidate):Promise<unknown>;
}
export const resolutionSchema = z.object({ scope:adaptationScopeSchema, candidateId:reference, orderId:z.uuid(),
  requestReference:reference, assurance:z.literal('SIMULATED') }).strict();
export interface AdaptationTransaction {
  job(key:string):Promise<AdaptationJob|null>;
  saveJob(job:AdaptationJob, previousVersion:number|null):Promise<void>;
  link(orderId:string):Promise<AdaptationLink|null>;
  saveLink(link:AdaptationLink, previousVersion:number|null):Promise<void>;
  appendTrace(trace:AdaptationTrace):Promise<void>;
}
export interface AdaptationRepository {
  // Full scope on every operation; unique jobs/links + CAS, traces in the SAME atomic unit.
  // No runtime implementation supplied. The only implementation is a test double.
  runAtomic<T>(scope:AdaptationScope, action:(tx:AdaptationTransaction)=>Promise<T>):Promise<{value:T;assurance:'SIMULATED'}>;
}
export class AdaptationError extends Error {
  readonly code:'INVALID_INPUT'|'NOT_FOUND'|'CONFLICT'|'UNAVAILABLE';
  constructor(code:AdaptationError['code']) { const safe=['INVALID_INPUT','NOT_FOUND','CONFLICT','UNAVAILABLE'].includes(code)?code:'UNAVAILABLE';super(safe);this.code=safe; }
}
