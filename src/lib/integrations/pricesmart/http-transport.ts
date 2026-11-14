import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MAX_BODY_BYTES, OrderError, orderSchema, cancellationSchema, parseBody, reference, scopeOf, states, type OrderContractOptions, type OrderView, type Scope } from './contracts';
import { createM2MSecurity } from './m2m-security';
import { DEFAULT_ENVIRONMENT, environmentSchema, type Environment } from './environment';
import { SecurityFailure, policySchema, type AbusePolicy, type Operation } from './security-contracts';
import type { OrderRepository, Transaction } from './ports';
import { OrderApplication } from './service';

export const PROVISIONAL_ORDERS_PATH = '/api/integrations/pricesmart/v1/orders';
export interface HttpEvidencePort {
  // Extract opaque evidence only. No default bearer parser or peer-certificate header trust.
  extract(input: { method: string; pathname: string; headers: readonly (readonly [string, string])[] }): Promise<unknown>;
}
const limitsSchema = z.object({
  originClubReference: reference.max(64), timeoutMs: z.number().int().positive().max(60000),
  maxHeaderBytes: z.number().int().positive().max(65536), maxHeaderCount: z.number().int().positive().max(128),
  maxUrlBytes: z.number().int().positive().max(8192), maxBodyChunks: z.number().int().positive().max(4096),
}).strict();
export type HttpTransportLimits = z.infer<typeof limitsSchema>;
const viewSchema = z.object({
  externalOrderId: reference, provisionalStatus: z.enum(states), processingStatus: z.enum(['PENDING','PAUSED','CANCELLED']),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), correlationId: z.uuid(),
}).strict().refine(v => v.processingStatus === (v.provisionalStatus === 'RECEIVED' ? 'PENDING' : v.provisionalStatus === 'CANCELLED' ? 'CANCELLED' : 'PAUSED'));
const committedSchema = z.object({ value: viewSchema, durability: z.literal('DURABLE') }).strict();
/** API-12: puntos de extensión OPCIONALES (solo composiciones de laboratorio). Sin ellos el comportamiento es exactamente el de API-04/API-11.
 *  - order: contrato de orden alternativo (esquema + identidad de contenido para la idempotencia).
 *  - readExtra: campos ADICIONALES de solo lectura para GET (no pueden pisar los del recibo).
 *  - afterCommit: acción posterior a un commit durable (p. ej. vincular con el TMS); un fallo NUNCA cambia la respuesta ya comprometida. */
export type HttpTransportExtensions = {
  order?: OrderContractOptions;
  readExtra?: (context: { scope: Scope; externalOrderId: string; view: OrderView }) => Promise<Record<string, unknown>>;
  afterCommit?: (context: { operation: Operation; scope: Scope; externalOrderId: string; view: OrderView }) => Promise<void>;
};
class HttpFailure extends Error {
  constructor(readonly status: number, readonly code: string, readonly allow?: string) { super(code); }
}
type Route = { operation: Operation; externalId?: string; method: 'GET'|'POST' };
function route(request: Request): Route {
  const url = new URL(request.url);
  if (!['http:','https:'].includes(url.protocol) || url.search || url.hash) throw new HttpFailure(400,'INVALID_INPUT');
  let operation: Operation; let externalId: string | undefined;
  if (url.pathname === PROVISIONAL_ORDERS_PATH) operation = 'orders:create';
  else {
    const parts = url.pathname.slice(PROVISIONAL_ORDERS_PATH.length + 1).split('/');
    if (!url.pathname.startsWith(`${PROVISIONAL_ORDERS_PATH}/`) || parts.length > 2 ||
        (parts.length === 2 && parts[1] !== 'cancellation-requests')) throw new HttpFailure(404,'NOT_FOUND');
    if (!reference.safeParse(parts[0]).success) throw new HttpFailure(400,'INVALID_INPUT');
    externalId = parts[0]; operation = parts.length === 2 ? 'orders:cancel' : 'orders:read';
  }
  const method = operation === 'orders:read' ? 'GET' : 'POST';
  if (request.method !== method) throw new HttpFailure(405,'METHOD_NOT_ALLOWED',method);
  return { operation, externalId, method };
}
function respond(status: number, value: unknown, correlationId: string, allow?: string): Response {
  const headers = new Headers({ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store, private',
    'Pragma':'no-cache', 'X-Content-Type-Options':'nosniff', 'X-Correlation-Id':correlationId });
  if (allow) headers.set('Allow',allow);
  return new Response(JSON.stringify(value),{ status,headers });
}

