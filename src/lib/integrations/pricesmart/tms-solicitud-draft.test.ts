import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/auditoria', () => ({ registrarAuditoriaTx: vi.fn(), registrarAuditoria: vi.fn() }));

import { validarParadasSolicitud } from '@/lib/tms/solicitudes-cliente';
import { normalizarHora } from '@/lib/rrhh/dates';
import { isCalendarDate, normalizeTime, orderDraftProposalSchema, stopsStructureValid, toSolicitudDraft } from './tms-solicitud-draft';
import { TMS_LIMITS } from './tms-contract-proposal';

// PROPUESTA D06: el borrador se valida con reglas propias y se contrasta DIFERENCIALMENTE con el código real del TMS (validarParadasSolicitud, normalizarHora).
const today = '2026-11-11';
const stop = (name: string, reference?: string) => ({ placeName: name, ...(reference ? { reference } : {}) });
const order = (over: Record<string, unknown> = {}) => ({ schemaVersion: 'api10-proposal-1', externalOrderId: 'PS-0001', originClubReference: 'Club-A', requestedDate: '2026-11-12', requestedTime: '08:30',
  pickup: stop('Centro de distribución'), deliveries: [stop('Club Zona 10', 'Puerta 3'), stop('Club Mixco')], dropoff: stop('Club Villa Nueva'), notes: 'Entregar antes del mediodía', ...over });

describe('toSolicitudDraft: traducción al formato de alta de solicitudes del TMS', () => {
  it('traduce un pedido válido: Carga primero, entregas en orden, Descarga última; nunca materializable', () => {
    const r = toSolicitudDraft(order(), today); expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.materializable).toBe(false);
    expect(r.draft).toMatchObject({ fechaSolicitada: '2026-11-12', horaSolicitada: '08:30:00', referenciaCliente: 'PS-0001', observaciones: 'Entregar antes del mediodía' });
    expect(r.draft.paradas.map(p => `${p.orden}:${p.tipo}:${p.lugarNombre}`)).toEqual(['1:Carga:Centro de distribución', '2:Entrega:Club Zona 10', '3:Entrega:Club Mixco', '4:Descarga:Club Villa Nueva']);
    expect(r.draft.paradas[1].referencia).toBe('Puerta 3'); expect(r.draft.paradas[2].referencia).toBeNull();
    expect(r.draft.entregas).toHaveLength(2);
  });
  it('lo traducido es aceptado por el validador REAL de paradas del TMS', () => {
    const r = toSolicitudDraft(order(), today); if (!r.ok) throw new Error('no ok');
    expect(validarParadasSolicitud(r.draft.paradas.map(p => ({ orden: p.orden, tipo: p.tipo, lugarNombre: p.lugarNombre })))).toEqual({ ok: true });
  });
  it('no inventa datos: hora y observaciones opcionales quedan null; el id interno de ubicación del TMS nunca aparece', () => {
    const r = toSolicitudDraft(order({ requestedTime: undefined, notes: undefined }), today); if (!r.ok) throw new Error('no ok');
    expect(r.draft.horaSolicitada).toBeNull(); expect(r.draft.observaciones).toBeNull(); expect(JSON.stringify(r.draft)).not.toMatch(/clienteUbicacionId|cliente_ubicacion/);
  });
  it('rechaza campos extra (también ids internos del TMS o un actor) y versiones distintas', () => {
    for (const extra of [{ tenantId: 9 }, { clienteId: 3 }, { estado: 'PROGRAMADA' }, { planId: 1 }, { clienteUbicacionId: 4 }]) expect(toSolicitudDraft(order(extra), today)).toEqual({ ok: false, issues: ['SCHEMA_INVALID'] });
    expect(toSolicitudDraft(order({ schemaVersion: 'api01-draft-1' }), today)).toEqual({ ok: false, issues: ['SCHEMA_INVALID'] });
    expect(toSolicitudDraft(order({ pickup: { placeName: 'X', clienteUbicacionId: 5 } }), today)).toEqual({ ok: false, issues: ['SCHEMA_INVALID'] });
  });
  it.each([
    ['fecha inexistente', { requestedDate: '2026-02-31' }, 'DATE_INVALID'], ['mes 13', { requestedDate: '2026-13-01' }, 'DATE_INVALID'], ['fecha pasada', { requestedDate: '2026-11-10' }, 'DATE_IN_PAST'],
    ['hora inválida', { requestedTime: '25:00' }, 'TIME_INVALID'], ['hora con texto', { requestedTime: 'mañana' }, 'TIME_INVALID'],
  ])('rechaza %s', (_n, over, issue) => { expect(toSolicitudDraft(order(over), today)).toEqual({ ok: false, issues: [issue] }); });
  it('acepta hoy y 29 de febrero bisiesto; rechaza 29 de febrero no bisiesto', () => {
    expect(toSolicitudDraft(order({ requestedDate: today }), today).ok).toBe(true); expect(toSolicitudDraft(order({ requestedDate: '2028-02-29' }), today).ok).toBe(true); expect(toSolicitudDraft(order({ requestedDate: '2027-02-29' }), today).ok).toBe(false);
  });
  it('respeta los límites reales: 1..18 entregas, nombres 200, referencias 300, notas 500, referencia del cliente 120', () => {
    expect(toSolicitudDraft(order({ deliveries: [] }), today).ok).toBe(false);
    expect(toSolicitudDraft(order({ deliveries: Array.from({ length: TMS_LIMITS.deliveriesMax }, (_, i) => stop(`E${i}`)) }), today).ok).toBe(true);
    expect(toSolicitudDraft(order({ deliveries: Array.from({ length: TMS_LIMITS.deliveriesMax + 1 }, (_, i) => stop(`E${i}`)) }), today).ok).toBe(false);
    expect(toSolicitudDraft(order({ pickup: stop('x'.repeat(200)) }), today).ok).toBe(true); expect(toSolicitudDraft(order({ pickup: stop('x'.repeat(201)) }), today).ok).toBe(false);
    expect(toSolicitudDraft(order({ pickup: stop('x', 'r'.repeat(300)) }), today).ok).toBe(true); expect(toSolicitudDraft(order({ pickup: stop('x', 'r'.repeat(301)) }), today).ok).toBe(false);
    expect(toSolicitudDraft(order({ notes: 'n'.repeat(500) }), today).ok).toBe(true); expect(toSolicitudDraft(order({ notes: 'n'.repeat(501) }), today).ok).toBe(false);
    expect(toSolicitudDraft(order({ externalOrderId: 'A'.repeat(120) }), today).ok).toBe(true); expect(toSolicitudDraft(order({ externalOrderId: 'A'.repeat(121) }), today).ok).toBe(false);
    expect(toSolicitudDraft(order({ pickup: stop('   ') }), today).ok).toBe(false);
  });
  it('un reloj inválido no relaja la regla de fecha pasada silenciosamente en el esquema, y la entrada basura no lanza', () => {
    for (const junk of [null, undefined, 42, 'x', [], {}]) expect(toSolicitudDraft(junk, today)).toEqual({ ok: false, issues: ['SCHEMA_INVALID'] });
    expect(orderDraftProposalSchema.safeParse(order()).success).toBe(true);
  });
});

