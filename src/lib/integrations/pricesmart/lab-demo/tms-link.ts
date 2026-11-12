import { createHash } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { crearSolicitudCliente } from '@/lib/tms/solicitudes-cliente';
import { registrarAuditoria } from '@/lib/auditoria';
import type { OrderView, Scope } from '../contracts';
import type { OrderRepository } from '../ports';
import { assessCancellation, projectExternalStatus } from '../tms-contract-proposal';
import type { LabOrderInput } from './contract';

// PRICESMART API-12 — vinculación REAL (solo laboratorio) de una orden recibida con UNA solicitud del TMS en estado SOLICITADA.
// Qué hace: crea la solicitud con crearSolicitudCliente (misma función y validaciones que el Portal del Cliente) para que Operaciones la vea en su bandeja
// existente («Solicitudes de clientes») y decida: tomar en revisión, rechazar o programar. Qué NO hace: no crea viajes/planes, asignaciones, tarifas ni estados de entrega;
// no cambia el estado de la solicitud después de crearla; no cancela nada automáticamente.
// Modelo de seguridad: el destino (empresa, cliente y usuario de la solicitud) sale SOLO de la tabla administrativa ps_api12_tms_mapping, ligada al alcance autenticado
// (tenant/cliente/integración del catálogo M2M); el cuerpo de la solicitud HTTP no puede elegirlo.

export type LinkResult = { state: 'LINKED' | 'ALREADY_LINKED'; solicitudId: number } | { state: 'UNMAPPED' | 'ORDER_NOT_FOUND' | 'LOCK_TIMEOUT' | 'REJECTED_BY_TMS'; detail?: string };

const hex = (s: string) => createHash('sha256').update(s).digest('hex');
const uuidBuf = (s: string) => Buffer.from(s.replaceAll('-', ''), 'hex');

