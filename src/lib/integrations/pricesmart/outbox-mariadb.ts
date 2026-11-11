import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { isSandboxVerifiedPool } from '../../sandbox-db';
import { outboxEventSchema, OutboxStoreError, type OutboxClaim, type OutboxStore } from './outbox';

// PRICESMART API-07 — almacén MariaDB de la outbox (ps_api01_outbox). NO crea el pool, NO ejecuta DDL y NO se importa desde rutas ni arranque.
// Mismos guardas que mariadb-repository.ts (pool verificado de sandbox, esquema/cuenta `sandbox_api02_*`, identidad SQL antes de BEGIN).
// ESTADO DE VALIDACIÓN: protocolo SQL probado con dobles del driver (SIMULATED). SKIP LOCKED, bloqueos y concurrencia reales NO están validados contra el motor:
// requieren extender el laboratorio de API-06A (cuenta de worker con SELECT en ps_api01_outbox/events y UPDATE de (status, attempts, next_attempt_at, lease_until)) — autorización aparte.
//
// Una sola fuente de tiempo: el RELOJ DE LA BASE (UTC_TIMESTAMP) para elegibilidad, lease y backoff; así varios workers no dependen de relojes locales.
// Fencing: cada reclamación hace attempts = attempts + 1; cerrar exige status='LEASED' AND attempts = <intento reclamado>. Sin columnas nuevas.

const where = 'environment=? AND tenant_id=? AND client_id=? AND integration_id=? AND order_id=? AND order_version=?';
const uuid = (s: string) => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s)) throw new OutboxStoreError('UNAVAILABLE');
  return Buffer.from(s.replaceAll('-', ''), 'hex');
};
const uuidText = (v: unknown) => {
  const b = Buffer.isBuffer(v) ? v : Buffer.alloc(0); if (b.length !== 16) throw new OutboxStoreError('UNAVAILABLE');
  const s = b.toString('hex'); return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};
const text = (v: unknown) => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v));
const int = (v: number, min: number, max: number) => { if (!Number.isSafeInteger(v) || v < min || v > max) throw new OutboxStoreError('UNAVAILABLE'); return v; };

