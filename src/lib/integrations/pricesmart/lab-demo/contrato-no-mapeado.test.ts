import { describe, expect, it, vi } from 'vitest';
import { classify, DEFAULT_RETRY_POLICY } from './link-retry';
import { createTmsLinker } from './tms-link';
import { createLinkOutboxHandler } from './outbox-link-handler';

vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));

// Homologación: el vínculo con el TMS solo traduce el contrato `lab-demo-1`. Con otra forma de orden (p. ej. un diccionario D06 definitivo todavía sin capa de mapeo) debe BLOQUEAR de inmediato y sin escribir,
// no lanzar una excepción que se reintenta durante horas mientras el GET dice «RECEIVED».
const scope = { environment: 'sandbox' as const, tenantId: 1, clientId: 1, integrationId: 'pricesmart-lab' };
const MAP = { empresa_id: 1, tms_cliente_id: 2, tms_usuario_cliente_id: 3, pickup_place: 'CD Origen', dropoff_place: 'CD Destino' };
const labInput = { schemaVersion: 'lab-demo-1', externalOrderId: 'PS-1', originClubReference: 'QA-CLUB', recipient: { name: 'Club Ficticio' }, address: 'Dirección ficticia 1', deliveryDate: '2030-01-15' };

function harness(input: unknown, rows: { links?: unknown[]; found?: unknown[] } = {}) {
  const sqls: string[] = [];
  const conn = {
    query: vi.fn(async () => [[{ ok: 1 }]]), release: vi.fn(), destroy: vi.fn(),
    execute: vi.fn(async (sql: string) => { sqls.push(sql); if (/FROM .*tms_mapping/.test(sql)) return [[MAP]]; if (/^SELECT claim_token, solicitud_id/.test(sql)) return [rows.links ?? []]; if (/^SELECT id FROM tms_solicitudes_cliente/.test(sql)) return [rows.found ?? []]; return [{ affectedRows: 1 }]; }),
  };
  const pool = { getConnection: vi.fn(async () => conn) };
  const stored = { id: '11111111-1111-4111-8111-111111111111', input };
  const repository = { runAtomic: async (_s: unknown, fn: (tx: unknown) => Promise<unknown>) => ({ value: await fn({ findForUpdate: async () => stored }) }) };
  const createRequest = vi.fn(async () => ({ ok: true as const, solicitud: { id: 77 } }));
  const linker = createTmsLinker({ pool: pool as never, schema: 'sandbox_api02_x', repository: repository as never, createRequest: createRequest as never });
  return { linker, sqls, createRequest };
}

