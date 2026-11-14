import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { OutboxEvent, OutboxHandler, OutboxOutcome } from '../outbox';
import type { createLinkRetry } from './link-retry';
import type { createTmsLinker } from './tms-link';

// PRICESMART API-23 — ENLACE outbox → vinculación TMS de laboratorio. Hasta API-22 el repositorio escribía los eventos en la outbox (API-01/07) pero NADA los consumía hacia el TMS de laboratorio: la vinculación
// ocurría solo por la vía rápida posterior al commit y por los reintentos propios de API-13. Este manejador cierra esa brecha SIN crear otra capa: usa el despachador de outbox existente (reclamo con lease y
// fencing, reintentos con backoff, revisión durable) y reutiliza tal cual la vinculación idempotente (`attemptNow`) y la constancia de cancelación (`noteCancellation`).
//  · Entrega al-menos-una-vez ⇒ idempotente: reprocesar un evento nunca crea una segunda solicitud (token de reclamo + GET_LOCK) ni duplica la auditoría de cancelación.
//  · Aislamiento: la orden se resuelve SOLO dentro del ALCANCE del evento (entorno, tenant, cliente, integración); un evento cuyo alcance no contiene la orden se manda a revisión, jamás se procesa en otro alcance.
//  · Resultado: DONE (vinculado / nada que vincular), RETRY (pendiente: sin mapeo, bloqueo temporal, vinculación en curso) o REVIEW (rechazo del TMS, ambigüedad, reintentos agotados). Solo códigos; nunca texto libre.
//  · Solo laboratorio (como toda la vinculación): no cancela solicitudes, planes ni viajes, no crea viajes y no depende de D05/D06/D08.
const CODE = /^[A-Z][A-Z0-9_]{0,39}$/;
const code = (v: unknown, fallback: string) => (typeof v === 'string' && CODE.test(v) ? v : fallback);

export type LinkOutboxDeps = {
  /** Pool de EJECUCIÓN (cuenta de la aplicación): solo lecturas de la orden, del trabajo y del vínculo dentro del alcance del evento. */
  pool: Pool; schema: string;
  retry: Pick<ReturnType<typeof createLinkRetry>, 'attemptNow'>;
  linker: Pick<ReturnType<typeof createTmsLinker>, 'noteCancellation'>;
};

export function createLinkOutboxHandler(deps: LinkOutboxDeps): OutboxHandler {
  const { pool, schema, retry, linker } = deps;
  if (!/^sandbox_api02_[a-z0-9_]+$/.test(schema)) throw new Error('esquema inválido');
  const q = (name: string) => `\`${schema}\`.\`${name}\``;
  const scopeParams = (e: OutboxEvent) => [Buffer.from(e.scope.environment), e.scope.tenantId, e.scope.clientId, Buffer.from(e.scope.integrationId)];
  const orderId = (e: OutboxEvent) => Buffer.from(e.orderId.replaceAll('-', ''), 'hex');

  async function order(e: OutboxEvent): Promise<{ externalOrderId: string; state: string } | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(`SELECT external_order_id, state FROM ${q('ps_api01_orders')} WHERE environment=? AND tenant_id=? AND client_id=? AND integration_id=? AND id=?`, [...scopeParams(e), orderId(e)]);
    if (rows.length !== 1) return null;
    const raw = rows[0].external_order_id; return { externalOrderId: Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw), state: String(rows[0].state) };
  }
  async function linked(e: OutboxEvent): Promise<boolean> {
    const [rows] = await pool.execute<RowDataPacket[]>(`SELECT 1 AS ok FROM ${q('ps_api12_tms_links')} WHERE environment=? AND tenant_id=? AND client_id=? AND integration_id=? AND order_id=? AND solicitud_id IS NOT NULL`, [...scopeParams(e), orderId(e)]);
    return rows.length > 0;
  }
  async function job(e: OutboxEvent): Promise<{ status: string; outcome: string | null; leased: boolean } | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(`SELECT status, last_outcome, (lease_until IS NOT NULL AND lease_until > UTC_TIMESTAMP(6)) AS leased FROM ${q('ps_api13_link_jobs')} WHERE environment=? AND tenant_id=? AND client_id=? AND integration_id=? AND order_id=?`, [...scopeParams(e), orderId(e)]);
    return rows.length === 1 ? { status: String(rows[0].status), outcome: rows[0].last_outcome == null ? null : String(rows[0].last_outcome), leased: Number(rows[0].leased) === 1 } : null;
  }

  return {
    async handle(event): Promise<OutboxOutcome> {
      const found = await order(event);
      if (!found) return { kind: 'REVIEW', reason: 'ORDER_NOT_IN_SCOPE' };   // el evento no pertenece a este alcance (o la orden no existe): nunca se procesa en otro
      if (event.type === 'CANCELLATION_REQUESTED') {
        if (await linked(event)) { await linker.noteCancellation(event.scope, found.externalOrderId); return { kind: 'DONE' }; }
        const j = await job(event);
        // Sin vínculo: si hay una vinculación EN CURSO (trabajo reclamado y con lease vigente) podría completarse después de esta solicitud: se reintenta para no perder la constancia. Si no, la vinculación
        // ya no ocurrirá (la orden dejó de estar RECIBIDA y el trabajo la bloqueará como no elegible) y no hay nada que marcar.
        return j?.status === 'PENDING' && j.leased ? { kind: 'RETRY', reason: 'LINK_IN_PROGRESS' } : { kind: 'DONE' };
      }
      // RECEIVED
      if (await linked(event)) return { kind: 'DONE' };
      if (found.state !== 'RECEIVED') return { kind: 'DONE' };   // la orden ya no está recibida (cancelación pedida): vincularla sería incorrecto; el evento quedó obsoleto
      await retry.attemptNow(event.scope, found.externalOrderId, 'outbox');   // idempotente; una excepción la convierte el despachador en RETRY (sin conservar el mensaje)
      if (await linked(event)) return { kind: 'DONE' };
      const j = await job(event);
      if (!j) return { kind: 'RETRY', reason: 'NO_LINK_JOB' };
      if (j.status === 'DONE') return { kind: 'DONE' };
      if (j.status === 'BLOCKED') return { kind: 'REVIEW', reason: code(j.outcome, 'LINK_BLOCKED') };
      if (j.status === 'EXHAUSTED') return { kind: 'REVIEW', reason: 'LINK_EXHAUSTED' };
      return { kind: 'RETRY', reason: code(j.outcome, 'LINK_PENDING') };
    },
  };
}
