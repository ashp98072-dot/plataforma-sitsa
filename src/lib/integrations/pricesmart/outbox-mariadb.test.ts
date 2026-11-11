import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import * as isolation from '../../sandbox-db';
import { mariaDbOutboxStore } from './outbox-mariadb';
import { OutboxStoreError, type OutboxClaim } from './outbox';

// Driver protocol double only (SIMULATED). Verifica la secuencia/forma del SQL y los parámetros; NO prueba SKIP LOCKED, locks, concurrencia ni durabilidad reales.
// UUID v4 válidos (zod 4 exige versión/variante): el mismo valor en binario (como lo devuelve BINARY(16)) y en texto.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = id;
const bin = (n: number) => Buffer.from(id(n).replaceAll('-', ''), 'hex');
const dueRow = (n: number, attempts = 0) => ({ environment: Buffer.from('sandbox'), tenant_id: 1, client_id: 2, integration_id: Buffer.from('PriceSmart'), order_id: bin(n), order_version: 1, attempts });
const detail = { event_type: 'RECEIVED', reason: null, correlation_id: bin(900), club: Buffer.from('Club-A') };
const failure = new Error('PASSWORD SECRET sql text');

function fixture(verified = true) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  let due: unknown[] = []; let expired: unknown[] = []; let details: unknown[][] = []; let affected: number[] = []; let fail = ''; let err: unknown = failure; let identity = { db: 'sandbox_api02_test', account: 'sandbox_api02_worker@127.0.0.1' };
  const conn = {
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      expect((sql.match(/\?/g) ?? []).length).toBe(params?.length ?? 0);   // todo valor va parametrizado
      calls.push({ sql, params }); if (fail && sql.includes(fail)) throw err;
      if (sql.startsWith('SELECT DATABASE')) return [[identity]];
      if (sql.startsWith('SELECT environment')) return [sql.includes("status='PENDING'") ? due : expired];   // dos consultas: PENDING vencidos y LEASED vencidos
      if (sql.startsWith('SELECT e.event_type')) return [details.shift() ?? []];
      return [{ affectedRows: affected.length ? affected.shift() : 1 }];
    }),
    query: vi.fn(async (sql: string) => { calls.push({ sql }); return [[]]; }),
    beginTransaction: vi.fn(async () => { calls.push({ sql: 'BEGIN' }); }),
    commit: vi.fn(async () => { calls.push({ sql: 'COMMIT' }); if (fail === 'COMMIT') throw err; }),
    rollback: vi.fn(async () => { calls.push({ sql: 'ROLLBACK' }); if (fail === 'ROLLBACK') throw err; }), release: vi.fn(), destroy: vi.fn(),
  };
  const pool = { getConnection: vi.fn(async () => conn) };
  if (verified) vi.spyOn(isolation, 'isSandboxVerifiedPool').mockImplementation(p => p === pool);
  const config = { schema: 'sandbox_api02_test', workerUser: 'sandbox_api02_worker' };
  return { conn, pool, calls, config, store: () => mariaDbOutboxStore(pool as unknown as Pool, config),
    set: { due: (v: unknown[]) => { due = v; }, expired: (v: unknown[]) => { expired = v; }, details: (v: unknown[][]) => { details = v; }, affected: (v: number[]) => { affected = v; }, fail: (at: string, e: unknown = failure) => { fail = at; err = e; }, identity: (v: typeof identity) => { identity = v; } } };
}
const event = { scope: { environment: 'sandbox' as const, tenantId: 1, clientId: 2, integrationId: 'PriceSmart', originClubReference: 'Club-A' }, orderId: id(1), version: 1, type: 'RECEIVED' as const, reason: null, correlationId: cid(900) };
const claim: OutboxClaim = { event, attempt: 3 };
const sqlOf = (f: ReturnType<typeof fixture>) => f.calls.map(c => c.sql);
afterEach(() => vi.restoreAllMocks());

