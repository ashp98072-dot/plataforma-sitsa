import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PayloadCipher } from './mariadb-repository';
import type { AtomicCounterPort, AtomicReplayPort, EvidenceVerifier, IntegrationCatalog, TrustedClock } from './security-contracts';
import { createInProcessIdentityAuthority, issueAttestation, type CompositionDescriptor } from './conformance-attestation';
import { runCompositionPreflight, type CompositionPreflightInput, type CompositionPreflightReport } from './composition-preflight';
import { REVIEWED_KMS_ADAPTERS, type KmsAdapterRegistry } from './kms-provider-selection';
import type { KmsClient } from './kms-config';
import type { PreflightDatabase } from './production-preflight';
import { buildAccountGrantPlan } from './account-plans';
import { buildReadinessDiagnostic } from './readiness-diagnostic';
import { isPriceSmartHandlerInstalled } from './runtime-state';
import type { PortName } from './port-conformance';

const KEY = randomBytes(32); const AUTH = randomBytes(32); const LAB_AUTH = randomBytes(32); const S = 'prod_pricesmart';
const env = (over: Record<string, string | undefined> = {}) => ({
  PRICESMART_COMPOSITION_TARGET: 'PRODUCTION', PRICESMART_KMS_TARGET: 'PRODUCTION', PRICESMART_KMS_CURRENT_ALIAS: 'prod.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'prod.k1', PRICESMART_KMS_PROVIDER: 'proveedor-aprobado', PRICESMART_KMS_SERVICE_IDENTITY: 'identidad-ps',
  PRICESMART_DB_HOST: 'db.interno.example', PRICESMART_DB_PORT: '3306', PRICESMART_DB_SCHEMA: S, PRICESMART_DB_RUNTIME_USER: 'ps_runtime', PRICESMART_DB_RUNTIME_HOST: 'localhost',
  PRICESMART_DB_REGISTRY_WRITER_USER: 'ps_registry', PRICESMART_DB_REGISTRY_WRITER_HOST: 'localhost', PRICESMART_DB_MIGRATION_USER: 'ps_migrator', PRICESMART_DB_MIGRATION_HOST: 'localhost', ...over });
const goodKms = (): KmsClient => ({ encrypt: async () => new Uint8Array(1), decrypt: async () => new Uint8Array(32), health: async () => true });
const approved = (targets: ('LAB' | 'PRODUCTION')[] = ['PRODUCTION'], client: () => KmsClient = goodKms): KmsAdapterRegistry => ({ 'proveedor-aprobado': { targets, create: () => client() } });
const session = (user: string, role: 'runtime' | 'registryWriter' | 'migration', over: Partial<PreflightDatabase> & { account?: string; lines?: string[] } = {}): PreflightDatabase => ({
  identity: async () => ({ db: S, account: over.account ?? `${user}@localhost` }), grants: async () => over.lines ?? buildAccountGrantPlan(role, { schema: S, user, host: 'localhost' }), ...(over.identity ? { identity: over.identity } : {}), ...(over.grants ? { grants: over.grants } : {}) });
const databases = (over: Partial<CompositionPreflightInput['databases']> = {}) => ({ runtime: session('ps_runtime', 'runtime'), registryWriter: session('ps_registry', 'registryWriter'), migration: session('ps_migrator', 'migration'), ...over });

function cipher(): PayloadCipher { const k = randomBytes(32); return {
  async seal(i, c) { const iv = randomBytes(12); const x = createCipheriv('aes-256-gcm', k, iv); x.setAAD(Buffer.from(c)); const b = Buffer.concat([x.update(JSON.stringify(i)), x.final()]); return { ciphertext: Buffer.concat([iv, x.getAuthTag(), b]), keyReference: 'k' }; },
  async open(buf, r, c) { if (r !== 'k') throw new Error('x'); const d = createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12)); d.setAAD(Buffer.from(c)); d.setAuthTag(buf.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString()); } }; }
