import { createHash } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { isSandboxVerifiedPool } from '../../sandbox-db';
import type { AttestationTarget, NonceStore } from './conformance-attestation';
import type { PortName } from './port-conformance';
import type { ResourceRegistry } from './registry-identity-authority';

// PRICESMART API-18 — almacén DURABLE y compartido de nonces de atestación (un solo uso, atómico) y lector del registro administrativo de identidad de recursos, respaldados por MariaDB.
// Atomicidad: la clave primaria (target, hash del nonce) hace que de N canjes concurrentes del mismo nonce exactamente UNO inserte; el resto recibe «ya usado» (errno 1062). Sin lecturas previas ni locks.
// Separación LAB / PRODUCTION: el destino es parte de la clave y de cada consulta, y la fábrica exige recursos disjuntos: LAB solo con el pool verificado de sandbox y esquema/cuenta `sandbox_api02_*`;
// PRODUCTION solo con un pool NO sandbox y nombres que no sigan el patrón de laboratorio. NO crea el pool, NO ejecuta DDL, NO escribe el registro (lo escribe una cuenta administrativa distinta) y
// ninguna ruta ni composición lo importa. Privilegios mínimos del runtime: nonces → SELECT+INSERT; registro → SELECT. DDL propuesto (no ejecutado): docs/integraciones/pricesmart/api18/staging-attestation.sql.in
const LAB_NAME = /^sandbox_api02_[a-z0-9_]+$/;
const PROD_NAME = /^[A-Za-z0-9_]{1,64}$/;
const PORTS: readonly PortName[] = ['cipher', 'clock', 'counter', 'replay', 'catalog', 'verifier'];
const unavailable = () => new Error('UNAVAILABLE');

export function mariaDbAttestationPorts(pool: Pool, config: { schema: string; runtimeUser: string; target: AttestationTarget }): { nonces: NonceStore; registry: ResourceRegistry } {
  const { schema, runtimeUser, target } = config;
  const lab = target === 'LAB';
  const verified = (() => { try { return isSandboxVerifiedPool(pool); } catch { return false; } })();
  if (target !== 'LAB' && target !== 'PRODUCTION') throw unavailable();
  if (lab ? !(verified && LAB_NAME.test(schema) && LAB_NAME.test(runtimeUser)) : !(!verified && PROD_NAME.test(schema) && PROD_NAME.test(runtimeUser) && !LAB_NAME.test(schema) && !LAB_NAME.test(runtimeUser))) throw unavailable();
  const table = (name: string) => `\`${schema}\`.\`ps_api18_${name}\``;

  async function withConn<T>(action: (conn: PoolConnection) => Promise<T>): Promise<T> {
    let conn: PoolConnection | undefined; let broken = false;
    try {
      conn = await pool.getConnection();
      const [identity] = await conn.execute<RowDataPacket[]>('SELECT DATABASE() AS db, CURRENT_USER() AS account');
      const account = String(identity[0]?.account ?? '');
      if (identity.length !== 1 || identity[0].db !== schema || account.slice(0, account.lastIndexOf('@')) !== runtimeUser) { broken = true; throw unavailable(); }   // la sesión no es la esperada
      return await action(conn);
    } catch {
      throw unavailable();   // nunca se propaga el detalle del motor
    } finally { if (conn) { if (broken) conn.destroy(); else conn.release(); } }
  }

  const nonces: NonceStore = {
    async consume(nonce, expiresAtMs) {
      if (!/^[a-f0-9]{32}$/.test(nonce) || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) throw unavailable();
      const hash = createHash('sha256').update(`pricesmart-api18-nonce-v1:${nonce}`).digest();
      let conn: PoolConnection | undefined; let broken = false;
      try {
        conn = await pool.getConnection();
        const [identity] = await conn.execute<RowDataPacket[]>('SELECT DATABASE() AS db, CURRENT_USER() AS account');
        const account = String(identity[0]?.account ?? '');
        if (identity.length !== 1 || identity[0].db !== schema || account.slice(0, account.lastIndexOf('@')) !== runtimeUser) { broken = true; throw unavailable(); }
        try { await conn.execute(`INSERT INTO ${table('attestation_nonces')} (target, nonce_hash, expires_at_ms) VALUES (?, ?, ?)`, [target, hash, expiresAtMs]); return 'FRESH'; }
        catch (error) { if ((error as { errno?: number })?.errno === 1062) return 'USED'; throw error; }
      } catch (error) {
        if (error instanceof Error && error.message === 'UNAVAILABLE') throw error;
        throw unavailable();
      } finally { if (conn) { if (broken) conn.destroy(); else conn.release(); } }
    },
  };

  const registry: ResourceRegistry = {
    async lookup({ target: t, port, resourceId }) {
      if (t !== target || !PORTS.includes(port) || !/^[A-Za-z0-9._:-]{1,128}$/.test(resourceId)) return null;   // un destino no consulta el registro del otro
      return withConn(async (conn) => {
        const [rows] = await conn.execute<RowDataPacket[]>(`SELECT subject, status FROM ${table('resource_registry')} WHERE target = ? AND port = ? AND resource_id = ?`, [target, port, Buffer.from(resourceId)]);
        if (rows.length !== 1) return null;
        const subject = String(rows[0].subject); const status = String(rows[0].status);
        return (subject === 'LIVE' || subject === 'ISOLATED_COPY') && (status === 'ACTIVE' || status === 'RETIRED') ? { subject, status } : null;
      });
    },
  };
  return { nonces, registry };
}
