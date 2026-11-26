import type { Pool, RowDataPacket } from 'mysql2/promise';
import { registrarAuditoriaTx } from '@/lib/auditoria';
import { assessCancellation } from '../tms-contract-proposal';

// PRICESMART API-27 (cancelaciones, parte INTERNA) — RESOLUCIÓN de una solicitud de cancelación por Operaciones. Independiente del método HTTP de cancelación que PriceSmart ratifique (D09).
//  · Solo la fija una PERSONA de Operaciones (nunca el proceso de recepción): queda quién, cuándo y, si no se ejecutó, el motivo.
//  · `EXECUTED` solo se acepta si el TMS YA refleja la cancelación/rechazo (se verifica contra el estado real, nunca por lo que diga quien llama): este módulo NO cancela solicitudes, planes ni viajes.
//  · `NOT_EXECUTED` exige nota y se rechaza si el TMS ya está cancelado (sería contradictorio).
//  · Idempotente y a prueba de concurrencia: la fila del vínculo se bloquea (FOR UPDATE); la primera resolución gana y no se sobrescribe. Resolución y auditoría se confirman en UNA transacción.
//  · Todo se acota por empresa Y solicitud (nunca por un identificador suelto).
export const CANCELLATION_RESOLUTIONS = ['EXECUTED', 'NOT_EXECUTED'] as const;
export type CancellationResolution = typeof CANCELLATION_RESOLUTIONS[number];
export type ResolveCancellationResult = 'RESOLVED' | 'ALREADY_RESOLVED' | 'NOT_FOUND' | 'NOT_REQUESTED' | 'STATE_CONFLICT' | 'NOTE_REQUIRED' | 'INVALID';
export const NOTE_MAX = 300;

export type ResolveCancellationDeps = { pool: Pool; schema: string; auditTx?: typeof registrarAuditoriaTx };
export type ResolveCancellationInput = { empresaId: number; solicitudId: number; resolution: CancellationResolution; usuario: string; note?: string | null };

export async function resolveCancellation(deps: ResolveCancellationDeps, input: ResolveCancellationInput): Promise<ResolveCancellationResult> {
  const { pool, schema } = deps; const auditTx = deps.auditTx ?? registrarAuditoriaTx;
  if (!/^sandbox_api02_[a-z0-9_]+$/.test(schema)) throw new Error('esquema inválido');
  const usuario = String(input.usuario ?? '').trim().slice(0, 100); const note = input.note == null ? null : String(input.note).trim();
  if (!Number.isInteger(input.empresaId) || input.empresaId <= 0 || !Number.isInteger(input.solicitudId) || input.solicitudId <= 0 || !usuario || !(CANCELLATION_RESOLUTIONS as readonly string[]).includes(input.resolution)) return 'INVALID';
  if (note != null && note.length > NOTE_MAX) return 'INVALID';
  if (input.resolution === 'NOT_EXECUTED' && (note == null || note.length < 3)) return 'NOTE_REQUIRED';
  const links = `\`${schema}\`.ps_api12_tms_links`;
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection(); let active = false; let broken = false;
    try {
      await conn.beginTransaction(); active = true;
      const [locked] = await conn.execute<RowDataPacket[]>(`SELECT cancellation_requested_at, cancellation_resolution FROM ${links} WHERE empresa_id=? AND solicitud_id=? FOR UPDATE`, [input.empresaId, input.solicitudId]);
      if (locked.length !== 1) { await conn.rollback(); active = false; return 'NOT_FOUND'; }
      if (locked[0].cancellation_requested_at == null) { await conn.rollback(); active = false; return 'NOT_REQUESTED'; }
      if (locked[0].cancellation_resolution != null) { await conn.rollback(); active = false; return 'ALREADY_RESOLVED'; }
      const [st] = await conn.execute<RowDataPacket[]>(
        `SELECT s.estado AS sol_estado, p.estado AS plan_estado FROM tms_solicitudes_cliente s LEFT JOIN tms_planes_viaje p ON p.empresa_id=s.empresa_id AND p.id=s.plan_id WHERE s.empresa_id=? AND s.id=?`, [input.empresaId, input.solicitudId]);
      if (st.length !== 1) { await conn.rollback(); active = false; return 'NOT_FOUND'; }
      const verdict = assessCancellation(String(st[0].sol_estado ?? ''), st[0].plan_estado == null ? null : String(st[0].plan_estado)).verdict;
      const tmsReflectsCancellation = verdict === 'ALREADY_CANCELLED' || verdict === 'ALREADY_TERMINAL';
      if (input.resolution === 'EXECUTED' ? !tmsReflectsCancellation : tmsReflectsCancellation) { await conn.rollback(); active = false; return 'STATE_CONFLICT'; }
      const [done] = await conn.execute<import('mysql2/promise').ResultSetHeader>(
        `UPDATE ${links} SET cancellation_resolution=?, cancellation_resolved_by=?, cancellation_resolved_at=UTC_TIMESTAMP(6), cancellation_resolution_note=? WHERE empresa_id=? AND solicitud_id=? AND cancellation_resolution IS NULL`,
        [input.resolution, usuario, input.resolution === 'NOT_EXECUTED' ? note : (note || null), input.empresaId, input.solicitudId]);
      if (done.affectedRows !== 1) { await conn.rollback(); active = false; return 'ALREADY_RESOLVED'; }
      await auditTx(conn, { empresaId: input.empresaId, usuario, accion: 'pricesmart_cancelacion_resuelta', modulo: 'tms',
        detalle: `Operaciones resolvió la cancelación pedida por PriceSmart de la solicitud TMS #${input.solicitudId}: ${input.resolution === 'EXECUTED' ? 'ejecutada (el TMS ya la refleja)' : 'NO ejecutada'}.` });
      await conn.commit(); active = false;
      return 'RESOLVED';
    } catch (error) {
      if (active) { try { await conn.rollback(); } catch { broken = true; } }
      const code = (error as { code?: string })?.code;
      if (attempt < 5 && (code === 'ER_CHECKREAD' || code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT')) continue;
      throw error;
    } finally { if (broken) conn.destroy(); else conn.release(); }
  }
}