class Counter implements AtomicCounterPort { private m = new Map<string, { used: number; resetAtMs: number }>(); async consume({ identityKey, limit, windowMs, nowMs }: Parameters<AtomicCounterPort['consume']>[0]) { let w = this.m.get(identityKey); if (!w || nowMs >= w.resetAtMs) w = { used: 0, resetAtMs: nowMs + windowMs }; const allowed = w.used < limit; if (allowed) w = { ...w, used: w.used + 1 }; this.m.set(identityKey, w); return { allowed, used: w.used, resetAtMs: w.resetAtMs, assurance: 'DISTRIBUTED_ATOMIC' as const }; } }
class Replay implements AtomicReplayPort { private m = new Map<string, string>(); async claim({ identityKey, proofId, bindingDigest }: Parameters<AtomicReplayPort['claim']>[0]) { const k = `${identityKey}|${proofId}`; const s = this.m.get(k); if (s === undefined) { this.m.set(k, bindingDigest); return { status: 'CLAIMED' as const, assurance: 'DURABLE_ATOMIC' as const }; } return { status: s === bindingDigest ? ('REUSED' as const) : ('COLLISION' as const), assurance: 'DURABLE_ATOMIC' as const }; } }
const clock = (): TrustedClock => { let last = 0; return { nowMs: () => (last = Math.max(last, Date.now())) }; };
const catalog = (): IntegrationCatalog => ({ findByCredential: async () => [] }); const verifier = (): EvidenceVerifier => ({ verify: async () => null });
async function attestation() {
  const authority = createInProcessIdentityAuthority({ authorityId: 'auth-prod', key: AUTH }); const inst: Record<PortName, object> = { cipher: cipher(), clock: clock(), counter: new Counter(), replay: new Replay(), catalog: catalog(), verifier: verifier() }; const composition: CompositionDescriptor = {};
  for (const [port, instance] of Object.entries(inst) as [PortName, object][]) { composition[port] = { instance, implementationId: `${port}-ref`, version: '1.0.0' }; authority.enroll(instance, port, { resourceId: `${port}-res`, subject: port === 'counter' || port === 'replay' ? 'ISOLATED_COPY' : 'LIVE' }); }
  const trust = { lab: { 'auth-lab': LAB_AUTH }, production: { 'auth-prod': AUTH } };
  const { attestation: att } = await issueAttestation({ composition, target: 'PRODUCTION', key: KEY, nowMs: Date.now(), ttlMs: 600_000, identity: { authority, trusted: trust.production } });
  return { trust, attestation: { composition, attestation: att, key: KEY, authority, clock: { nowMs: () => Date.now() } } };
}
async function input(over: Partial<CompositionPreflightInput> = {}): Promise<CompositionPreflightInput> {
  const a = await attestation(); return { env: env(), adapters: approved(), databases: databases(), trust: a.trust, attestation: a.attestation, ...over };
}
const st = (r: CompositionPreflightReport) => Object.fromEntries(r.checks.map(c => [c.id, c.status + (c.code ? `:${c.code}` : '')]));
const failing = (r: CompositionPreflightReport) => r.checks.filter(c => c.status !== 'PASS').map(c => `${c.id}:${c.code}`);

