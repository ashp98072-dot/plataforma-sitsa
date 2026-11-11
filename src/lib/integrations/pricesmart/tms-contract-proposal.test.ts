import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/auditoria', () => ({ registrarAuditoriaTx: vi.fn(), registrarAuditoria: vi.fn() }));

import { ESTADOS_SOLICITUD_CLIENTE, TIPOS_SOLICITUD_PARADA } from '@/lib/tms/solicitudes-cliente';
import { ESTADOS_CIERRE_MANUAL } from '@/lib/tms/cierre-viaje-shared';
import { ESTADOS_BLOQUEADOS, ESTADOS_SOLO_NOTAS } from '@/lib/tms/programacion-validacion-recursos';
import {
  assessCancellation, CONTRACT_STATUS, DECISION_STATUS, EXTERNAL_STATUSES, FULFILLMENT_MODEL, PLAN_STATES, projectExternalStatus, SOLICITUD_STATES, TMS_LIMITS,
} from './tms-contract-proposal';

// Guardas de DERIVA: la propuesta D05/D06/D08/D09 se apoya en reglas reales del TMS. Si el TMS cambia (estados, límites, DDL, rutas), estas pruebas fallan y obligan a revisar la propuesta.
const root = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const schema = read('sql/schema.sql');
const table = (name: string) => { const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\) ENGINE`).exec(schema); if (!m) throw new Error(name); return m[1]; };
const varchar = (body: string, column: string) => Number(new RegExp(`\\b${column} VARCHAR\\((\\d+)\\)`).exec(body)?.[1]);

describe('propuesta D05/D06/D08/D09: sin deriva respecto al TMS real', () => {
  it('es una PROPUESTA (no ratificada)', () => { expect(CONTRACT_STATUS).toBe('PROPOSED'); });
  it('solo D05 está aprobado; D06, D08 y D09 siguen como propuesta', () => { expect(DECISION_STATUS).toEqual({ D05: 'APPROVED', D06: 'PROPOSED', D08: 'PROPOSED', D09: 'PROPOSED' }); });
  it('los estados de solicitud coinciden con los reales y los tipos de parada son los reales', () => {
    expect([...SOLICITUD_STATES]).toEqual([...ESTADOS_SOLICITUD_CLIENTE]); expect([...TIPOS_SOLICITUD_PARADA]).toEqual(['Carga', 'Entrega', 'Descarga']);
  });
  it('los estados de plan cubren los que el TMS usa (cierre manual, bloqueados, solo notas, defecto del DDL)', () => {
    for (const s of [...ESTADOS_CIERRE_MANUAL, ...ESTADOS_BLOQUEADOS, ...ESTADOS_SOLO_NOTAS]) expect(PLAN_STATES).toContain(s);
    expect([...ESTADOS_BLOQUEADOS].sort()).toEqual(['Cancelado', 'Cerrado']); expect([...ESTADOS_SOLO_NOTAS]).toEqual(['En ruta']);
    expect(table('tms_planes_viaje')).toContain("estado VARCHAR(40) NOT NULL DEFAULT 'Programado'");
  });
  it('los límites propuestos coinciden con el DDL real y con las validaciones del portal y de planes', () => {
    const paradas = table('tms_solicitud_paradas'); const sol = table('tms_solicitudes_cliente');
    expect(varchar(paradas, 'lugar_nombre')).toBe(TMS_LIMITS.placeNameMax); expect(varchar(paradas, 'referencia')).toBe(TMS_LIMITS.stopReferenceMax);
    expect(varchar(sol, 'referencia_cliente')).toBe(TMS_LIMITS.customerReferenceMax); expect(varchar(sol, 'observaciones')).toBe(TMS_LIMITS.notesMax);
    const portal = read('src/app/api/cliente-portal/solicitudes/route.ts');
    expect(portal).toContain(`lugarNombre: z.string().trim().min(1).max(${TMS_LIMITS.placeNameMax})`); expect(portal).toContain(`referencia: z.string().trim().max(${TMS_LIMITS.stopReferenceMax})`);
    expect(portal).toContain(`referenciaCliente: z.string().trim().max(${TMS_LIMITS.customerReferenceMax})`); expect(portal).toContain(`observaciones: z.string().trim().max(${TMS_LIMITS.notesMax})`);
    const planes = read('src/app/api/empresas/[slug]/tms/planes/route.ts'); expect(planes).toMatch(new RegExp(`\\n    \\.max\\(${TMS_LIMITS.stopsMax}\\)\\n    \\.optional\\(\\),\\n  // --- Fase P5\\.1a`));
    expect(TMS_LIMITS.deliveriesMax).toBe(TMS_LIMITS.stopsMax - 2);
  });
  it('D05: una solicitud ↔ un plan (UNIQUE real) y las paradas no tienen estado propio', () => {
    expect(FULFILLMENT_MODEL).toMatchObject({ requestsPerOrder: 1, plansPerRequest: 1, perStopStatus: false, partialDelivery: 'UNSUPPORTED_REVIEW', deliveryRetries: 'UNSUPPORTED_REVIEW', sharedTrip: 'UNSUPPORTED_REVIEW' });
    expect(table('tms_solicitudes_cliente')).toContain('UNIQUE KEY uq_tmssolicli_plan (empresa_id, plan_id)');
    expect(table('tms_solicitud_paradas')).not.toMatch(/\bestado\b|\bstatus\b/i);
  });
  it('el TMS real NO tiene escritor de CANCELADA para solicitudes ni cancela la solicitud al cancelar el plan (si cambia, revisar D09)', () => {
    for (const f of ['src/lib/tms/solicitudes-cliente.ts', 'src/lib/tms/solicitudes-cliente-operaciones.ts']) expect(read(f)).not.toMatch(/estado\s*=\s*'CANCELADA'/);
    expect(read('src/lib/tms/solicitudes-cliente-operaciones.ts')).toContain("estado = 'RECHAZADA'");   // única salida terminal hoy, solo personal interno y con motivo
  });
  it('toda solicitud real exige un usuario del portal del cliente como creador (actor humano): bloqueante para una integración máquina-a-máquina', () => {
    expect(table('tms_solicitudes_cliente')).toContain('creado_por_usuario_cliente_id INT NOT NULL');
  });
});