describe('MariaDB outbox store: guardas (doubles, not a real engine)', () => {
  it('rechaza un pool no verificado antes de adquirir conexión', () => { const f = fixture(false); expect(f.store).toThrow(OutboxStoreError); expect(f.pool.getConnection).not.toHaveBeenCalled(); });
  it.each(['sandbox_pricesmart', 'production', 'sandbox_api02_test`;DROP TABLE x'])('rechaza el esquema no autorizado %s', schema => { const f = fixture(); f.config.schema = schema; expect(f.store).toThrow(); expect(f.pool.getConnection).not.toHaveBeenCalled(); });
  it.each(['root', 'sandbox_pricesmart', 'sandbox_api02_x`'])('rechaza la cuenta de worker %s', user => { const f = fixture(); f.config.workerUser = user; expect(f.store).toThrow(); });
  it('rechaza una identidad SQL ajena antes de BEGIN y destruye la conexión', async () => {
    const f = fixture(); f.set.identity({ db: 'foreign', account: 'root@localhost' }); await expect(f.store().claim(5, 10_000)).rejects.toThrow('UNAVAILABLE');
    expect(f.conn.beginTransaction).not.toHaveBeenCalled(); expect(f.conn.destroy).toHaveBeenCalled(); expect(f.conn.release).not.toHaveBeenCalled();
  });
  it('rechaza si la cuenta no es la del worker configurado', async () => {
    const f = fixture(); f.set.identity({ db: 'sandbox_api02_test', account: 'sandbox_api02_test@127.0.0.1' }); await expect(f.store().complete(claim)).rejects.toThrow('UNAVAILABLE'); expect(f.conn.beginTransaction).not.toHaveBeenCalled();
  });
  it('una conexión rechazada se sanea (sin mensaje del driver)', async () => {
    const f = fixture(); f.pool.getConnection.mockRejectedValue(new Error('PASSWORD SECRET')); const e = await f.store().claim(5, 10_000).catch(x => x); expect(e).toBeInstanceOf(OutboxStoreError); expect(JSON.stringify(e) + String(e.message)).not.toContain('SECRET');
  });
});