export function mariaDbOutboxStore(pool: Pool, config: { schema: string; workerUser: string }): OutboxStore {
  if (!isSandboxVerifiedPool(pool) || !/^sandbox_api02_[a-z0-9_]+$/.test(config.schema) || !/^sandbox_api02_[a-z0-9_]+$/.test(config.workerUser)) throw new OutboxStoreError('UNAVAILABLE');
  const { schema, workerUser } = config;
  const table = (name: string) => `\`${schema}\`.\`ps_api01_${name}\``;
  type Key = [Buffer, number, number, Buffer, Buffer, number];
  const keyOf = (e: { scope: { environment: string; tenantId: number; clientId: number; integrationId: string }; orderId: string; version: number }): Key =>
    [Buffer.from(e.scope.environment), e.scope.tenantId, e.scope.clientId, Buffer.from(e.scope.integrationId), uuid(e.orderId), e.version];

  async function inTransaction<T>(action: (conn: PoolConnection) => Promise<T>): Promise<T> {
    let conn: PoolConnection | undefined; let active = false; let broken = false;
    try {
      conn = await pool.getConnection();
      const [identity] = await conn.execute<RowDataPacket[]>('SELECT DATABASE() AS db, CURRENT_USER() AS account');
      if (identity.length !== 1 || identity[0].db !== schema || identity[0].account !== `${workerUser}@127.0.0.1`) { broken = true; throw new OutboxStoreError('UNAVAILABLE'); }
      await conn.beginTransaction(); active = true;
      const value = await action(conn);
      await conn.commit(); active = false;
      return value;
    } catch (error) {
      if (conn && active) { try { await conn.rollback(); } catch { broken = true; } }
      if (error instanceof OutboxStoreError) throw error;
      const code = (error as { code?: string })?.code;
      throw new OutboxStoreError(code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT' ? 'RETRYABLE' : 'UNAVAILABLE');   // sin mensaje SQL, sin datos
    } finally {
      if (conn) { try { if (broken) conn.destroy(); else conn.release(); } catch { throw new OutboxStoreError('UNAVAILABLE'); } }
    }
  }
  async function close(sql: string, claim: OutboxClaim): Promise<boolean> {
    const key = keyOf(claim.event); int(claim.attempt, 1, Number.MAX_SAFE_INTEGER);
    return inTransaction(async conn => {
      const [result] = await conn.execute<ResultSetHeader>(sql, [...key, claim.attempt]);
      return result.affectedRows === 1;   // 0 = fencing: otro worker reclamó el evento o ya no está LEASED
    });
  }

  return {
    async claim(limit, leaseMs) {
      const n = int(limit, 1, 100); const lease = int(leaseMs, 1_000, 3_600_000);   // validados y en línea: LIMIT/INTERVAL con marcadores en sentencias preparadas no es portable
      return inTransaction(async conn => {
        const [due] = await conn.execute<RowDataPacket[]>(
          `SELECT environment,tenant_id,client_id,integration_id,order_id,order_version,attempts FROM ${table('outbox')} ` +
          `WHERE (status='PENDING' AND next_attempt_at <= UTC_TIMESTAMP(6)) OR (status='LEASED' AND lease_until <= UTC_TIMESTAMP(6)) ` +
          `ORDER BY next_attempt_at, order_version LIMIT ${n} FOR UPDATE SKIP LOCKED`, []);
        const claims: OutboxClaim[] = [];
        for (const row of due) {
          const key: Key = [row.environment, row.tenant_id, row.client_id, row.integration_id, row.order_id, row.order_version];
          const attempts = int(Number(row.attempts), 0, Number.MAX_SAFE_INTEGER - 1);
          const [claimed] = await conn.execute<ResultSetHeader>(
            `UPDATE ${table('outbox')} SET status='LEASED', attempts=attempts+1, lease_until=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ${lease * 1000} MICROSECOND) ` +
            `WHERE ${where} AND attempts=? AND status IN ('PENDING','LEASED')`, [...key, attempts]);
          if (claimed.affectedRows !== 1) throw new OutboxStoreError('UNAVAILABLE');   // se tienen los locks: no debería ocurrir; se revierte todo el lote
          const [details] = await conn.execute<RowDataPacket[]>(
            `SELECT e.event_type AS event_type, e.reason AS reason, e.correlation_id AS correlation_id, o.origin_club_reference AS club ` +
            `FROM ${table('events')} e JOIN ${table('orders')} o ON o.environment=e.environment AND o.tenant_id=e.tenant_id AND o.client_id=e.client_id AND o.integration_id=e.integration_id AND o.id=e.order_id ` +
            `WHERE e.environment=? AND e.tenant_id=? AND e.client_id=? AND e.integration_id=? AND e.order_id=? AND e.order_version=?`, key);
          const event = details.length === 1 ? outboxEventSchema.safeParse({
            scope: { environment: text(row.environment), tenantId: Number(row.tenant_id), clientId: Number(row.client_id), integrationId: text(row.integration_id), originClubReference: text(details[0].club) },
            orderId: uuidText(row.order_id), version: Number(row.order_version), type: details[0].event_type, reason: details[0].reason ?? null, correlationId: uuidText(details[0].correlation_id),
          }) : null;
          if (!event?.success) {
            // Veneno (evento ilegible/huérfano): pasa a REVIEW durable en la misma transacción para no bloquear el lote ni perder la orden.
            await conn.execute(`UPDATE ${table('outbox')} SET status='REVIEW', lease_until=NULL WHERE ${where} AND status='LEASED' AND attempts=?`, [...key, attempts + 1]);
            continue;
          }
          claims.push({ event: event.data, attempt: attempts + 1 });
        }
        return claims;
      });
    },
    complete: claim => close(`UPDATE ${table('outbox')} SET status='DONE', lease_until=NULL WHERE ${where} AND status='LEASED' AND attempts=?`, claim),
    retry: async (claim, delayMs) => {
      const micro = int(delayMs, 0, 86_400_000) * 1000;
      return close(`UPDATE ${table('outbox')} SET status='PENDING', lease_until=NULL, next_attempt_at=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ${micro} MICROSECOND) WHERE ${where} AND status='LEASED' AND attempts=?`, claim);
    },
    review: claim => close(`UPDATE ${table('outbox')} SET status='REVIEW', lease_until=NULL WHERE ${where} AND status='LEASED' AND attempts=?`, claim),
  };
}
