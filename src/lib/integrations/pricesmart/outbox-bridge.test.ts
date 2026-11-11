import { describe, expect, it, vi } from 'vitest';
import { OrderApplication } from './service';
import { ModelRepository } from './__tests__/model-repository';
import { AdaptationModel } from './__tests__/tms-adaptation-model';
import { OutboxModelStore } from './__tests__/outbox-model';
import { BRIDGE_MODE, createMariaDbSimulatedBridge, createSimulatedOrderBridge, createSyntheticCandidateResolver } from './outbox-bridge';
import { DEFAULT_OUTBOX_POLICY } from './outbox';
import { AdaptationError, type AdaptationScope, type LogisticsCandidate } from './tms-adaptation-contracts';

// ALL SIMULATED: órdenes (ModelRepository), diario de adaptación (AdaptationModel) y outbox (OutboxModelStore) son dobles en memoria.
// Prueba la COMPOSICIÓN: orden recibida/cancelada → outbox → despachador → adaptación sintética. Nada crea una solicitud operativa del TMS.
const scope: AdaptationScope = { environment: 'sandbox', tenantId: 1, clientId: 2, integrationId: 'PriceSmart', originClubReference: 'Club-A' };
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const body = (externalOrderId: string) => ({ schemaVersion: 'api01-draft-1', externalOrderId, originClubReference: 'Club-A' });

function fixture(options: { resolve?: (c: LogisticsCandidate) => Promise<unknown>; policy?: Partial<typeof DEFAULT_OUTBOX_POLICY> } = {}) {
  let now = 1_800_000_000_000; const orders = new ModelRepository(); const journal = new AdaptationModel(); const outbox = new OutboxModelStore(() => now);
  const resolver = { resolve: vi.fn(options.resolve ?? (async (c: LogisticsCandidate) => ({ scope: c.scope, candidateId: c.candidateId, orderId: c.orderId, requestReference: 'qa-request:' + c.orderId, assurance: 'SIMULATED' }))) };
  const source = { load: vi.fn(async (context: AdaptationScope, id: string) => {
    const order = [...orders.orders.values()].find(row => row.id === id && orders.orders.get(orders.key(context, row.input.externalOrderId))?.id === id && row.input.originClubReference === context.originClubReference);
    return order ? { scope: { ...context }, orderId: order.id, input: order.input, state: order.state, version: order.version, correlationId: order.correlationId, receivedAt: order.receivedAt, cancellationReason: order.cancellationReason, assurance: 'SIMULATED' } : null;
  }) };
  const logs: string[] = []; const policy = { ...DEFAULT_OUTBOX_POLICY, maxAttempts: 3, backoffBaseMs: 1_000, backoffMaxMs: 4_000, ...options.policy };
  const bridge = createSimulatedOrderBridge({ outbox, source, resolver, repository: journal, nowMs: () => now, policy, log: e => logs.push(`${e.outcome}:${e.code}`) });
  const app = new OrderApplication({ resolve: async () => ({ ...scope, scopes: ['orders:create', 'orders:read', 'orders:cancel'] }) }, orders);
  let synced = 0;
  const sync = () => { for (const e of orders.outbox.slice(synced)) outbox.enqueue({ scope, orderId: e.orderId, version: e.version, type: e.type, reason: e.reason, correlationId: e.correlationId }); synced = orders.outbox.length; };
  return { orders, journal, outbox, bridge, app, resolver, source, logs, sync, advance: (ms: number) => { now += ms; } };
}
const link = (f: ReturnType<typeof fixture>, externalOrderId: string) => [...f.journal.links.values()].find(l => l.externalOrderId === externalOrderId);

