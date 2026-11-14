import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { isSandboxVerifiedPool } from '../../sandbox-db';
import type { Environment } from './environment';
import { OrderError, orderSchema, reference, type OrderContractOptions, type Scope, type OrderInput } from './contracts';
import { UniqueOrderCollision, type OrderRepository, type Transaction, type StoredOrder, type Committed } from './ports';

// No default codec: plaintext persistence is deliberately unavailable.
export interface PayloadCipher {
  seal(input: OrderInput, context: string): Promise<{ ciphertext: Buffer; keyReference: string }>;
  open(ciphertext: Buffer, keyReference: string, context: string): Promise<unknown>;
}
export class PersistenceError extends Error {
  constructor(public readonly code: 'UNAVAILABLE' | 'RETRYABLE' | 'COMMIT_UNKNOWN') { super(code); }
}
const uuid = (s: string) => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s)) throw new PersistenceError('UNAVAILABLE');
  return Buffer.from(s.replaceAll('-', ''), 'hex');
};
const hash = (s: string) => {
  if (!/^[a-f0-9]{64}$/.test(s)) throw new PersistenceError('UNAVAILABLE');
  return Buffer.from(s, 'hex');
};
const text = (v: unknown) => Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
const uuidText = (v: Buffer) => {
  const s = v.toString('hex'); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
};
const where = 'environment=? AND tenant_id=? AND client_id=? AND integration_id=?';
const fields = 'environment,tenant_id,client_id,integration_id';

