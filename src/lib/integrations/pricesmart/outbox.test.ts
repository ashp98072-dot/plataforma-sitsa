import { afterEach, describe, expect, it, vi } from 'vitest';
import { backoffMs, DEFAULT_OUTBOX_POLICY, OutboxDispatcher, OutboxStoreError, validatePolicy, type OutboxEvent, type OutboxHandler, type OutboxLogEntry, type OutboxPolicy } from './outbox';
import { OutboxModelStore } from './__tests__/outbox-model';

// ALL SIMULATED: in-memory model of ps_api01_outbox (leases, fencing by attempts, durable REVIEW). Not a database test.
const scope = { environment: 'sandbox' as const, tenantId: 1, clientId: 2, integrationId: 'PriceSmart', originClubReference: 'Club-A' };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ev = (n: number, over: Partial<OutboxEvent> = {}): OutboxEvent => ({ scope, orderId: id(n), version: 1, type: 'RECEIVED', reason: null, correlationId: id(900 + n), ...over });
const policy = (over: Partial<OutboxPolicy> = {}): OutboxPolicy => ({ ...DEFAULT_OUTBOX_POLICY, batchSize: 5, leaseMs: 10_000, maxAttempts: 3, backoffBaseMs: 1_000, backoffMaxMs: 8_000, ...over });
function setup(handler: OutboxHandler, over: Partial<OutboxPolicy> = {}) {
  let now = 1_000_000; const store = new OutboxModelStore(() => now); const logs: OutboxLogEntry[] = [];
  const dispatcher = new OutboxDispatcher(store, handler, policy(over), e => logs.push(e));
  return { store, dispatcher, logs, advance: (ms: number) => { now += ms; }, now: () => now, make: (h: OutboxHandler, o: Partial<OutboxPolicy> = {}) => new OutboxDispatcher(store, h, policy(o), e => logs.push(e)) };
}
const ok: OutboxHandler = { handle: async () => ({ kind: 'DONE' }) };
afterEach(() => vi.useRealTimers());