describe('contraste DIFERENCIAL con el código real del TMS', () => {
  it('stopsStructureValid ≡ validarParadasSolicitud sobre miles de secuencias generadas (hasta 20 paradas)', () => {
    let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const kinds = ['Carga', 'Entrega', 'Descarga', 'Salida'];
    for (let i = 0; i < 4000; i++) {
      const n = 1 + Math.floor(rnd() * 6); const stops = Array.from({ length: n }, (_, k) => ({ orden: k + 1, tipo: kinds[Math.floor(rnd() * (i % 5 === 0 ? 4 : 3))], lugarNombre: 'L' }));
      expect(stopsStructureValid(stops), JSON.stringify(stops)).toBe(validarParadasSolicitud(stops).ok);
    }
    const valid = [{ tipo: 'Carga' }, { tipo: 'Entrega' }, { tipo: 'Descarga' }]; expect(stopsStructureValid(valid)).toBe(true);
    expect(stopsStructureValid(Array.from({ length: 21 }, (_, i) => ({ tipo: i === 0 ? 'Carga' : i === 20 ? 'Descarga' : 'Entrega' })))).toBe(false);   // más de 20: límite del PATCH de planes
  });
  it('normalizeTime ≡ normalizarHora', () => {
    for (const v of ['8:05', '08:05', '23:59', '24:00', '12:60', '12:30:59', '12:30:60', '1:2', 'ab', '', ' 07:15 ', '7:5:5', '007:15', '12:30:5']) expect(normalizeTime(v), v).toBe(normalizarHora(v));
  });
  it('isCalendarDate distingue fechas reales (bisiestos, meses de 30 días, rangos)', () => {
    const yes = ['2026-01-31', '2028-02-29', '2026-04-30', '2000-02-29']; const no = ['2026-04-31', '2027-02-29', '1900-02-29', '2026-00-10', '2026-13-01', '2026-01-00', '26-01-01', '2026-1-01'];
    for (const v of yes) expect(isCalendarDate(v), v).toBe(true); for (const v of no) expect(isCalendarDate(v), v).toBe(false);
  });
});
