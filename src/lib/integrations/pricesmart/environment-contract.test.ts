import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENVIRONMENTS, environmentSchema, isEnvironment, sameEnvironment, type Environment } from './environment';
import { assertionSchema, integrationSchema, targetSchema, type IntegrationRecord, type ResourceTarget, type VerifiedAssertion, type AbusePolicy } from './security-contracts';
import { createM2MSecurity, requestBindingDigest } from './m2m-security';
import { createIsolatedHttpTransport } from './http-transport';
import { denyAllEvidenceVerifier, guardEvidenceVerifier } from './guarded-evidence-verifier';
import { runPortConformance } from './port-conformance';
import { REVIEWED_KMS_ADAPTERS } from './kms-provider-selection';
import { parseRuntimeConfig, ENABLE_ACK } from './runtime-config';
import { installControlledRuntime, evaluateReadiness, type RuntimePorts } from './runtime-assembly';
import { handlePriceSmart } from './runtime';
import { isPriceSmartHandlerInstalled, installPriceSmartHandler } from './runtime-state';
import { buildReadinessDiagnostic } from './readiness-diagnostic';

const now = 1_800_000_000_000; const ENVS: Environment[] = ['sandbox', 'production'];
const policy: AbusePolicy = { maxEvidenceBytes: 100, maxBodyBytes: 100, requestsPerWindow: 5, windowMs: 1000, maxProofAgeMs: 5000, futureSkewMs: 100, replayRetentionMs: 5100 };
const body = new TextEncoder().encode('{"externalOrderId":"Order-A"}'); const evidence = new Uint8Array([1, 2, 3]);
const targetOf = (environment: unknown): ResourceTarget => ({ environment, tenantId: 1, clientId: 2, integrationId: 'PriceSmart', originClubReference: 'Club-A', externalOrderId: 'Order-A' }) as ResourceTarget;
const recordOf = (environment: unknown, over: Partial<IntegrationRecord> = {}): IntegrationRecord => ({ integrationId: 'PriceSmart', tenantId: 1, clientId: 2, environment, issuer: 'iss', subject: 'sub', credentialReference: 'cred',
  revision: 1, status: 'ACTIVE', validFromMs: now - 10000, validUntilMs: now + 10000, credentialValidFromMs: now - 10000, credentialValidUntilMs: now + 10000, rotatedAtMs: now - 10000,
  allowedClubs: ['Club-A'], scopes: ['orders:create', 'orders:read', 'orders:cancel'], ...over }) as IntegrationRecord;
const assertionOf = (environment: unknown, over: Partial<VerifiedAssertion> = {}): VerifiedAssertion => ({ environment, issuer: 'iss', subject: 'sub', credentialReference: 'cred', validFromMs: now - 1000, validUntilMs: now + 8000,
  scopes: ['orders:create', 'orders:read', 'orders:cancel'], requestProof: { id: 'Proof-A', issuedAtMs: now - 500, expiresAtMs: now + 4000, bindingDigest: requestBindingDigest('orders:create', targetOf(over.environment ?? environment), body) }, ...over }) as VerifiedAssertion;

/** Puertos SIMULADOS. `record`/`assertion` son el entorno que devuelven el catálogo y el verificador; `deployment` es el entorno con el que se configura el motor. */
function engine(deployment: unknown, o: { record?: unknown; assertion?: unknown; records?: IntegrationRecord[]; revoked?: (input: { environment: Environment; issuer: string }) => boolean } = {}) {
  const ports = {
    verifier: { verify: vi.fn(async (): Promise<unknown> => assertionOf(o.assertion ?? deployment)) },
    catalog: { findByCredential: vi.fn(async (): Promise<unknown[]> => o.records ?? [recordOf(o.record ?? deployment)]) },
    revocation: { isRevoked: vi.fn(async (input: { environment: Environment; issuer: string }): Promise<boolean> => (o.revoked ? o.revoked(input) : false)) }, clock: { nowMs: () => now },
    counter: { consume: vi.fn(async (a: { nowMs: number; windowMs: number; identityKey: string }) => ({ allowed: true, used: 1, resetAtMs: a.nowMs + a.windowMs, assurance: 'SIMULATED' as const })) },
    replay: { claim: vi.fn(async (a: { identityKey: string }) => { void a; return { status: 'CLAIMED' as 'CLAIMED' | 'REUSED' | 'COLLISION', assurance: 'SIMULATED' as const }; }) },
  };
  return { ports, security: createM2MSecurity(ports, policy, { environment: deployment as Environment }) };
}
const denied = async (p: Promise<unknown>) => { try { await p; return false; } catch (e) { return (e as Error).message === 'DENIED'; } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); installPriceSmartHandler(null); });

