import { describe, expect, it, vi } from 'vitest';
import { classify, DEFAULT_RETRY_POLICY } from './link-retry';
import { createTmsLinker } from './tms-link';

vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));

// Homologación: el vínculo con el TMS solo traduce el contrato `lab-demo-1`. Con otra forma de orden (p. ej. un diccionario D06 definitivo todavía sin capa de mapeo) debe BLOQUEAR de inmediato y sin escribir,
// no lanzar una excepción que se reintenta durante horas mientras el GET dice «RECEIVED».
const scope = { environment: 'sandbox' as const, tenantId: 1, clientId: 1, integrationId: 'pricesmart-lab' };
const MAP = { empresa_id: 1, tms_cliente_id: 2, tms_usuario_cliente_id: 3, pickup_place: 'CD Origen', dropoff_place: 'CD Destino' };
const labInput = { schemaVersion: 'lab-demo-1', externalOrderId: 'PS-1', originClubReference: 'QA-CLUB', recipient: { name: 'Club Ficticio' }, address: 'Dirección ficticia 1', deliveryDate: '2030-01-15' };

function harness(input: unknown) {
  const sqls: string[] = [];
  const conn = {
    query: vi.fn(async () => [[{ ok: 1 }]]), release: vi.fn(), destroy: vi.fn(),
    execute: vi.fn(async (sql: string) => { sqls.push(sql); if (/FROM .*tms_mapping/.test(sql)) return [[MAP]]; return [[]]; }),
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
});