describe('puente orden → outbox → TMS (SIMULATED)', () => {
  it('declara el modo SIMULATED y expone solo runOnce (sin temporizadores)', () => {
    const f = fixture(); expect(f.bridge.mode).toBe(BRIDGE_MODE); expect(BRIDGE_MODE).toBe('SIMULATED'); expect(Object.keys(f.bridge).sort()).toEqual(['mode', 'runOnce']); expect(Object.isFrozen(f.bridge)).toBe(true);
    const timers = vi.spyOn(globalThis, 'setInterval'); void f.bridge.runOnce(); expect(timers).not.toHaveBeenCalled(); timers.mockRestore();
  });
  it('recibe una orden y la adapta: un candidato NO materializable, sin solicitud TMS ni estado externo; la orden de origen no se toca', async () => {
    const f = fixture(); await f.app.receive(bytes(body('Order-A'))); f.sync();
    const summary = await f.bridge.runOnce();
    expect(summary).toEqual({ claimed: 1, done: 1, retried: 0, review: 0, lostLease: 0, unrecorded: 0 }); expect(f.logs).toEqual(['DONE:OK']);
    const adapted = link(f, 'Order-A')!;
    expect(adapted).toMatchObject({ assurance: 'SIMULATED', tmsRequestId: null, externalPriceSmartStatus: null, cancellationRequested: false, localDeliveryState: 'LOGISTICS_REVIEW' });
    expect(adapted.candidate).toMatchObject({ materializable: false, readiness: 'CONTRACT_PENDING', commercialData: null, requestedDate: null, tmsActor: null });
    expect([...f.orders.orders.values()][0]).toMatchObject({ state: 'RECEIVED', tmsLinked: false }); expect(f.resolver.resolve).toHaveBeenCalledTimes(1);
  });
  it('una segunda pasada no reprocesa lo ya cerrado', async () => {
    const f = fixture(); await f.app.receive(bytes(body('Order-A'))); f.sync(); await f.bridge.runOnce();
    expect(await f.bridge.runOnce()).toMatchObject({ claimed: 0 }); expect(f.resolver.resolve).toHaveBeenCalledTimes(1);
  });
  it('cancelación: pasa a revisión de cancelación y no cancela ni confirma nada fuera', async () => {
    const f = fixture(); await f.app.receive(bytes(body('Order-A'))); f.sync(); await f.bridge.runOnce();
    await f.app.requestCancellation('Order-A', bytes({ reason: 'ORIGIN_REQUEST' })); f.sync(); expect(await f.bridge.runOnce()).toMatchObject({ claimed: 1, done: 1 });
    expect(link(f, 'Order-A')).toMatchObject({ localDeliveryState: 'CANCELLATION_REVIEW', cancellationRequested: true, sourceState: 'CANCELLATION_REQUESTED', tmsRequestId: null, externalPriceSmartStatus: null });
    expect([...f.orders.orders.values()][0].state).toBe('CANCELLATION_REQUESTED');   // nunca CANCELLED por el puente
  });
  it('el resultado es el mismo si recepción y cancelación llegan en el mismo lote o en lotes sucesivos', async () => {
    const together = fixture(); await together.app.receive(bytes(body('Order-A'))); await together.app.requestCancellation('Order-A', bytes({ reason: 'DUPLICATE' })); together.sync();
    expect(await together.bridge.runOnce()).toMatchObject({ claimed: 2, done: 2 });
    const apart = fixture(); await apart.app.receive(bytes(body('Order-A'))); apart.sync(); await apart.bridge.runOnce(); await apart.app.requestCancellation('Order-A', bytes({ reason: 'DUPLICATE' })); apart.sync(); await apart.bridge.runOnce();
    const final = (f: ReturnType<typeof fixture>) => { const l = link(f, 'Order-A')!; return { state: l.localDeliveryState, cancel: l.cancellationRequested, tms: l.tmsRequestId, source: l.sourceState }; };
    expect(final(together)).toEqual(final(apart)); expect(final(apart)).toEqual({ state: 'CANCELLATION_REVIEW', cancel: true, tms: null, source: 'CANCELLATION_REQUESTED' });
  });
  it('si el resolutor falla, la orden NO se pierde: reintento con espera y se completa al recuperarse', async () => {
    let healthy = false;
    const f = fixture({ resolve: async c => { if (!healthy) throw new Error('SQL SECRET'); return { scope: c.scope, candidateId: c.candidateId, orderId: c.orderId, requestReference: 'qa-request:' + c.orderId, assurance: 'SIMULATED' }; } });
    await f.app.receive(bytes(body('Order-A'))); f.sync();
    expect(await f.bridge.runOnce()).toMatchObject({ claimed: 1, retried: 1, done: 0 }); expect(link(f, 'Order-A')).toBeUndefined();
    expect(await f.bridge.runOnce()).toMatchObject({ claimed: 0 });   // todavía en espera
    healthy = true; f.advance(1_100); expect(await f.bridge.runOnce()).toMatchObject({ claimed: 1, done: 1 }); expect(link(f, 'Order-A')).toBeDefined();
    expect(f.logs.join(' ')).not.toContain('SECRET');
  });
  it('si el resolutor sigue fallando, al agotar intentos queda en REVIEW durable y la orden aceptada permanece intacta', async () => {
    const f = fixture({ resolve: async () => { throw new Error('caído'); } }); await f.app.receive(bytes(body('Order-A'))); f.sync();
    for (let i = 0; i < 4; i++) { await f.bridge.runOnce(); f.advance(5_000); }
    expect(f.logs).toEqual(['RETRY:ADAPTATION_UNAVAILABLE', 'RETRY:ADAPTATION_UNAVAILABLE', 'REVIEW:MAX_ATTEMPTS']);
    expect(f.outbox.rows[0]).toMatchObject({ status: 'REVIEW', attempts: 3 }); expect([...f.orders.orders.values()]).toHaveLength(1); expect([...f.orders.orders.values()][0].state).toBe('RECEIVED');
  });
  it('un evento cuya orden no existe en su alcance va a REVIEW (NOT_FOUND), no se reintenta ni se descarta', async () => {
    const f = fixture(); f.outbox.enqueue({ scope, orderId: '00000000-0000-4000-8000-0000000000aa', version: 1, type: 'RECEIVED', reason: null, correlationId: '00000000-0000-4000-8000-0000000000bb' });
    expect(await f.bridge.runOnce()).toMatchObject({ claimed: 1, review: 1 }); expect(f.logs).toEqual(['REVIEW:ADAPTATION_NOT_FOUND']); expect(f.outbox.rows[0].status).toBe('REVIEW'); expect(f.resolver.resolve).not.toHaveBeenCalled();
  });
  it('aislamiento: la lectura de la orden usa el alcance COMPLETO del evento, también con el mismo identificador externo en otro club', async () => {
    const f = fixture(); await f.app.receive(bytes(body('Order-A'))); f.sync();
    f.outbox.rows[0].event = { ...f.outbox.rows[0].event, scope: { ...scope, originClubReference: 'Club-B' } };
    expect(await f.bridge.runOnce()).toMatchObject({ review: 1 }); expect(f.source.load).toHaveBeenCalledWith(expect.objectContaining({ originClubReference: 'Club-B', tenantId: 1, clientId: 2 }), expect.any(String)); expect(f.journal.links.size).toBe(0);
  });
  it('rechaza una política inválida al componer y no admite dos ejecuciones simultáneas de la misma instancia', async () => {
    expect(() => fixture({ policy: { batchSize: 0 } })).toThrow(AdaptationError);
    const f = fixture(); await f.app.receive(bytes(body('Order-A'))); f.sync();
    const first = f.bridge.runOnce(); await expect(f.bridge.runOnce()).rejects.toMatchObject({ code: 'CONFLICT' }); await first; await expect(f.bridge.runOnce()).resolves.toMatchObject({ claimed: 0 });
  });
});