describe('MariaDB outbox store: claim', () => {
  it('reclama con FOR UPDATE SKIP LOCKED, reloj de la base, attempts+1 y devuelve la ficha de fencing', async () => {
    const f = fixture(); f.set.due([dueRow(1, 2)]); f.set.details([[detail]]);
    const claims = await f.store().claim(5, 10_000);
    expect(claims).toEqual([{ event: { scope: event.scope, orderId: id(1), version: 1, type: 'RECEIVED', reason: null, correlationId: id(900) }, attempt: 3 }]);
    const [select, leasedSelect, update, joined] = f.calls.filter(c => /^(SELECT environment|UPDATE|SELECT e\.)/.test(c.sql));
    expect(select.sql).toContain('FOR UPDATE SKIP LOCKED'); expect(select.sql).toContain('UTC_TIMESTAMP(6)'); expect(select.sql).toContain('LIMIT 5'); expect(select.sql).toMatch(/status='PENDING' AND next_attempt_at <=/); expect(select.sql).not.toMatch(/OR/);
    expect(leasedSelect.sql).toMatch(/status='LEASED' AND lease_until <=/); expect(leasedSelect.sql).toContain('LIMIT 4'); expect(leasedSelect.sql).toContain('FOR UPDATE SKIP LOCKED'); expect(leasedSelect.sql).not.toMatch(/OR/);   // lote restante = 5 - 1 PENDING
    expect(sqlOf(f).slice(sqlOf(f).findIndex(x => x.startsWith('SELECT DATABASE'))).slice(0, 3)).toEqual([expect.stringMatching(/^SELECT DATABASE/), 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED', 'BEGIN']);
    expect(update.sql).toContain('attempts=attempts+1'); expect(update.sql).toContain('INTERVAL 10000000 MICROSECOND'); expect(update.sql).toContain('AND attempts=?');
    expect(update.params).toEqual([Buffer.from('sandbox'), 1, 2, Buffer.from('PriceSmart'), bin(1), 1, 2]);   // alcance completo + PK + CAS por attempts leído
    expect(joined.params!.slice(0, 4)).toEqual([Buffer.from('sandbox'), 1, 2, Buffer.from('PriceSmart')]);
    expect(sqlOf(f).slice(-1)).toEqual(['COMMIT']); expect(f.conn.release).toHaveBeenCalled();
    expect(sqlOf(f).indexOf('BEGIN')).toBeGreaterThan(sqlOf(f).findIndex(s => s.startsWith('SELECT DATABASE')));
  });
  it('si el lote ya se llenó con PENDING no consulta los LEASED vencidos; si no, completa con ellos (lease vencida = worker caído)', async () => {
    const f = fixture(); f.set.due([dueRow(1)]); f.set.details([[detail]]); await f.store().claim(1, 10_000);
    expect(f.calls.filter(c => /^SELECT environment/.test(c.sql))).toHaveLength(1);
    const g = fixture(); g.set.expired([dueRow(2, 4)]); g.set.details([[detail]]); const claims = await g.store().claim(3, 10_000);
    expect(claims).toHaveLength(1); expect(claims[0].attempt).toBe(5); expect(g.calls.filter(c => /^SELECT environment/.test(c.sql))).toHaveLength(2);
  });
  it('solo el reclamo usa READ COMMITTED; los cierres no', async () => { const f = fixture(); await f.store().complete(claim); expect(sqlOf(f)).not.toContain('SET TRANSACTION ISOLATION LEVEL READ COMMITTED'); });
  it('sin eventos vencidos devuelve vacío y confirma', async () => { const f = fixture(); expect(await f.store().claim(5, 10_000)).toEqual([]); expect(f.conn.commit).toHaveBeenCalled(); });
  it.each([0, 101, 1.5, -1, Number.NaN, '5' as unknown as number, Number.POSITIVE_INFINITY])('valida el tamaño de lote %s antes de tocar la base', async limit => {
    const f = fixture(); await expect(f.store().claim(limit, 10_000)).rejects.toBeInstanceOf(OutboxStoreError); expect(f.pool.getConnection).not.toHaveBeenCalled();
  });
  it.each([0, 999, 3_600_001, 1.5, Number.NaN])('valida la lease %s antes de tocar la base', async lease => { const f = fixture(); await expect(f.store().claim(5, lease)).rejects.toBeInstanceOf(OutboxStoreError); expect(f.pool.getConnection).not.toHaveBeenCalled(); });
  it('un evento ilegible u huérfano pasa a REVIEW en la misma transacción, no bloquea el lote y no se pierde', async () => {
    const f = fixture(); f.set.due([dueRow(1, 0), dueRow(2, 0), dueRow(3, 0)]); f.set.details([[], [{ ...detail, event_type: 'OTRO_TIPO' }], [detail]]);
    const claims = await f.store().claim(5, 10_000);
    expect(claims.map(c => c.event.orderId)).toEqual([id(3)]);
    const reviews = f.calls.filter(c => c.sql.includes("SET status='REVIEW'")); expect(reviews).toHaveLength(2); expect(reviews[0].sql).toContain("status='LEASED' AND attempts=?"); expect(reviews[0].params!.at(-1)).toBe(1);
    expect(f.calls.some(c => /DELETE|DROP|TRUNCATE/i.test(c.sql))).toBe(false);
  });
  it('si el UPDATE de reclamación no afecta exactamente 1 fila revierte TODO el lote', async () => {
    const f = fixture(); f.set.due([dueRow(1), dueRow(2)]); f.set.details([[detail], [detail]]); f.set.affected([1, 0]);
    await expect(f.store().claim(5, 10_000)).rejects.toThrow('UNAVAILABLE'); expect(sqlOf(f)).toContain('ROLLBACK'); expect(sqlOf(f)).not.toContain('COMMIT');
  });
  it('un interbloqueo o timeout de bloqueo es RETRYABLE; cualquier otro error es UNAVAILABLE sin mensaje', async () => {
    for (const [code, expected] of [['ER_LOCK_DEADLOCK', 'RETRYABLE'], ['ER_LOCK_WAIT_TIMEOUT', 'RETRYABLE'], ['ER_PARSE_ERROR', 'UNAVAILABLE']] as const) {
      const f = fixture(); f.set.due([dueRow(1)]); f.set.fail('UPDATE', Object.assign(new Error('PASSWORD SECRET'), { code }));
      const e = await f.store().claim(5, 10_000).catch(x => x); expect(e).toBeInstanceOf(OutboxStoreError); expect(e.code).toBe(expected); expect(String(e.message)).not.toContain('SECRET'); expect(sqlOf(f)).toContain('ROLLBACK');
    }
  });
});

describe('MariaDB outbox store: cierre con fencing', () => {
  it.each([
    ['complete', (s: ReturnType<ReturnType<typeof fixture>['store']>) => s.complete(claim), "SET status='DONE', lease_until=NULL"],
    ['review', (s: ReturnType<ReturnType<typeof fixture>['store']>) => s.review(claim), "SET status='REVIEW', lease_until=NULL"],
    ['retry', (s: ReturnType<ReturnType<typeof fixture>['store']>) => s.retry(claim, 4_000), "SET status='PENDING', lease_until=NULL, next_attempt_at=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 4000000 MICROSECOND)"],
  ])('%s: UPDATE con alcance completo, status LEASED y attempts del intento reclamado', async (_n, run, fragment) => {
    const f = fixture(); expect(await run(f.store())).toBe(true);
    const update = f.calls.find(c => c.sql.startsWith('UPDATE'))!; expect(update.sql).toContain(fragment); expect(update.sql).toContain("status='LEASED' AND attempts=?");
    expect(update.params).toEqual([Buffer.from('sandbox'), 1, 2, Buffer.from('PriceSmart'), bin(1), 1, 3]);
    expect(sqlOf(f).slice(-1)).toEqual(['COMMIT']);
  });
  it.each(['complete', 'review', 'retry'] as const)('%s devuelve false (fencing) si ninguna fila coincide y no lanza', async op => {
    const f = fixture(); f.set.affected([0]); const s = f.store(); expect(await (op === 'retry' ? s.retry(claim, 1_000) : s[op](claim))).toBe(false);
  });
  it('valida la espera del reintento y el intento antes de tocar la base', async () => {
    const f = fixture(); for (const bad of [-1, 1.5, 86_400_001, Number.NaN]) await expect(f.store().retry(claim, bad)).rejects.toBeInstanceOf(OutboxStoreError);
    await expect(f.store().complete({ event, attempt: 0 })).rejects.toBeInstanceOf(OutboxStoreError); await expect(f.store().complete({ event: { ...event, orderId: 'no-uuid' }, attempt: 1 })).rejects.toBeInstanceOf(OutboxStoreError);
    expect(f.pool.getConnection).not.toHaveBeenCalled();
  });
  it('si COMMIT falla se intenta ROLLBACK y el error es UNAVAILABLE; si ROLLBACK también falla la conexión se destruye', async () => {
    const f = fixture(); f.set.fail('COMMIT'); await expect(f.store().complete(claim)).rejects.toThrow('UNAVAILABLE'); expect(sqlOf(f)).toContain('ROLLBACK'); expect(f.conn.release).toHaveBeenCalled();
    const g = fixture(); g.conn.execute.mockImplementationOnce(async () => [[{ db: 'sandbox_api02_test', account: 'sandbox_api02_worker@127.0.0.1' }]] as never); g.conn.execute.mockImplementationOnce(async () => { throw failure; });
    g.conn.rollback.mockRejectedValue(failure); await expect(g.store().complete(claim)).rejects.toThrow('UNAVAILABLE'); expect(g.conn.destroy).toHaveBeenCalled();
  });
});

describe('MariaDB outbox store: invariantes de seguridad del SQL', () => {
  it('ninguna operación emite DELETE, DROP, TRUNCATE, ALTER, INSERT ni DDL; solo SELECT/UPDATE parametrizados sobre las tablas de la outbox', async () => {
    const f = fixture(); f.set.due([dueRow(1)]); f.set.details([[detail]]); const s = f.store();
    await s.claim(5, 10_000); await s.complete(claim); await s.retry(claim, 1_000); await s.review(claim);
    for (const c of f.calls) { expect(c.sql).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER|INSERT|CREATE|GRANT|REPLACE)\b/i); if (!/^(BEGIN|COMMIT|ROLLBACK|SELECT DATABASE|SET TRANSACTION ISOLATION LEVEL READ COMMITTED$)/.test(c.sql)) expect(c.sql).toMatch(/`sandbox_api02_test`\.`ps_api01_(outbox|events|orders)`/); }
    expect(f.conn.execute).toHaveBeenCalled();   // solo sentencias preparadas
  });
  it('las columnas que escribe coinciden con el UPDATE de columnas concedido al worker (status, attempts, next_attempt_at, lease_until)', async () => {
    const f = fixture(); f.set.due([dueRow(1)]); f.set.details([[detail]]); const s = f.store(); await s.claim(5, 10_000); await s.complete(claim); await s.retry(claim, 1_000); await s.review(claim);
    const written = new Set<string>(); for (const c of f.calls.filter(x => x.sql.startsWith('UPDATE'))) for (const m of c.sql.matchAll(/(?:SET|,)\s*(\w+)=/g)) written.add(m[1]);
    expect([...written].sort()).toEqual(['attempts', 'lease_until', 'next_attempt_at', 'status']);
  });
});
