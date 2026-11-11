import { describe, expect, it, vi } from 'vitest';
import { OrderApplication } from './service';
import { ModelRepository } from './__tests__/model-repository';
import { AdaptationModel } from './__tests__/tms-adaptation-model';
import { OutboxModelStore } from './__tests__/outbox-model';
import { createTmsAdaptation } from './tms-adaptation';
import { AdaptationError, type AdaptationScope, type LogisticsCandidate } from './tms-adaptation-contracts';
import { DEFAULT_OUTBOX_POLICY, OutboxDispatcher, type OutboxEvent } from './outbox';
import { commandFor, createSyntheticAdaptationHandler } from './outbox-adaptation-handler';

// ALL SIMULATED: orders (ModelRepository), adaptation journal (AdaptationModel) and outbox (OutboxModelStore) are in-memory doubles.
// Circuito: recibir/cancelar orden → eventos de la outbox → despachador → adaptación sintética (candidato NO materializable). Nada crea una solicitud operativa del TMS.
const scope: AdaptationScope = { environment: 'sandbox', tenantId: 1, clientId: 2, integrationId: 'PriceSmart', originClubReference: 'Club-A' };
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const input = { schemaVersion: 'api01-draft-1', externalOrderId: 'Order-A', originClubReference: 'Club-A' };

function circuit(resolve?: (c: LogisticsCandidate) => Promise<unknown>) {
  let now = 1_800_000_000_000; const orders = new ModelRepository(); const journal = new AdaptationModel(); const outbox = new OutboxModelStore(() => now);
  const resolver = { resolve: vi.fn(resolve ?? (async (c: LogisticsCandidate) => ({ scope: c.scope, candidateId: c.candidateId, orderId: c.orderId, requestReference: 'qa-request:' + c.orderId, assurance: 'SIMULATED' }))) };
  const adaptation = createTmsAdaptation({ resolver, repository: journal, nowMs: () => now, source: { load: async (context, id) => {
    const order = [...orders.orders.values()].find(row => row.id === id && orders.orders.get(orders.key(context, row.input.externalOrderId))?.id === id && row.input.originClubReference === context.originClubReference);
    return order ? { scope: { ...context }, orderId: order.id, input: order.input, state: order.state, version: order.version, correlationId: order.correlationId, receivedAt: order.receivedAt, cancellationReason: order.cancellationReason, assurance: 'SIMULATED' } : null;
  } } }, 1000);
  const app = new OrderApplication({ resolve: async () => ({ ...scope, scopes: ['orders:create', 'orders:read', 'orders:cancel'] }) }, orders);
  const logs: string[] = []; const policy = { ...DEFAULT_OUTBOX_POLICY, maxAttempts: 3, backoffBaseMs: 1_000, backoffMaxMs: 4_000 };
  const dispatcher = new OutboxDispatcher(outbox, createSyntheticAdaptationHandler(adaptation), policy, e => logs.push(`${e.outcome}:${e.code}`));
  const sync = () => { for (const e of orders.outbox.slice(synced)) outbox.enqueue({ scope, orderId: e.orderId, version: e.version, type: e.type, reason: e.reason, correlationId: e.correlationId }); synced = orders.outbox.length; };
  let synced = 0;
  return { orders, journal, outbox, adaptation, app, dispatcher, resolver, logs, sync, advance: (ms: number) => { now += ms; } };
}

