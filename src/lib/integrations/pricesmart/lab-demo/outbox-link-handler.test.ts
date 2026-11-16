import { describe, expect, it, vi } from 'vitest';
import { createLinkOutboxHandler } from './outbox-link-handler';
import { labDemoGate, LAB_DEMO_FLAG } from './gate';
import { labVerifier, LAB_EVIDENCE_HEADER } from './lab-crypto';
import { createM2MSecurity, requestBindingDigest } from '../m2m-security';
import { REVIEWED_KMS_ADAPTERS } from '../kms-provider-selection';
import type { OutboxEvent } from '../outbox';

// PRICESMART API-23 — pruebas unitarias (puertos simulados; el comportamiento real contra MariaDB lo prueba el e2e de laboratorio `pricesmart-flow.e2e.ts`).
const SCHEMA = 'sandbox_api02_x';
const scope = { environment: 'sandbox' as const, tenantId: 1, clientId: 1, integrationId: 'pricesmart-lab', originClubReference: 'QA-CLUB' };
const ev = (type: OutboxEvent['type'] = 'RECEIVED'): OutboxEvent => ({ scope, orderId: '11111111-1111-4111-8111-111111111111', version: type === 'RECEIVED' ? 1 : 2, type, reason: type === 'RECEIVED' ? null : 'ORIGIN_REQUEST', correlationId: '22222222-2222-4222-8222-222222222222' });

type World = { order?: { state: string }; linked?: boolean[]; job?: { status: string; last_outcome: string | null; leased: number } };
function build(w: World) {
  const linkedSeq = [...(w.linked ?? [false])];
  const sqls: string[] = []; const params: unknown[][] = [];
  const pool = { execute: vi.fn(async (sql: string, p: unknown[]) => {
    sqls.push(sql); params.push(p);
    if (sql.includes('ps_api01_orders')) return [w.order ? [{ external_order_id: Buffer.from('PS1'), state: w.order.state }] : []];
    if (sql.includes('ps_api12_tms_links')) return [(linkedSeq.length > 1 ? linkedSeq.shift() : linkedSeq[0]) ? [{ ok: 1 }] : []];
    if (sql.includes('ps_api13_link_jobs')) return [w.job ? [w.job] : []];
    throw new Error('sql inesperado');
  }) };
  const retry = { attemptNow: vi.fn(async () => []) }; const linker = { noteCancellation: vi.fn(async () => undefined) };
  return { handler: createLinkOutboxHandler({ pool: pool as never, schema: SCHEMA, retry: retry as never, linker }), retry, linker, sqls, params };
}