describe('el entorno es un valor de primer orden del contrato', () => {
  it('solo sandbox y production; todo lo demás (ausente, vacío, mayúsculas, otros nombres, tipos) se rechaza', () => {
    expect([...ENVIRONMENTS]).toEqual(['sandbox', 'production']);
    for (const ok of ENVS) { expect(environmentSchema.safeParse(ok).success).toBe(true); expect(isEnvironment(ok)).toBe(true); }
    for (const bad of [undefined, null, '', 'Sandbox', 'PRODUCTION', 'staging', 'prod', 'sandbox ', 0, 1, true, {}, [], ['sandbox']]) { expect(isEnvironment(bad), String(bad)).toBe(false); expect(environmentSchema.safeParse(bad).success).toBe(false); }
  });
  it('sameEnvironment exige valores válidos e iguales; vacío, ausente o dispar es falso', () => {
    expect(sameEnvironment('sandbox', 'sandbox', 'sandbox')).toBe(true); expect(sameEnvironment('production', 'production')).toBe(true);
    for (const bad of [[], ['sandbox', 'production'], ['sandbox', undefined], [undefined, undefined], ['staging', 'staging'], ['production', 'Production']]) expect(sameEnvironment(...bad), JSON.stringify(bad)).toBe(false);
  });
  it('los esquemas de seguridad aceptan ambos entornos y exigen el campo (la ausencia o un valor inválido se rechaza)', () => {
    for (const env of ENVS) { expect(targetSchema.safeParse(targetOf(env)).success).toBe(true); expect(assertionSchema.safeParse(assertionOf(env)).success).toBe(true); expect(integrationSchema.safeParse(recordOf(env)).success).toBe(true); }
    for (const bad of [undefined, null, '', 'staging', 'Sandbox', 5]) {
      expect(targetSchema.safeParse(targetOf(bad)).success, `target ${String(bad)}`).toBe(false); expect(assertionSchema.safeParse({ ...assertionOf('sandbox'), environment: bad }).success, `aserción ${String(bad)}`).toBe(false); expect(integrationSchema.safeParse(recordOf(bad)).success, `registro ${String(bad)}`).toBe(false);
    }
    const { environment: _t, ...noEnv } = targetOf('sandbox'); void _t; expect(targetSchema.safeParse(noEnv).success).toBe(false);
  });
  it('el digest de la prueba de solicitud depende del entorno: la misma solicitud en sandbox y en production produce digests distintos', () => {
    expect(requestBindingDigest('orders:create', targetOf('sandbox'), body)).not.toBe(requestBindingDigest('orders:create', targetOf('production'), body));
    expect(() => requestBindingDigest('orders:create', targetOf('staging'), body)).toThrow();
  });
});