describe('API-07 outbox → adaptación sintética (SIMULATED)', () => {
  it('una orden recibida produce un evento y el despachador lo adapta (candidato NO materializable) y lo cierra DONE', async () => {
    const f = circuit(); await f.app.receive(bytes(input)); f.sync(); expect(f.outbox.rows).toHaveLength(1);
    expect(await f.dispatcher.runOnce()).toMatchObject({ claimed: 1, done: 1 });
    const link = (await f.adaptation.get(scope, f.orders.outbox[0].orderId)).value;
    expect(link.candidate.materializable).toBe(false); expect(link.candidate.readiness).toBe('CONTRACT_PENDING'); expect(link.tmsRequestId).toBeNull(); expect(link.externalPriceSmartStatus).toBeNull(); expect(link.assurance).toBe('SIMULATED');
    expect(f.outbox.rows[0].status).toBe('DONE'); expect((await f.dispatcher.runOnce()).claimed).toBe(0);
    expect([...f.orders.orders.values()][0].tmsLinked).toBe(false);
  });
  it('una cancelación produce su evento y la adaptación pasa a CANCELLATION_REVIEW sin cancelar nada operativo', async () => {
    const f = circuit(); await f.app.receive(bytes(input)); await f.app.requestCancellation('Order-A', bytes({ reason: 'ORIGIN_REQUEST' })); f.sync(); expect(f.outbox.rows.map(r => r.event.type)).toEqual(['RECEIVED', 'CANCELLATION_REQUESTED']);
    expect(await f.dispatcher.runOnce()).toMatchObject({ claimed: 2, done: 2 });
    const link = (await f.adaptation.get(scope, f.orders.outbox[0].orderId)).value; expect(link.localDeliveryState).toBe('CANCELLATION_REVIEW'); expect(link.cancellationRequested).toBe(true);
    expect([...f.orders.orders.values()][0].state).toBe('CANCELLATION_REQUESTED'); expect([...f.orders.orders.values()][0].tmsLinked).toBe(false);
  });
  it('el orden de entrega de los eventos no importa: cancelación antes que recepción converge igual', async () => {
    const f = circuit(); await f.app.receive(bytes(input)); await f.app.requestCancellation('Order-A', bytes({ reason: 'DUPLICATE' })); f.sync();
    f.outbox.rows.reverse();   // se invierte la prioridad de reclamación
    f.outbox.rows[0].nextAttemptAtMs -= 10; expect(await f.dispatcher.runOnce()).toMatchObject({ done: 2 });
    expect((await f.adaptation.get(scope, f.orders.outbox[0].orderId)).value.localDeliveryState).toBe('CANCELLATION_REVIEW');
  });
  it('fallo temporal de la dependencia → RETRY con backoff y, al recuperarse, DONE en el intento 2 (idempotente: un solo vínculo)', async () => {
    let calls = 0; const f = circuit(async c => { if (calls++ === 0) throw new Error('SECRET dependency down'); return { scope: c.scope, candidateId: c.candidateId, orderId: c.orderId, requestReference: 'qa-request:' + c.orderId, assurance: 'SIMULATED' }; });
    await f.app.receive(bytes(input)); f.sync();
    expect(await f.dispatcher.runOnce()).toMatchObject({ retried: 1, done: 0 }); expect(f.outbox.rows[0]).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect((await f.dispatcher.runOnce()).claimed).toBe(0); f.advance(1_000);
    expect(await f.dispatcher.runOnce()).toMatchObject({ claimed: 1, done: 1 }); expect(f.outbox.rows[0]).toMatchObject({ status: 'DONE', attempts: 2 });
    expect(f.logs).toEqual(['RETRY:ADAPTATION_UNAVAILABLE', 'DONE:OK']); expect(JSON.stringify(f.logs)).not.toContain('SECRET');
    const phases = f.journal.traces.map(t => t.phase); expect(phases).toContain('FAILED'); expect(phases).toContain('SUCCEEDED');
  });
  it('la dependencia caída de forma persistente agota los intentos y la orden queda en REVIEW durable (no se pierde, no se marca DONE)', async () => {
    const f = circuit(async () => { throw new Error('down'); }); await f.app.receive(bytes(input)); f.sync();
    for (let i = 0; i < 2; i++) { await f.dispatcher.runOnce(); f.advance(60_000); }
    expect(await f.dispatcher.runOnce()).toMatchObject({ review: 1, done: 0 }); expect(f.outbox.rows[0]).toMatchObject({ status: 'REVIEW', attempts: 3 }); expect(f.logs.at(-1)).toBe('REVIEW:MAX_ATTEMPTS');
    expect([...f.orders.orders.values()]).toHaveLength(1);   // la orden aceptada sigue intacta
  });
  it('un evento de una orden inexistente o de otro club NO se arregla reintentando: REVIEW durable (NOT_FOUND)', async () => {
    const f = circuit(); await f.app.receive(bytes(input)); f.sync();
    f.outbox.enqueue({ scope, orderId: '00000000-0000-4000-8000-0000000000aa', version: 1, type: 'RECEIVED', reason: null, correlationId: '00000000-0000-4000-8000-0000000000bb' });
    f.outbox.enqueue({ scope: { ...scope, originClubReference: 'Club-Z' }, orderId: f.orders.outbox[0].orderId, version: 1, type: 'RECEIVED', reason: null, correlationId: '00000000-0000-4000-8000-0000000000cc' });
    expect(await f.dispatcher.runOnce()).toMatchObject({ claimed: 3, done: 1, review: 2 });
    expect(f.logs.filter(l => l === 'REVIEW:ADAPTATION_NOT_FOUND')).toHaveLength(2);
  });
  it('si la adaptación declara una garantía distinta de SIMULATED, el puente exige revisión y NO cierra DONE', async () => {
    const handler = createSyntheticAdaptationHandler({ process: async () => ({ value: {} as never, assurance: 'DURABLE' as 'SIMULATED', replayed: false }) });
    expect(await handler.handle({ scope, orderId: '00000000-0000-4000-8000-000000000001', version: 1, type: 'RECEIVED', reason: null, correlationId: '00000000-0000-4000-8000-000000000002' } as OutboxEvent)).toEqual({ kind: 'REVIEW', reason: 'UNEXPECTED_ASSURANCE' });
  });
  it('mapea errores: UNAVAILABLE → RETRY; CONFLICT/NOT_FOUND/INVALID_INPUT → REVIEW; error inesperado → RETRY', async () => {
    const ev: OutboxEvent = { scope, orderId: '00000000-0000-4000-8000-000000000001', version: 1, type: 'RECEIVED', reason: null, correlationId: '00000000-0000-4000-8000-000000000002' };
    const run = (code?: AdaptationError['code']) => createSyntheticAdaptationHandler({ process: async () => { throw code ? new AdaptationError(code) : new Error('x'); } }).handle(ev);
    expect(await run('UNAVAILABLE')).toEqual({ kind: 'RETRY', reason: 'ADAPTATION_UNAVAILABLE' });
    for (const code of ['CONFLICT', 'NOT_FOUND', 'INVALID_INPUT'] as const) expect(await run(code)).toEqual({ kind: 'REVIEW', reason: `ADAPTATION_${code}` });
    expect(await run()).toEqual({ kind: 'RETRY', reason: 'UNEXPECTED_ERROR' });
  });
  it('commandFor: RECEIVED → RECEIVE v1; CANCELLATION_REQUESTED → CANCEL con su versión y motivo; combinaciones inválidas se rechazan', () => {
    const base = { scope, orderId: '00000000-0000-4000-8000-000000000001', correlationId: '00000000-0000-4000-8000-000000000002' };
    expect(commandFor({ ...base, version: 1, type: 'RECEIVED', reason: null })).toEqual({ kind: 'RECEIVE', orderId: base.orderId, sourceVersion: 1, correlationId: base.correlationId });
    expect(commandFor({ ...base, version: 2, type: 'CANCELLATION_REQUESTED', reason: 'DUPLICATE' })).toEqual({ kind: 'CANCEL', orderId: base.orderId, sourceVersion: 2, reason: 'DUPLICATE', correlationId: base.correlationId });
    expect(() => commandFor({ ...base, version: 2, type: 'CANCELLATION_REQUESTED', reason: null })).toThrow(AdaptationError);
  });
  it('el puente no importa ni invoca puertos del TMS operativo: solo el comando de adaptación', () => {
    const resolver = vi.fn(); const process = vi.fn(async () => ({ value: {} as never, assurance: 'SIMULATED' as const, replayed: false }));
    return createSyntheticAdaptationHandler({ process }).handle({ scope, orderId: '00000000-0000-4000-8000-000000000001', version: 1, type: 'RECEIVED', reason: null, correlationId: '00000000-0000-4000-8000-000000000002' }).then(r => { expect(r).toEqual({ kind: 'DONE' }); expect(process).toHaveBeenCalledTimes(1); expect(resolver).not.toHaveBeenCalled(); });
  });
});