/** Callable Request/Response adapter only: no route registration, server or default dependencies. */
export function createIsolatedHttpTransport(dependencies: {
  evidence: HttpEvidencePort; security: Parameters<typeof createM2MSecurity>[0]; repository: OrderRepository;
  /** API-22: entorno del despliegue (por omisión `sandbox`). Cualquier otro valor distinto de `sandbox`/`production` hace fallar la construcción. */
  environment?: Environment;
}, proposedPolicy: AbusePolicy, proposedLimits: HttpTransportLimits, extensions: HttpTransportExtensions = {}): (request: Request) => Promise<Response> {
  const parsedLimits = limitsSchema.safeParse(proposedLimits), parsedPolicy = policySchema.safeParse(proposedPolicy);
  if (!parsedLimits.success || !parsedPolicy.success || typeof dependencies.evidence?.extract !== 'function' ||
      typeof dependencies.repository?.runAtomic !== 'function') throw new SecurityFailure('UNAVAILABLE');
  const limits = Object.freeze(parsedLimits.data), policy = Object.freeze(parsedPolicy.data);
  const parsedEnvironment = environmentSchema.safeParse(dependencies.environment === undefined ? DEFAULT_ENVIRONMENT : dependencies.environment); if (!parsedEnvironment.success) throw new SecurityFailure('UNAVAILABLE');
  const deploymentEnvironment = parsedEnvironment.data;
  return async (request: Request): Promise<Response> => {
    const correlationId = randomUUID();
    if (!(request instanceof Request)) return respond(400,{ code:'INVALID_INPUT',correlationId },correlationId);
    const startedAt = performance.now();
    let expired = false, complete = false;
    const phase: { value:'TRANSPORT'|'AUTHENTICATION'|'AUTHORIZATION'|'ANTIABUSE'|'APPLICATION' } = { value:'TRANSPORT' };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const timeoutError = () => phase.value === 'TRANSPORT' ? new HttpFailure(408,'REQUEST_TIMEOUT') : new HttpFailure(503,'UNAVAILABLE');
    const checkpoint = () => {
      if (performance.now() - startedAt >= limits.timeoutMs) expired = true;
      if (expired || request.signal.aborted) throw timeoutError();
    };
    const cancelBody = () => {
      const cancellation = reader ? reader.cancel() : request.body && !request.body.locked ? request.body.cancel() : undefined;
      if (cancellation) void cancellation.catch(() => {});
    };
    let rejectDeadline!: (error: unknown) => void;
    const deadline = new Promise<never>((_resolve,reject) => { rejectDeadline = reject; });
    const expire = () => { if (complete) return; expired = true; cancelBody(); rejectDeadline(timeoutError()); };
    const timer = setTimeout(expire,limits.timeoutMs);
    request.signal.addEventListener('abort',expire,{ once:true });
    async function guarded<T>(call: () => Promise<T>): Promise<T> {
      checkpoint(); const value = await call(); checkpoint(); return value;
    }
    async function process(): Promise<Response> {
      checkpoint();
      if (request.bodyUsed) throw new HttpFailure(400,'INVALID_INPUT');
      const encoder = new TextEncoder();
      if (encoder.encode(request.url).byteLength > limits.maxUrlBytes) throw new HttpFailure(414,'INVALID_INPUT');
      const headers = [...request.headers.entries()];
      const headerBytes = headers.reduce((sum,[name,value]) => sum+encoder.encode(name).byteLength+encoder.encode(value).byteLength+4,0);
      if (headers.length > limits.maxHeaderCount || headerBytes > limits.maxHeaderBytes) throw new HttpFailure(431,'INVALID_INPUT');
      const selected = route(request);
      const accept = request.headers.get('accept');
      if (accept && !['application/json','*/*'].includes(accept.trim().toLowerCase())) throw new HttpFailure(406,'NOT_ACCEPTABLE');
      if (request.headers.has('content-encoding') || request.headers.has('transfer-encoding')) throw new HttpFailure(415,'UNSUPPORTED_FORMAT');
      if (selected.method === 'POST' && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new HttpFailure(415,'UNSUPPORTED_FORMAT');
      const rawLength = request.headers.get('content-length');
      let declared: number | undefined;
      if (rawLength !== null) {
        if (!/^(0|[1-9][0-9]*)$/.test(rawLength)) throw new HttpFailure(400,'INVALID_INPUT');
        declared = Number(rawLength);
        if (!Number.isSafeInteger(declared) || declared > policy.maxBodyBytes || declared > MAX_BODY_BYTES) throw new HttpFailure(413,'TOO_LARGE');
      }
      if (selected.method === 'GET' && (request.body !== null || (declared ?? 0) !== 0)) throw new HttpFailure(400,'INVALID_INPUT');
      const chunks: Uint8Array[] = []; let size = 0;
      if (request.body) {
        reader = request.body.getReader();
        for (;;) {
          let part: ReadableStreamReadResult<Uint8Array>;
          try { part = await reader.read(); } catch { throw new HttpFailure(400,'INVALID_INPUT'); }
          checkpoint();
          if (part.done) break;
          if (!(part.value instanceof Uint8Array)) throw new HttpFailure(400,'INVALID_INPUT');
          size += part.value.byteLength;
          if (size > policy.maxBodyBytes || size > MAX_BODY_BYTES) throw new HttpFailure(413,'TOO_LARGE');
          if (chunks.length >= limits.maxBodyChunks) throw new HttpFailure(413,'TOO_LARGE');
          chunks.push(new Uint8Array(part.value));
        }
      }
      if (declared !== undefined && declared !== size) throw new HttpFailure(400,'INVALID_INPUT');
      const body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk,offset); offset += chunk.byteLength; }
      checkpoint(); phase.value = 'AUTHENTICATION';
      const metadata = Object.freeze({ method:request.method,pathname:new URL(request.url).pathname,
        headers:Object.freeze(headers.map(pair => Object.freeze(pair))) });
      const security = createM2MSecurity({
        verifier:{ verify:(value,context) => guarded(() => dependencies.security.verifier.verify(value,context)) },
        catalog:{ findByCredential:binding => guarded(() => dependencies.security.catalog.findByCredential(binding)) },
        revocation:{ isRevoked:binding => guarded(() => dependencies.security.revocation.isRevoked(binding)) },
        counter:{ consume:input => guarded(() => dependencies.security.counter.consume(input)) },
        replay:{ claim:input => guarded(() => dependencies.security.replay.claim(input)) },
        clock:{ nowMs:() => { checkpoint(); return dependencies.security.clock.nowMs(); } },
      },policy,{ environment:deploymentEnvironment });
      const evidence = await guarded(() => dependencies.evidence.extract(metadata)); checkpoint();
      const identity = await security.authenticate(evidence); checkpoint();
      phase.value = 'AUTHORIZATION';
      let externalId = selected.externalId;
      if (selected.operation === 'orders:create') {
        const input = parseBody(body,extensions.order?.orderSchema ?? orderSchema); externalId = input.externalOrderId;
        if (input.originClubReference !== limits.originClubReference) throw new HttpFailure(403,'FORBIDDEN');
      } else if (selected.operation === 'orders:cancel') parseBody(body,cancellationSchema);
      const target = await security.resourceTarget(identity,limits.originClubReference,externalId!); checkpoint();
      await security.authorize(identity,selected.operation,target); checkpoint();
      phase.value = 'ANTIABUSE';
      const admission = await security.admit(identity,selected.operation,target,body); checkpoint();
      if (admission.assurance !== 'PORT_ATTESTED') throw new HttpFailure(503,'UNAVAILABLE');
      // Scoped, fresh identity bridge. No public API accepts a Principal or tenant header.
      const identityPort = { resolve: async () => {
        checkpoint();
        try { const principal = await security.authorize(identity,selected.operation,target); checkpoint(); return principal; }
        catch (error) { if (error instanceof SecurityFailure && error.code === 'DENIED') throw new OrderError('FORBIDDEN'); throw error; }
      } };
      phase.value = 'APPLICATION';
      const repository: OrderRepository = { runAtomic: (scope,action) => guarded(() => dependencies.repository.runAtomic(scope,async tx => {
        checkpoint();
        const wrapped = Object.fromEntries((['insert','findForUpdate','save','appendEvent','appendAudit','enqueue'] as const).map(key => [key, (...args: unknown[]) =>
          guarded(async () => Reflect.apply(tx[key],tx,args))])) as unknown as Transaction;
        return guarded(() => action(wrapped));
      })) };
      const application = new OrderApplication(identityPort,repository,extensions.order);
      const result = selected.operation === 'orders:create' ? await application.receive(body)
        : selected.operation === 'orders:read' ? await application.get(externalId) : await application.requestCancellation(externalId,body);
      checkpoint();
      const committed = committedSchema.safeParse(result);
      if (!committed.success || committed.data.value.externalOrderId !== externalId ||
          (selected.operation === 'orders:create' && (committed.data.value.provisionalStatus !== 'RECEIVED' || committed.data.value.version !== 1)) ||
          (selected.operation === 'orders:cancel' && (committed.data.value.provisionalStatus !== 'CANCELLATION_REQUESTED' || committed.data.value.version < 2))) throw new HttpFailure(503,'UNAVAILABLE');
      let extra: Record<string, unknown> = {};
      if (selected.operation === 'orders:read' && extensions.readExtra) {
        extra = await guarded(() => extensions.readExtra!({ scope: scopeOf(admission.principal), externalOrderId: externalId!, view: committed.data.value }));
        if (extra === null || typeof extra !== 'object' || Object.keys(extra).some(key => key in committed.data.value)) throw new HttpFailure(503,'UNAVAILABLE');
      }
      if (selected.operation !== 'orders:read' && extensions.afterCommit) {
        // El commit durable ya ocurrió: un fallo posterior no puede convertir la respuesta en error ni provocar un reintento duplicado.
        try { await extensions.afterCommit({ operation: selected.operation, scope: scopeOf(admission.principal), externalOrderId: externalId!, view: committed.data.value }); } catch { /* recuperable: la vinculación es idempotente */ }
      }
      return respond(selected.operation === 'orders:read' ? 200 : 202,{ ...committed.data.value, ...extra },correlationId);
    }
    try { return await Promise.race([process(),deadline]); }
    catch (error) {
      let status = 503, code = 'UNAVAILABLE', allow: string | undefined;
      if (error instanceof HttpFailure) { status = error.status; code = error.code; allow = error.allow; }
      else if (error instanceof SecurityFailure) {
        const mapped = { DENIED:phase.value === 'AUTHENTICATION' ? [401,'UNAUTHENTICATED'] : [403,'FORBIDDEN'],
          TOO_LARGE:[413,'TOO_LARGE'], LIMITED:[429,'LIMITED'], REPLAY_REJECTED:[409,'REPLAY_REJECTED'], UNAVAILABLE:[503,'UNAVAILABLE'] }[error.code];
        if (Array.isArray(mapped) && typeof mapped[0] === 'number' && typeof mapped[1] === 'string') { status = mapped[0]; code = mapped[1]; }
      } else if (error instanceof OrderError) {
        const mapped = { INVALID_INPUT:[400,'INVALID_INPUT'], TOO_LARGE:[413,'TOO_LARGE'], UNAUTHENTICATED:[401,'UNAUTHENTICATED'],
          FORBIDDEN:[403,'FORBIDDEN'], NOT_FOUND:[404,'NOT_FOUND'], CONFLICT:[409,'CONFLICT'], UNAVAILABLE:[503,'UNAVAILABLE'], DISABLED:[503,'DISABLED'] }[error.code];
        if (Array.isArray(mapped) && typeof mapped[0] === 'number' && typeof mapped[1] === 'string') { status = mapped[0]; code = mapped[1]; }
      }
      return respond(status,{ code,correlationId },correlationId,allow);
    } finally {
      complete = true; clearTimeout(timer); request.signal.removeEventListener('abort',expire); cancelBody();
    }
  };
}