describe('API-23 manejador outbox → vinculación TMS de laboratorio', () => {
  it('rechaza esquemas fuera del patrón sandbox_api02_*', () => {
    for (const bad of ['produccion', 'sandbox_api02_', 'Sandbox_api02_x', 'sandbox_api02_x;DROP']) expect(() => createLinkOutboxHandler({ pool: {} as never, schema: bad, retry: {} as never, linker: {} as never })).toThrow();
  });
  it('RECEIVED ya vinculado → DONE sin reintentar la vinculación (idempotente)', async () => {
    const t = build({ order: { state: 'RECEIVED' }, linked: [true] });
    expect(await t.handler.handle(ev())).toEqual({ kind: 'DONE' }); expect(t.retry.attemptNow).not.toHaveBeenCalled();
  });
  it('RECEIVED sin vínculo → intenta vincular; si queda vinculado → DONE', async () => {
    const t = build({ order: { state: 'RECEIVED' }, linked: [false, true] });
    expect(await t.handler.handle(ev())).toEqual({ kind: 'DONE' }); expect(t.retry.attemptNow).toHaveBeenCalledWith(scope, 'PS1', 'outbox');
  });
  it('RECEIVED sin vínculo y trabajo PENDING (sin mapeo, TMS caído…) → RETRY con el código del último resultado; BLOCKED/EXHAUSTED → REVIEW; sin trabajo → RETRY', async () => {
    expect(await build({ order: { state: 'RECEIVED' }, job: { status: 'PENDING', last_outcome: 'UNMAPPED', leased: 0 } }).handler.handle(ev())).toEqual({ kind: 'RETRY', reason: 'UNMAPPED' });
    expect(await build({ order: { state: 'RECEIVED' }, job: { status: 'PENDING', last_outcome: 'texto libre con datos', leased: 0 } }).handler.handle(ev())).toEqual({ kind: 'RETRY', reason: 'LINK_PENDING' });   // nunca texto libre
    expect(await build({ order: { state: 'RECEIVED' }, job: { status: 'BLOCKED', last_outcome: 'REJECTED', leased: 0 } }).handler.handle(ev())).toEqual({ kind: 'REVIEW', reason: 'REJECTED' });
    expect(await build({ order: { state: 'RECEIVED' }, job: { status: 'EXHAUSTED', last_outcome: 'TMS_ERROR', leased: 0 } }).handler.handle(ev())).toEqual({ kind: 'REVIEW', reason: 'LINK_EXHAUSTED' });
    expect(await build({ order: { state: 'RECEIVED' } }).handler.handle(ev())).toEqual({ kind: 'RETRY', reason: 'NO_LINK_JOB' });
  });
  it('orden inexistente o fuera del alcance del evento → REVIEW; toda consulta va acotada por entorno, empresa, cliente e integración', async () => {
    const t = build({}); expect(await t.handler.handle(ev())).toEqual({ kind: 'REVIEW', reason: 'ORDER_NOT_IN_SCOPE' }); expect(t.retry.attemptNow).not.toHaveBeenCalled();
    const ok = build({ order: { state: 'RECEIVED' }, linked: [true] }); await ok.handler.handle(ev());
    for (const sql of ok.sqls) expect(sql).toMatch(/environment=\? AND tenant_id=\? AND client_id=\? AND integration_id=\?/);
    for (const p of ok.params) expect(p.slice(0, 4)).toEqual([Buffer.from('sandbox'), 1, 1, Buffer.from('pricesmart-lab')]);
  });
  it('RECEIVED de una orden que ya no está RECIBIDA (cancelación pedida) y sin vínculo → DONE: no se vincula una orden con cancelación pendiente', async () => {
    const t = build({ order: { state: 'CANCELLATION_REQUESTED' } }); expect(await t.handler.handle(ev())).toEqual({ kind: 'DONE' }); expect(t.retry.attemptNow).not.toHaveBeenCalled();
  });
  it('CANCELLATION_REQUESTED con vínculo → deja constancia (idempotente en el vinculador) y DONE; sin vínculo y sin vinculación en curso → DONE sin constancia; con vinculación en curso → RETRY', async () => {
    const a = build({ order: { state: 'CANCELLATION_REQUESTED' }, linked: [true] });
    expect(await a.handler.handle(ev('CANCELLATION_REQUESTED'))).toEqual({ kind: 'DONE' }); expect(a.linker.noteCancellation).toHaveBeenCalledWith(scope, 'PS1');
    const b = build({ order: { state: 'CANCELLATION_REQUESTED' }, job: { status: 'PENDING', last_outcome: null, leased: 0 } });
    expect(await b.handler.handle(ev('CANCELLATION_REQUESTED'))).toEqual({ kind: 'DONE' }); expect(b.linker.noteCancellation).not.toHaveBeenCalled(); expect(b.retry.attemptNow).not.toHaveBeenCalled();
    const c = build({ order: { state: 'CANCELLATION_REQUESTED' }, job: { status: 'PENDING', last_outcome: null, leased: 1 } });
    expect(await c.handler.handle(ev('CANCELLATION_REQUESTED'))).toEqual({ kind: 'RETRY', reason: 'LINK_IN_PROGRESS' });
  });
});

