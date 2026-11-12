import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '@/lib/db';
import { registrarAuditoria } from '@/lib/auditoria';
import { labDemoGate } from './composition';

// PRICESMART API-13 — vista de OPERACIONES sobre la integración (solo laboratorio): qué solicitudes de la bandeja existente nacieron de PriceSmart, cuáles tienen una cancelación pedida
// y qué vinculaciones están pendientes o fallidas. Todo se filtra por la EMPRESA de la sesión (la que fijó el mapeo administrativo), nunca por datos del navegador.
// No expone tokens de reclamo, firmas, claves ni cuerpos de solicitud: solo referencia, estado, contador de intentos y un código/mensaje de validación corto.
// Fuera del laboratorio (`labDemoGate` falso) devuelve {enabled:false} sin consultar nada.

export type PriceSmartOrigin = { solicitudId: number; cancelacionSolicitadaEn: string | null; cancelacionPendiente: boolean };
export type PriceSmartIssue = { id: string; referencia: string; estado: 'PENDIENTE' | 'BLOQUEADA' | 'AGOTADA'; intentos: number; ultimoResultado: string | null; ultimoDetalle: string | null; proximoIntento: string | null; reconocidoPor: string | null; reconocidoEn: string | null };
export type PriceSmartBandeja = { enabled: false } | { enabled: true; origen: PriceSmartOrigin[]; pendientes: PriceSmartIssue[] };

const schemaOf = () => String(process.env.DB_NAME);
const iso = (v: unknown) => (v == null ? null : new Date(String(v).includes('T') ? String(v) : `${String(v).replace(' ', 'T')}Z`).toISOString());
const ESTADO = { PENDING: 'PENDIENTE', BLOCKED: 'BLOQUEADA', EXHAUSTED: 'AGOTADA' } as const;

export function pricesmartBandejaHabilitada(): boolean { return labDemoGate(process.env).ok; }

export async function obtenerBandejaPriceSmart(empresaId: number): Promise<PriceSmartBandeja> {
  if (!pricesmartBandejaHabilitada()) return { enabled: false };
  const s = `\`${schemaOf()}\``; const pool = getPool();
  const [origen] = await pool.execute<RowDataPacket[]>(
    `SELECT l.solicitud_id, l.cancellation_requested_at, sc.estado FROM ${s}.ps_api12_tms_links l
       JOIN tms_solicitudes_cliente sc ON sc.empresa_id = l.empresa_id AND sc.id = l.solicitud_id
      WHERE l.empresa_id = ? AND l.solicitud_id IS NOT NULL`, [empresaId]);
  const [issues] = await pool.execute<RowDataPacket[]>(
    `SELECT HEX(j.order_id) AS id, j.external_order_id, j.status, j.attempts, j.last_outcome, j.last_detail, j.next_attempt_at, j.ack_by, j.ack_at
       FROM ${s}.ps_api13_link_jobs j
      WHERE j.empresa_id = ? AND (j.status IN ('BLOCKED','EXHAUSTED') OR (j.status = 'PENDING' AND j.attempts > 0))
      ORDER BY j.updated_at DESC LIMIT 200`, [empresaId]);
  return {
    enabled: true,
    origen: origen.map((r) => ({ solicitudId: Number(r.solicitud_id), cancelacionSolicitadaEn: iso(r.cancellation_requested_at),
      cancelacionPendiente: r.cancellation_requested_at != null && !['CANCELADA', 'RECHAZADA'].includes(String(r.estado)) })),
    pendientes: issues.map((r) => ({ id: String(r.id), referencia: Buffer.isBuffer(r.external_order_id) ? r.external_order_id.toString('utf8') : String(r.external_order_id),
      estado: ESTADO[String(r.status) as keyof typeof ESTADO], intentos: Number(r.attempts), ultimoResultado: r.last_outcome == null ? null : String(r.last_outcome),
      ultimoDetalle: r.last_detail == null ? null : String(r.last_detail), proximoIntento: iso(r.next_attempt_at), reconocidoPor: r.ack_by == null ? null : String(r.ack_by), reconocidoEn: iso(r.ack_at) })),
  };
}

/** «Reconocer» deja constancia de que una persona vio la vinculación pendiente/fallida. NO reintenta, NO crea ni cancela solicitudes, planes ni viajes. */
export async function reconocerVinculacion(empresaId: number, orderIdHex: string, usuario: string): Promise<'OK' | 'NO_ENCONTRADA' | 'DESHABILITADO'> {
  if (!pricesmartBandejaHabilitada()) return 'DESHABILITADO';
  if (!/^[0-9A-Fa-f]{32}$/.test(orderIdHex)) return 'NO_ENCONTRADA';
  const [r] = await getPool().execute<import('mysql2/promise').ResultSetHeader>(
    `UPDATE \`${schemaOf()}\`.ps_api13_link_jobs SET ack_by = ?, ack_at = UTC_TIMESTAMP(6)
      WHERE empresa_id = ? AND order_id = UNHEX(?) AND ack_at IS NULL AND (status IN ('BLOCKED','EXHAUSTED') OR (status = 'PENDING' AND attempts > 0))`, [usuario.slice(0, 100), empresaId, orderIdHex]);
  if (r.affectedRows !== 1) return 'NO_ENCONTRADA';
  await registrarAuditoria({ empresaId, usuario, accion: 'pricesmart_vinculacion_reconocida', modulo: 'tms', detalle: `Vinculación PriceSmart ${orderIdHex.slice(0, 8)}… reconocida por Operaciones (sin cambios en solicitudes ni planes).` });
  return 'OK';
}