describe('puente durable (composición MariaDB) y resolutor sintético', () => {
  it('el resolutor sintético deriva una referencia local determinista y nunca toca el TMS', async () => {
    const f = fixture(); await f.app.receive(bytes(body('Order-A'))); f.sync();
    const candidate = (await (async () => { const o = [...f.orders.orders.values()][0]; const { candidateFromSnapshot } = await import('./tms-adaptation'); return candidateFromSnapshot({ scope, orderId: o.id, input: o.input, state: o.state, version: o.version, correlationId: o.correlationId, receivedAt: o.receivedAt, cancellationReason: null, assurance: 'SIMULATED' }); })());
    const resolver = createSyntheticCandidateResolver(); const a = await resolver.resolve(candidate); const b = await resolver.resolve(candidate);
    expect(a).toEqual(b); expect(a).toMatchObject({ requestReference: `synthetic:${candidate.orderId}`, assurance: 'SIMULATED', candidateId: candidate.candidateId, orderId: candidate.orderId });
  });
  it('rechaza un pool que no es de sandbox verificado antes de componer nada (también sin resolutor propio)', () => {
    expect(() => createMariaDbSimulatedBridge({ pool: {} as never, schema: 'sandbox_api02_test', workerUser: 'sandbox_api02_worker', nowMs: () => 1 })).toThrow();
  });
});
