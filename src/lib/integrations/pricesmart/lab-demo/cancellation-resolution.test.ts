import { describe, expect, it, vi } from 'vitest';
import { resolveCancellation, CANCELLATION_RESOLUTIONS, NOTE_MAX } from './cancellation-resolution';

vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));

// PRICESMART API-27 — resolución de cancelaciones por Operaciones (unitarias con conexión simulada; la prueba contra MariaDB real es scripts/ci/pricesmart-demo/cancellation-resolution.e2e.ts).
type Link = { cancellation_requested_at: Date | null; cancellation_resolution: string | null } | null;
function fixture(link: Link, sol = 'SOLICITADA', plan: string | null = null, opts: { failAudit?: boolean; affected?: number } = {}) {
  const sql: string[] = []; const params: unknown[][] = []; const audit = vi.fn(async () => { if (opts.failAudit) throw new Error('auditoría caída'); });
  const conn = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn(),
    execute: vi.fn(async (q: string, p: unknown[]) => {
      sql.push(q); params.push(p);
      if (/FOR UPDATE/.test(q)) return [link ? [link] : []];
      if (/FROM tms_solicitudes_cliente/.test(q)) return [[{ sol_estado: sol, plan_estado: plan }]];
      if (/^UPDATE/.test(q)) return [{ affectedRows: opts.affected ?? 1 }];
      return [[]];
    }) };
  return { conn, sql, params, audit, deps: { pool: { getConnection: vi.fn(async () => conn) } as never, schema: 'sandbox_api02_x', auditTx: audit as never } };
}
const asked = { cancellation_requested_at: new Date(), cancellation_resolution: null };
const input = { empresaId: 1, solicitudId: 7, resolution: 'NOT_EXECUTED' as const, usuario: 'ops.lab', note: 'ya coordinado' };

describe('resolveCancellation', () => {
  it('NOT_EXECUTED con nota: actualiza SOLO el vínculo de ESA empresa y solicitud, audita en la misma transacción y confirma; no toca solicitudes ni planes', async () => {
    const f = fixture(asked, 'PROGRAMADA', 'Programado');
    expect(await resolveCancellation(f.deps, input)).toBe('RESOLVED');
    const writes = f.sql.filter((q) => /^UPDATE|^INSERT|^DELETE/.test(q)); expect(writes).toHaveLength(1); expect(writes[0]).toMatch(/^UPDATE `sandbox_api02_x`\.ps_api12_tms_links SET cancellation_resolution=.*WHERE empresa_id=\? AND solicitud_id=\? AND cancellation_resolution IS NULL/);
    expect(f.sql.join('\n')).not.toMatch(/UPDATE tms_|DELETE/); expect(f.audit).toHaveBeenCalledTimes(1);
    expect(f.audit.mock.calls[0]).toMatchObject([f.conn, { empresaId: 1, usuario: 'ops.lab', accion: 'pricesmart_cancelacion_resuelta' }]);
    expect(f.conn.commit).toHaveBeenCalledTimes(1); expect(f.conn.rollback).not.toHaveBeenCalled();
  });
  it('no resuelve lo que no existe, no fue pedido o ya está resuelto (no se sobrescribe); empresa ajena = NOT_FOUND', async () => {
    expect(await resolveCancellation(fixture(null).deps, input)).toBe('NOT_FOUND');
    expect(await resolveCancellation(fixture({ cancellation_requested_at: null, cancellation_resolution: null }).deps, input)).toBe('NOT_REQUESTED');
    const done = fixture({ cancellation_requested_at: new Date(), cancellation_resolution: 'NOT_EXECUTED' });
    expect(await resolveCancellation(done.deps, input)).toBe('ALREADY_RESOLVED'); expect(done.sql.some((q) => /^UPDATE/.test(q))).toBe(false); expect(done.audit).not.toHaveBeenCalled(); expect(done.conn.rollback).toHaveBeenCalled();
    const f = fixture(asked); await resolveCancellation(f.deps, { ...input, empresaId: 2 }); expect(f.params[0]).toEqual([2, 7]);   // la consulta va acotada a la empresa pedida
  });
  it('EXECUTED solo si el TMS ya está cancelado/rechazado; NOT_EXECUTED se rechaza si el TMS ya lo está; viaje en ruta o descargado protegido', async () => {
    for (const [sol, plan] of [['SOLICITADA', null], ['EN_REVISION', null], ['PROGRAMADA', 'Programado'], ['PROGRAMADA', 'En ruta'], ['PROGRAMADA', 'Descargado'], ['PROGRAMADA', 'Cerrado']] as const) {
      const f = fixture(asked, sol, plan); expect(await resolveCancellation(f.deps, { ...input, resolution: 'EXECUTED' }), `${sol}/${plan}`).toBe('STATE_CONFLICT'); expect(f.audit).not.toHaveBeenCalled(); expect(f.sql.some((q) => /^UPDATE/.test(q))).toBe(false);
    }
    for (const [sol, plan] of [['CANCELADA', null], ['RECHAZADA', null], ['PROGRAMADA', 'Cancelado']] as const) {
      expect(await resolveCancellation(fixture(asked, sol, plan).deps, { ...input, resolution: 'EXECUTED' }), `${sol}/${plan}`).toBe('RESOLVED');
      expect(await resolveCancellation(fixture(asked, sol, plan).deps, input), `${sol}/${plan}`).toBe('STATE_CONFLICT');
    }
  });
  it('validaciones: nota obligatoria y acotada, resolución conocida, usuario obligatorio; nada llega a la base', async () => {
    const f = fixture(asked);
    expect(await resolveCancellation(f.deps, { ...input, note: undefined })).toBe('NOTE_REQUIRED'); expect(await resolveCancellation(f.deps, { ...input, note: 'ab' })).toBe('NOTE_REQUIRED');
    expect(await resolveCancellation(f.deps, { ...input, note: 'x'.repeat(NOTE_MAX + 1) })).toBe('INVALID'); expect(await resolveCancellation(f.deps, { ...input, resolution: 'ELIMINAR' as never })).toBe('INVALID');
    expect(await resolveCancellation(f.deps, { ...input, usuario: '  ' })).toBe('INVALID'); expect(await resolveCancellation(f.deps, { ...input, solicitudId: -1 })).toBe('INVALID'); expect(await resolveCancellation(f.deps, { ...input, empresaId: 1.5 })).toBe('INVALID');
    expect(f.conn.execute).not.toHaveBeenCalled(); expect([...CANCELLATION_RESOLUTIONS]).toEqual(['EXECUTED', 'NOT_EXECUTED']);
  });
  it('si la auditoría falla, TODO se revierte y el error llega a quien llama (no queda una resolución sin auditoría); esquema inválido se rechaza', async () => {
    const f = fixture(asked, 'SOLICITADA', null, { failAudit: true });
    await expect(resolveCancellation(f.deps, input)).rejects.toThrow('auditoría caída'); expect(f.conn.rollback).toHaveBeenCalled(); expect(f.conn.commit).not.toHaveBeenCalled();
    await expect(resolveCancellation({ ...f.deps, schema: 'produccion; DROP' }, input)).rejects.toThrow('esquema inválido');
  });
  it('si una carrera deja el UPDATE sin filas, devuelve ALREADY_RESOLVED sin auditar', async () => {
    const f = fixture(asked, 'SOLICITADA', null, { affected: 0 }); expect(await resolveCancellation(f.deps, input)).toBe('ALREADY_RESOLVED'); expect(f.audit).not.toHaveBeenCalled(); expect(f.conn.commit).not.toHaveBeenCalled();
  });
});