describe('API-07 despachador de outbox (SIMULATED)', () => {
  it('procesa un lote y cierra DONE solo cuando el handler lo confirma', async () => {
    const f = setup(ok); f.store.enqueue(ev(1)); f.store.enqueue(ev(2));
    expect(await f.dispatcher.runOnce()).toEqual({ claimed: 2, done: 2, retried: 0, review: 0, lostLease: 0, unrecorded: 0 });
    expect(f.store.rows.map(r => r.status)).toEqual(['DONE', 'DONE']); expect(f.store.rows.map(r => r.attempts)).toEqual([1, 1]);
    expect(await f.dispatcher.runOnce()).toMatchObject({ claimed: 0 });   // lo cerrado no se vuelve a reclamar
  });
  it('respeta el tamaño de lote y el orden de vencimiento', async () => {
    const seen: string[] = []; const f = setup({ handle: async e => { seen.push(e.orderId); return { kind: 'DONE' }; } }, { batchSize: 2 });
    for (const n of [3, 1, 2]) f.store.enqueue(ev(n), 1_000_000 - n);
    expect((await f.dispatcher.runOnce()).claimed).toBe(2); expect(seen).toEqual([id(3), id(2)]);
    expect((await f.dispatcher.runOnce()).claimed).toBe(1);
  });
  it('RETRY: vuelve a PENDING con backoff exponencial acotado y no se reclama antes de tiempo', async () => {
    const f = setup({ handle: async () => ({ kind: 'RETRY', reason: 'DEPENDENCY_DOWN' }) }, { maxAttempts: 10, backoffBaseMs: 1_000, backoffMaxMs: 4_000 });
    f.store.enqueue(ev(1)); const row = f.store.rows[0]; const waits: number[] = [];
    for (let i = 0; i < 4; i++) { const t = f.now(); expect((await f.dispatcher.runOnce()).retried).toBe(1); waits.push(row.nextAttemptAtMs - t); expect(row.status).toBe('PENDING'); expect((await f.dispatcher.runOnce()).claimed).toBe(0); f.advance(waits[i]); }
    expect(waits).toEqual([1_000, 2_000, 4_000, 4_000]);
  });
  it('agotar los intentos pasa a REVIEW durable: la orden NO se pierde ni se marca DONE', async () => {
    const f = setup({ handle: async () => ({ kind: 'RETRY', reason: 'X' }) }, { maxAttempts: 3 }); f.store.enqueue(ev(1));
    for (let i = 0; i < 2; i++) { await f.dispatcher.runOnce(); f.advance(60_000); }
    expect(await f.dispatcher.runOnce()).toMatchObject({ review: 1, retried: 0, done: 0 });
    const row = f.store.rows[0]; expect(row.status).toBe('REVIEW'); expect(row.attempts).toBe(3);
    f.advance(10 * 3_600_000); expect((await f.dispatcher.runOnce()).claimed).toBe(0);   // REVIEW no se reintenta sola
    expect(f.logs.at(-1)).toMatchObject({ outcome: 'REVIEW', code: 'MAX_ATTEMPTS' });
  });
  it('REVIEW explícito del handler es durable', async () => {
    const f = setup({ handle: async () => ({ kind: 'REVIEW', reason: 'CONTRACT_PENDING' }) }); f.store.enqueue(ev(1));
    expect(await f.dispatcher.runOnce()).toMatchObject({ review: 1 }); expect(f.store.rows[0].status).toBe('REVIEW');
  });
  it.each([undefined, null, 'DONE', {}, { kind: 'OK' }, { kind: 'DONE', extra: 1 }, { kind: 'RETRY' }, { kind: 'RETRY', reason: 7 }, { kind: 'done' }, 42])('salida inválida del handler (%j) → REVIEW, NUNCA DONE', async bad => {
    const f = setup({ handle: async () => bad }); f.store.enqueue(ev(1));
    expect(await f.dispatcher.runOnce()).toMatchObject({ review: 1, done: 0 }); expect(f.store.rows[0].status).toBe('REVIEW'); expect(f.logs[0].code).toBe('INVALID_OUTCOME');
  });
  it('una excepción del handler es RETRY y su mensaje (que puede traer datos) no se conserva ni se registra', async () => {
    const f = setup({ handle: async () => { throw new Error('SQL_SECRET password=hunter2 externalOrderId=Order-A'); } }); f.store.enqueue(ev(1));
    expect(await f.dispatcher.runOnce()).toMatchObject({ retried: 1 }); expect(JSON.stringify(f.logs)).not.toMatch(/hunter2|SQL_SECRET|Order-A/); expect(f.logs[0].code).toBe('HANDLER_ERROR');
  });
  it('los motivos libres del handler se registran solo como códigos', async () => {
    const f = setup({ handle: async () => ({ kind: 'RETRY', reason: 'texto libre con datos de Order-A' }) }); f.store.enqueue(ev(1)); await f.dispatcher.runOnce();
    expect(f.logs[0].code).toBe('UNSPECIFIED'); expect(JSON.stringify(f.logs)).not.toContain('Order-A');
  });
  it('un handler que excede la lease cuenta como RETRY (HANDLER_TIMEOUT) y libera el lote', async () => {
    vi.useFakeTimers(); const f = setup({ handle: () => new Promise(() => {}) }, { leaseMs: 5_000 }); f.store.enqueue(ev(1));
    const run = f.dispatcher.runOnce(); await vi.advanceTimersByTimeAsync(5_001); expect(await run).toMatchObject({ retried: 1 }); expect(f.logs[0].code).toBe('HANDLER_TIMEOUT');
  });
  it('el handler recibe una copia: mutarla no altera el evento de la fila', async () => {
    const f = setup({ handle: async e => { (e as { orderId: string }).orderId = 'x'; (e.scope as { tenantId: number }).tenantId = 99; return { kind: 'DONE' }; } }); f.store.enqueue(ev(1)); await f.dispatcher.runOnce();
    expect(f.store.rows[0].event.orderId).toBe(id(1)); expect(f.store.rows[0].event.scope.tenantId).toBe(1);
  });
  it('lease vencida: otro despachador reclama (worker caído) y el rezagado NO pisa (fencing por attempts)', async () => {
    const f = setup(ok); f.store.enqueue(ev(1));
    const claimA = (await f.store.claim(5, 10_000))[0]; expect(claimA.attempt).toBe(1);               // worker A reclama y "se cae"
    expect((await f.dispatcher.runOnce()).claimed).toBe(0);                                          // aún vigente
    f.advance(10_001);
    expect(await f.dispatcher.runOnce()).toMatchObject({ claimed: 1, done: 1 }); expect(f.store.rows[0].attempts).toBe(2);   // B reclama el intento 2 y cierra
    expect(await f.store.complete(claimA)).toBe(false); expect(await f.store.retry(claimA, 1)).toBe(false); expect(await f.store.review(claimA)).toBe(false);   // A rezagado
    expect(f.store.rows[0].status).toBe('DONE');
  });
  it('fencing: si el evento es reclamado por otro MIENTRAS el handler corre, el cierre del primero se descarta (lostLease)', async () => {
    const f = setup({ handle: async () => { f.advance(10_001); await f.store.claim(5, 10_000); return { kind: 'DONE' }; } }); f.store.enqueue(ev(1));
    expect(await f.dispatcher.runOnce()).toMatchObject({ lostLease: 1, done: 0 }); expect(f.store.rows[0].status).toBe('LEASED'); expect(f.store.rows[0].attempts).toBe(2);
    expect(f.logs[0]).toMatchObject({ outcome: 'LOST_LEASE', code: 'FENCING' });
  });
  it('dos despachadores sobre el mismo almacén nunca reclaman el mismo evento a la vez', async () => {
    const f = setup(ok, { batchSize: 3 }); for (let n = 1; n <= 6; n++) f.store.enqueue(ev(n));
    const a = await f.store.claim(3, 10_000); const b = await f.store.claim(3, 10_000);
    expect(new Set([...a, ...b].map(c => c.event.orderId)).size).toBe(6);
  });
  it('aislamiento por alcance: el handler recibe el alcance completo de cada evento sin mezclar', async () => {
    const seen: string[] = []; const f = setup({ handle: async e => { seen.push(`${e.scope.tenantId}/${e.scope.clientId}/${e.scope.integrationId}/${e.scope.originClubReference}`); return { kind: 'DONE' }; } });
    f.store.enqueue(ev(1)); f.store.enqueue(ev(2, { scope: { ...scope, tenantId: 9, originClubReference: 'Club-Z' } })); await f.dispatcher.runOnce();
    expect(seen.sort()).toEqual(['1/2/PriceSmart/Club-A', '9/2/PriceSmart/Club-Z']);
  });
  it('un fallo al CERRAR un evento no detiene el lote: se cuenta unrecorded y la lease vencida lo reintentará', async () => {
    const f = setup(ok); f.store.enqueue(ev(1)); f.store.enqueue(ev(2)); f.store.failNext = 'complete';
    expect(await f.dispatcher.runOnce()).toMatchObject({ claimed: 2, done: 1, unrecorded: 1 }); expect(f.store.rows.map(r => r.status).sort()).toEqual(['DONE', 'LEASED']);
    f.advance(10_001); expect(await f.dispatcher.runOnce()).toMatchObject({ claimed: 1, done: 1 });
  });
  it('un fallo al RECLAMAR se propaga y no deja nada reclamado', async () => {
    const f = setup(ok); f.store.enqueue(ev(1)); f.store.failNext = 'claim'; await expect(f.dispatcher.runOnce()).rejects.toThrow(); expect(f.store.rows[0].status).toBe('PENDING');
  });
  it('un almacén que devuelve reclamaciones corruptas o de más hace fallar la ejecución sin invocar al handler', async () => {
    const handle = vi.fn(async () => ({ kind: 'DONE' as const })); const mk = (claims: unknown) => new OutboxDispatcher({ claim: async () => claims as never, complete: async () => true, retry: async () => true, review: async () => true }, { handle }, policy({ batchSize: 2 }));
    for (const bad of ['x', [{ event: { orderId: 'no-uuid' }, attempt: 1 }], [{ event: ev(1), attempt: 0 }], [{ event: ev(1), attempt: 1 }, { event: ev(2), attempt: 1 }, { event: ev(3), attempt: 1 }], [{ event: ev(1, { type: 'CANCELLATION_REQUESTED' }), attempt: 1 }]]) await expect(mk(bad).runOnce()).rejects.toBeInstanceOf(OutboxStoreError);
    expect(handle).not.toHaveBeenCalled();
  });
  it('no crea temporizadores periódicos ni deja temporizadores pendientes', async () => {
    const setI = vi.spyOn(globalThis, 'setInterval'); const f = setup(ok); f.store.enqueue(ev(1)); await f.dispatcher.runOnce(); expect(setI).not.toHaveBeenCalled(); setI.mockRestore();
    vi.useFakeTimers(); const g = setup(ok); g.store.enqueue(ev(1)); await g.dispatcher.runOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('política y backoff', () => {
  it('valores por defecto válidos y acotados', () => { expect(validatePolicy(DEFAULT_OUTBOX_POLICY)).toEqual(DEFAULT_OUTBOX_POLICY); expect(Object.isFrozen(DEFAULT_OUTBOX_POLICY)).toBe(true); });
  it.each([{ batchSize: 0 }, { batchSize: 101 }, { batchSize: 1.5 }, { leaseMs: 999 }, { leaseMs: 3_600_001 }, { maxAttempts: 0 }, { maxAttempts: 101 }, { backoffBaseMs: 0 }, { backoffBaseMs: 9_000, backoffMaxMs: 8_000 }, { backoffMaxMs: 86_400_001 }, { batchSize: Number.NaN }])('rechaza la política %j', over => {
    expect(() => validatePolicy(policy(over))).toThrow(OutboxStoreError); expect(() => new OutboxDispatcher(new OutboxModelStore(() => 0), ok, policy(over))).toThrow();
  });
  it('backoff exponencial acotado, sin desbordar con intentos enormes', () => {
    const p = policy({ backoffBaseMs: 1_000, backoffMaxMs: 300_000 });
    expect([1, 2, 3, 4, 9, 10, 1_000_000].map(a => backoffMs(p, a))).toEqual([1_000, 2_000, 4_000, 8_000, 256_000, 300_000, 300_000]);
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => backoffMs(p, bad)).toThrow();
  });
});