describe('autenticación y autorización cruzadas entre entornos (motor M2M con puertos simulados)', () => {
  it('SOLO si el entorno del despliegue, el de la aserción, el del registro y el del recurso coinciden se autoriza (matriz completa)', async () => {
    for (const deployment of ENVS) for (const assertion of ENVS) for (const record of ENVS) for (const target of ENVS) {
      const e = engine(deployment, { assertion, record }); const allEqual = deployment === assertion && assertion === record && record === target; const label = `D=${deployment} A=${assertion} R=${record} T=${target}`;
      let authenticated = true; let handle: unknown;
      try { handle = await e.security.authenticate(evidence); } catch { authenticated = false; }
      if (deployment !== assertion || deployment !== record) { expect(authenticated, `${label} no debe autenticar`).toBe(false); continue; }
      expect(authenticated, label).toBe(true);
      const ok = !(await denied(e.security.authorize(handle, 'orders:create', targetOf(target))));
      expect(ok, label).toBe(allEqual);
    }
  });
  it('una credencial de SANDBOX jamás autoriza operaciones de PRODUCCIÓN y viceversa (aserción, registro y recurso)', async () => {
    const [sb, pr] = [engine('sandbox'), engine('production')];
    const sbHandle = await sb.security.authenticate(evidence); const prHandle = await pr.security.authenticate(evidence);
    expect(await denied(sb.security.authorize(sbHandle, 'orders:create', targetOf('production')))).toBe(true); expect(await denied(pr.security.authorize(prHandle, 'orders:create', targetOf('sandbox')))).toBe(true);
    expect(await denied(engine('production', { assertion: 'sandbox' }).security.authenticate(evidence))).toBe(true); expect(await denied(engine('sandbox', { assertion: 'production' }).security.authenticate(evidence))).toBe(true);
    expect(await denied(engine('production', { record: 'sandbox' }).security.authenticate(evidence))).toBe(true); expect(await denied(engine('sandbox', { record: 'production' }).security.authenticate(evidence))).toBe(true);
    // un handle de un motor no vale en otro
    expect(await denied(pr.security.authorize(sbHandle, 'orders:create', targetOf('production')))).toBe(true);
  });
  it('el verificador recibe SIEMPRE el entorno del despliegue; sin opción se conserva sandbox (compatibilidad); valores inválidos o null rechazan la construcción', async () => {
    for (const env of ENVS) { const e = engine(env); await e.security.authenticate(evidence); expect(e.ports.verifier.verify).toHaveBeenCalledWith(evidence, { environment: env }); }
    const ports = engine('sandbox').ports; const compat = createM2MSecurity(ports, policy); await compat.authenticate(evidence); expect(ports.verifier.verify).toHaveBeenCalledWith(evidence, { environment: 'sandbox' });
    expect(() => createM2MSecurity(ports, policy, { environment: undefined })).not.toThrow();
    for (const bad of [null, '', 'staging', 'Sandbox', 'PRODUCTION', 0, {}]) expect(() => createM2MSecurity(ports, policy, { environment: bad as never }), String(bad)).toThrow('UNAVAILABLE');
  });
  it('una aserción o un recurso SIN entorno se rechazan de forma segura', async () => {
    const noEnvAssertion = engine('sandbox'); noEnvAssertion.ports.verifier.verify.mockResolvedValue((() => { const { environment: _e, ...rest } = assertionOf('sandbox'); void _e; return rest; })()); expect(await denied(noEnvAssertion.security.authenticate(evidence))).toBe(true);
    const e = engine('sandbox'); const handle = await e.security.authenticate(evidence); const { environment: _x, ...noEnvTarget } = targetOf('sandbox'); void _x;
    expect(await denied(e.security.authorize(handle, 'orders:create', noEnvTarget as never))).toBe(true); expect(await denied(e.security.admit(handle, 'orders:create', noEnvTarget as never, body))).toBe(true);
    const noEnvRecord = engine('sandbox'); noEnvRecord.ports.catalog.findByCredential.mockResolvedValue([(() => { const { environment: _r, ...rest } = recordOf('sandbox'); void _r; return rest; })()]); expect(await denied(noEnvRecord.security.authenticate(evidence))).toBe(true);
  });
  it('un registro ambiguo con el MISMO vínculo de credencial en ambos entornos se rechaza; uno solo del otro entorno también', async () => {
    for (const deployment of ENVS) {
      expect(await denied(engine(deployment, { records: [recordOf('sandbox'), recordOf('production')] }).security.authenticate(evidence)), `ambiguo ${deployment}`).toBe(true);
      const other: Environment = deployment === 'sandbox' ? 'production' : 'sandbox'; expect(await denied(engine(deployment, { records: [recordOf(other)] }).security.authenticate(evidence)), `otro entorno ${deployment}`).toBe(true);
    }
  });
  it('revocación y permisos SEPARADOS por entorno: revocar en uno no afecta al otro y el puerto recibe el entorno del registro', async () => {
    const revokedIn = (env: Environment) => (input: { environment: Environment }) => input.environment === env;
    const sbRevoked = engine('sandbox', { revoked: revokedIn('sandbox') }); const prWhileSbRevoked = engine('production', { revoked: revokedIn('sandbox') });
    expect(await denied(sbRevoked.security.authenticate(evidence))).toBe(true); expect(await denied(prWhileSbRevoked.security.authenticate(evidence))).toBe(false);
    const prRevoked = engine('production', { revoked: revokedIn('production') }); const sbWhilePrRevoked = engine('sandbox', { revoked: revokedIn('production') });
    expect(await denied(prRevoked.security.authenticate(evidence))).toBe(true); expect(await denied(sbWhilePrRevoked.security.authenticate(evidence))).toBe(false);
    for (const env of ENVS) { const e = engine(env); await e.security.authenticate(evidence); expect(e.ports.revocation.isRevoked).toHaveBeenCalledWith(expect.objectContaining({ environment: env })); }
    // permisos: un registro de producción sin alcance de cancelación no puede cancelar aunque la aserción lo declare
    const limited = engine('production', { records: [recordOf('production', { scopes: ['orders:read'] })] }); const h = await limited.security.authenticate(evidence);
    expect(await denied(limited.security.authorize(h, 'orders:cancel', targetOf('production')))).toBe(true); expect(await denied(limited.security.authorize(h, 'orders:read', targetOf('production')))).toBe(false);
  });
  it('identidades empresariales, clientes e integraciones aisladas: el namespace de cuotas y reclamos incluye el entorno y las pruebas de un entorno no valen en el otro', async () => {
    const keys: Record<string, string> = {};
    for (const env of ENVS) { const e = engine(env); const handle = await e.security.authenticate(evidence); await e.security.admit(handle, 'orders:create', targetOf(env), body); keys[env] = (e.ports.counter.consume.mock.calls[0][0] as { identityKey: string }).identityKey; expect((e.ports.replay.claim.mock.calls[0][0] as { identityKey: string }).identityKey).toBe(keys[env]); }
    expect(keys.sandbox).not.toBe(keys.production); expect(keys.sandbox).toContain('sandbox'); expect(keys.production).toContain('production');
    // mismo tenant/cliente/integración, entorno distinto: la prueba ligada al recurso de sandbox NO admite una solicitud de producción
    const wrongProof = engine('production'); wrongProof.ports.verifier.verify.mockResolvedValue(assertionOf('production', { requestProof: { id: 'P', issuedAtMs: now - 500, expiresAtMs: now + 4000, bindingDigest: requestBindingDigest('orders:create', targetOf('sandbox'), body) } }));
    const hp = await wrongProof.security.authenticate(evidence); expect(await denied(wrongProof.security.admit(hp, 'orders:create', targetOf('production'), body))).toBe(true); expect(wrongProof.ports.counter.consume).not.toHaveBeenCalled();
    // y el principal resultante lleva el entorno del registro
    const e = engine('production'); const h = await e.security.authenticate(evidence); expect(await e.security.authorize(h, 'orders:create', targetOf('production'))).toMatchObject({ environment: 'production', tenantId: 1, clientId: 2 });
  });
});

