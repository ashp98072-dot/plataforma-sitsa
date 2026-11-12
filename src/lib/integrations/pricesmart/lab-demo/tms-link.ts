import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
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
//
// IDENTIDAD DEL VÍNCULO (API-12 auditoría + API-13): una solicitud solo se asocia a una orden si su pertenencia está DEMOSTRADA, nunca por coincidir en referencia.
//   1) Antes de crear la solicitud se persiste, en el vínculo de la orden (clave: alcance + orden), un token aleatorio de 128 bits (`claim_token`, UNIQUE) con la solicitud aún en NULL.
//   2) La solicitud se crea con `crearSolicitudCliente` y su gancho `dentroDeTransaccion`: el UPDATE que escribe `solicitud_id` en el vínculo ocurre EN LA MISMA TRANSACCIÓN que el alta de la
//      solicitud (ACID). No existe ventana de caída entre «crear la solicitud» y «anotar el vínculo»: o quedan ambas o ninguna. La pertenencia vive en una columna con FK y UNIQUE,
//      no en texto editable.
//   3) El token también se escribe al inicio de `observaciones` ([PS:<32 hex>]) SOLO como trazabilidad para personas y como compatibilidad con vínculos pendientes creados por API-12
//      (esos se recuperan por token). Que un usuario edite ese texto ya no puede romper ni falsear la identidad de los vínculos nuevos.
//   Una solicitud preexistente con la misma referencia, o creada por otra integración que comparta cliente y usuario de servicio, NO se reutiliza jamás.

export type LinkResult =
  | { state: 'LINKED' | 'ALREADY_LINKED'; solicitudId: number; warning?: string }
  | { state: 'UNMAPPED' | 'ORDER_NOT_FOUND' | 'LOCK_TIMEOUT' | 'REJECTED_BY_TMS' | 'RECOVERY_AMBIGUOUS'; detail?: string; warning?: string };

export type TmsLinkerDeps = {
  pool: Pool; schema: string; repository: OrderRepository;
  /** Solo pruebas: sustituye la creación de la solicitud (p. ej. para simular una caída antes o después de crearla). Por defecto, la función real del TMS. */
  createRequest?: typeof crearSolicitudCliente;
};

const hex = (s: string) => createHash('sha256').update(s).digest('hex');
const uuidBuf = (s: string) => Buffer.from(s.replaceAll('-', ''), 'hex');
export const claimMarker = (token: Buffer) => `[PS:${token.toString('hex')}]`;

