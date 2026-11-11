import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { isSandboxVerifiedPool } from '../../sandbox-db';
import { AdaptationError, sourceSnapshotSchema, type AdaptationScope, type SourceOrderPort } from './tms-adaptation-contracts';

// PRICESMART API-08 — puerto de LECTURA de órdenes para la adaptación TMS, sobre ps_api01_orders (MariaDB).
// Solo lee columnas NO sensibles: nunca payload cifrado, hash de entrada ni recibos. La adaptación sólo necesita identidad, club, estado, versión y motivo de cancelación.
// Alcance completo (entorno, empresa, cliente, integración) + id + club de origen en CADA consulta; un id existente de otro alcance o club es indistinguible de uno inexistente (null).
// Misma defensa que API-02/API-07: pool verificado de sandbox, esquema/cuenta `sandbox_api02_*`, identidad SQL comprobada antes de consultar.
//
// ESTADO DE VALIDACIÓN: protocolo SQL probado con dobles del driver (SIMULATED). NO validado contra un motor real, y la cuenta de worker de API-07 AÚN NO tiene el
// SELECT necesario sobre estas columnas (ver SOURCE_ORDER_COLUMNS): conceder y validar exige tocar el laboratorio de API-06A, con autorización aparte.
// `assurance: 'SIMULATED'` es el literal del contrato de la cadena de adaptación (el puente completo es sintético), no una afirmación sobre la durabilidad de la lectura.

/** Columnas de ps_api01_orders que esta lectura consulta (y que el rol que la use necesitará como SELECT por columna). */
export const SOURCE_ORDER_COLUMNS = Object.freeze([
  'environment', 'tenant_id', 'client_id', 'integration_id', 'id', 'external_order_id', 'origin_club_reference',
  'payload_version', 'state', 'version', 'correlation_id', 'cancellation_reason', 'received_at',
] as const);

const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const uuidText = (v: unknown) => {
  if (!Buffer.isBuffer(v) || v.length !== 16) throw new AdaptationError('UNAVAILABLE');
  const s = v.toString('hex'); return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};
const text = (v: unknown) => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v));

export function mariaDbSourceOrderPort(pool: Pool, config: { schema: string; account: string }): SourceOrderPort {
  if (!isSandboxVerifiedPool(pool) || !/^sandbox_api02_[a-z0-9_]+$/.test(config.schema) || !/^sandbox_api02_[a-z0-9_]+$/.test(config.account)) throw new AdaptationError('UNAVAILABLE');
  const { schema, account } = config;
  const orders = `\`${schema}\`.\`ps_api01_orders\``;
  return {
    async load(scope: AdaptationScope, orderId: string): Promise<unknown | null> {
      if (typeof orderId !== 'string' || !idPattern.test(orderId)) throw new AdaptationError('INVALID_INPUT');
      let conn: PoolConnection | undefined; let broken = false;
      try {
        conn = await pool.getConnection();
        const [identity] = await conn.execute<RowDataPacket[]>('SELECT DATABASE() AS db, CURRENT_USER() AS account');
        if (identity.length !== 1 || identity[0].db !== schema || identity[0].account !== `${account}@127.0.0.1`) { broken = true; throw new AdaptationError('UNAVAILABLE'); }
        const [rows] = await conn.execute<RowDataPacket[]>(
          `SELECT ${SOURCE_ORDER_COLUMNS.filter(c => c !== 'received_at').join(', ')}, DATE_FORMAT(received_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS received_at_iso FROM ${orders} ` +
          `WHERE environment=? AND tenant_id=? AND client_id=? AND integration_id=? AND id=? AND origin_club_reference=?`,
          [Buffer.from(scope.environment), scope.tenantId, scope.clientId, Buffer.from(scope.integrationId), Buffer.from(orderId.replaceAll('-', ''), 'hex'), Buffer.from(scope.originClubReference)]);
        if (rows.length === 0) return null;
        if (rows.length !== 1) throw new AdaptationError('UNAVAILABLE');
        const row = rows[0];
        const snapshot = sourceSnapshotSchema.safeParse({
          scope: { environment: text(row.environment), tenantId: Number(row.tenant_id), clientId: Number(row.client_id), integrationId: text(row.integration_id), originClubReference: text(row.origin_club_reference) },
          orderId: uuidText(row.id),
          input: { schemaVersion: text(row.payload_version), externalOrderId: text(row.external_order_id), originClubReference: text(row.origin_club_reference) },
          state: row.state, version: Number(row.version), correlationId: uuidText(row.correlation_id), receivedAt: new Date(String(row.received_at_iso)).toISOString(),
          cancellationReason: row.cancellation_reason ?? null, assurance: 'SIMULATED',
        });
        if (!snapshot.success) throw new AdaptationError('UNAVAILABLE');   // fila corrupta/no reconocida: no se adivina nada
        return snapshot.data;
      } catch (error) {
        if (error instanceof AdaptationError) throw error;
        throw new AdaptationError('UNAVAILABLE');   // sin mensaje SQL ni datos
      } finally {
        if (conn) { try { if (broken) conn.destroy(); else conn.release(); } catch { throw new AdaptationError('UNAVAILABLE'); } }
      }
    },
  };
}
