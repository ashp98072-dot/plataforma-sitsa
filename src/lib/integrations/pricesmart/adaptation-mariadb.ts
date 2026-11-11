import { createHash } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { isSandboxVerifiedPool } from '../../sandbox-db';
import {
  AdaptationError, adaptationScopeSchema, jobSchema, linkSchema, observationSchema,
  type AdaptationRepository, type AdaptationScope, type AdaptationTrace, type AdaptationTransaction,
} from './tms-adaptation-contracts';

// PRICESMART API-09 — AdaptationRepository DURABLE sobre MariaDB (ps_api09_adapt_jobs / _links / _traces; DDL de diseño en docs/integraciones/pricesmart/api09/staging.sql.in).
// Cada runAtomic es UNA transacción: trabajo + vínculo + bitácora se confirman o se revierten juntos. CAS por versión en trabajos y vínculos; trabajo único por clave (idempotencia);
// una referencia de solicitud sólo puede pertenecer a UN vínculo del espacio (restricción única). Alcance completo (entorno, empresa, cliente, integración) en CADA consulta.
// Recuperación: la lease del trabajo se guarda con el reloj de la aplicación (el mismo de la adaptación); al vencer, otro intento la recupera (lógica de tms-adaptation.ts).
// Mismas defensas que API-02/07/08: pool verificado de sandbox, esquema/cuenta `sandbox_api02_*`, identidad SQL antes de BEGIN, errores sin mensaje SQL.
//
// `assurance: 'SIMULATED'` es el literal del contrato de la cadena de adaptación (el puente completo sigue siendo sintético: el candidato no es materializable y no existe
// ningún id de TMS en el esquema); NO describe la durabilidad de este almacén, que es real cuando el motor confirma el COMMIT.
// ESTADO DE VALIDACIÓN: protocolo SQL con dobles del driver; la validación contra motor real corresponde al bloque B11 del laboratorio de API-06A (requiere autorización expresa).

const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const uuid = (s: string) => { if (typeof s !== 'string' || !idPattern.test(s)) throw new AdaptationError('INVALID_INPUT'); return Buffer.from(s.replaceAll('-', ''), 'hex'); };
const uuidText = (v: unknown) => {
  if (!Buffer.isBuffer(v) || v.length !== 16) throw new AdaptationError('UNAVAILABLE');
  const s = v.toString('hex'); return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};
const text = (v: unknown) => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v));
const keyHash = (key: string) => createHash('sha256').update(key, 'utf8').digest();
const sqlTime = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(iso)) throw new AdaptationError('INVALID_INPUT');
  return iso.slice(0, -1).replace('T', ' ');
};
/** Solo el nombre de la clave del final del mensaje (nunca se busca en el valor duplicado). */
const dupKey = (e: unknown, key: string) => {
  const err = e as { code?: string; sqlMessage?: string };
  const name = / for key ['`]([^'`]+)['`]$/.exec(err?.sqlMessage ?? '')?.[1];
  return err?.code === 'ER_DUP_ENTRY' && (name === key || name?.endsWith(`.${key}`) === true);
};