/** Offline composition only. Never creates a pool or executes DDL. */
export function mariaDbOrderRepository(pool: Pool, config: {
  schema: string; runtimeUser: string; cipher: PayloadCipher; contract?: Pick<OrderContractOptions, 'orderSchema'>;
  /** API-22: explícito y SOLO `sandbox`. La persistencia de producción no está autorizada (decisión pendiente): cualquier otro valor rechaza la construcción. */
  environment?: Environment;
}): OrderRepository {
  if (config.environment !== undefined && config.environment !== 'sandbox') throw new PersistenceError('UNAVAILABLE');
  if (!isSandboxVerifiedPool(pool) || !/^sandbox_api02_[a-z0-9_]+$/.test(config.schema) ||
      !/^sandbox_api02_[a-z0-9_]+$/.test(config.runtimeUser) || !config.cipher?.seal || !config.cipher?.open) {
    throw new PersistenceError('UNAVAILABLE');
  }
  const { schema, runtimeUser, cipher } = config;
  const storedSchema = (config.contract?.orderSchema ?? orderSchema) as typeof orderSchema;   // API-12: por defecto, el borrador API-01 sin cambios
  const table = (name: string) => `\`${schema}\`.\`ps_api01_${name}\``;
  return {
    async runAtomic<T>(inputScope: Scope, action: (tx: Transaction) => Promise<T>): Promise<Committed<T>> {
      const scope = { ...inputScope };
      if (scope.environment !== 'sandbox' || !Number.isSafeInteger(scope.tenantId) || scope.tenantId < 1 ||
          !Number.isSafeInteger(scope.clientId) || scope.clientId < 1 || !reference.safeParse(scope.integrationId).success) throw new OrderError('FORBIDDEN');
      const ns = [Buffer.from(scope.environment), scope.tenantId, scope.clientId, Buffer.from(scope.integrationId)];
      const context = (id: string) => JSON.stringify([scope.environment, scope.tenantId, scope.clientId, scope.integrationId, id]);
      let conn: PoolConnection | undefined; let active = false; let committing = false; let broken = false;
      try {
        conn = await pool.getConnection();
        const [identity] = await conn.execute<RowDataPacket[]>('SELECT DATABASE() AS db, CURRENT_USER() AS account');
        if (identity.length !== 1 || identity[0].db !== schema || identity[0].account !== `${runtimeUser}@127.0.0.1`) { broken = true; throw new PersistenceError('UNAVAILABLE'); }
        await conn.execute('SET SESSION time_zone = ?', ['+00:00']);
        await conn.beginTransaction(); active = true;
        let pending = false; let poisoned = false;
        const sql = async (query: string, params: (string | number | Buffer | null)[]) => {
          if (!active || pending || poisoned) { poisoned = true; throw new PersistenceError('UNAVAILABLE'); }
          pending = true;
          try { return await conn!.execute(query, params); }
          catch (error) { poisoned = true; throw error; }
          finally { pending = false; }
        };
        const tx: Transaction = {
          async insert(order) {
            const sealed = await cipher.seal(order.input, context(order.input.externalOrderId));
            if (!Buffer.isBuffer(sealed.ciphertext) || !sealed.ciphertext.length || !reference.safeParse(sealed.keyReference).success || order.tmsLinked) throw new PersistenceError('UNAVAILABLE');
            try {
              await sql(`INSERT INTO ${table('orders')} (id,${fields},external_order_id,origin_club_reference,payload_version,payload_ciphertext,payload_key_reference,input_hash,state,version,correlation_id,received_at,receipt_json,tms_linked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
                [uuid(order.id), ...ns, Buffer.from(order.input.externalOrderId), Buffer.from(order.input.originClubReference), Buffer.from(order.input.schemaVersion), sealed.ciphertext, Buffer.from(sealed.keyReference), hash(order.inputHash), order.state, order.version, uuid(order.correlationId), new Date(order.receivedAt).toISOString().slice(0,23).replace('T',' '), JSON.stringify(order.receipt)]);
            } catch (e) {
              const err = e as { code?: string; sqlMessage?: string };
              // Parse only the terminal key token, never search arbitrary duplicate value text.
              const key = / for key ['`]([^'`]+)['`]$/.exec(err.sqlMessage ?? '')?.[1];
              if (err.code === 'ER_DUP_ENTRY' && (key === 'uq_ps_api01_identity' || key === 'ps_api01_orders.uq_ps_api01_identity')) throw new UniqueOrderCollision();
              throw e;
            }
          },
          async findForUpdate(id) {
            if (!reference.safeParse(id).success) throw new OrderError('INVALID_INPUT');
            const [rows] = await sql(`SELECT *,DATE_FORMAT(received_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS received_at_iso FROM ${table('orders')} WHERE ${where} AND external_order_id=? FOR UPDATE`, [...ns, Buffer.from(id)]);
            const row = (rows as RowDataPacket[])[0]; if (!row) return null;
            const input = storedSchema.parse(await cipher.open(row.payload_ciphertext, text(row.payload_key_reference), context(id)));
            if (input.externalOrderId !== id || input.originClubReference !== text(row.origin_club_reference) || input.schemaVersion !== text(row.payload_version)) throw new PersistenceError('UNAVAILABLE');
            return { id: uuidText(row.id), input, inputHash: row.input_hash.toString('hex'), state: row.state, version: row.version,
              correlationId: uuidText(row.correlation_id), receivedAt: new Date(row.received_at_iso ?? row.received_at).toISOString(), receipt: JSON.parse(text(row.receipt_json)),
              cancellationHash: row.cancellation_hash?.toString('hex') ?? null, cancellationReason: row.cancellation_reason,
              cancellationReceipt: row.cancellation_receipt_json ? JSON.parse(text(row.cancellation_receipt_json)) : null, tmsLinked: Boolean(row.tms_linked) } satisfies StoredOrder;
          },
          async save(order, previous) {
            if (!Number.isSafeInteger(previous) || previous < 1 || order.version !== previous + 1 || order.tmsLinked) throw new OrderError('CONFLICT');
            const [result] = await sql(`UPDATE ${table('orders')} SET state=?,version=?,cancellation_hash=?,cancellation_reason=?,cancellation_receipt_json=? WHERE ${where} AND id=? AND external_order_id=? AND version=? AND tms_linked=0`,
              [order.state, order.version, order.cancellationHash ? hash(order.cancellationHash) : null, order.cancellationReason, order.cancellationReceipt ? JSON.stringify(order.cancellationReceipt) : null, ...ns, uuid(order.id), Buffer.from(order.input.externalOrderId), previous]);
            if ((result as ResultSetHeader).affectedRows !== 1) throw new OrderError('CONFLICT');
          },
          async appendEvent(event) {
            await sql(`INSERT INTO ${table('events')} (${fields},order_id,order_version,event_type,reason,correlation_id,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6))`, [...ns, uuid(event.orderId), event.version, event.type, event.reason, uuid(event.correlationId)]);
          },
          async appendAudit(audit) {
            await sql(`INSERT INTO ${table('audit')} (id,${fields},order_id,operation,result,correlation_id,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6))`, [uuid(randomUUID()), ...ns, uuid(audit.orderId), audit.operation, audit.result, uuid(audit.correlationId)]);
          },
          async enqueue(event) {
            await sql(`INSERT INTO ${table('outbox')} (${fields},order_id,order_version,next_attempt_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(6))`, [...ns, uuid(event.orderId), event.version]);
          },
        };
        let inFlight = 0;
        const guarded = Object.fromEntries(Object.entries(tx).map(([key, operation]) => [key, async (...args: unknown[]) => {
          if (!active || inFlight || poisoned) { poisoned = true; throw new PersistenceError('UNAVAILABLE'); }
          inFlight++;
          try { return await Reflect.apply(operation, tx, args); }
          catch (error) { poisoned = true; throw error; }
          finally { inFlight--; }
        }])) as unknown as Transaction;
        const value = await action(guarded);
        if (pending || poisoned || inFlight) throw new PersistenceError('UNAVAILABLE');
        active = false; committing = true;
        await conn.commit(); committing = false;
        return { value, durability: 'DURABLE' };
      } catch (error) {
        active = false;
        if (conn) { try { await conn.rollback(); } catch { broken = true; } }
        if (committing) { broken = true; throw new PersistenceError('COMMIT_UNKNOWN'); }
        if (error instanceof UniqueOrderCollision || error instanceof OrderError || error instanceof PersistenceError) throw error;
        const code = (error as { code?: string })?.code;
        throw new PersistenceError(code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT' ? 'RETRYABLE' : 'UNAVAILABLE');
      } finally {
        if (conn) {
          try { if (broken) conn.destroy(); else conn.release(); }
          catch { throw new PersistenceError('UNAVAILABLE'); }
        }
      }
    },
  };
}