describe('preflight de composición', () => {
  it('HOY falla cerrado: con el registro REVISADO del repositorio (vacío) no hay proveedor KMS y no pasa ninguna comprobación dependiente', async () => {
    const r = await runCompositionPreflight({ ...(await input()), adapters: REVIEWED_KMS_ADAPTERS });
    expect(r.passed).toBe(false); expect(st(r).KMS_PROVIDER).toBe('FAIL:KMS_PROVIDER_NOT_SELECTED'); expect(st(r).COMPOSITION_CONFIG).toBe('PASS');
    for (const id of ['KMS_HEALTH', 'DB_SESSION_IDENTITY', 'DB_GRANTS', 'ATTESTATION']) expect(st(r)[id], id).toBe('FAIL:BLOCKED_BY_PREVIOUS');
  });
  it('con todo en orden (adaptador aprobado, tres cuentas distintas con privilegios mínimos, atestación) pasa, pero NO autoriza ni cambia el readiness', async () => {
    const r = await runCompositionPreflight(await input()); expect(failing(r)).toEqual([]); expect(r.passed).toBe(true);
    expect(r).toMatchObject({ target: 'PRODUCTION', ready: false, authorizesInstallation: false }); expect(r.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(isPriceSmartHandlerInstalled()).toBe(false); expect(buildReadinessDiagnostic({ PRICESMART_RUNTIME_MODE: 'ENABLED' }, { handlerInstalled: false, labActive: false }).ready).toBe(false);
  });
  it('configuración inválida o mezclada: todo queda bloqueado y se informa COMPOSITION_CONFIG_INVALID', async () => {
    for (const bad of [{}, { PRICESMART_COMPOSITION_TARGET: undefined }, { PRICESMART_LAB_KEY: 'k'.repeat(40) }, { PRICESMART_DB_PASSWORD: 'x' }, { PRICESMART_DB_RUNTIME_HOST: '%' }, { NOVALVION_ENV: 'sandbox' }]) {
      const e = Object.keys(bad).length === 0 ? {} : env(bad as Record<string, string>); const r = await runCompositionPreflight({ ...(await input()), env: e });
      expect(r.passed, JSON.stringify(Object.keys(bad))).toBe(false); expect(st(r).COMPOSITION_CONFIG).toBe('FAIL:COMPOSITION_CONFIG_INVALID'); expect(failing(r).every(x => /COMPOSITION_CONFIG_INVALID|BLOCKED_BY_PREVIOUS/.test(x))).toBe(true);
    }
  });
  it('un adaptador aprobado solo para LAB no sirve para PRODUCCIÓN; sin proveedor o sin identidad de servicio tampoco', async () => {
    expect(st(await runCompositionPreflight({ ...(await input()), adapters: approved(['LAB']) })).KMS_PROVIDER).toBe('FAIL:KMS_PROVIDER_NOT_APPROVED_FOR_TARGET');
    expect(st(await runCompositionPreflight({ ...(await input()), env: env({ PRICESMART_KMS_PROVIDER: undefined }) })).KMS_PROVIDER).toBe('FAIL:KMS_PROVIDER_NOT_SELECTED');
    expect(st(await runCompositionPreflight({ ...(await input()), env: env({ PRICESMART_KMS_SERVICE_IDENTITY: undefined }) })).KMS_PROVIDER).toBe('FAIL:SERVICE_IDENTITY_MISSING');
    expect(st(await runCompositionPreflight({ ...(await input()), env: env({ PRICESMART_KMS_PROVIDER: 'otro' }) })).KMS_PROVIDER).toBe('FAIL:KMS_PROVIDER_UNKNOWN');
    expect(st(await runCompositionPreflight({ ...(await input()), adapters: approved(['PRODUCTION'], () => ({ ...goodKms(), health: async () => false })) })).KMS_HEALTH).toBe('FAIL:KMS_UNHEALTHY');
  });
  it('privilegios y sesiones de las TRES cuentas: exceso, faltantes, host o usuario distinto y esquema ajeno se rechazan', async () => {
    const plan = (role: 'runtime' | 'registryWriter' | 'migration', user: string) => buildAccountGrantPlan(role, { schema: S, user, host: 'localhost' });
    const cases: [string, Partial<CompositionPreflightInput['databases']>, string][] = [
      ['DB_GRANTS', { runtime: session('ps_runtime', 'runtime', { lines: [...plan('runtime', 'ps_runtime'), 'GRANT DELETE ON `prod_pricesmart`.`ps_api11_proof_claims` TO `ps_runtime`@`localhost`'] }) }, 'FAIL:EXCESS_PRIVILEGE'],
      ['DB_GRANTS', { runtime: session('ps_runtime', 'runtime', { lines: plan('registryWriter', 'ps_runtime') }) }, 'FAIL:EXCESS_PRIVILEGE'],
      ['ACCOUNT_REGISTRY_WRITER_GRANTS', { registryWriter: session('ps_registry', 'registryWriter', { lines: [...plan('registryWriter', 'ps_registry'), 'GRANT DELETE ON `prod_pricesmart`.`ps_api18_resource_registry` TO `ps_registry`@`localhost`'] }) }, 'FAIL:EXCESS_PRIVILEGE'],
      ['ACCOUNT_REGISTRY_WRITER_GRANTS', { registryWriter: session('ps_registry', 'registryWriter', { lines: plan('runtime', 'ps_registry') }) }, 'FAIL:UNKNOWN_TABLE'],
      ['ACCOUNT_REGISTRY_WRITER_GRANTS', { registryWriter: session('ps_registry', 'registryWriter', { lines: plan('registryWriter', 'ps_registry').slice(0, 1) }) }, 'FAIL:MISSING_PRIVILEGE'],
      ['ACCOUNT_MIGRATION_GRANTS', { migration: session('ps_migrator', 'migration', { lines: [...plan('migration', 'ps_migrator'), 'GRANT SELECT ON `prod_pricesmart`.* TO `ps_migrator`@`localhost`'] }) }, 'FAIL:SCHEMA_WIDE'],
      ['ACCOUNT_MIGRATION_GRANTS', { migration: session('ps_migrator', 'migration', { lines: [...plan('migration', 'ps_migrator'), 'GRANT ALL PRIVILEGES ON *.* TO `ps_migrator`@`localhost`'] }) }, 'FAIL:GLOBAL_PRIVILEGE'],
      ['ACCOUNT_MIGRATION_GRANTS', { migration: session('ps_migrator', 'migration', { lines: plan('runtime', 'ps_migrator') }) }, 'FAIL:UNKNOWN_TABLE'],
      ['ACCOUNT_REGISTRY_WRITER_SESSION', { registryWriter: session('ps_registry', 'registryWriter', { account: 'ps_registry@10.0.0.5' }) }, 'FAIL:SESSION_IDENTITY_MISMATCH'],
      ['ACCOUNT_REGISTRY_WRITER_SESSION', { registryWriter: session('ps_registry', 'registryWriter', { account: 'ps_registry@%' }) }, 'FAIL:SESSION_IDENTITY_MISMATCH'],
      ['ACCOUNT_MIGRATION_SESSION', { migration: session('ps_migrator', 'migration', { account: 'ps_runtime@localhost' }) }, 'FAIL:SESSION_IDENTITY_MISMATCH'],
      ['DB_SESSION_IDENTITY', { runtime: session('ps_runtime', 'runtime', { account: 'ps_migrator@localhost' }) }, 'FAIL:SESSION_IDENTITY_MISMATCH'],
    ];
    for (const [id, over, expected] of cases) { const r = await runCompositionPreflight({ ...(await input()), databases: databases(over) }); expect(st(r)[id], `${id} ${expected}`).toBe(expected); expect(r.passed).toBe(false); }
  });
  it('las tres sesiones deben ser cuentas efectivas DISTINTAS: la misma cuenta usada en dos roles falla aunque sus privilegios fueran válidos', async () => {
    const same = session('ps_runtime', 'runtime'); const r = await runCompositionPreflight({ ...(await input()), databases: databases({ registryWriter: session('ps_registry', 'registryWriter', { account: 'ps_runtime@localhost' }) }) });
    expect(st(r).ACCOUNTS_DISTINCT).toBe('FAIL:ACCOUNTS_NOT_DISTINCT'); void same;
    const r2 = await runCompositionPreflight({ ...(await input()), databases: databases({ migration: session('ps_migrator', 'migration', { account: 'PS_RUNTIME@LOCALHOST' }) }) }); expect(st(r2).ACCOUNTS_DISTINCT).toBe('FAIL:ACCOUNTS_NOT_DISTINCT');
  });
  it('una atestación inválida o ausente impide el pase; las excepciones de las dependencias son fallos cerrados sin detalles', async () => {
    expect((await runCompositionPreflight({ ...(await input()), attestation: undefined })).passed).toBe(false);
    const boom = async () => { throw new Error('secreto-db-9'); };
    const r = await runCompositionPreflight({ ...(await input()), databases: databases({ registryWriter: session('ps_registry', 'registryWriter', { identity: boom, grants: boom }) }) });
    expect(st(r).ACCOUNT_REGISTRY_WRITER_SESSION).toBe('FAIL:UNAVAILABLE'); expect(st(r).ACCOUNT_REGISTRY_WRITER_GRANTS).toBe('FAIL:UNAVAILABLE'); expect(JSON.stringify(r)).not.toContain('secreto');
    expect((await runCompositionPreflight(null as never)).passed).toBe(false);
  });
  it('el informe no contiene valores (alias, esquema, cuentas, hosts, claves) y su resumen es determinista', async () => {
    const i = await input(); const [a, b] = [await runCompositionPreflight(i), await runCompositionPreflight(i)]; const text = JSON.stringify(a);
    for (const v of ['prod.k1', S, 'ps_runtime', 'ps_registry', 'ps_migrator', 'localhost', 'db.interno.example', 'identidad-ps', 'proveedor-aprobado', KEY.toString('hex'), AUTH.toString('hex'), '@']) expect(text).not.toContain(v);
    expect(a.digest).toBe(b.digest); expect((await runCompositionPreflight({ ...i, adapters: REVIEWED_KMS_ADAPTERS })).digest).not.toBe(a.digest);
  });
  it('un preflight de PRODUCCIÓN no pasa con recursos, alias ni cuentas de laboratorio', async () => {
    const labEnv = env({ PRICESMART_COMPOSITION_TARGET: 'LAB' }); const r = await runCompositionPreflight({ ...(await input()), env: labEnv }); expect(r.passed).toBe(false);
    expect(r.target).toBe('LAB'); expect(st(r).COMPOSITION_CONFIG).toBe('FAIL:COMPOSITION_CONFIG_INVALID');
  });
});

describe('diagnóstico de readiness (API-15) tras API-21: fallos cerrados', () => {
  const diag = (e: Record<string, string | undefined>) => buildReadinessDiagnostic(e, { handlerInstalled: false, labActive: false });
  it('KMS_PROVIDER_NOT_SELECTED aparece siempre mientras el registro revisado esté vacío; ready=false y ningún puerto OK', () => {
    for (const e of [{}, env(), env({ PRICESMART_KMS_PROVIDER: 'proveedor-aprobado' })]) { const r = diag(e); expect(r.blockers).toContain('KMS_PROVIDER_NOT_SELECTED'); expect(r.ready).toBe(false); expect(r.checks.some(c => c.id.startsWith('PORT:') && c.status === 'OK')).toBe(false); }
  });
  it('sin configuración de composición: MISSING; con configuración válida: solo INFO (nunca OK); inválida o mezclada: bloqueo COMPOSITION_CONFIG_INVALID', () => {
    expect(diag({}).checks.find(c => c.id === 'COMPOSITION_CONFIG')?.status).toBe('MISSING');
    const ok = diag(env()); expect(ok.checks.find(c => c.id === 'COMPOSITION_CONFIG')?.status).toBe('INFO'); expect(ok.blockers).not.toContain('COMPOSITION_CONFIG_INVALID');
    for (const bad of [{ PRICESMART_DB_RUNTIME_HOST: '%' }, { PRICESMART_LAB_KEY: 'k'.repeat(40) }, { PRICESMART_DB_PASSWORD: 'x' }, { PRICESMART_COMPOSITION_TARGET: 'LAB' }]) expect(diag(env(bad)).blockers, JSON.stringify(Object.keys(bad))).toContain('COMPOSITION_CONFIG_INVALID');
    expect(diag({ PRICESMART_KMS_PROVIDER: 'x' }).blockers).toContain('COMPOSITION_CONFIG_INVALID');   // una configuración parcial también falla cerrada
  });
  it('el diagnóstico no revela valores de la configuración de composición', () => {
    const text = JSON.stringify(diag(env({ PRICESMART_DB_RUNTIME_HOST: '10.77.%' }))); for (const v of ['ps_runtime', 'db.interno.example', 'identidad-ps', '10.77.%', 'prod.k1', 'proveedor-aprobado']) expect(text).not.toContain(v);
  });
});

describe('aislamiento estático', () => {
  const strip = (f: string) => readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '');
  it('los módulos nuevos no leen el entorno, no usan red/archivos/base de datos propios ni instalan handlers', () => {
    for (const f of ['kms-config.ts', 'kms-provider-selection.ts', 'composition-config.ts', 'account-plans.ts', 'composition-preflight.ts']) { const t = strip(f); expect(t, f).not.toMatch(/process\.env|\bfetch\s*\(|from\s+['"](?:mysql2|@\/lib\/(?:db|tms)|node:(?:net|tls|http|https|fs|child_process))|sandbox-db/); expect(t, f).not.toContain(['install', 'PriceSmartHandler'].join('')); expect(t, f).not.toMatch(/from '\.\/runtime(?:-assembly)?'/); }
  });
  it('ninguna ruta ni módulo de la aplicación importa los módulos de composición (salvo el diagnóstico, que solo usa los puros)', () => {
    const root = path.resolve(__dirname, '../../..'); const hits: string[] = []; const names = ['composition-preflight', 'account-plans', 'kms-provider-selection', 'composition-config', 'kms-config'];
    const allowed = ['readiness-diagnostic.ts', 'composition-', 'account-plans', 'kms-', 'production-preflight', 'grants-audit'];
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !n.includes('.test.') && !allowed.some(a => n.startsWith(a))) { const t = readFileSync(f, 'utf8'); if (names.some(x => t.includes(`/${x}'`) || t.includes(`/${x}"`))) hits.push(path.relative(root, f)); } } };
    walk(root); expect(hits).toEqual([]);
    for (const f of ['readiness-diagnostic.ts']) { const t = strip(f); expect(t).not.toMatch(/composition-preflight|account-plans/); }
  }, 30000);
});
