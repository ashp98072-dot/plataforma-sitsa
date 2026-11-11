import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import * as isolation from '../../sandbox-db';
import { OrderApplication } from './service';
import { ModelRepository } from './__tests__/model-repository';
import { AdaptationModel } from './__tests__/tms-adaptation-model';
import { createTmsAdaptation } from './tms-adaptation';
import { mariaDbAdaptationRepository } from './adaptation-mariadb';
import { AdaptationError, type AdaptationJob, type AdaptationLink, type AdaptationScope, type AdaptationTrace } from './tms-adaptation-contracts';

// Driver protocol double only (SIMULATED). Verifica secuencia/forma del SQL, parámetros, mapeo de errores y saneamiento; NO prueba bloqueos, CAS ni durabilidad de un motor real (eso es B11).
const scope: AdaptationScope = { environment: 'sandbox', tenantId: 1, clientId: 2, integrationId: 'PriceSmart', originClubReference: 'Club-A' };
const now = 1_800_000_000_000;
async function build(): Promise<{ link: AdaptationLink; job: AdaptationJob }> {   // objetos VÁLIDOS producidos por la adaptación real (con el diario en memoria), usados como filas de la base
  const orders = new ModelRepository(); const journal = new AdaptationModel();
  const app = new OrderApplication({ resolve: async () => ({ ...scope, scopes: ['orders:create', 'orders:read', 'orders:cancel'] }) }, orders);
  await app.receive(new TextEncoder().encode(JSON.stringify({ schemaVersion: 'api01-draft-1', externalOrderId: 'Order-A', originClubReference: 'Club-A' })));
  const adaptation = createTmsAdaptation({ repository: journal, nowMs: () => now,
    resolver: { resolve: async c => ({ scope: c.scope, candidateId: c.candidateId, orderId: c.orderId, requestReference: 'qa-request:' + c.orderId, assurance: 'SIMULATED' }) },
    source: { load: async (ctx, id) => { const o = [...orders.orders.values()].find(r => r.id === id); return o ? { scope: { ...ctx }, orderId: o.id, input: o.input, state: o.state, version: o.version, correlationId: o.correlationId, receivedAt: o.receivedAt, cancellationReason: o.cancellationReason, assurance: 'SIMULATED' } : null; } } }, 1000);
  const event = orders.outbox[0];
  await adaptation.process(scope, { kind: 'RECEIVE', orderId: event.orderId, sourceVersion: 1, correlationId: event.correlationId });
  return { link: [...journal.links.values()][0], job: [...journal.jobs.values()][0] };
}
const { link, job } = await build();   // a nivel de módulo: las tablas de it.each se evalúan al recolectar
const bin = (id: string) => Buffer.from(id.replaceAll('-', ''), 'hex');
const jobRow = (j: AdaptationJob = job, over: Record<string, unknown> = {}) => ({ job_key: Buffer.from(j.key), order_id: bin(j.orderId), input_hash: Buffer.from(j.inputHash, 'hex'), version: j.version, attempt: j.attempt, status: j.status, lease_until_ms: j.leaseUntilMs, result_json: j.result ? JSON.stringify(j.result) : null, ...over });
const linkRow = (l: AdaptationLink = link, over: Record<string, unknown> = {}) => ({ order_id: bin(l.orderId), external_order_id: Buffer.from(l.externalOrderId), origin_club_reference: Buffer.from(l.scope.originClubReference), request_reference: l.requestReference === null ? null : Buffer.from(l.requestReference),
  version: l.version, source_version: l.sourceVersion, source_state: l.sourceState, local_delivery_state: l.localDeliveryState, cancellation_requested: l.cancellationRequested ? 1 : 0, correlation_id: bin(l.correlationId), link_json: JSON.stringify(l), ...over });
const trace = (over: Partial<AdaptationTrace> = {}): AdaptationTrace => ({ jobKey: job.key, orderId: job.orderId, attempt: 1, phase: 'STARTED', correlationId: link.correlationId, recordedAt: '2026-11-11T12:00:00.123Z', failure: null, observation: null, ...over });

