import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import * as isolation from '../../sandbox-db';
import { mariaDbOrderRepository, PersistenceError } from './mariadb-repository';
import { OrderApplication } from './service';
import { OrderError, type Scope } from './contracts';
import { UniqueOrderCollision, type StoredOrder, type Transaction } from './ports';

// Driver protocol double only. No database, locking, permissions or durability evidence.
const scope: Scope = { environment: 'sandbox', tenantId: 1, clientId: 2, integrationId: 'PriceSmart' };
const id = '11111111-1111-4111-8111-111111111111';
const input = { schemaVersion: 'api01-draft-1' as const, externalOrderId: 'Order-A', originClubReference: 'Club-A' };
const order: StoredOrder = { id, input, inputHash: 'a'.repeat(64), state: 'RECEIVED', version: 1, correlationId: id,
  receivedAt: '2026-11-02T12:00:00.000Z', receipt: { externalOrderId: 'Order-A', provisionalStatus: 'RECEIVED', processingStatus: 'PENDING', version: 1, correlationId: id },
  cancellationHash: null, cancellationReason: null, cancellationReceipt: null, tmsLinked: false };
const bytes = Buffer.from(id.replaceAll('-', ''), 'hex');
const row = { id: bytes, origin_club_reference: Buffer.from('Club-A'), payload_version: Buffer.from(input.schemaVersion),
  payload_ciphertext: Buffer.from('opaque-test-only'), payload_key_reference: Buffer.from('test-key'), input_hash: Buffer.from(order.inputHash, 'hex'),
  state: 'RECEIVED', version: 1, correlation_id: bytes, received_at: new Date(order.receivedAt), receipt_json: JSON.stringify(order.receipt),
  cancellation_hash: null, cancellation_reason: null, cancellation_receipt_json: null, tms_linked: 0 };