describe('D08 (propuesta): proyección a estados externos', () => {
  const plans = [null, ...PLAN_STATES];
  it('ninguna combinación confirma entrega ni es publicable; Descargado NO es «entregado»', () => {
    for (const s of [...SOLICITUD_STATES, 'DESCONOCIDA']) for (const p of plans) { const r = projectExternalStatus(s, p); expect(r.confirmsDelivery).toBe(false); expect(r.publishable).toBe(false); expect(EXTERNAL_STATUSES).toContain(r.status); }
    expect(projectExternalStatus('PROGRAMADA', 'Descargado').status).toBe('UNLOADED_UNCONFIRMED'); expect(projectExternalStatus('PROGRAMADA', 'Cerrado').status).toBe('CLOSED_ADMINISTRATIVE');
  });
  it.each([
    ['SOLICITADA', null, 'RECEIVED'], ['EN_REVISION', null, 'IN_REVIEW'], ['RECHAZADA', null, 'REJECTED'], ['CANCELADA', null, 'CANCELLED'],
    ['PROGRAMADA', 'Programado', 'SCHEDULED'], ['PROGRAMADA', 'Cargado', 'LOADED'], ['PROGRAMADA', 'En ruta', 'IN_TRANSIT'], ['PROGRAMADA', 'Descargado', 'UNLOADED_UNCONFIRMED'],
    ['PROGRAMADA', 'Cerrado', 'CLOSED_ADMINISTRATIVE'], ['PROGRAMADA', 'Cancelado', 'CANCELLED'],
  ])('%s + %s ⇒ %s', (s, p, expected) => { expect(projectExternalStatus(s, p).status).toBe(expected); });
  it.each([['PROGRAMADA', null], ['PROGRAMADA', 'Otro'], ['SOLICITADA', 'Programado'], ['RECHAZADA', 'Cerrado'], ['XYZ', null]])('combinación incoherente %s + %s ⇒ REVIEW_REQUIRED', (s, p) => { expect(projectExternalStatus(s, p as string | null).status).toBe('REVIEW_REQUIRED'); });
});

describe('D09 (propuesta): evaluación de cancelación según el estado real del TMS', () => {
  it.each([
    ['SOLICITADA', null, 'STAFF_REJECTION_BEFORE_SCHEDULING'], ['EN_REVISION', null, 'STAFF_REJECTION_BEFORE_SCHEDULING'],
    ['PROGRAMADA', 'Programado', 'OPERATIONS_MAY_CANCEL_PLAN'], ['PROGRAMADA', 'Cargado', 'OPERATIONS_MAY_CANCEL_PLAN'],
    ['PROGRAMADA', 'En ruta', 'BLOCKED_IN_EXECUTION'], ['PROGRAMADA', 'Descargado', 'BLOCKED_COMPLETED'], ['PROGRAMADA', 'Cerrado', 'BLOCKED_COMPLETED'], ['PROGRAMADA', 'Cancelado', 'ALREADY_CANCELLED'],
    ['RECHAZADA', null, 'ALREADY_TERMINAL'], ['CANCELADA', null, 'ALREADY_CANCELLED'],
    ['PROGRAMADA', null, 'REVIEW_REQUIRED'], ['SOLICITADA', 'Programado', 'REVIEW_REQUIRED'], ['QUIEN', null, 'REVIEW_REQUIRED'],
  ])('%s + %s ⇒ %s', (s, p, verdict) => { expect(assessCancellation(s, p as string | null).verdict).toBe(verdict); });
  it('NUNCA es automática, para ninguna combinación', () => {
    for (const s of [...SOLICITUD_STATES, 'X']) for (const p of [null, ...PLAN_STATES, 'Y']) expect(assessCancellation(s, p).automatic).toBe(false);
  });
  it('coherencia con el TMS real: no se puede cancelar en «En ruta» (solo notas) ni en Cerrado/Cancelado (bloqueados); sí en Programado/Cargado', () => {
    expect(ESTADOS_SOLO_NOTAS.has('En ruta')).toBe(true); expect(ESTADOS_BLOQUEADOS.has('Cerrado')).toBe(true);
    for (const p of PLAN_STATES) { const editable = !ESTADOS_BLOQUEADOS.has(p) && !ESTADOS_SOLO_NOTAS.has(p) && p !== 'Descargado'; expect(assessCancellation('PROGRAMADA', p).verdict === 'OPERATIONS_MAY_CANCEL_PLAN').toBe(editable); }
  });
});
