import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createTmsLinker } from './tms-link';
import { assessCancellation, EXTERNAL_STATUSES, PLAN_STATES, projectExternalStatus, SOLICITUD_STATES } from '../tms-contract-proposal';
import { assessDeliveryEvidence } from '../delivery-evidence';
import { REQUIRED_DECISIONS } from '../runtime-config';

vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));

// PRICESMART homologación (auditoría posterior a API-27) — dos garantías de CONTRATO que no pueden romperse en silencio:
//  D09: una SOLICITUD de cancelación nunca se presenta como una cancelación EJECUTADA. Lo efectivo lo decide Operaciones en el TMS y solo entonces el estado externo pasa a CANCELLED.
//  D13: mientras la prueba de entrega no esté ratificada, NINGÚN camino afirma ni publica una entrega: no existe un estado DELIVERED, `confirmsDelivery` y `publishable` son false siempre.
const scope = { environment: 'sandbox' as const, tenantId: 1, clientId: 1, integrationId: 'pricesmart-lab' };
const view = (provisionalStatus: string) => ({ provisionalStatus }) as never;
/** Pool simulado: las consultas de `status()` se contestan en orden (vínculo, paradas del plan, confirmaciones del piloto). */
function linker(answers: unknown[][]) {
  let n = 0; const execute = vi.fn(async () => [answers[n++] ?? []]);
  return createTmsLinker({ pool: { execute } as never, schema: 'sandbox_api02_x', repository: {} as never });
}
const link = (sol: string | null, plan: string | null) => ({ empresa_id: 1, solicitud_id: 7, cancellation_requested_at: null, sol_estado: sol, plan_id: plan === null ? null : 70, plan_estado: plan });

describe('D09 — pedir una cancelación NO es cancelar', () => {
  it('ninguna combinación solicitud × plan se presenta como CANCELLED por haber pedido la cancelación: solo si el TMS ya está cancelado; la petición queda marcada como no automática', async () => {
    for (const sol of SOLICITUD_STATES) for (const plan of [null, ...PLAN_STATES]) {
      const answers = [[link(sol, plan)], [], []];
      const asked = await linker(answers).status(scope, 'PS-1', view('CANCELLATION_REQUESTED')) as Record<string, unknown> & { cancellation?: Record<string, unknown> };
      const plain = await linker([[link(sol, plan)], [], []]).status(scope, 'PS-1', view('RECEIVED')) as Record<string, unknown>;
      const effective = projectExternalStatus(sol, plan).status;
      const label = `${sol}/${plan}`;
      expect(asked.proposedStatus, label).toBe(effective);   // el estado externo NO cambia por pedir la cancelación…
      expect(asked.proposedStatus, label).toBe(plain.proposedStatus);   // …es el mismo que sin pedirla
      if (asked.proposedStatus === 'CANCELLED') expect(sol === 'CANCELADA' || plan === 'Cancelado', label).toBe(true);   // CANCELLED solo si el TMS está realmente cancelado
      expect(asked.cancellation, label).toEqual({ requested: true, automatic: false, assessment: assessCancellation(sol, plan).verdict });
      expect(plain.cancellation, label).toBeUndefined();
    }
  });
  it('la solicitud sobre un pedido programado queda SCHEDULED con el veredicto «Operaciones puede cancelar el plan»; en ruta o descargado, la cancelación está bloqueada, no ejecutada', async () => {
    const programado = await linker([[link('PROGRAMADA', 'Programado')], [], []]).status(scope, 'PS-1', view('CANCELLATION_REQUESTED'));
    expect(programado).toMatchObject({ proposedStatus: 'SCHEDULED', cancellation: { requested: true, automatic: false, assessment: 'OPERATIONS_MAY_CANCEL_PLAN' } });
    for (const [plan, verdict, status] of [['En ruta', 'BLOCKED_IN_EXECUTION', 'IN_TRANSIT'], ['Descargado', 'BLOCKED_COMPLETED', 'UNLOADED_UNCONFIRMED'], ['Cerrado', 'BLOCKED_COMPLETED', 'CLOSED_ADMINISTRATIVE']] as const)
      expect(await linker([[link('PROGRAMADA', plan)], [], []]).status(scope, 'PS-1', view('CANCELLATION_REQUESTED'))).toMatchObject({ proposedStatus: status, cancellation: { requested: true, automatic: false, assessment: verdict } });
  });
  it('sin vínculo con el TMS la solicitud queda registrada como «REQUESTED_NOT_LINKED» y el pedido sigue RECEIVED: no se simula una cancelación', async () => {
    expect(await linker([[], []]).status(scope, 'PS-1', view('CANCELLATION_REQUESTED'))).toMatchObject({ proposedStatus: 'RECEIVED', tms: { linked: false }, cancellation: { requested: true, automatic: false, assessment: 'REQUESTED_NOT_LINKED' } });
  });
  it('la constancia de la solicitud (noteCancellation) solo escribe el vínculo y la auditoría: nunca toca solicitudes ni planes del TMS; es idempotente', async () => {
    const writes: string[] = []; const audit = vi.fn<(conn: unknown, entry: unknown) => Promise<void>>(async () => undefined);
    let marked = false;
    const conn = {
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn(),
      execute: vi.fn(async (sql: string) => {
        if (/^SELECT cancellation_requested_at/.test(sql)) return [[{ cancellation_requested_at: marked ? new Date() : null }]];
        writes.push(sql); if (/^UPDATE/.test(sql)) marked = true; return [{ affectedRows: 1 }];
      }),
    };
    const pool = { execute: vi.fn(async () => [[{ empresa_id: 1, solicitud_id: 7, order_id: Buffer.alloc(16, 1) }]]), getConnection: vi.fn(async () => conn) };
    const l = createTmsLinker({ pool: pool as never, schema: 'sandbox_api02_x', repository: {} as never, auditTx: audit as never });
    await l.noteCancellation(scope, 'PS-1'); await l.noteCancellation(scope, 'PS-1');
    expect(writes).toHaveLength(1); expect(writes[0]).toMatch(/^UPDATE `sandbox_api02_x`\.`ps_api12_tms_links` SET cancellation_requested_at/);
    expect(writes.join('\n')).not.toMatch(/tms_solicitudes_cliente|tms_planes_viaje|tms_plan_paradas/);
    expect(audit).toHaveBeenCalledTimes(1);   // una sola auditoría aunque se repita
    expect(audit.mock.calls[0][1]).toMatchObject({ accion: 'pricesmart_cancelacion_solicitada', detalle: expect.stringContaining('Sin acción automática') });
  });
  it('ningún código de la integración asigna jamás el estado CANCELLED a una orden (solo se pide la cancelación); CANCELLED solo existe como destino posible del contrato', () => {
    const root = path.resolve(__dirname, '..'); const hits: string[] = [];
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) { if (n !== '__tests__') walk(f); } else if (/\.ts$/.test(n) && !n.includes('.test.') && /\.(state\s*=|state:)\s*'CANCELLED'/.test(readFileSync(f, 'utf8'))) hits.push(f); } };
    walk(root); expect(hits).toEqual([]);
  });
});

