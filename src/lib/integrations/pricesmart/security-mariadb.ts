import { createHash } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { isSandboxVerifiedPool } from '../../sandbox-db';
import { SecurityFailure, type AtomicCounterPort, type AtomicReplayPort, type CredentialBinding, type IntegrationCatalog, type RevocationPort, type TrustedClock } from './security-contracts';

// PRICESMART API-11 — puertos de seguridad M2M respaldados por MariaDB (catálogo, revocación, contador y reclamo anti-repetición).
// Son INDEPENDIENTES del mecanismo criptográfico (D02): no verifican credenciales, solo guardan estado administrativo y atómico. NO crean el pool, NO ejecutan DDL
// y NO se importan desde rutas. Mismas guardas que mariadb-repository.ts: pool verificado de sandbox, esquema/cuenta `sandbox_api02_*`, identidad SQL antes de operar.
// Privilegios mínimos requeridos del runtime: SELECT en integraciones/revocaciones; SELECT+INSERT+UPDATE(used) en rate_counters; SELECT+INSERT en proof_claims. Nunca DELETE/DDL.
// DDL propuesto (no ejecutado): docs/integraciones/pricesmart/api11/staging-security.sql.in

class RetryableDeadlock extends Error {}
const SCHEMA_RE = /^sandbox_api02_[a-z0-9_]+$/;
const text = (v: unknown) => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v));
const sha = (s: string) => Buffer.from(s, 'hex');
const digest = (s: string) => { if (!/^[a-f0-9]{64}$/.test(s)) throw new SecurityFailure('UNAVAILABLE'); return sha(s); };
const bounded = (s: unknown, max: number) => {
  if (typeof s !== 'string' || s.length < 1 || Buffer.byteLength(s) > max) throw new SecurityFailure('UNAVAILABLE');
  return Buffer.from(s);
};

