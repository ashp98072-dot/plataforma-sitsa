import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import * as isolation from '../../sandbox-db';
import { mariaDbSourceOrderPort, SOURCE_ORDER_COLUMNS } from './source-order-mariadb';
import { AdaptationError, sourceSnapshotSchema, type AdaptationScope } from './tms-adaptation-contracts';

// Driver protocol double only (SIMULATED). Verifica la forma del SQL, los parámetros y el saneamiento de errores; NO prueba un motor real.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const bin = (n: number) => Buffer.from(id(n).replaceAll('-', ''), 'hex');
const scope: AdaptationScope = { environment: 'sandbox', tenantId: 1, clientId: 2, integrationId: 'PriceSmart', originClubReference: 'Club-A' };
const row = (over: Record<string, unknown> = {}) => ({
  environment: Buffer.from('sandbox'), tenant_id: 1, client_id: 2, integration_id: Buffer.from('PriceSmart'), id: bin(1), external_order_id: Buffer.from('Order-A'),
  origin_club_reference: Buffer.from('Club-A'), payload_version: Buffer.from('api01-draft-1'), state: 'RECEIVED', version: 1, correlation_id: bin(900),
  cancellation_reason: null, received_at_iso: '2026-11-11T12:00:00.123456Z', ...over,
});

function fixture(verified = true) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  let rows: unknown[] = []; let identity = { db: 'sandbox_api02_test', account: 'sandbox_api02_worker@127.0.0.1' }; let fail = false;
  const conn = {
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      expect((sql.match(/\?/g) ?? []).length).toBe(params?.length ?? 0);
      calls.push({ sql, params });
      if (sql.startsWith('SELECT DATABASE')) return [[identity]];
      if (fail) throw Object.assign(new Error('PASSWORD SECRET sql text'), { code: 'ER_PARSE_ERROR' });
      return [rows];
    }),
    release: vi.fn(), destroy: vi.fn(),
  };
  const pool = { getConnection: vi.fn(async () => conn) };
  if (verified) vi.spyOn(isolation, 'isSandboxVerifiedPool').mockImplementation(p => p === pool);
  const config = { schema: 'sandbox_api02_test', account: 'sandbox_api02_worker' };
  return { conn, pool, calls, config, port: () => mariaDbSourceOrderPort(pool as unknown as Pool, config),
    set: { rows: (v: unknown[]) => { rows = v; }, identity: (v: typeof identity) => { identity = v; }, fail: () => { fail = true; } } };
}
afterEach(() => vi.restoreAllMocks());