describe('D13 — la entrega NO se confirma ni se publica mientras la prueba de entrega no esté ratificada', () => {
  const stops = [{ id: 1, tipo: 'Carga' }, { id: 2, tipo: 'Entrega' }, { id: 3, tipo: 'Entrega' }, { id: 4, tipo: 'Descarga' }];
  const confirm = (stopId: number, resultado = 'ENTREGADA_POR_PILOTO', revision = 'NO_REQUERIDA', evidencia = 99) => ({ parada_id: stopId, resultado, revision, evidencia_id: evidencia });

  it('no existe un estado externo de entrega: ni DELIVERED ni equivalente en los estados, y ninguna proyección confirma entrega ni es publicable', () => {
    expect(EXTERNAL_STATUSES.some((s) => /DELIVER|ENTREG/i.test(s))).toBe(false);
    for (const sol of [...SOLICITUD_STATES, 'DESCONOCIDO']) for (const plan of [null, ...PLAN_STATES, 'DESCONOCIDO']) expect(projectExternalStatus(sol, plan), `${sol}/${plan}`).toMatchObject({ confirmsDelivery: false, publishable: false });
  });
  it('con TODAS las entregas confirmadas por el piloto y el plan Cerrado, el GET sigue sin afirmar entrega: evidencia interna informativa, aceptación oficial «NOT_ACCEPTED_BY_PRICESMART», bloqueada por D13', async () => {
    const r = await linker([[link('PROGRAMADA', 'Cerrado')], stops, [confirm(2), confirm(3)]]).status(scope, 'PS-1', view('RECEIVED')) as { proposedStatus: string; confirmsDelivery: boolean; tms: { deliveryEvidence: Record<string, unknown> } };
    expect(r.proposedStatus).toBe('CLOSED_ADMINISTRATIVE'); expect(r.confirmsDelivery).toBe(false);
    expect(r.tms.deliveryEvidence).toEqual({ level: 'PILOT_CONFIRMED_ALL', deliveryStops: 2, pilotConfirmed: 2, pendingReview: 0, officialAcceptance: 'NOT_ACCEPTED_BY_PRICESMART', confirmsDelivery: false, publishable: false, blockedBy: ['D13_PENDING'] });
    expect(JSON.stringify(r)).not.toMatch(/DELIVERED|"delivered"|entregad[ao]\b/i);
  });
  it('parciales, rechazos, incidencias, sin evidencia o confirmaciones incoherentes → revisión humana, nunca «entregada»; cada caso conserva confirmsDelivery=false y publishable=false', async () => {
    const cases: Array<[string, unknown[], string]> = [
      ['una sola de dos entregas confirmada', [confirm(2)], 'PARTIAL'],
      ['sin confirmaciones', [], 'NONE'],
      ['entrega PARCIAL pendiente de revisión', [confirm(2), confirm(3, 'PARCIAL', 'PENDIENTE')], 'REVIEW_REQUIRED'],
      ['RECHAZADA pendiente de revisión', [confirm(2), confirm(3, 'RECHAZADA', 'PENDIENTE')], 'REVIEW_REQUIRED'],
      ['INCIDENCIA pendiente de revisión', [confirm(2), confirm(3, 'INCIDENCIA', 'PENDIENTE')], 'REVIEW_REQUIRED'],
      ['confirmada sin evidencia vinculada', [confirm(2), confirm(3, 'ENTREGADA_POR_PILOTO', 'NO_REQUERIDA', 0)], 'REVIEW_REQUIRED'],
      ['confirmación de una parada que no es entrega', [confirm(1), confirm(2), confirm(3)], 'REVIEW_REQUIRED'],
      ['resultado desconocido', [confirm(2), confirm(3, 'OTRO', 'NO_REQUERIDA')], 'REVIEW_REQUIRED'],
    ];
    for (const [label, confs, level] of cases) {
      const r = await linker([[link('PROGRAMADA', 'Descargado')], stops, confs]).status(scope, 'PS-1', view('RECEIVED')) as { proposedStatus: string; tms: { deliveryEvidence: { level: string; confirmsDelivery: boolean; publishable: boolean; blockedBy: string[] } } };
      expect(r.tms.deliveryEvidence.level, label).toBe(level); expect(r.proposedStatus, label).toBe('UNLOADED_UNCONFIRMED');
      expect(r.tms.deliveryEvidence, label).toMatchObject({ confirmsDelivery: false, publishable: false, blockedBy: ['D13_PENDING'] });
    }
  });
  it('si la tabla de confirmaciones no existe se informa UNAVAILABLE (nunca «sin entregas»); cualquier otro error de base de datos se propaga', async () => {
    let n = 0; const execute = vi.fn(async () => { n++; if (n === 1) return [[link('PROGRAMADA', 'Descargado')]]; if (n === 2) return [stops]; throw Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' }); });
    const l = createTmsLinker({ pool: { execute } as never, schema: 'sandbox_api02_x', repository: {} as never });
    expect(await l.status(scope, 'PS-1', view('RECEIVED'))).toMatchObject({ tms: { deliveryEvidence: { level: 'UNAVAILABLE', confirmsDelivery: false, publishable: false, blockedBy: ['D13_PENDING'] } } });
    let m = 0; const failing = vi.fn(async () => { m++; if (m === 1) return [[link('PROGRAMADA', 'Descargado')]]; throw Object.assign(new Error('caída'), { code: 'ER_LOCK_DEADLOCK' }); });
    await expect(createTmsLinker({ pool: { execute: failing } as never, schema: 'sandbox_api02_x', repository: {} as never }).status(scope, 'PS-1', view('RECEIVED'))).rejects.toThrow('caída');
  });
  it('D13 NO figura entre las decisiones que habilitan el runtime y la evaluación de evidencia no tiene ninguna entrada que la «ratifique»: no se puede activar la publicación de entregas por configuración', () => {
    for (const decisions of Object.values(REQUIRED_DECISIONS)) expect(decisions).not.toContain('D13');
    expect(assessDeliveryEvidence.length).toBe(2);   // (paradas, confirmaciones): ningún tercer parámetro de política
    expect(assessDeliveryEvidence([{ id: 1, type: 'Entrega' }], [{ stopId: 1, result: 'ENTREGADA_POR_PILOTO', revision: 'NO_REQUERIDA', hasEvidence: true }])).toMatchObject({ confirmsDelivery: false, publishable: false, officialAcceptance: 'NOT_ACCEPTED_BY_PRICESMART' });
  });
  it('ningún código no-de-prueba de la integración ni el OpenAPI/Postman contiene un estado DELIVERED; los datos de entrega nunca salen en el cuerpo de la ORDEN, solo en el GET informativo', () => {
    const root = path.resolve(__dirname, '..'); const hits: string[] = [];
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) { if (n !== '__tests__') walk(f); } else if (/\.ts$/.test(n) && !n.includes('.test.') && /['"`]DELIVERED['"`]|confirmsDelivery:\s*true|publishable:\s*true/.test(readFileSync(f, 'utf8'))) hits.push(f); } };
    walk(root); expect(hits).toEqual([]);
    for (const f of ['openapi.homologation.json', 'postman_collection.homologation.json']) expect(readFileSync(`docs/integraciones/pricesmart/api25/${f}`, 'utf8'), f).not.toMatch(/DELIVERED/);
  });
});