function fixture(verified = true) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  let reply: (sql: string) => unknown = () => []; let fail = ''; let err: unknown = new Error('PASSWORD SECRET sql text'); let identity = { db: 'sandbox_api02_test', account: 'sandbox_api02_worker@127.0.0.1' };
  const conn = {
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      expect((sql.match(/\?/g) ?? []).length).toBe(params?.length ?? 0);
      calls.push({ sql, params }); if (fail && sql.includes(fail)) throw err;
      if (sql.startsWith('SELECT DATABASE')) return [[identity]];
      return [reply(sql)];
    }),
    beginTransaction: vi.fn(async () => { calls.push({ sql: 'BEGIN' }); }),
    commit: vi.fn(async () => { calls.push({ sql: 'COMMIT' }); if (fail === 'COMMIT') throw err; }),
    rollback: vi.fn(async () => { calls.push({ sql: 'ROLLBACK' }); }), release: vi.fn(), destroy: vi.fn(),
  };
  const pool = { getConnection: vi.fn(async () => conn) };
  if (verified) vi.spyOn(isolation, 'isSandboxVerifiedPool').mockImplementation(p => p === pool);
  const config = { schema: 'sandbox_api02_test', account: 'sandbox_api02_worker' };
  return { conn, pool, calls, config, repo: () => mariaDbAdaptationRepository(pool as unknown as Pool, config),
    set: { reply: (r: typeof reply) => { reply = r; }, fail: (at: string, e?: unknown) => { fail = at; if (e) err = e; }, identity: (v: typeof identity) => { identity = v; } } };
}
const sqlOf = (f: ReturnType<typeof fixture>) => f.calls.map(c => c.sql);
const ok = (affectedRows = 1) => ({ affectedRows });
const dup = (key: string) => Object.assign(new Error('Duplicate entry SECRET'), { code: 'ER_DUP_ENTRY', sqlMessage: `Duplicate entry 'x' for key '${key}'` });
afterEach(() => vi.restoreAllMocks());