describe('mariaDbSourceOrderPort: guardas', () => {
  it('rechaza un pool no verificado, un esquema ajeno y una cuenta ajena antes de abrir conexión', () => {
    const a = fixture(false); expect(a.port).toThrow(AdaptationError);
    for (const schema of ['sandbox_pricesmart', 'production', 'sandbox_api02_x`;DROP TABLE y']) { const f = fixture(); f.config.schema = schema; expect(f.port).toThrow(); expect(f.pool.getConnection).not.toHaveBeenCalled(); }
    for (const account of ['root', 'sandbox_api02_x`']) { const f = fixture(); f.config.account = account; expect(f.port).toThrow(); }
  });
  it('rechaza una identidad SQL ajena sin consultar y destruye la conexión', async () => {
    const f = fixture(); f.set.identity({ db: 'foreign', account: 'root@localhost' });
    await expect(f.port().load(scope, id(1))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(f.calls.some(c => c.sql.includes('ps_api01_orders'))).toBe(false); expect(f.conn.destroy).toHaveBeenCalled(); expect(f.conn.release).not.toHaveBeenCalled();
  });
  it.each(['', 'not-a-uuid', id(1) + 'x', '00000000-0000-4000-8000-00000000000g', 42 as unknown as string])('valida el id %s antes de tocar la base', async value => {
    const f = fixture(); await expect(f.port().load(scope, value)).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(f.pool.getConnection).not.toHaveBeenCalled();
  });
});

describe('mariaDbSourceOrderPort: lectura', () => {
  it('devuelve una instantánea válida para la adaptación, con la ficha completa del alcance', async () => {
    const f = fixture(); f.set.rows([row()]); const snapshot = await f.port().load(scope, id(1));
    expect(sourceSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot).toEqual({ scope, orderId: id(1), input: { schemaVersion: 'api01-draft-1', externalOrderId: 'Order-A', originClubReference: 'Club-A' }, state: 'RECEIVED', version: 1,
      correlationId: id(900), receivedAt: '2026-11-11T12:00:00.123Z', cancellationReason: null, assurance: 'SIMULATED' });
    expect(f.conn.release).toHaveBeenCalled(); expect(f.conn.destroy).not.toHaveBeenCalled();
  });
  it('lleva el motivo de cancelación y el estado cuando la orden tiene una solicitud de cancelación', async () => {
    const f = fixture(); f.set.rows([row({ state: 'CANCELLATION_REQUESTED', version: 2, cancellation_reason: 'DUPLICATE' })]);
    expect(await f.port().load(scope, id(1))).toMatchObject({ state: 'CANCELLATION_REQUESTED', version: 2, cancellationReason: 'DUPLICATE' });
  });
  it('filtra por entorno, empresa, cliente, integración, id Y club de origen; una sola consulta SELECT parametrizada', async () => {
    const f = fixture(); await f.port().load(scope, id(1));
    const query = f.calls.find(c => c.sql.includes('ps_api01_orders'))!;
    expect(query.sql).toMatch(/^SELECT /); expect(query.sql).toContain('`sandbox_api02_test`.`ps_api01_orders`');
    for (const column of ['environment=?', 'tenant_id=?', 'client_id=?', 'integration_id=?', 'id=?', 'origin_club_reference=?']) expect(query.sql).toContain(column);
    expect(query.params).toEqual([Buffer.from('sandbox'), 1, 2, Buffer.from('PriceSmart'), bin(1), Buffer.from('Club-A')]);
    expect(f.calls.filter(c => c.sql.includes('ps_api01_orders'))).toHaveLength(1);
    expect(query.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|FOR UPDATE)\b/i);
  });
  it('nunca lee el payload cifrado, el hash de entrada ni los recibos: solo las columnas declaradas', async () => {
    const f = fixture(); await f.port().load(scope, id(1)); const sql = f.calls.find(c => c.sql.includes('ps_api01_orders'))!.sql;
    for (const sensitive of ['payload_ciphertext', 'payload_key_reference', 'input_hash', 'receipt_json', 'cancellation_hash', 'cancellation_receipt_json', '*']) expect(sql).not.toContain(sensitive);
    const list = /^SELECT (.+) FROM/.exec(sql)![1]!.replace(/DATE_FORMAT\(received_at,'[^']*'\) AS received_at_iso/, 'received_at');   // la coma del formato no es separador de columnas
    const selected = list.split(',').map(s => s.trim());
    expect([...selected].sort()).toEqual([...SOURCE_ORDER_COLUMNS].sort());
  });
  it('un id de otro alcance, de otro club o inexistente es indistinguible: null', async () => {
    const f = fixture(); f.set.rows([]); expect(await f.port().load(scope, id(1))).toBeNull(); expect(await f.port().load({ ...scope, tenantId: 99 }, id(1))).toBeNull();
    expect(f.calls.filter(c => c.sql.includes('ps_api01_orders')).map(c => c.params![1])).toEqual([1, 99]);
  });
  it('si la base devolviera dos filas o una fila no reconocible, falla cerrado (UNAVAILABLE) sin adivinar', async () => {
    for (const rows of [[row(), row()], [row({ state: 'DELIVERED' })], [row({ version: 0 })], [row({ correlation_id: Buffer.from('corto') })], [row({ payload_version: Buffer.from('otra') })], [row({ cancellation_reason: 'DUPLICATE' })]]) {
      const f = fixture(); f.set.rows(rows); await expect(f.port().load(scope, id(1))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    }
  });
  it('un error del driver se sanea: sin mensaje SQL, sin credenciales, y la conexión se devuelve', async () => {
    const f = fixture(); f.set.fail(); const error = (await f.port().load(scope, id(1)).catch((e: unknown) => e)) as AdaptationError;
    expect(error).toBeInstanceOf(AdaptationError); expect(error.code).toBe('UNAVAILABLE'); expect(JSON.stringify(error) + String(error.message)).not.toMatch(/SECRET|PASSWORD|sql text/); expect(f.conn.release).toHaveBeenCalled();
  });
  it('una conexión rechazada se sanea', async () => {
    const f = fixture(); f.pool.getConnection.mockRejectedValue(new Error('PASSWORD SECRET')); const error = (await f.port().load(scope, id(1)).catch((e: unknown) => e)) as AdaptationError;
    expect(error).toBeInstanceOf(AdaptationError); expect(String(error.message)).not.toContain('SECRET');
  });
});