// ---- El verificador sintético solo sirve en LABORATORIO: jamás autoriza PRODUCTION.
describe('API-23 el verificador de laboratorio no puede autorizar PRODUCTION', () => {
  const now = 1_800_000_000_000; const KEY = 'k'.repeat(32);
  const policy = { maxEvidenceBytes: 4096, maxBodyBytes: 8192, requestsPerWindow: 5, windowMs: 1000, maxProofAgeMs: 5000, futureSkewMs: 100, replayRetentionMs: 5100 };
  const target = (environment: string) => ({ environment, tenantId: 1, clientId: 1, integrationId: 'pricesmart-lab', originClubReference: 'QA-CLUB', externalOrderId: 'O1' }) as never;
  const body = new TextEncoder().encode('{}');
  async function evidence(env: 'sandbox' | 'production') {
    const { createHmac } = await import('node:crypto');
    const proof = { id: 'p1', issuedAtMs: now - 100, expiresAtMs: now + 3000, bindingDigest: requestBindingDigest('orders:create', target(env), body) };
    const payload = Buffer.from(JSON.stringify({ k: 'a', proof })).toString('base64url');
    return new TextEncoder().encode(`${payload}.${createHmac('sha256', KEY).update(`api12-lab:${payload}`).digest('hex')}`);
  }
  const record = (environment: string) => ({ integrationId: 'pricesmart-lab', tenantId: 1, clientId: 1, environment, issuer: 'lab-issuer', subject: 'lab-subject-a', credentialReference: 'lab-cred-a-1', revision: 1, status: 'ACTIVE',
    validFromMs: now - 10000, validUntilMs: now + 10000, credentialValidFromMs: now - 10000, credentialValidUntilMs: now + 10000, rotatedAtMs: now - 10000, allowedClubs: ['QA-CLUB'], scopes: ['orders:create', 'orders:read', 'orders:cancel'] });
  const security = (deployment: 'sandbox' | 'production', recordEnv: string) => createM2MSecurity({
    verifier: labVerifier(KEY, () => now) as never, catalog: { findByCredential: async () => [record(recordEnv)] as never }, revocation: { isRevoked: async () => false }, clock: { nowMs: () => now },
    counter: { consume: async (a: { nowMs: number; windowMs: number }) => ({ allowed: true, used: 1, resetAtMs: a.nowMs + a.windowMs, assurance: 'SIMULATED' as const }) },
    replay: { claim: async () => ({ status: 'CLAIMED' as const, assurance: 'SIMULATED' as const }) },
  }, policy, { environment: deployment });
  const admitted = async (sec: ReturnType<typeof security>, ev: Uint8Array, env: string) => { const h = await sec.authenticate(ev); return sec.admit(h, 'orders:create', target(env), body); };
  const denied = async (p: Promise<unknown>) => { try { await p; return false; } catch (e) { return (e as Error).message === 'DENIED'; } };

  it('control: en sandbox la misma evidencia sintética SÍ autentica (la prueba no es vacía)', async () => {
    await expect(admitted(security('sandbox', 'sandbox'), await evidence('sandbox'), 'sandbox')).resolves.toBeDefined();
  });
  it('un despliegue PRODUCTION rechaza la evidencia sintética, con registro de sandbox o de production, y con un destino de production', async () => {
    for (const recordEnv of ['sandbox', 'production']) for (const targetEnv of ['sandbox', 'production'] as const) {
      expect(await denied(admitted(security('production', recordEnv), await evidence(targetEnv), targetEnv)), `${recordEnv}/${targetEnv}`).toBe(true);
    }
  });
  it('el verificador de laboratorio solo emite aserciones `sandbox` (no hay forma de declarar production en la evidencia) y nada ofrece un adaptador KMS aprobado', async () => {
    const assertion = await labVerifier(KEY, () => now).verify(await evidence('production')) as { environment: string };
    expect(assertion.environment).toBe('sandbox'); expect(Object.keys(REVIEWED_KMS_ADAPTERS)).toEqual([]);
  });
  it('la compuerta del laboratorio se niega con NODE_ENV=production, entorno distinto de sandbox, base no loopback o sin la bandera', () => {
    const ok = { NODE_ENV: 'development', NOVALVION_ENV: 'sandbox', PRICESMART_LAB_DEMO: LAB_DEMO_FLAG, DB_HOST: '127.0.0.1', DB_NAME: 'sandbox_api02_a', DB_USER: 'sandbox_api02_a', PRICESMART_LAB_KEY: KEY };
    expect(labDemoGate(ok).ok).toBe(true);
    for (const bad of [{ NODE_ENV: 'production' }, { NOVALVION_ENV: 'production' }, { NOVALVION_ENV: undefined }, { PRICESMART_LAB_DEMO: undefined }, { DB_HOST: 'db.ejemplo.com' }, { DB_NAME: 'novalvion' }, { DB_USER: 'root' }, { PRICESMART_LAB_KEY: 'corta' }])
      expect(labDemoGate({ ...ok, ...bad }).ok, JSON.stringify(bad)).toBe(false);
    expect(LAB_EVIDENCE_HEADER).toBe('x-lab-evidence');
  });
});