describe('mariaDbAdaptationRepository: guardas', () => {
  it('rechaza pool no verificado, esquema ajeno y cuenta ajena antes de abrir conexión', () => {
    expect(fixture(false).repo).toThrow(AdaptationError);
    for (const schema of ['sandbox_pricesmart', 'production', 'sandbox_api02_x`;DROP TABLE y']) { const f = fixture(); f.config.schema = schema; expect(f.repo).toThrow(); expect(f.pool.getConnection).not.toHaveBeenCalled(); }
    for (const account of ['root', 'sandbox_api02_x`']) { const f = fixture(); f.config.account = account; expect(f.repo).toThrow(); }
  });
  it('valida el alcance antes de abrir conexión', async () => {
    const f = fixture(); await expect(f.repo().runAtomic({ ...scope, tenantId: 0 }, async () => 1)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(f.repo().runAtomic({ ...scope, environment: 'production' } as unknown as AdaptationScope, async () => 1)).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(f.pool.getConnection).not.toHaveBeenCalled();
  });
  it('rechaza una identidad SQL ajena antes de BEGIN y destruye la conexión', async () => {
    const f = fixture(); f.set.identity({ db: 'foreign', account: 'root@localhost' });
    await expect(f.repo().runAtomic(scope, async () => 1)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(f.conn.beginTransaction).not.toHaveBeenCalled(); expect(f.conn.destroy).toHaveBeenCalled(); expect(f.conn.release).not.toHaveBeenCalled();
  });
});

describe('mariaDbAdaptationRepository: transacción', () => {
  it('confirma una sola vez, después de la acción, y devuelve el literal SIMULATED del contrato', async () => {
    const f = fixture(); const result = await f.repo().runAtomic(scope, async () => 42);
    expect(result).toEqual({ value: 42, assurance: 'SIMULATED' }); expect(sqlOf(f).filter(s => s === 'COMMIT')).toHaveLength(1); expect(f.conn.release).toHaveBeenCalled();
    expect(sqlOf(f).indexOf('BEGIN')).toBeGreaterThan(sqlOf(f).findIndex(s => s.startsWith('SELECT DATABASE')));
  });
  it('si la acción falla revierte TODO y no confirma; el error original de dominio se conserva y el SQL se sanea', async () => {
    const f = fixture(); await expect(f.repo().runAtomic(scope, async tx => { await tx.appendTrace(trace()); throw new AdaptationError('CONFLICT'); })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(sqlOf(f)).toContain('ROLLBACK'); expect(sqlOf(f)).not.toContain('COMMIT');
    const g = fixture(); g.set.fail('INSERT', new Error('PASSWORD SECRET sql text')); const e = await g.repo().runAtomic(scope, tx => tx.appendTrace(trace())).catch(x => x);
    expect(e).toBeInstanceOf(AdaptationError); expect(e.code).toBe('UNAVAILABLE'); expect(JSON.stringify(e) + e.message).not.toMatch(/SECRET|PASSWORD|sql text/); expect(sqlOf(g)).toContain('ROLLBACK');
  });
  it('si el COMMIT falla (resultado desconocido) responde UNAVAILABLE y destruye la conexión', async () => {
    const f = fixture(); f.set.fail('COMMIT'); await expect(f.repo().runAtomic(scope, async () => 1)).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(f.conn.destroy).toHaveBeenCalled(); expect(f.conn.release).not.toHaveBeenCalled();
  });
  it('rechaza operaciones solapadas dentro de una transacción y la deja inutilizable', async () => {
    const f = fixture(); f.set.reply(() => [jobRow()]);
    await expect(f.repo().runAtomic(scope, async tx => { await Promise.all([tx.job(job.key), tx.job(job.key)]); })).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(sqlOf(f)).not.toContain('COMMIT');
  });
  it('una operación posterior a un fallo SQL queda envenenada (no hay confirmación parcial)', async () => {
    const f = fixture(); f.set.fail('INSERT');
    await expect(f.repo().runAtomic(scope, async tx => { await tx.appendTrace(trace()).catch(() => undefined); await tx.appendTrace(trace({ phase: 'REPLAY' })); })).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(sqlOf(f)).not.toContain('COMMIT');
  });
  it('ninguna operación emite DELETE/DROP/TRUNCATE/ALTER/DDL; todo con alcance completo y marcadores', async () => {
    const f = fixture(); f.set.reply(s => (s.startsWith('SELECT job_key') ? [jobRow()] : s.startsWith('SELECT order_id') ? [linkRow()] : ok()));
    await f.repo().runAtomic(scope, async tx => { await tx.job(job.key); await tx.saveJob({ ...job, version: job.version + 1 }, job.version); await tx.link(link.orderId); await tx.saveLink({ ...link, version: link.version + 1 }, link.version); await tx.appendTrace(trace()); });
    for (const c of f.calls) { expect(c.sql).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REPLACE)\b/i); if (/ps_api09_adapt_/.test(c.sql)) expect(c.sql).toMatch(/`sandbox_api02_test`\.`ps_api09_adapt_(jobs|links|traces)`/); }
    for (const c of f.calls.filter(x => /^(SELECT job_key|UPDATE|SELECT order_id)/.test(x.sql))) { for (const col of ['environment=?', 'tenant_id=?', 'client_id=?', 'integration_id=?']) expect(c.sql).toContain(col); expect(c.params!.slice(c.sql.startsWith('UPDATE') ? -7 : 0).length).toBeGreaterThan(0); }
  });
});

describe('mariaDbAdaptationRepository: trabajos (idempotencia y CAS)', () => {
  it('job(): null si no existe; si existe lo devuelve validado y bloquea la fila (FOR UPDATE) con alcance completo', async () => {
    const f = fixture(); const none = await f.repo().runAtomic(scope, tx => tx.job(job.key)); expect(none.value).toBeNull();
    const g = fixture(); g.set.reply(() => [jobRow()]); const found = await g.repo().runAtomic(scope, tx => tx.job(job.key)); expect(found.value).toEqual(job);
    const query = g.calls.find(c => c.sql.startsWith('SELECT job_key'))!; expect(query.sql).toContain('FOR UPDATE'); expect(query.params).toEqual([Buffer.from('sandbox'), 1, 2, Buffer.from('PriceSmart'), expect.any(Buffer)]);
    expect((query.params![4] as Buffer).length).toBe(32);
  });
  it.each([
    ['clave distinta a la pedida', jobRow(job, { job_key: Buffer.from('otra-clave') })], ['estado desconocido', jobRow(job, { status: 'EXPLOTADO' })],
    ['DONE sin resultado', jobRow(job, { result_json: null })], ['resultado no JSON', jobRow(job, { result_json: '{no es json' })], ['hash de entrada corto', jobRow(job, { input_hash: Buffer.from('ab', 'hex') })],
  ])('fila de trabajo corrupta (%s) falla cerrado', async (_name, row) => {
    const f = fixture(); f.set.reply(() => [row]); await expect(f.repo().runAtomic(scope, tx => tx.job(job.key))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('saveJob inserta con versión previa nula (clave hash + clave en claro + resultado) y actualiza con CAS por versión', async () => {
    const f = fixture(); f.set.reply(() => ok()); await f.repo().runAtomic(scope, async tx => { await tx.saveJob(job, null); await tx.saveJob({ ...job, version: job.version + 1 }, job.version); });
    const insert = f.calls.find(c => c.sql.startsWith('INSERT INTO'))!; expect(insert.sql).toContain('ps_api09_adapt_jobs'); expect(insert.params!.slice(0, 4)).toEqual([Buffer.from('sandbox'), 1, 2, Buffer.from('PriceSmart')]);
    expect(insert.params![5]).toEqual(Buffer.from(job.key)); expect(insert.params![12]).toBe(JSON.stringify(job.result));
    const update = f.calls.find(c => c.sql.startsWith('UPDATE'))!; expect(update.sql).toMatch(/WHERE .*job_key_hash=\? AND version=\?$/); expect(update.params!.at(-1)).toBe(job.version);
  });
  it('un trabajo ya creado por otro intento (PRIMARY duplicada) es CONFLICT; la versión obsoleta (0 filas) también', async () => {
    const f = fixture(); f.set.fail('INSERT', dup('PRIMARY')); await expect(f.repo().runAtomic(scope, tx => tx.saveJob(job, null))).rejects.toMatchObject({ code: 'CONFLICT' });
    const g = fixture(); g.set.reply(() => ok(0)); await expect(g.repo().runAtomic(scope, tx => tx.saveJob({ ...job, version: 9 }, 8))).rejects.toMatchObject({ code: 'CONFLICT' }); expect(sqlOf(g)).toContain('ROLLBACK');
    const h = fixture(); h.set.fail('INSERT', dup('uq_otra')); await expect(h.repo().runAtomic(scope, tx => tx.saveJob(job, null))).rejects.toMatchObject({ code: 'UNAVAILABLE' });   // otra clave no se confunde con la idempotencia
  });
});

describe('mariaDbAdaptationRepository: vínculos', () => {
  it('link(): null si no existe; lo devuelve validado y coherente con sus columnas', async () => {
    const f = fixture(); expect((await f.repo().runAtomic(scope, tx => tx.link(link.orderId))).value).toBeNull();
    const g = fixture(); g.set.reply(() => [linkRow()]); expect((await g.repo().runAtomic(scope, tx => tx.link(link.orderId))).value).toEqual(link);
    expect(g.calls.find(c => c.sql.startsWith('SELECT order_id'))!.sql).toContain('FOR UPDATE');
  });
  it.each([
    ['versión distinta', { version: 99 }], ['referencia de solicitud distinta', { request_reference: Buffer.from('otra') }], ['estado local distinto', { local_delivery_state: 'REVIEW_REQUIRED' }],
    ['club distinto', { origin_club_reference: Buffer.from('Club-B') }], ['cancelación distinta', { cancellation_requested: 1 }], ['JSON ilegible', { link_json: '{{' }], ['id externo distinto', { external_order_id: Buffer.from('Order-X') }],
  ])('columnas y JSON discrepantes (%s) fallan cerrado', async (_name, over) => {
    const f = fixture(); f.set.reply(() => [linkRow(link, over)]); await expect(f.repo().runAtomic(scope, tx => tx.link(link.orderId))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('saveLink inserta o actualiza con CAS y guarda el JSON validado junto a las columnas; nunca un id de TMS', async () => {
    const f = fixture(); f.set.reply(() => ok()); await f.repo().runAtomic(scope, async tx => { await tx.saveLink(link, null); await tx.saveLink({ ...link, version: link.version + 1 }, link.version); });
    const insert = f.calls.find(c => c.sql.startsWith('INSERT INTO'))!; expect(insert.sql).toContain('ps_api09_adapt_links'); expect(insert.sql).not.toMatch(/tms/i); expect(insert.params).toContain(JSON.stringify(link));
    const update = f.calls.find(c => c.sql.startsWith('UPDATE'))!; expect(update.sql).toMatch(/AND order_id=\? AND version=\?$/); expect(update.params!.at(-1)).toBe(link.version);
  });
  it('una referencia de solicitud ya usada por otra orden o un vínculo ya creado es CONFLICT; la versión obsoleta también', async () => {
    for (const key of ['uq_ps_api09_link_request', 'PRIMARY']) { const f = fixture(); f.set.fail('INSERT', dup(key)); await expect(f.repo().runAtomic(scope, tx => tx.saveLink(link, null))).rejects.toMatchObject({ code: 'CONFLICT' }); }
    const g = fixture(); g.set.reply(() => ok(0)); await expect(g.repo().runAtomic(scope, tx => tx.saveLink({ ...link, version: link.version + 1 }, link.version))).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('rechaza un vínculo con un id de TMS o campos extra antes de tocar la base', async () => {
    const f = fixture(); await expect(f.repo().runAtomic(scope, tx => tx.saveLink({ ...link, tmsRequestId: 'TMS-1' } as unknown as AdaptationLink, null))).rejects.toBeTruthy(); expect(f.calls.some(c => c.sql.startsWith('INSERT'))).toBe(false);
  });
});

describe('mariaDbAdaptationRepository: bitácora', () => {
  it('appendTrace sólo inserta (alcance, clave hash, fase, hora UTC con microsegundos, fallo, observación)', async () => {
    const f = fixture(); f.set.reply(() => ok()); await f.repo().runAtomic(scope, async tx => { await tx.appendTrace(trace()); await tx.appendTrace(trace({ phase: 'FAILED', failure: 'DEPENDENCY_FAILURE', recordedAt: '2026-11-11T12:00:01Z' })); });
    const inserts = f.calls.filter(c => c.sql.startsWith('INSERT INTO')); expect(inserts).toHaveLength(2); expect(inserts[0].sql).toContain('ps_api09_adapt_traces');
    expect(inserts[0].params).toEqual([Buffer.from('sandbox'), 1, 2, Buffer.from('PriceSmart'), expect.any(Buffer), bin(job.orderId), 1, 'STARTED', bin(link.correlationId), '2026-11-11 12:00:00.123', null, null]);
    expect(inserts[1].params!.slice(6, 11)).toEqual([1, 'FAILED', bin(link.correlationId), '2026-11-11 12:00:01', 'DEPENDENCY_FAILURE']);
  });
  it.each([['fase desconocida', { phase: 'OTRA' }], ['hora inválida', { recordedAt: 'ayer' }], ['id de orden inválido', { orderId: 'x' }]])('rechaza una traza inválida (%s) sin tocar la base', async (_n, over) => {
    const f = fixture(); await expect(f.repo().runAtomic(scope, tx => tx.appendTrace(trace(over as Partial<AdaptationTrace>)))).rejects.toBeTruthy(); expect(f.calls.some(c => c.sql.startsWith('INSERT'))).toBe(false);
  });
});