export function createTmsLinker(deps: { pool: Pool; schema: string; repository: OrderRepository }) {
  const { pool, schema, repository } = deps;
  if (!/^sandbox_api02_[a-z0-9_]+$/.test(schema)) throw new Error('esquema inválido');
  const t = (name: string) => `\`${schema}\`.\`ps_api12_${name}\``;
  const ns = (s: Scope): [Buffer, number, number, Buffer] => [Buffer.from(s.environment), s.tenantId, s.clientId, Buffer.from(s.integrationId)];
  const where = 'environment=? AND tenant_id=? AND client_id=? AND integration_id=?';

  async function link(scope: Scope, externalOrderId: string): Promise<LinkResult> {
    const conn = await pool.getConnection();
    const lockName = `ps12:${hex(JSON.stringify([scope.environment, scope.tenantId, scope.clientId, scope.integrationId, externalOrderId])).slice(0, 48)}`;
    let locked = false;
    try {
      const [[lk]] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 10) AS ok', [lockName]);
      if (Number(lk.ok) !== 1) return { state: 'LOCK_TIMEOUT' };
      locked = true;
      const [maps] = await conn.execute<RowDataPacket[]>(`SELECT empresa_id, tms_cliente_id, tms_usuario_cliente_id, pickup_place, dropoff_place FROM ${t('tms_mapping')} WHERE ${where}`, ns(scope));
      if (maps.length !== 1) return { state: 'UNMAPPED' };
      const map = maps[0];
      const stored = (await repository.runAtomic(scope, (tx) => tx.findForUpdate(externalOrderId))).value;
      if (!stored) return { state: 'ORDER_NOT_FOUND' };
      const [existing] = await conn.execute<RowDataPacket[]>(`SELECT solicitud_id FROM ${t('tms_links')} WHERE ${where} AND order_id=?`, [...ns(scope), uuidBuf(stored.id)]);
      if (existing.length) return { state: 'ALREADY_LINKED', solicitudId: Number(existing[0].solicitud_id) };
      const input = stored.input as unknown as LabOrderInput;
      // Recuperación tras una caída entre «crear la solicitud» y «anotar el vínculo»: la solicitud del mismo cliente/usuario con la misma referencia ya es la de esta orden.
      const [prior] = await conn.execute<RowDataPacket[]>(
        'SELECT id FROM tms_solicitudes_cliente WHERE empresa_id=? AND cliente_id=? AND creado_por_usuario_cliente_id=? AND referencia_cliente=? ORDER BY id LIMIT 1',
        [map.empresa_id, map.tms_cliente_id, map.tms_usuario_cliente_id, input.externalOrderId]);
      let solicitudId: number;
      if (prior.length) solicitudId = Number(prior[0].id);
      else {
        const created = await crearSolicitudCliente(
          { empresaId: Number(map.empresa_id), clienteId: Number(map.tms_cliente_id), usuarioClienteId: Number(map.tms_usuario_cliente_id) },
          {
            fechaSolicitada: input.deliveryDate, referenciaCliente: input.externalOrderId,
            observaciones: `PriceSmart (laboratorio) · club ${input.originClubReference} · destinatario ${input.recipient.name}${input.notes ? ` · ${input.notes}` : ''}`.slice(0, 500),
            origen: { lugarNombre: String(map.pickup_place) },
            entregas: [{ lugarNombre: input.recipient.name, referencia: input.address }],
            destino: { lugarNombre: String(map.dropoff_place) },
          });
        if (!created.ok) return { state: 'REJECTED_BY_TMS', detail: created.mensaje };
        solicitudId = created.solicitud.id;
      }
      await conn.execute(`INSERT INTO ${t('tms_links')} (environment, tenant_id, client_id, integration_id, order_id, empresa_id, solicitud_id, linked_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(6))`,
        [...ns(scope), uuidBuf(stored.id), map.empresa_id, solicitudId]);
      return { state: 'LINKED', solicitudId };
    } finally {
      if (locked) { try { await conn.query('SELECT RELEASE_LOCK(?)', [lockName]); } catch { conn.destroy(); return undefined as never; } }
      conn.release();
    }
  }

  /** Estado real para el GET. Nunca afirma entrega: `confirmsDelivery` es siempre false (Cerrado/Descargado no prueban entrega aceptada). */
  async function status(scope: Scope, externalOrderId: string, view: OrderView): Promise<Record<string, unknown>> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT l.empresa_id, l.solicitud_id, l.cancellation_requested_at, s.estado AS sol_estado, p.estado AS plan_estado
         FROM ${t('tms_links')} l
         JOIN \`${schema}\`.ps_api01_orders o ON o.environment=l.environment AND o.tenant_id=l.tenant_id AND o.client_id=l.client_id AND o.integration_id=l.integration_id AND o.id=l.order_id
         LEFT JOIN tms_solicitudes_cliente s ON s.empresa_id=l.empresa_id AND s.id=l.solicitud_id
         LEFT JOIN tms_planes_viaje p ON p.empresa_id=s.empresa_id AND p.id=s.plan_id
        WHERE l.environment=? AND l.tenant_id=? AND l.client_id=? AND l.integration_id=? AND o.external_order_id=?`, [...ns(scope), Buffer.from(externalOrderId)]);
    const cancellationAsked = view.provisionalStatus === 'CANCELLATION_REQUESTED' || view.provisionalStatus === 'CANCELLED';
    if (!rows.length) {
      return { labProposal: true, proposedStatus: 'RECEIVED', confirmsDelivery: false, tms: { linked: false },
        ...(cancellationAsked ? { cancellation: { requested: true, automatic: false, assessment: 'REQUESTED_NOT_LINKED' } } : {}) };
    }
    const r = rows[0];
    const projection = projectExternalStatus(String(r.sol_estado ?? ''), r.plan_estado == null ? null : String(r.plan_estado));
    return {
      labProposal: true, proposedStatus: projection.status, confirmsDelivery: false,
      tms: { linked: true, requestState: r.sol_estado == null ? null : String(r.sol_estado), scheduled: r.plan_estado != null },
      ...(cancellationAsked ? { cancellation: { requested: true, automatic: false, assessment: assessCancellation(String(r.sol_estado ?? ''), r.plan_estado == null ? null : String(r.plan_estado)).verdict } } : {}),
    };
  }

  /** Solicitud de cancelación: SOLO deja constancia (vínculo + auditoría). No cancela solicitudes, planes ni viajes: lo decide Operaciones. */
  async function noteCancellation(scope: Scope, externalOrderId: string): Promise<void> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT l.empresa_id, l.solicitud_id FROM ${t('tms_links')} l JOIN \`${schema}\`.ps_api01_orders o ON o.environment=l.environment AND o.tenant_id=l.tenant_id AND o.client_id=l.client_id AND o.integration_id=l.integration_id AND o.id=l.order_id
        WHERE l.environment=? AND l.tenant_id=? AND l.client_id=? AND l.integration_id=? AND o.external_order_id=?`, [...ns(scope), Buffer.from(externalOrderId)]);
    if (!rows.length) return;
    await pool.execute(`UPDATE ${t('tms_links')} l JOIN \`${schema}\`.ps_api01_orders o ON o.environment=l.environment AND o.tenant_id=l.tenant_id AND o.client_id=l.client_id AND o.integration_id=l.integration_id AND o.id=l.order_id
        SET l.cancellation_requested_at = COALESCE(l.cancellation_requested_at, UTC_TIMESTAMP(6))
      WHERE l.environment=? AND l.tenant_id=? AND l.client_id=? AND l.integration_id=? AND o.external_order_id=?`, [...ns(scope), Buffer.from(externalOrderId)]);
    await registrarAuditoria({ empresaId: Number(rows[0].empresa_id), usuario: 'integracion:pricesmart-laboratorio', accion: 'pricesmart_cancelacion_solicitada', modulo: 'tms',
      detalle: `PriceSmart solicitó cancelar el pedido ${externalOrderId} (solicitud TMS #${rows[0].solicitud_id}). Sin acción automática: requiere decisión de Operaciones.` });
  }
  return { link, status, noteCancellation };
}
