import { describe, expect, it, vi } from 'vitest';
import { labOrderSchema, labObservations } from './contract';
import { createTmsLinker, claimMarker } from './tms-link';
import { createM2MSecurity, requestBindingDigest } from '../m2m-security';
import { guardEvidenceVerifier } from '../guarded-evidence-verifier';

vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));

// PRICESMART API-24 — pruebas de homologación SIN base de datos (puertos simulados). Lo que se prueba contra MariaDB real está en scripts/ci/pricesmart-demo/homologation.e2e.ts.
const base = { schemaVersion: 'lab-demo-1', externalOrderId: 'PS-1', originClubReference: 'QA-CLUB', recipient: { name: 'Club Ficticio' }, address: 'Dirección ficticia 1', deliveryDate: '2030-01-15' };

describe('API-24 contrato provisional lab-demo-1 — nada se trunca en silencio', () => {
  it('el texto de observaciones del TMS (≤ 500) nunca se corta: lo que no cabe se RECHAZA en la recepción', () => {
    const marker = claimMarker(Buffer.alloc(16, 1));
    const fits = { ...base, recipient: { name: 'N'.repeat(200) }, notes: 'x'.repeat(100) };
    expect(labOrderSchema.safeParse(fits).success).toBe(true);
    const parsed = labOrderSchema.parse(fits); expect(labObservations(marker, parsed).length).toBeLessThanOrEqual(500);
    // Máximos individuales válidos (destinatario 200 + notas 200 + club 64) sumados NO caben → 400, no truncamiento.
    const tooBig = { ...base, originClubReference: 'C'.repeat(64), recipient: { name: 'N'.repeat(200) }, notes: 'x'.repeat(200) };
    const r = labOrderSchema.safeParse(tooBig); expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(['notes']);
  });
  it('el límite exacto: el marcador real mide lo mismo que el reservado, así que la longitud validada es la que se escribe', () => {
    const marker = claimMarker(Buffer.alloc(16, 0xab)); expect(marker).toHaveLength(`[PS:${'0'.repeat(32)}]`.length);
    for (let notes = 0; notes <= 200; notes += 20) {
      const input = { ...base, originClubReference: 'C'.repeat(64), recipient: { name: 'N'.repeat(200) }, ...(notes ? { notes: 'x'.repeat(notes) } : {}) };
      const ok = labOrderSchema.safeParse(input).success;
      const parsed = labOrderSchema.safeParse({ ...input, notes: notes ? 'x'.repeat(notes) : undefined });
      expect(ok).toBe(parsed.success);
      if (ok) expect(labObservations(marker, input as never).length).toBeLessThanOrEqual(500);
    }
  });
  it('contrato provisional: varias entregas, campos desconocidos, fechas imposibles, vacíos y tipos erróneos se rechazan (no se inventan campos de PriceSmart)', () => {
    for (const bad of [
      { ...base, deliveries: [{ name: 'A' }, { name: 'B' }] }, { ...base, campoNuevo: 1 }, { ...base, deliveryDate: '2030-02-31' }, { ...base, deliveryDate: '15/01/2030' },
      { ...base, recipient: { name: '   ' } }, { ...base, recipient: 'texto' }, { ...base, address: '' }, { ...base, externalOrderId: '' }, { ...base, schemaVersion: 'otra' },
      { ...base, recipient: { name: 'x', phone: '5555' } }, { ...base, address: 'a'.repeat(301) }, { ...base, recipient: { name: 'a'.repeat(201) } },
    ]) expect(labOrderSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(false);
  });
});

describe('API-24 el GET no aparenta «RECIBIDA» indefinidamente cuando el TMS rechazó o se agotaron los reintentos', () => {
  const scope = { environment: 'sandbox' as const, tenantId: 1, clientId: 1, integrationId: 'pricesmart-lab' };
  const view = (provisionalStatus: string) => ({ provisionalStatus }) as never;
  function linker(rowsBySql: Array<unknown[]>) {
    let n = 0; const execute = vi.fn(async () => [rowsBySql[n++] ?? []]);
    return createTmsLinker({ pool: { execute } as never, schema: 'sandbox_api02_x', repository: {} as never });
  }
  it('trabajo BLOQUEADO / AGOTADO sin vínculo → REVIEW_REQUIRED con código acotado (sin el mensaje del TMS)', async () => {
    const blocked = await linker([[], [{ status: 'BLOCKED', last_outcome: 'REJECTED_BY_TMS' }]]).status(scope, 'PS-1', view('RECEIVED'));
    expect(blocked).toMatchObject({ proposedStatus: 'REVIEW_REQUIRED', confirmsDelivery: false, tms: { linked: false, linkIssue: { status: 'BLOCKED', code: 'REJECTED_BY_TMS' } } });
    const exhausted = await linker([[], [{ status: 'EXHAUSTED', last_outcome: 'texto libre con datos personales' }]]).status(scope, 'PS-1', view('RECEIVED'));
    expect(exhausted).toMatchObject({ proposedStatus: 'REVIEW_REQUIRED', tms: { linkIssue: { status: 'EXHAUSTED', code: 'UNSPECIFIED' } } });
    expect(JSON.stringify([blocked, exhausted])).not.toMatch(/DELIVERED|ENTREGAD|datos personales/i);
  });
  it('trabajo PENDIENTE, sin trabajo, o con cancelación pedida → sigue RECEIVED / REQUESTED_NOT_LINKED (no se alarma por reintentos normales)', async () => {
    expect(await linker([[], [{ status: 'PENDING', last_outcome: 'UNMAPPED' }]]).status(scope, 'PS-1', view('RECEIVED'))).toMatchObject({ proposedStatus: 'RECEIVED', tms: { linked: false } });
    expect(await linker([[], []]).status(scope, 'PS-1', view('RECEIVED'))).toMatchObject({ proposedStatus: 'RECEIVED' });
    expect(await linker([[], [{ status: 'BLOCKED', last_outcome: 'ORDER_NOT_ELIGIBLE' }]]).status(scope, 'PS-1', view('CANCELLATION_REQUESTED')))
      .toMatchObject({ proposedStatus: 'RECEIVED', cancellation: { requested: true, automatic: false, assessment: 'REQUESTED_NOT_LINKED' } });
  });
});

// ---- El motor M2M no cambia al integrar un verificador aprobado: cualquier verificador que cumpla el puerto funciona, y la envoltura de cierre por defecto lo protege.
describe('API-24 el verificador es el ÚNICO punto de integración del mecanismo D02', () => {
  const now = 1_800_000_000_000;
  const policy = { maxEvidenceBytes: 4096, maxBodyBytes: 8192, requestsPerWindow: 5, windowMs: 1000, maxProofAgeMs: 5000, futureSkewMs: 100, replayRetentionMs: 5100 };
  const target = { environment: 'sandbox', tenantId: 1, clientId: 1, integrationId: 'pricesmart-lab', originClubReference: 'QA-CLUB', externalOrderId: 'O1' } as never;
  const body = new TextEncoder().encode('{}');
  const record = (over: Record<string, unknown> = {}) => ({ integrationId: 'pricesmart-lab', tenantId: 1, clientId: 1, environment: 'sandbox', issuer: 'iss-x', subject: 'sub-x', credentialReference: 'cred-x', revision: 1, status: 'ACTIVE',
    validFromMs: now - 10000, validUntilMs: now + 10000, credentialValidFromMs: now - 10000, credentialValidUntilMs: now + 10000, rotatedAtMs: now - 10000, allowedClubs: ['QA-CLUB'], scopes: ['orders:create'], ...over });
  const assertion = (over: Record<string, unknown> = {}) => ({ environment: 'sandbox', issuer: 'iss-x', subject: 'sub-x', credentialReference: 'cred-x', validFromMs: now - 1000, validUntilMs: now + 8000, scopes: ['orders:create'],
    requestProof: { id: 'p1', issuedAtMs: now - 100, expiresAtMs: now + 3000, bindingDigest: requestBindingDigest('orders:create', target, body) }, ...over });
  const engine = (verifier: unknown, records: unknown[] = [record()], revoked = false) => createM2MSecurity({
    verifier: verifier as never, catalog: { findByCredential: async () => records as never }, revocation: { isRevoked: async () => revoked }, clock: { nowMs: () => now },
    counter: { consume: async (a: { nowMs: number; windowMs: number }) => ({ allowed: true, used: 1, resetAtMs: a.nowMs + a.windowMs, assurance: 'SIMULATED' as const }) },
    replay: { claim: async () => ({ status: 'CLAIMED' as const, assurance: 'SIMULATED' as const }) },
  }, policy, { environment: 'sandbox' });
  const admit = async (sec: ReturnType<typeof engine>) => { const h = await sec.authenticate(new Uint8Array([1])); return sec.admit(h, 'orders:create', target, body); };
  const denied = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };

  it('dos verificadores distintos (formatos de evidencia arbitrarios) se enchufan al MISMO motor sin cambiarlo; la envoltura los protege', async () => {
    const formatA = { async verify() { return assertion(); } };
    const formatB = { async verify(e: Uint8Array) { return e[0] === 1 ? assertion({ issuer: 'iss-x' }) : null; } };
    for (const v of [formatA, formatB, guardEvidenceVerifier(formatA), guardEvidenceVerifier(formatB)]) await expect(admit(engine(v))).resolves.toBeDefined();
    // un verificador que lanza, devuelve basura o una aserción de otro entorno nunca autoriza (envuelto)
    for (const bad of [{ async verify() { throw new Error('boom'); } }, { async verify() { return { cualquier: 'cosa' }; } }, { async verify() { return assertion({ environment: 'production' }); } }])
      expect(await denied(admit(engine(guardEvidenceVerifier(bad as never))))).toBe(true);
  });
  it('caducidad, revocación, rotación y scopes los decide el motor con el catálogo, no el verificador', async () => {
    const v = { async verify() { return assertion(); } };
    expect(await denied(admit(engine(v, [record({ credentialValidUntilMs: now - 1 })])))).toBe(true);            // credencial caducada
    expect(await denied(admit(engine(v, [record({ validUntilMs: now - 1 })])))).toBe(true);                       // integración caducada
    expect(await denied(admit(engine(v, [record()], true)))).toBe(true);                                          // revocada
    expect(await denied(admit(engine(v, [record({ status: 'SUSPENDED' })])))).toBe(true);                         // no activa
    expect(await denied(admit(engine(v, [record({ scopes: ['orders:read'] })])))).toBe(true);                     // sin el scope de la operación
    expect(await denied(admit(engine(v, [record({ allowedClubs: ['OTRO'] })])))).toBe(true);                      // club no permitido
    expect(await denied(admit(engine(v, [record(), record({ revision: 2 })])))).toBe(true);                       // dos registros para la misma credencial: ambiguo ⇒ denegado
    expect(await denied(admit(engine(v, [record({ credentialReference: 'cred-y' })])))).toBe(true);               // la credencial de la aserción no es la del catálogo
  });
});