describe('contrato de la orden sin capa de mapeo hacia el TMS', () => {
  it('una orden con otra forma (diccionario D06 distinto) queda CONTRACT_NOT_MAPPED: sin reclamo persistido, sin solicitud en el TMS y sin excepción', async () => {
    for (const input of [{ ...labInput, schemaVersion: 'd06-definitivo-1' }, { schemaVersion: 'd06-definitivo-1', externalOrderId: 'PS-1', originClubReference: 'QA-CLUB', consignee: { legalName: 'X' }, deliveryWindow: { from: '2030-01-15' } }, { ...labInput, recipient: 'texto' }, null, 'cadena']) {
      const h = harness(input);
      const r = await h.linker.link(scope, 'PS-1');
      expect(r.state).toBe('CONTRACT_NOT_MAPPED'); expect('detail' in r && r.detail).toMatch(/lab-demo-1/);
      expect(h.createRequest).not.toHaveBeenCalled();
      expect(h.sqls.filter((s) => /^(INSERT|UPDATE|DELETE)/.test(s))).toEqual([]);   // no se persistió ningún reclamo
    }
  });
  it('una orden lab-demo-1 sigue vinculándose igual que antes (se escribe el reclamo y se crea UNA solicitud con los datos de la orden)', async () => {
    const h = harness(labInput);
    const r = await h.linker.link(scope, 'PS-1');
    expect(r).toMatchObject({ state: 'LINKED', solicitudId: 77 });
    expect(h.createRequest).toHaveBeenCalledTimes(1);
    const [, request] = h.createRequest.mock.calls[0] as unknown as [unknown, { fechaSolicitada: string; referenciaCliente: string; entregas: Array<{ lugarNombre: string; referencia: string }> }];
    expect(request).toMatchObject({ fechaSolicitada: '2030-01-15', referenciaCliente: 'PS-1', entregas: [{ lugarNombre: 'Club Ficticio', referencia: 'Dirección ficticia 1' }] });
    expect(h.sqls.some((s) => /^INSERT INTO .*tms_links/.test(s))).toBe(true);
  });
  it('la clasificación lo bloquea YA (sin reintentos ni retroceso) y deja un código acotado que el GET muestra como REVIEW_REQUIRED', () => {
    const c = classify({ state: 'CONTRACT_NOT_MAPPED', detail: 'x'.repeat(500) }, 1, DEFAULT_RETRY_POLICY);
    expect(c).toMatchObject({ status: 'BLOCKED', outcome: 'CONTRACT_NOT_MAPPED', delayMs: 0 }); expect(c.detail!.length).toBeLessThanOrEqual(200);
    expect(c.outcome).toMatch(/^[A-Z][A-Z0-9_]{0,31}$/);   // cabe en last_outcome VARCHAR(32) y en el patrón del OpenAPI (linkIssue.code)
    // Contraste: un fallo transitorio SÍ se reintenta con retroceso.
    expect(classify({ state: 'LOCK_TIMEOUT' }, 1, DEFAULT_RETRY_POLICY)).toMatchObject({ status: 'PENDING' });
  });

  describe('no perjudica lo ya vinculado ni los mecanismos de recuperación', () => {
    const otraForma = { schemaVersion: 'd06-definitivo-1', externalOrderId: 'PS-1', consignee: { legalName: 'X' } };
    const writes = (h: { sqls: string[] }) => h.sqls.filter((q) => /^(INSERT|UPDATE|DELETE)/.test(q));

    it('una orden YA VINCULADA sigue siendo ALREADY_LINKED aunque su contrato no sea lab-demo-1: no se bloquea, no se escribe nada y no se crea otra solicitud', async () => {
      const h = harness(otraForma, { links: [{ claim_token: Buffer.alloc(16, 2), solicitud_id: 55 }] });
      expect(await h.linker.link(scope, 'PS-1')).toMatchObject({ state: 'ALREADY_LINKED', solicitudId: 55 });
      expect(h.createRequest).not.toHaveBeenCalled(); expect(writes(h)).toEqual([]);
    });
    it('RECUPERACIÓN: un reclamo pendiente cuya solicitud ya existe en el TMS (se encuentra por token) se completa como LINKED aunque el contrato no sea lab-demo-1; no se crea nada nuevo', async () => {
      const h = harness(otraForma, { links: [{ claim_token: Buffer.alloc(16, 3), solicitud_id: null }], found: [{ id: 91 }] });
      expect(await h.linker.link(scope, 'PS-1')).toMatchObject({ state: 'LINKED', solicitudId: 91 });
      expect(h.createRequest).not.toHaveBeenCalled();
      expect(writes(h)).toHaveLength(1); expect(writes(h)[0]).toMatch(/^UPDATE .*ps_api12_tms_links`? SET solicitud_id=/);
    });
    it('un reclamo pendiente SIN solicitud recuperable y con contrato no mapeado queda CONTRACT_NOT_MAPPED: no se crea la solicitud ni se escribe otro reclamo (el existente se conserva)', async () => {
      const h = harness(otraForma, { links: [{ claim_token: Buffer.alloc(16, 4), solicitud_id: null }], found: [] });
      expect(await h.linker.link(scope, 'PS-1')).toMatchObject({ state: 'CONTRACT_NOT_MAPPED' });
      expect(h.createRequest).not.toHaveBeenCalled(); expect(writes(h)).toEqual([]);
    });
    it('un reclamo pendiente con una orden lab-demo-1 sigue creando la solicitud como siempre (reintento de un intento interrumpido)', async () => {
      const h = harness(labInput, { links: [{ claim_token: Buffer.alloc(16, 5), solicitud_id: null }], found: [] });
      expect(await h.linker.link(scope, 'PS-1')).toMatchObject({ state: 'LINKED', solicitudId: 77 }); expect(h.createRequest).toHaveBeenCalledTimes(1);
      expect(writes(h).some((q) => /^INSERT INTO .*tms_links/.test(q))).toBe(false);   // el reclamo ya existía: no se duplica
    });
    it('GET: una orden bloqueada por contrato muestra REVIEW_REQUIRED con código acotado; una orden vinculada se consulta igual con cualquier contrato', async () => {
      const pool = (answers: unknown[][]) => { let n = 0; return { execute: vi.fn(async () => [answers[n++] ?? []]) } as never; };
      const blocked = await createTmsLinker({ pool: pool([[], [{ status: 'BLOCKED', last_outcome: 'CONTRACT_NOT_MAPPED' }]]), schema: 'sandbox_api02_x', repository: {} as never }).status(scope, 'PS-1', { provisionalStatus: 'RECEIVED' } as never);
      expect(blocked).toMatchObject({ proposedStatus: 'REVIEW_REQUIRED', confirmsDelivery: false, tms: { linked: false, linkIssue: { status: 'BLOCKED', code: 'CONTRACT_NOT_MAPPED' } } });
      const linked = await createTmsLinker({ pool: pool([[{ empresa_id: 1, solicitud_id: 7, cancellation_requested_at: null, sol_estado: 'PROGRAMADA', plan_id: null, plan_estado: null }]]), schema: 'sandbox_api02_x', repository: {} as never }).status(scope, 'PS-1', { provisionalStatus: 'RECEIVED' } as never);
      expect(linked).toMatchObject({ tms: { linked: true } });
    });
    it('outbox: el evento RECEIVED de una orden bloqueada por contrato va a REVIEW con el código (no reintenta sin fin); una CANCELACIÓN de esa orden no se reintenta ni se pierde', async () => {
      const answer = (jobRow: Record<string, unknown> | null) => {
        const execute = vi.fn(async (sql: string) => {
          if (/FROM `sandbox_api02_x`\.`ps_api01_orders`/.test(sql)) return [[{ external_order_id: 'PS-1', state: 'RECEIVED' }]];
          if (/ps_api12_tms_links/.test(sql)) return [[]];
          if (/ps_api13_link_jobs/.test(sql)) return [jobRow ? [jobRow] : []];
          return [[]];
        });
        return createLinkOutboxHandler({ pool: { execute } as never, schema: 'sandbox_api02_x', retry: { attemptNow: vi.fn(async () => ({})) } as never, linker: { noteCancellation: vi.fn() } as never });
      };
      const base = { orderId: '11111111-1111-4111-8111-111111111111', version: 1, scope, correlationId: 'c', reason: null } as never;
      const blockedJob = { status: 'BLOCKED', last_outcome: 'CONTRACT_NOT_MAPPED', leased: 0 };
      expect(await answer(blockedJob).handle({ ...(base as object), type: 'RECEIVED' } as never)).toEqual({ kind: 'REVIEW', reason: 'CONTRACT_NOT_MAPPED' });
      expect(await answer(blockedJob).handle({ ...(base as object), type: 'CANCELLATION_REQUESTED', version: 2, reason: 'ORIGIN_REQUEST' } as never)).toEqual({ kind: 'DONE' });
    });
  });
});