export function mariaDbAdaptationRepository(pool: Pool, config: { schema: string; account: string }): AdaptationRepository {
  if (!isSandboxVerifiedPool(pool) || !/^sandbox_api02_[a-z0-9_]+$/.test(config.schema) || !/^sandbox_api02_[a-z0-9_]+$/.test(config.account)) throw new AdaptationError('UNAVAILABLE');
  const { schema, account } = config;
  const table = (name: 'jobs' | 'links' | 'traces') => `\`${schema}\`.\`ps_api09_adapt_${name}\``;
  return {
    async runAtomic<T>(inputScope: AdaptationScope, action: (tx: AdaptationTransaction) => Promise<T>): Promise<{ value: T; assurance: 'SIMULATED' }> {
      const parsedScope = adaptationScopeSchema.safeParse(inputScope);
      if (!parsedScope.success) throw new AdaptationError('INVALID_INPUT');
      const scope = parsedScope.data;
      const ns = [Buffer.from(scope.environment), scope.tenantId, scope.clientId, Buffer.from(scope.integrationId)] as const;
      const where = 'environment=? AND tenant_id=? AND client_id=? AND integration_id=?';
      const fields = 'environment,tenant_id,client_id,integration_id';
      let conn: PoolConnection | undefined; let active = false; let committing = false; let broken = false;
      try {
        conn = await pool.getConnection();
        const [identity] = await conn.execute<RowDataPacket[]>('SELECT DATABASE() AS db, CURRENT_USER() AS account');
        if (identity.length !== 1 || identity[0].db !== schema || identity[0].account !== `${account}@127.0.0.1`) { broken = true; throw new AdaptationError('UNAVAILABLE'); }
        await conn.beginTransaction(); active = true;
        let pending = false; let poisoned = false;
        const sql = async (query: string, params: (string | number | Buffer | null)[]) => {
          if (!active || pending || poisoned) { poisoned = true; throw new AdaptationError('UNAVAILABLE'); }
          pending = true;
          try { return await conn!.execute(query, params); }
          catch (error) { poisoned = true; throw error; }
          finally { pending = false; }
        };
        const tx: AdaptationTransaction = {
          async job(key) {
            const [rows] = await sql(`SELECT job_key, order_id, input_hash, version, attempt, status, lease_until_ms, result_json FROM ${table('jobs')} WHERE ${where} AND job_key_hash=? FOR UPDATE`, [...ns, keyHash(key)]);
            const row = (rows as RowDataPacket[])[0]; if (!row) return null;
            if (text(row.job_key) !== key) throw new AdaptationError('UNAVAILABLE');
            let result: unknown = null;
            if (row.result_json !== null) { try { result = JSON.parse(text(row.result_json)); } catch { throw new AdaptationError('UNAVAILABLE'); } }
            const parsed = jobSchema.safeParse({ key, orderId: uuidText(row.order_id), inputHash: Buffer.from(row.input_hash).toString('hex'), version: Number(row.version), attempt: Number(row.attempt),
              status: row.status, leaseUntilMs: Number(row.lease_until_ms), result });
            if (!parsed.success) throw new AdaptationError('UNAVAILABLE');   // fila no reconocible: no se adivina nada
            return parsed.data;
          },
          async saveJob(job, previousVersion) {
            const checked = jobSchema.parse(job);
            const result = checked.result ? JSON.stringify(checked.result) : null;
            if (previousVersion === null) {
              try {
                await sql(`INSERT INTO ${table('jobs')} (${fields},job_key_hash,job_key,order_id,input_hash,version,attempt,status,lease_until_ms,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                  [...ns, keyHash(checked.key), Buffer.from(checked.key, 'utf8'), uuid(checked.orderId), Buffer.from(checked.inputHash, 'hex'), checked.version, checked.attempt, checked.status, checked.leaseUntilMs, result]);
              } catch (e) { if (dupKey(e, 'PRIMARY')) throw new AdaptationError('CONFLICT'); throw e; }   // otro intento ya creó el trabajo
              return;
            }
            const [updated] = await sql(`UPDATE ${table('jobs')} SET version=?, attempt=?, status=?, lease_until_ms=?, result_json=? WHERE ${where} AND job_key_hash=? AND version=?`,
              [checked.version, checked.attempt, checked.status, checked.leaseUntilMs, result, ...ns, keyHash(checked.key), previousVersion]);
            if ((updated as ResultSetHeader).affectedRows !== 1) throw new AdaptationError('CONFLICT');
          },
          async link(orderId) {
            const [rows] = await sql(`SELECT order_id, external_order_id, origin_club_reference, request_reference, version, source_version, source_state, local_delivery_state, cancellation_requested, correlation_id, link_json FROM ${table('links')} WHERE ${where} AND order_id=? FOR UPDATE`, [...ns, uuid(orderId)]);
            const row = (rows as RowDataPacket[])[0]; if (!row) return null;
            let json: unknown; try { json = JSON.parse(text(row.link_json)); } catch { throw new AdaptationError('UNAVAILABLE'); }
            const parsed = linkSchema.safeParse(json);
            // El JSON y las columnas indexadas deben coincidir: una discrepancia indica corrupción o escritura ajena.
            if (!parsed.success || parsed.data.orderId !== uuidText(row.order_id) || parsed.data.version !== Number(row.version) || parsed.data.externalOrderId !== text(row.external_order_id) ||
                parsed.data.scope.originClubReference !== text(row.origin_club_reference) || (parsed.data.requestReference ?? null) !== (row.request_reference === null ? null : text(row.request_reference)) ||
                parsed.data.localDeliveryState !== row.local_delivery_state || parsed.data.sourceVersion !== Number(row.source_version) || parsed.data.sourceState !== row.source_state ||
                Boolean(row.cancellation_requested) !== parsed.data.cancellationRequested || parsed.data.correlationId !== uuidText(row.correlation_id)) throw new AdaptationError('UNAVAILABLE');
            return parsed.data;
          },
          async saveLink(link, previousVersion) {
            const checked = linkSchema.parse(link);
            const columns = [Buffer.from(checked.externalOrderId), Buffer.from(checked.scope.originClubReference), checked.requestReference === null ? null : Buffer.from(checked.requestReference),
              checked.version, checked.sourceVersion, checked.sourceState, checked.localDeliveryState, checked.cancellationRequested ? 1 : 0, uuid(checked.correlationId), JSON.stringify(checked)] as const;
            try {
              if (previousVersion === null) {
                await sql(`INSERT INTO ${table('links')} (${fields},order_id,external_order_id,origin_club_reference,request_reference,version,source_version,source_state,local_delivery_state,cancellation_requested,correlation_id,link_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                  [...ns, uuid(checked.orderId), ...columns]);
                return;
              }
              const [updated] = await sql(`UPDATE ${table('links')} SET external_order_id=?, origin_club_reference=?, request_reference=?, version=?, source_version=?, source_state=?, local_delivery_state=?, cancellation_requested=?, correlation_id=?, link_json=? WHERE ${where} AND order_id=? AND version=?`,
                [...columns, ...ns, uuid(checked.orderId), previousVersion]);
              if ((updated as ResultSetHeader).affectedRows !== 1) throw new AdaptationError('CONFLICT');
            } catch (e) {
              if (dupKey(e, 'PRIMARY') || dupKey(e, 'uq_ps_api09_link_request')) throw new AdaptationError('CONFLICT');   // vínculo ya creado o referencia de solicitud ya usada por otra orden
              throw e;
            }
          },
          async appendTrace(trace: AdaptationTrace) {
            if (!['STARTED', 'LEASE_RECLAIMED', 'SUCCEEDED', 'FAILED', 'REPLAY'].includes(trace.phase)) throw new AdaptationError('INVALID_INPUT');
            const observation = trace.observation === null ? null : JSON.stringify(observationSchema.parse(trace.observation));
            await sql(`INSERT INTO ${table('traces')} (${fields},job_key_hash,order_id,attempt,phase,correlation_id,recorded_at,failure,observation_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
              [...ns, keyHash(trace.jobKey), uuid(trace.orderId), trace.attempt, trace.phase, uuid(trace.correlationId), sqlTime(trace.recordedAt), trace.failure, observation]);
          },
        };
        let inFlight = 0;
        const guarded = Object.fromEntries(Object.entries(tx).map(([name, operation]) => [name, async (...args: unknown[]) => {
          if (!active || inFlight || poisoned) { poisoned = true; throw new AdaptationError('UNAVAILABLE'); }
          inFlight++;
          try { return await Reflect.apply(operation, tx, args); }
          catch (error) { poisoned = true; throw error; }
          finally { inFlight--; }
        }])) as unknown as AdaptationTransaction;
        const value = await action(guarded);
        if (pending || poisoned || inFlight) throw new AdaptationError('UNAVAILABLE');
        active = false; committing = true;
        await conn.commit(); committing = false;
        return { value, assurance: 'SIMULATED' };
      } catch (error) {
        active = false;
        if (conn) { try { await conn.rollback(); } catch { broken = true; } }
        if (committing) { broken = true; throw new AdaptationError('UNAVAILABLE'); }   // resultado del COMMIT desconocido: el trabajo es idempotente y se reintenta
        if (error instanceof AdaptationError) throw error;
        throw new AdaptationError('UNAVAILABLE');   // sin mensaje SQL ni datos; interbloqueos y esperas de bloqueo también se reintentan
      } finally {
        if (conn) { try { if (broken) conn.destroy(); else conn.release(); } catch { throw new AdaptationError('UNAVAILABLE'); } }
      }
    },
  };
}