describe('capacidades de producción NO adquiridas: transporte, verificador, KMS, persistencia y activación', () => {
  const fakeRepository = () => { const calls: unknown[] = []; return { calls, repository: { runAtomic: vi.fn(async (...a: unknown[]) => { calls.push(a); throw new Error('no debe llamarse'); }) } }; };
  const limits = { originClubReference: 'Club-A', timeoutMs: 2000, maxHeaderBytes: 8192, maxHeaderCount: 32, maxUrlBytes: 2048, maxBodyChunks: 16 };
  it('el transporte valida el entorno del despliegue y, con verificador/catalogo de otro entorno, ninguna solicitud llega al repositorio', async () => {
    const f = engine('sandbox'); const { repository, calls } = fakeRepository();
    for (const bad of [null, '', 'staging', 5]) expect(() => createIsolatedHttpTransport({ evidence: { extract: async () => evidence }, security: f.ports, repository: repository as never, environment: bad as never }, policy, limits), String(bad)).toThrow();
    for (const deployment of ENVS) {
      const other: Environment = deployment === 'sandbox' ? 'production' : 'sandbox'; const g = engine(other);   // puertos de OTRO entorno
      const handler = createIsolatedHttpTransport({ evidence: { extract: async () => evidence }, security: g.ports, repository: repository as never, environment: deployment }, policy, limits);
      const res = await handler(new Request('https://x.test/api/integrations/pricesmart/v1/orders/Order-A', { method: 'GET' })); expect([401, 403]).toContain(res.status);
    }
    expect(calls).toEqual([]); expect(repository.runAtomic).not.toHaveBeenCalled();
  });
  it('NO existe verificador criptográfico productivo: el verificador por omisión deniega en ambos entornos y la envoltura exige el entorno exacto', async () => {
    for (const env of ENVS) { expect(await denyAllEvidenceVerifier.verify(evidence, { environment: env })).toBeNull(); expect(guardEvidenceVerifier(null, { environment: env })).toBe(denyAllEvidenceVerifier); }
    const inner = { verify: vi.fn(async (_e: Uint8Array, c: { environment: Environment }) => assertionOf(c.environment)) };
    const guardedProd = guardEvidenceVerifier(inner, { environment: 'production' });
    expect(await guardedProd.verify(evidence, { environment: 'sandbox' })).toBeNull(); expect(inner.verify).not.toHaveBeenCalled();   // entorno distinto: ni se consulta
    expect(await guardedProd.verify(evidence, { environment: 'production' })).toMatchObject({ environment: 'production' });
    const liar = guardEvidenceVerifier({ verify: async () => assertionOf('sandbox') }, { environment: 'production' }); expect(await liar.verify(evidence, { environment: 'production' })).toBeNull();   // aserción de otro entorno nunca se entrega
    const liar2 = guardEvidenceVerifier({ verify: async () => assertionOf('production') }, { environment: 'sandbox' }); expect(await liar2.verify(evidence, { environment: 'sandbox' })).toBeNull();
    for (const bad of [null, '', 'staging', 7]) expect(() => guardEvidenceVerifier(inner, { environment: bad as never })).toThrow();
  });
  it('la conformidad del verificador se prueba en cada entorno y con entornos inválidos falla cerrada', async () => {
    for (const environment of ENVS) expect((await runPortConformance({ verifier: denyAllEvidenceVerifier }, { required: ['verifier'], environment })).conformant, environment).toBe(true);
    for (const environment of ENVS) expect((await runPortConformance({ verifier: { verify: async () => ({ ok: true }) } }, { required: ['verifier'], environment })).conformant).toBe(false);
    await expect(runPortConformance({ verifier: denyAllEvidenceVerifier }, { required: ['verifier'], environment: 'staging' as never })).rejects.toThrow();
  });
  it('el registro oficial de proveedores KMS sigue VACÍO y congelado', () => { expect(Object.keys(REVIEWED_KMS_ADAPTERS)).toEqual([]); expect(Object.isFrozen(REVIEWED_KMS_ADAPTERS)).toBe(true); });
  it('la configuración del runtime parsea production pero NO lo autoriza: instalar con todo ratificado y puertos completos deja el handler en null y los endpoints en 503 DISABLED', async () => {
    const env = { PRICESMART_RUNTIME_MODE: 'ENABLED', PRICESMART_RUNTIME_ACK: ENABLE_ACK, PRICESMART_RUNTIME_ENVIRONMENT: 'production', PRICESMART_ORIGIN_CLUB: 'Club-A', PRICESMART_DB_SCHEMA: 'schema_x', PRICESMART_DB_RUNTIME_USER: 'user_x', PRICESMART_RATIFIED_DECISIONS: 'D02,D06,D08,D09,D12' };
    const parsed = parseRuntimeConfig(env); expect(parsed.ok && parsed.config.environment === 'production').toBe(true); expect(parseRuntimeConfig({ ...env, PRICESMART_RUNTIME_ENVIRONMENT: 'staging' }).ok).toBe(false);
    const f = engine('production'); const ports: RuntimePorts = { evidence: { extract: async () => evidence }, security: { ...f.ports, clock: f.ports.clock }, repository: fakeRepository().repository as never, probes: { ok: async () => true }, killSwitch: () => false };
    const readiness = await evaluateReadiness(env, ports); expect(readiness.ready).toBe(false); expect(readiness.blockers.map(b => b.code)).toContain('PRODUCTION_ENVIRONMENT_NOT_AUTHORIZED');
    const report = await installControlledRuntime(env, ports); expect(report.ready).toBe(false); expect(isPriceSmartHandlerInstalled()).toBe(false);
    const res = await handlePriceSmart(new Request('https://x.test/api/integrations/pricesmart/v1/orders/A1')); expect(res.status).toBe(503); expect((await res.json()).code).toBe('DISABLED');
  });
  it('banderas y variables de entorno accidentales (producción, modo habilitado, laboratorio) no activan los endpoints: siguen 503 DISABLED', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NOVALVION_ENV', 'production'); vi.stubEnv('PRICESMART_RUNTIME_MODE', 'ENABLED'); vi.stubEnv('PRICESMART_RUNTIME_ENVIRONMENT', 'production'); vi.stubEnv('PRICESMART_RUNTIME_ACK', ENABLE_ACK); vi.stubEnv('PRICESMART_LAB_DEMO', 'SINTETICO-LOCAL-SIN-PRODUCCION');
    for (const [url, method] of [['https://x.test/api/integrations/pricesmart/v1/orders', 'POST'], ['https://x.test/api/integrations/pricesmart/v1/orders/A1', 'GET'], ['https://x.test/api/integrations/pricesmart/v1/orders/A1/cancellation-requests', 'POST']] as const) {
      const res = await handlePriceSmart(new Request(url, { method, body: method === 'POST' ? '{}' : undefined })); expect(res.status, url).toBe(503); expect((await res.json()).code).toBe('DISABLED');
    }
    expect(isPriceSmartHandlerInstalled()).toBe(false);
    const r = buildReadinessDiagnostic({ PRICESMART_RUNTIME_MODE: 'ENABLED', PRICESMART_RUNTIME_ENVIRONMENT: 'production' }, { handlerInstalled: false, labActive: false }); expect(r.ready).toBe(false); expect(r.blockers).toContain('PRODUCTION_ENVIRONMENT_NOT_AUTHORIZED');
  });
  it('INVENTARIO DE GUARDAS: ninguna guarda sandbox de persistencia fue eliminada o relajada (siguen presentes en cada puerto de laboratorio)', () => {
    const src = (f: string) => readFileSync(path.join(__dirname, f), 'utf8');
    for (const f of ['mariadb-repository.ts', 'security-mariadb.ts', 'outbox-mariadb.ts', 'adaptation-mariadb.ts', 'source-order-mariadb.ts']) { const t = src(f); expect(t, f).toContain('isSandboxVerifiedPool'); expect(t, f).toMatch(/sandbox_api02_\[a-z0-9_\]\+/); }
    expect(src('mariadb-repository.ts')).toContain("scope.environment !== 'sandbox'");   // el repositorio rechaza cualquier ámbito que no sea sandbox
    expect(src('mariadb-repository.ts')).toContain("config.environment !== undefined && config.environment !== 'sandbox'"); expect(src('security-mariadb.ts')).toContain("config.environment !== undefined && config.environment !== 'sandbox'");
    expect(src('outbox.ts')).toContain("environment: z.literal('sandbox')"); expect(src('tms-adaptation-contracts.ts')).toContain("environment:z.literal('sandbox')");   // outbox y adaptación al TMS siguen sandbox-only
  });
  it('ningún módulo productivo de PriceSmart lee process.env ni instala handlers por el entorno (la activación solo existe como API explícita sin llamadores)', () => {
    const root = path.resolve(__dirname, '../../..'); const hits: string[] = [];
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !n.includes('.test.') && /process\.env/.test(readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')) && f.includes(path.join('lib', 'integrations', 'pricesmart'))) hits.push(path.relative(root, f)); } };
    walk(root); expect(hits.filter(h => !/lab-demo|readiness-diagnostic/.test(h))).toEqual([]);
  }, 30000);
});