export function mariaDbSecurityPorts(pool: Pool, config: { schema: string; runtimeUser: string }): {
  catalog: IntegrationCatalog; revocation: RevocationPort; counter: AtomicCounterPort; replay: AtomicReplayPort; clock: TrustedClock;
} {
  if (!isSandboxVerifiedPool(pool) || !SCHEMA_RE.test(config.schema) || !SCHEMA_RE.test(config.runtimeUser)) throw new SecurityFailure('UNAVAILABLE');
  const { schema, runtimeUser } = config;
  const table = (name: string) => `\`${schema}\`.\`ps_api11_${name}\``;

  async function withConn<T>(action: (conn: PoolConnection) => Promise<T>, transactional: boolean): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await once(action, transactional); }
      catch (error) { if (!(error instanceof RetryableDeadlock) || attempt >= 2) throw error instanceof RetryableDeadlock ? new SecurityFailure('UNAVAILABLE') : error; }
    }
  }
  async function once<T>(action: (conn: PoolConnection) => Promise<T>, transactional: boolean): Promise<T> {
    let conn: PoolConnection | undefined; let active = false; let broken = false; let changedIsolation = false;
    try {
      conn = await pool.getConnection();
      const [identity] = await conn.execute<RowDataPacket[]>('SELECT DATABASE() AS db, CURRENT_USER() AS account');
      if (identity.length !== 1 || identity[0].db !== schema || identity[0].account !== `${runtimeUser}@127.0.0.1`) { broken = true; throw new SecurityFailure('UNAVAILABLE'); }
      // El proxy del pool sandbox verifica la identidad con una lectura previa a cada sentencia, que consumiría un SET TRANSACTION de una sola vez: se usa el nivel de SESIÓN y se restaura.
      if (transactional) { await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED'); changedIsolation = true; await conn.beginTransaction(); active = true; }
      const value = await action(conn);
      if (active) { await conn.commit(); active = false; }
      return value;
    } catch (error) {
      if (conn && active) { try { await conn.rollback(); } catch { broken = true; } }
      if (error instanceof SecurityFailure) throw error;
      if (transactional && (error as { errno?: number })?.errno === 1213) throw new RetryableDeadlock();   // interbloqueo: la transacción ya revirtió; se reintenta (máx. 2 veces)
      throw new SecurityFailure('UNAVAILABLE');
    } finally {
      if (conn && changedIsolation && !broken) { try { await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ'); } catch { broken = true; } }
      if (conn) { if (broken) conn.destroy(); else conn.release(); }
    }
  }

  const catalog: IntegrationCatalog = {
    async findByCredential(binding: CredentialBinding): Promise<unknown[]> {
      const b = [bounded(binding.issuer, 256), bounded(binding.subject, 256), bounded(binding.credentialReference, 256)];
      return withConn(async (conn) => {
        const [rows] = await conn.execute<RowDataPacket[]>(
          `SELECT environment, tenant_id, client_id, integration_id, issuer, subject, credential_reference, revision, status, valid_from_ms, valid_until_ms,
                  credential_valid_from_ms, credential_valid_until_ms, rotated_at_ms, allowed_clubs_json, scopes_json
             FROM ${table('integrations')} WHERE issuer = ? AND subject = ? AND credential_reference = ? LIMIT 3`, b);
        return rows.map((r) => ({
          integrationId: text(r.integration_id), tenantId: Number(r.tenant_id), clientId: Number(r.client_id), environment: text(r.environment),
          issuer: text(r.issuer), subject: text(r.subject), credentialReference: text(r.credential_reference), revision: Number(r.revision), status: text(r.status),
          validFromMs: Number(r.valid_from_ms), validUntilMs: Number(r.valid_until_ms), credentialValidFromMs: Number(r.credential_valid_from_ms),
          credentialValidUntilMs: Number(r.credential_valid_until_ms), rotatedAtMs: Number(r.rotated_at_ms),
          allowedClubs: JSON.parse(text(r.allowed_clubs_json)) as unknown, scopes: JSON.parse(text(r.scopes_json)) as unknown,
        }));
      }, false);
    },
  };

  const revocation: RevocationPort = {
    async isRevoked(input) {
      // Revocada = existe una revocación para la credencial con revisión >= a la del catálogo, o cualquier revocación de la integración completa (revision = 0).
      const b = [bounded(input.issuer, 256), bounded(input.subject, 256), bounded(input.credentialReference, 256), input.revision];
      return withConn(async (conn) => {
        const [rows] = await conn.execute<RowDataPacket[]>(
          `SELECT 1 AS hit FROM ${table('revocations')} WHERE issuer = ? AND subject = ? AND credential_reference = ? AND (revision = 0 OR revision >= ?) LIMIT 1`, b);
        return rows.length > 0;
      }, false);
    },
  };

  // Ventana fija atómica. Paso 1 (fuera de transacción, se confirma de inmediato): INSERT IGNORE crea la fila en 0; así no hay bloqueos compartidos retenidos.
  // Paso 2 (transacción corta): UPDATE used = used + 1 toma el bloqueo exclusivo y SELECT lee el valor propio. Dos variantes anteriores se descartaron por el laboratorio:
  // "INSERT IGNORE + UPDATE" en la misma transacción y "INSERT … ON DUPLICATE KEY UPDATE" se interbloquean con conexiones simultáneas sobre la misma clave nueva.
  // Toda solicitud cuenta, también las rechazadas: permitida ⇔ used <= límite.
  const counter: AtomicCounterPort = {
    async consume({ identityKey, limit, windowMs, nowMs }) {
      if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1 || !Number.isSafeInteger(nowMs) || nowMs < 0) throw new SecurityFailure('UNAVAILABLE');
      const key = Buffer.from(identityKey); if (key.length < 1 || key.length > 512) throw new SecurityFailure('UNAVAILABLE');
      const windowStart = Math.floor(nowMs / windowMs) * windowMs;
      await withConn(async (conn) => { await conn.execute(`INSERT IGNORE INTO ${table('rate_counters')} (identity_key, window_start_ms, used) VALUES (?, ?, 0)`, [key, windowStart]); }, false);
      return withConn(async (conn) => {
        const [up] = await conn.execute<ResultSetHeader>(`UPDATE ${table('rate_counters')} SET used = used + 1 WHERE identity_key = ? AND window_start_ms = ?`, [key, windowStart]);
        if (up.affectedRows !== 1) throw new SecurityFailure('UNAVAILABLE');
        const [rows] = await conn.execute<RowDataPacket[]>(`SELECT used FROM ${table('rate_counters')} WHERE identity_key = ? AND window_start_ms = ?`, [key, windowStart]);
        if (rows.length !== 1) throw new SecurityFailure('UNAVAILABLE');
        const used = Number(rows[0].used);
        return { allowed: used <= limit, used, resetAtMs: windowStart + windowMs, assurance: 'DISTRIBUTED_ATOMIC' as const };
      }, true);
    },
  };

  const replay: AtomicReplayPort = {
    async claim({ identityKey, proofId, bindingDigest, retainUntilMs, nowMs }) {
      const key = digest(identityHash(identityKey)); const id = bounded(proofId, 120); const d = digest(bindingDigest);
      if (!Number.isSafeInteger(retainUntilMs) || !Number.isSafeInteger(nowMs) || retainUntilMs <= nowMs) throw new SecurityFailure('UNAVAILABLE');
      return withConn(async (conn) => {
        const [ins] = await conn.execute<ResultSetHeader>(`INSERT IGNORE INTO ${table('proof_claims')} (identity_hash, proof_id, binding_digest, claimed_at_ms, retain_until_ms) VALUES (?, ?, ?, ?, ?)`, [key, id, d, nowMs, retainUntilMs]);
        if (ins.affectedRows === 1) return { status: 'CLAIMED' as const, assurance: 'DURABLE_ATOMIC' as const };
        const [rows] = await conn.execute<RowDataPacket[]>(`SELECT binding_digest FROM ${table('proof_claims')} WHERE identity_hash = ? AND proof_id = ?`, [key, id]);
        if (rows.length !== 1) throw new SecurityFailure('UNAVAILABLE');
        return { status: Buffer.compare(rows[0].binding_digest as Buffer, d) === 0 ? 'REUSED' as const : 'COLLISION' as const, assurance: 'DURABLE_ATOMIC' as const };
      }, true);
    },
  };

  // Reloj local del proceso. La autoridad de tiempo distribuida es un requisito pendiente de composición (varios nodos deben sincronizarse por NTP).
  const clock: TrustedClock = { nowMs: () => Date.now() };
  return Object.freeze({ catalog, revocation, counter, replay, clock });
}

/** La clave de identidad (namespace JSON) puede medir más de 120 bytes: se guarda su SHA-256, no el texto. */
function identityHash(identityKey: string): string {
  if (typeof identityKey !== 'string' || identityKey.length < 1 || identityKey.length > 1024) throw new SecurityFailure('UNAVAILABLE');
  return createHash('sha256').update(identityKey).digest('hex');
}