export function createTmsLinker(deps: TmsLinkerDeps) {
  const { pool, schema, repository } = deps;
  const createRequest = deps.createRequest ?? crearSolicitudCliente;
  if (!/^sandbox_api02_[a-z0-9_]+$/.test(schema)) throw new Error('esquema inválido');
  const t = (name: string) => `\`${schema}\`.\`ps_api12_${name}\``;
  const ns = (s: Scope): [Buffer, number, number, Buffer] => [Buffer.from(s.environment), s.tenantId, s.clientId, Buffer.from(s.integrationId)];
  const where = 'environment=? AND tenant_id=? AND client_id=? AND integration_id=?';

  async function linkLocked(conn: PoolConnection, scope: Scope, externalOrderId: string): Promise<LinkResult> {
    const [maps] = await conn.execute<RowDataPacket[]>(`SELECT empresa_id, tms_cliente_id, tms_usuario_cliente_id, pickup_place, dropoff_place FROM ${t('tms_mapping')} WHERE ${where}`, ns(scope));
    if (maps.length !== 1) return { state: 'UNMAPPED' };
    const map = maps[0];
    const stored = (await repository.runAtomic(scope, (tx) => tx.findForUpdate(externalOrderId))).value;
    if (!stored) return { state: 'ORDER_NOT_FOUND' };
    const orderKey = [...ns(scope), uuidBuf(stored.id)];
    const [links] = await conn.execute<RowDataPacket[]>(`SELECT claim_token, solicitud_id FROM ${t('tms_links')} WHERE ${where} AND order_id=?`, orderKey);
    if (links.length && links[0].solicitud_id != null) return { state: 'ALREADY_LINKED', solicitudId: Number(links[0].solicitud_id) };
    // Paso 1: reclamo persistido ANTES de crear nada en el TMS (o el de un intento anterior interrumpido).
    let token: Buffer;
    if (links.length) token = links[0].claim_token as Buffer;
    else {
      token = randomBytes(16);
      await conn.execute(`INSERT INTO ${t('tms_links')} (environment, tenant_id, client_id, integration_id, order_id, empresa_id, claim_token, created_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(6))`, [...orderKey, map.empresa_id, token]);
    }
    const marker = claimMarker(token);
    // Recuperación: SOLO por token. El marcador es hexadecimal puro (sin comodines de LIKE) y los demás filtros fijan empresa/cliente/usuario del mapeo.
    const [found] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM tms_solicitudes_cliente WHERE empresa_id=? AND cliente_id=? AND creado_por_usuario_cliente_id=? AND LEFT(observaciones, ?) = ? ORDER BY id LIMIT 2',
      [map.empresa_id, map.tms_cliente_id, map.tms_usuario_cliente_id, marker.length, marker]);
    if (found.length > 1) return { state: 'RECOVERY_AMBIGUOUS', detail: 'más de una solicitud con el mismo reclamo' };
    let solicitudId: number;
    if (found.length === 1) solicitudId = Number(found[0].id);
    else {
      const input = stored.input as unknown as LabOrderInput;
      const created = await createRequest(
        { empresaId: Number(map.empresa_id), clienteId: Number(map.tms_cliente_id), usuarioClienteId: Number(map.tms_usuario_cliente_id) },
        {
          fechaSolicitada: input.deliveryDate, referenciaCliente: input.externalOrderId,
          observaciones: `${marker} PriceSmart (laboratorio) · club ${input.originClubReference} · destinatario ${input.recipient.name}${input.notes ? ` · ${input.notes}` : ''}`.slice(0, 500),
          origen: { lugarNombre: String(map.pickup_place) },
          entregas: [{ lugarNombre: input.recipient.name, referencia: input.address }],
          destino: { lugarNombre: String(map.dropoff_place) },
        },
        {
          // Misma transacción que el alta de la solicitud: si este UPDATE no afecta exactamente 1 fila, se revierte la solicitud completa.
          dentroDeTransaccion: async (tx, id) => {
            const [done] = await tx.execute<import('mysql2/promise').ResultSetHeader>(
              `UPDATE ${t('tms_links')} SET solicitud_id=?, linked_at=UTC_TIMESTAMP(6) WHERE ${where} AND order_id=? AND claim_token=? AND solicitud_id IS NULL`, [id, ...orderKey, token]);
            if (done.affectedRows !== 1) throw new Error('El vínculo no pudo completarse de forma atómica.');
          },
        });
      if (!created.ok) return { state: 'REJECTED_BY_TMS', detail: created.mensaje };
      return { state: 'LINKED', solicitudId: created.solicitud.id };
    }
    // Compatibilidad: solicitud encontrada por token (vínculo pendiente de API-12). Se completa el vínculo, condicionado al token y a que siga pendiente.
    const [upd] = await conn.execute<import('mysql2/promise').ResultSetHeader>(
      `UPDATE ${t('tms_links')} SET solicitud_id=?, linked_at=UTC_TIMESTAMP(6) WHERE ${where} AND order_id=? AND claim_token=? AND solicitud_id IS NULL`, [solicitudId, ...orderKey, token]);
    if (upd.affectedRows !== 1) throw new Error('El vínculo no pudo completarse (estado inesperado).');
    return { state: 'LINKED', solicitudId };
  }

  /** Serializa por orden con GET_LOCK. Un fallo al liberar el bloqueo NUNCA oculta el error original ni cambia el resultado: se destruye la conexión (el servidor libera el bloqueo al cerrarla)
   *  y, si el trabajo terminó bien, el resultado lleva `warning: 'LOCK_RELEASE_FAILED'`. */
  async function link(scope: Scope, externalOrderId: string): Promise<LinkResult> {
    const conn = await pool.getConnection();
    const lockName = `ps12:${hex(JSON.stringify([scope.environment, scope.tenantId, scope.clientId, scope.integrationId, externalOrderId])).slice(0, 48)}`;
    let locked = false; let releaseFailed = false; let outcome: LinkResult | undefined;
    try {
      const [[lk]] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 10) AS ok', [lockName]);
      if (Number(lk.ok) !== 1) return { state: 'LOCK_TIMEOUT' };
      locked = true;
      outcome = await linkLocked(conn, scope, externalOrderId);
    } finally {
      if (locked) {
        try { const [[rel]] = await conn.query<RowDataPacket[]>('SELECT RELEASE_LOCK(?) AS ok', [lockName]); if (Number(rel.ok) !== 1) releaseFailed = true; }
        catch { releaseFailed = true; }
      }
      if (releaseFailed) conn.destroy(); else conn.release();
    }
    return releaseFailed ? { ...outcome!, warning: 'LOCK_RELEASE_FAILED' } : outcome!;
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
    if (!rows.length || rows[0].solicitud_id == null) {   // sin vínculo, o reclamo pendiente que aún no se completó: NO se simula una solicitud
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
    const join = `${t('tms_links')} l JOIN \`${schema}\`.ps_api01_orders o ON o.environment=l.environment AND o.tenant_id=l.tenant_id AND o.client_id=l.client_id AND o.integration_id=l.integration_id AND o.id=l.order_id`;
    const [rows] = await pool.execute<RowDataPacket[]>(`SELECT l.empresa_id, l.solicitud_id FROM ${join} WHERE l.environment=? AND l.tenant_id=? AND l.client_id=? AND l.integration_id=? AND o.external_order_id=? AND l.solicitud_id IS NOT NULL`, [...ns(scope), Buffer.from(externalOrderId)]);
    if (!rows.length) return;
    await pool.execute(`UPDATE ${join} SET l.cancellation_requested_at = COALESCE(l.cancellation_requested_at, UTC_TIMESTAMP(6)) WHERE l.environment=? AND l.tenant_id=? AND l.client_id=? AND l.integration_id=? AND o.external_order_id=?`, [...ns(scope), Buffer.from(externalOrderId)]);
    await registrarAuditoria({ empresaId: Number(rows[0].empresa_id), usuario: 'integracion:pricesmart-laboratorio', accion: 'pricesmart_cancelacion_solicitada', modulo: 'tms',
      detalle: `PriceSmart solicitó cancelar el pedido ${externalOrderId} (solicitud TMS #${rows[0].solicitud_id}). Sin acción automática: requiere decisión de Operaciones.` });
  }
  return { link, status, noteCancellation };
}