function fixture(verified = true) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  let fail = ''; let failure: unknown = new Error('SQL SECRET'); let rows: unknown[] = [row]; let affected = 1;
  const conn = {
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      expect((sql.match(/\?/g) ?? []).length).toBe(params?.length ?? 0);
      calls.push({ sql, params }); if (fail && sql.includes(fail)) throw failure;
      if (sql.startsWith('SELECT DATABASE')) return [[{ db: 'sandbox_api02_test', account: 'sandbox_api02_test@127.0.0.1' }]];
      if (sql.startsWith('SELECT *')) return [rows]; return [{ affectedRows: affected }];
    }),
    beginTransaction: vi.fn(async () => { calls.push({ sql: 'BEGIN' }); }),
    commit: vi.fn(async () => { calls.push({ sql: 'COMMIT' }); if (fail === 'COMMIT') throw failure; }),
    rollback: vi.fn(async () => { calls.push({ sql: 'ROLLBACK' }); }), release: vi.fn(), destroy: vi.fn(),
  };
  const pool = { getConnection: vi.fn(async () => conn) };
  if (verified) vi.spyOn(isolation, 'isSandboxVerifiedPool').mockImplementation(p => p === pool);
  const config = { schema: 'sandbox_api02_test', runtimeUser: 'sandbox_api02_test', cipher: {
    seal: vi.fn(async () => ({ ciphertext: Buffer.from('opaque-test-only'), keyReference: 'test-key' })), open: vi.fn(async () => input),
  } };
  return { conn, pool, calls, config, repo: () => mariaDbOrderRepository(pool as unknown as Pool, config),
    fault: (at: string, error: unknown = failure) => { fail = at; failure = error; },
    rows: (value: unknown[]) => { rows = value; }, affected: (value: number) => { affected = value; } };
}
afterEach(() => vi.restoreAllMocks());
describe('MariaDB adapter protocol (doubles, not real transactions)', () => {
  it('rejects an unverified pool before acquiring a connection', () => {
    const f = fixture(false); expect(f.repo).toThrow(PersistenceError); expect(f.pool.getConnection).not.toHaveBeenCalled();
  });
  it.each(['sandbox_pricesmart', 'production', 'sandbox_api02_test`;DROP TABLE x'])('rejects unauthorized schema %s', schema => {
    const f = fixture(); f.config.schema = schema; expect(f.repo).toThrow(); expect(f.pool.getConnection).not.toHaveBeenCalled();
  });
  it('rejects S04 and root runtime profiles', () => {
    const f = fixture(); for (const user of ['root', 'sandbox_pricesmart']) { f.config.runtimeUser = user; expect(f.repo).toThrow(); }
  });
  it('rejects refused connection with sanitized error', async () => {
    const f = fixture(); f.pool.getConnection.mockRejectedValue(new Error('PASSWORD SECRET')); await expect(f.repo().runAtomic(scope, async () => 1)).rejects.toThrow('UNAVAILABLE');
  });
  it('rejects foreign DB identity before BEGIN', async () => {
    const f = fixture(); f.conn.execute.mockResolvedValueOnce([[{ db: 'foreign', account: 'root@localhost' }]] as never);
    await expect(f.repo().runAtomic(scope, async () => 1)).rejects.toThrow('UNAVAILABLE'); expect(f.conn.beginTransaction).not.toHaveBeenCalled();
  });
  it('inserts encrypted bytes with all scope fields and awaits COMMIT', async () => {
    const f = fixture(); let resolve!: () => void;
    f.conn.commit.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
    let done = false; const promise = f.repo().runAtomic(scope, async tx => { await tx.insert(order); return 9; }).then(v => { done = true; return v; });
    await vi.waitFor(() => expect(f.conn.commit).toHaveBeenCalled()); expect(done).toBe(false); resolve();
    expect(await promise).toEqual({ value: 9, durability: 'DURABLE' });
    const insert = f.calls.find(c => c.sql.startsWith('INSERT'))!;
    expect(insert.params!.slice(1,5)).toEqual([Buffer.from('sandbox'),1,2,Buffer.from('PriceSmart')]);
    expect(insert.sql).not.toContain('Order-A'); expect(insert.params).toContainEqual(Buffer.from('opaque-test-only'));
  });
  it('reads under full scope and FOR UPDATE, preserves identifier case', async () => {
    const f = fixture(); const result = await f.repo().runAtomic(scope, tx => tx.findForUpdate('Order-A'));
    expect(result.value).toEqual(order); const select = f.calls.find(c => c.sql.startsWith('SELECT *'))!;
    expect(select.sql).toContain('FOR UPDATE'); expect(select.params).toEqual([Buffer.from('sandbox'),1,2,Buffer.from('PriceSmart'),Buffer.from('Order-A')]);
  });
  it('returns no foreign tenant row and binds the supplied trusted scope', async () => {
    const f = fixture(); f.rows([]); expect((await f.repo().runAtomic({ ...scope, tenantId: 99 }, tx => tx.findForUpdate('Order-A'))).value).toBeNull();
    expect(f.calls.find(c => c.sql.startsWith('SELECT *'))!.params![1]).toBe(99);
  });
  it.each(['events','audit','outbox'])('rolls back failure in %s without success', async table => {
    const f = fixture(); f.fault(`ps_api01_${table}`); const app = new OrderApplication({ resolve: async () => ({ ...scope, originClubReference: 'Club-A', scopes: ['orders:create'] }) }, f.repo());
    await expect(app.receive(Buffer.from(JSON.stringify(input)))).rejects.toThrow('UNAVAILABLE'); expect(f.conn.rollback).toHaveBeenCalledOnce(); expect(f.conn.commit).not.toHaveBeenCalled();
  });
  it.each(['uq_ps_api01_identity','ps_api01_orders.uq_ps_api01_identity'])('maps only order identity key %s', async key => {
    const f = fixture(); f.fault('INSERT', { code: 'ER_DUP_ENTRY', sqlMessage: `Duplicate entry 'x' for key '${key}'` });
    await expect(f.repo().runAtomic(scope, tx => tx.insert(order))).rejects.toBeInstanceOf(UniqueOrderCollision); expect(f.conn.rollback).toHaveBeenCalledOnce();
  });
  it.each(['PRIMARY','uq_ps_api01_scoped_row','other.uq_ps_api01_identity'])('does not replay unrelated duplicate %s', async key => {
    const f = fixture(); f.fault('INSERT', { code: 'ER_DUP_ENTRY', sqlMessage: `Duplicate entry 'uq_ps_api01_identity' for key '${key}'` });
    await expect(f.repo().runAtomic(scope, tx => tx.insert(order))).rejects.toThrow('UNAVAILABLE');
  });
  it('rejects uncertain COMMIT, attempts rollback and destroys connection without retry', async () => {
    const f = fixture(); f.fault('COMMIT'); await expect(f.repo().runAtomic(scope, tx => tx.insert(order))).rejects.toThrow('COMMIT_UNKNOWN');
    expect(f.conn.rollback).toHaveBeenCalledOnce(); expect(f.conn.destroy).toHaveBeenCalledOnce(); expect(f.pool.getConnection).toHaveBeenCalledOnce();
  });
  it.each(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'])('makes %s retryable only through a new transaction', async code => {
    const f = fixture(); f.fault('INSERT', { code }); const repo = f.repo();
    await expect(repo.runAtomic(scope, tx => tx.insert(order))).rejects.toThrow('RETRYABLE'); f.fault('');
    await repo.runAtomic(scope, tx => tx.insert(order)); expect(f.pool.getConnection).toHaveBeenCalledTimes(2); expect(f.conn.beginTransaction).toHaveBeenCalledTimes(2);
  });
  it('updates only the expected version and rejects zero affected rows', async () => {
    const f = fixture(); f.affected(0);
    await expect(f.repo().runAtomic(scope, tx => tx.save({ ...order, version: 2 }, 1))).rejects.toEqual(new OrderError('CONFLICT'));
    const update = f.calls.find(c => c.sql.startsWith('UPDATE'))!; expect(update.sql).toContain('version=? AND tms_linked=0'); expect(update.params!.slice(-7)).toEqual([Buffer.from('sandbox'),1,2,Buffer.from('PriceSmart'),bytes,Buffer.from('Order-A'),1].slice(-7));
  });
  it('cancels atomically with event, audit and outbox before commit', async () => {
    const f = fixture(); const app = new OrderApplication({ resolve: async () => ({ ...scope, originClubReference: 'Club-A', scopes: ['orders:cancel'] }) }, f.repo());
    expect((await app.requestCancellation('Order-A', Buffer.from('{"reason":"ORIGIN_REQUEST"}'))).value.version).toBe(2);
    expect(f.calls.filter(c => /^(INSERT|UPDATE)/.test(c.sql))).toHaveLength(4); expect(f.calls.at(-1)!.sql).toBe('COMMIT');
  });
  it('rejects a conflicting replay and rolls back the fresh lookup transaction', async () => {
    const f = fixture(); f.fault('INSERT', { code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'x' for key 'uq_ps_api01_identity'" });
    const app = new OrderApplication({ resolve: async () => ({ ...scope, originClubReference: 'Club-A', scopes: ['orders:create'] }) }, f.repo());
    await expect(app.receive(Buffer.from(JSON.stringify(input)))).rejects.toThrow('CONFLICT'); expect(f.pool.getConnection).toHaveBeenCalledTimes(2);
  });
  it('replays identical input using a fresh transaction and immutable receipt', async () => {
    const f = fixture(); f.rows([{ ...row, state: 'CANCELLATION_REQUESTED', version: 2,
      input_hash: createHash('sha256').update(JSON.stringify([input.schemaVersion,input.externalOrderId,input.originClubReference])).digest() }]);
    f.fault('ps_api01_orders` (', { code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'x' for key 'uq_ps_api01_identity'" });
    const app = new OrderApplication({ resolve: async () => ({ ...scope, originClubReference: 'Club-A', scopes: ['orders:create'] }) }, f.repo());
    expect((await app.receive(Buffer.from(JSON.stringify(input)))).value).toEqual(order.receipt);
    expect(f.pool.getConnection).toHaveBeenCalledTimes(2); expect(f.conn.rollback).toHaveBeenCalledOnce(); expect(f.conn.commit).toHaveBeenCalledOnce();
  });
  it('rolls back even when callback swallows a write failure', async () => {
    const f = fixture(); f.fault('INSERT');
    await expect(f.repo().runAtomic(scope, async tx => { try { await tx.insert(order); } catch { /* deliberately swallowed */ } })).rejects.toThrow('UNAVAILABLE');
    expect(f.conn.commit).not.toHaveBeenCalled(); expect(f.conn.rollback).toHaveBeenCalledOnce();
  });
  it('destroys connection if rollback itself fails', async () => {
    const f = fixture(); f.fault('INSERT'); f.conn.rollback.mockRejectedValue(new Error('SECRET'));
    await expect(f.repo().runAtomic(scope, tx => tx.insert(order))).rejects.toThrow('UNAVAILABLE'); expect(f.conn.destroy).toHaveBeenCalledOnce();
  });
  it('creates order, event, audit and outbox before confirmed COMMIT', async () => {
    const f = fixture(); const app = new OrderApplication({ resolve: async () => ({ ...scope, originClubReference: 'Club-A', scopes: ['orders:create'] }) }, f.repo());
    const result = await app.receive(Buffer.from(JSON.stringify(input)));
    expect(result.value.provisionalStatus).toBe('RECEIVED');
    const writes = f.calls.filter(c => c.sql.startsWith('INSERT'));
    expect(writes).toHaveLength(4); expect(f.calls.at(-1)!.sql).toBe('COMMIT');
    for (const write of writes) expect(write.params).toContainEqual(Buffer.from('PriceSmart'));
    expect(f.conn.rollback).not.toHaveBeenCalled();
  });
  it.each(['events','audit','outbox'])('never maps duplicate in %s to order replay', async table => {
    const f = fixture(); f.fault('ps_api01_' + table, { code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'x' for key 'uq_ps_api01_identity'" });
    const app = new OrderApplication({ resolve: async () => ({ ...scope, originClubReference: 'Club-A', scopes: ['orders:create'] }) }, f.repo());
    await expect(app.receive(Buffer.from(JSON.stringify(input)))).rejects.toThrow('UNAVAILABLE');
    expect(f.pool.getConnection).toHaveBeenCalledOnce(); expect(f.conn.rollback).toHaveBeenCalledOnce();
  });
  it('does not allow transaction use after callback completion', async () => {
    const f = fixture(); let escaped!: Transaction; await f.repo().runAtomic(scope, async tx => { escaped = tx; });
    await expect(escaped.findForUpdate('Order-A')).rejects.toThrow('UNAVAILABLE');
  });
});
