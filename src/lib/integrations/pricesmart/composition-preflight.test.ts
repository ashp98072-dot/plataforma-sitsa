import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PayloadCipher } from './mariadb-repository';
import type { AtomicCounterPort, AtomicReplayPort, EvidenceVerifier, IntegrationCatalog, TrustedClock } from './security-contracts';
import { createInProcessIdentityAuthority, issueAttestation, type AttestationTarget, type CompositionDescriptor } from './conformance-attestation';
import { runCompositionPreflight, type CompositionPreflightInput, type CompositionPreflightReport } from './composition-preflight';
import { REVIEWED_KMS_ADAPTERS, isReviewedForTarget, sanitizeLabAdapters, type KmsAdapterRegistry } from './kms-provider-selection';
import { parseKmsConfig, type KmsClient } from './kms-config';
import { runProductionPreflight, type PreflightDatabase } from './production-preflight';
import { buildAccountGrantPlan } from './account-plans';
import { buildReadinessDiagnostic } from './readiness-diagnostic';
import { isPriceSmartHandlerInstalled } from './runtime-state';
import type { PortName } from './port-conformance';

const KEY = randomBytes(32); const AUTH = randomBytes(32); const OTHER_AUTH = randomBytes(32);
type Dest = { target: AttestationTarget; schema: string; host: string; run: string; reg: string; mig: string; alias: string; provider: string };
const LAB: Dest = { target: 'LAB', schema: 'sandbox_api02_x', host: '127.0.0.1', run: 'sandbox_api02_run', reg: 'sandbox_api02_reg', mig: 'sandbox_api02_mig', alias: 'lab.k1', provider: 'proveedor-lab' };
const PROD: Dest = { target: 'PRODUCTION', schema: 'prod_pricesmart', host: 'localhost', run: 'ps_runtime', reg: 'ps_registry', mig: 'ps_migrator', alias: 'prod.k1', provider: 'proveedor-aprobado' };
const env = (d: Dest, over: Record<string, string | undefined> = {}) => ({
  PRICESMART_COMPOSITION_TARGET: d.target, PRICESMART_KMS_TARGET: d.target, PRICESMART_KMS_CURRENT_ALIAS: d.alias, PRICESMART_KMS_ALLOWED_ALIASES: d.alias, PRICESMART_KMS_PROVIDER: d.provider, PRICESMART_KMS_SERVICE_IDENTITY: 'identidad-ps',
  PRICESMART_DB_HOST: d.target === 'LAB' ? '127.0.0.1' : 'db.interno.example', PRICESMART_DB_PORT: d.target === 'LAB' ? '3307' : '3306', PRICESMART_DB_SCHEMA: d.schema,
  PRICESMART_DB_RUNTIME_USER: d.run, PRICESMART_DB_RUNTIME_HOST: d.host, PRICESMART_DB_REGISTRY_WRITER_USER: d.reg, PRICESMART_DB_REGISTRY_WRITER_HOST: d.host, PRICESMART_DB_MIGRATION_USER: d.mig, PRICESMART_DB_MIGRATION_HOST: d.host, ...over });
const goodKms = (): KmsClient => ({ encrypt: async () => new Uint8Array(1), decrypt: async () => new Uint8Array(32), health: async () => true });
const registry = (d: Dest, targets: ('LAB' | 'PRODUCTION')[], client: () => KmsClient = goodKms): KmsAdapterRegistry => ({ [d.provider]: { targets, create: () => client() } });
const session = (d: Dest, user: string, role: 'runtime' | 'registryWriter' | 'migration', over: Partial<PreflightDatabase> & { account?: string; lines?: string[]; db?: string } = {}): PreflightDatabase => ({
  identity: over.identity ?? (async () => ({ db: over.db ?? d.schema, account: over.account ?? `${user}@${d.host}` })), grants: over.grants ?? (async () => over.lines ?? buildAccountGrantPlan(role, { schema: d.schema, user, host: d.host })) });
const databases = (d: Dest, over: Partial<CompositionPreflightInput['databases']> = {}) => ({ runtime: session(d, d.run, 'runtime'), registryWriter: session(d, d.reg, 'registryWriter'), migration: session(d, d.mig, 'migration'), ...over });

function cipher(): PayloadCipher { const k = randomBytes(32); return {
  async seal(i, c) { const iv = randomBytes(12); const x = createCipheriv('aes-256-gcm', k, iv); x.setAAD(Buffer.from(c)); const b = Buffer.concat([x.update(JSON.stringify(i)), x.final()]); return { ciphertext: Buffer.concat([iv, x.getAuthTag(), b]), keyReference: 'k' }; },
  async open(buf, r, c) { if (r !== 'k') throw new Error('x'); const d = createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12)); d.setAAD(Buffer.from(c)); d.setAuthTag(buf.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString()); } }; }
class Counter implements AtomicCounterPort { private m = new Map<string, { used: number; resetAtMs: number }>(); async consume({ identityKey, limit, windowMs, nowMs }: Parameters<AtomicCounterPort['consume']>[0]) { let w = this.m.get(identityKey); if (!w || nowMs >= w.resetAtMs) w = { used: 0, resetAtMs: nowMs + windowMs }; const allowed = w.used < limit; if (allowed) w = { ...w, used: w.used + 1 }; this.m.set(identityKey, w); return { allowed, used: w.used, resetAtMs: w.resetAtMs, assurance: 'DISTRIBUTED_ATOMIC' as const }; } }
class Replay implements AtomicReplayPort { private m = new Map<string, string>(); async claim({ identityKey, proofId, bindingDigest }: Parameters<AtomicReplayPort['claim']>[0]) { const k = `${identityKey}|${proofId}`; const s = this.m.get(k); if (s === undefined) { this.m.set(k, bindingDigest); return { status: 'CLAIMED' as const, assurance: 'DURABLE_ATOMIC' as const }; } return { status: s === bindingDigest ? ('REUSED' as const) : ('COLLISION' as const), assurance: 'DURABLE_ATOMIC' as const }; } }
const clock = (): TrustedClock => { let last = 0; return { nowMs: () => (last = Math.max(last, Date.now())) }; };
const catalog = (): IntegrationCatalog => ({ findByCredential: async () => [] }); const verifier = (): EvidenceVerifier => ({ verify: async () => null });
async function attestation(d: Dest) {
  const id = d.target === 'LAB' ? 'auth-lab' : 'auth-prod'; const authority = createInProcessIdentityAuthority({ authorityId: id, key: AUTH });
  const inst: Record<PortName, object> = { cipher: cipher(), clock: clock(), counter: new Counter(), replay: new Replay(), catalog: catalog(), verifier: verifier() }; const composition: CompositionDescriptor = {};
  for (const [port, instance] of Object.entries(inst) as [PortName, object][]) { composition[port] = { instance, implementationId: `${port}-ref`, version: '1.0.0' }; authority.enroll(instance, port, { resourceId: `${port}-res`, subject: port === 'counter' || port === 'replay' ? 'ISOLATED_COPY' : 'LIVE' }); }
  const trust = d.target === 'LAB' ? { lab: { [id]: AUTH }, production: { 'auth-prod': OTHER_AUTH } } : { lab: { 'auth-lab': OTHER_AUTH }, production: { [id]: AUTH } };
  const { attestation: att } = await issueAttestation({ composition, target: d.target, key: KEY, nowMs: Date.now(), ttlMs: 600_000, identity: { authority, trusted: d.target === 'LAB' ? trust.lab : trust.production } });
  return { trust, attestation: { composition, attestation: att, key: KEY, authority, clock: { nowMs: () => Date.now() } } };
}
/** Entrada completa y válida para el destino; en LAB lleva un adaptador sintético aprobado SOLO para LAB. */
async function input(d: Dest, over: Partial<CompositionPreflightInput> = {}): Promise<CompositionPreflightInput> {
  const a = await attestation(d); return { env: env(d), ...(d.target === 'LAB' ? { labAdapters: registry(d, ['LAB']) } : {}), databases: databases(d), trust: a.trust, attestation: a.attestation, ...over };
}
const st = (r: CompositionPreflightReport) => Object.fromEntries(r.checks.map(c => [c.id, c.status + (c.code ? `:${c.code}` : '')]));
const failing = (r: CompositionPreflightReport) => r.checks.filter(c => c.status !== 'PASS').map(c => `${c.id}:${c.code}`);

describe('preflight de composición — ruta positiva SOLO en laboratorio (adaptador sintético aislado)', () => {
  it('con todo en orden en LAB pasa, pero NO autoriza ni cambia el readiness', async () => {
    const r = await runCompositionPreflight(await input(LAB)); expect(failing(r)).toEqual([]); expect(r.passed).toBe(true);
    expect(r).toMatchObject({ target: 'LAB', ready: false, authorizesInstallation: false }); expect(r.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(isPriceSmartHandlerInstalled()).toBe(false); expect(buildReadinessDiagnostic({ PRICESMART_RUNTIME_MODE: 'ENABLED' }, { handlerInstalled: false, labActive: false }).ready).toBe(false);
  });
  it('sin adaptadores sintéticos solo existe el registro oficial (vacío): también falla cerrado en LAB', async () => {
    const r = await runCompositionPreflight({ ...(await input(LAB)), labAdapters: undefined }); expect(r.passed).toBe(false); expect(st(r).KMS_PROVIDER).toBe('FAIL:KMS_PROVIDER_NOT_SELECTED');
    for (const id of ['KMS_HEALTH', 'DB_SESSION_IDENTITY', 'DB_GRANTS', 'ATTESTATION']) expect(st(r)[id], id).toBe('FAIL:BLOCKED_BY_PREVIOUS');
  });
  it('configuración inválida o mezclada: todo queda bloqueado y se informa COMPOSITION_CONFIG_INVALID', async () => {
    for (const bad of [{}, { PRICESMART_COMPOSITION_TARGET: undefined }, { NODE_ENV: 'production' }, { PRICESMART_DB_PASSWORD: 'x' }, { PRICESMART_DB_RUNTIME_HOST: '%' }, { PRICESMART_KMS_TARGET: 'PRODUCTION' }]) {
      const e = Object.keys(bad).length === 0 ? {} : env(LAB, bad as Record<string, string>); const r = await runCompositionPreflight({ ...(await input(LAB)), env: e });
      expect(r.passed, JSON.stringify(Object.keys(bad))).toBe(false); expect(st(r).COMPOSITION_CONFIG).toBe('FAIL:COMPOSITION_CONFIG_INVALID'); expect(failing(r).every(x => /COMPOSITION_CONFIG_INVALID|BLOCKED_BY_PREVIOUS/.test(x))).toBe(true);
    }
  });
  it('proveedor sin identidad de servicio, desconocido o sin salud: se rechaza', async () => {
    expect(st(await runCompositionPreflight({ ...(await input(LAB)), env: env(LAB, { PRICESMART_KMS_PROVIDER: undefined }) })).KMS_PROVIDER).toBe('FAIL:KMS_PROVIDER_NOT_SELECTED');
    expect(st(await runCompositionPreflight({ ...(await input(LAB)), env: env(LAB, { PRICESMART_KMS_SERVICE_IDENTITY: undefined }) })).KMS_PROVIDER).toBe('FAIL:SERVICE_IDENTITY_MISSING');
    expect(st(await runCompositionPreflight({ ...(await input(LAB)), env: env(LAB, { PRICESMART_KMS_PROVIDER: 'otro' }) })).KMS_PROVIDER).toBe('FAIL:KMS_PROVIDER_UNKNOWN');
    expect(st(await runCompositionPreflight({ ...(await input(LAB)), labAdapters: registry(LAB, ['LAB'], () => ({ ...goodKms(), health: async () => false })) })).KMS_HEALTH).toBe('FAIL:KMS_UNHEALTHY');
  });
  it('privilegios y sesiones de las TRES cuentas: exceso, faltantes, host o usuario distinto se rechazan', async () => {
    const plan = (role: 'runtime' | 'registryWriter' | 'migration', user: string) => buildAccountGrantPlan(role, { schema: LAB.schema, user, host: LAB.host }); const to = (u: string) => `\`${u}\`@\`${LAB.host}\``;
    const cases: [string, Partial<CompositionPreflightInput['databases']>, string][] = [
      ['DB_GRANTS', { runtime: session(LAB, LAB.run, 'runtime', { lines: [...plan('runtime', LAB.run), `GRANT DELETE ON \`${LAB.schema}\`.\`ps_api11_proof_claims\` TO ${to(LAB.run)}`] }) }, 'FAIL:EXCESS_PRIVILEGE'],
      ['DB_GRANTS', { runtime: session(LAB, LAB.run, 'runtime', { lines: plan('registryWriter', LAB.run) }) }, 'FAIL:EXCESS_PRIVILEGE'],
      ['ACCOUNT_REGISTRY_WRITER_GRANTS', { registryWriter: session(LAB, LAB.reg, 'registryWriter', { lines: [...plan('registryWriter', LAB.reg), `GRANT DELETE ON \`${LAB.schema}\`.\`ps_api18_resource_registry\` TO ${to(LAB.reg)}`] }) }, 'FAIL:EXCESS_PRIVILEGE'],
      ['ACCOUNT_REGISTRY_WRITER_GRANTS', { registryWriter: session(LAB, LAB.reg, 'registryWriter', { lines: plan('runtime', LAB.reg) }) }, 'FAIL:UNKNOWN_TABLE'],
      ['ACCOUNT_REGISTRY_WRITER_GRANTS', { registryWriter: session(LAB, LAB.reg, 'registryWriter', { lines: plan('registryWriter', LAB.reg).slice(0, 1) }) }, 'FAIL:MISSING_PRIVILEGE'],
      ['ACCOUNT_MIGRATION_GRANTS', { migration: session(LAB, LAB.mig, 'migration', { lines: [...plan('migration', LAB.mig), `GRANT SELECT ON \`${LAB.schema}\`.* TO ${to(LAB.mig)}`] }) }, 'FAIL:SCHEMA_WIDE'],
      ['ACCOUNT_MIGRATION_GRANTS', { migration: session(LAB, LAB.mig, 'migration', { lines: [...plan('migration', LAB.mig), `GRANT ALL PRIVILEGES ON *.* TO ${to(LAB.mig)}`] }) }, 'FAIL:GLOBAL_PRIVILEGE'],
      ['ACCOUNT_MIGRATION_GRANTS', { migration: session(LAB, LAB.mig, 'migration', { lines: plan('runtime', LAB.mig) }) }, 'FAIL:UNKNOWN_TABLE'],
      ['ACCOUNT_REGISTRY_WRITER_SESSION', { registryWriter: session(LAB, LAB.reg, 'registryWriter', { account: `${LAB.reg}@10.0.0.5` }) }, 'FAIL:SESSION_IDENTITY_MISMATCH'],
      ['ACCOUNT_REGISTRY_WRITER_SESSION', { registryWriter: session(LAB, LAB.reg, 'registryWriter', { account: `${LAB.reg}@%` }) }, 'FAIL:SESSION_IDENTITY_MISMATCH'],
      ['ACCOUNT_MIGRATION_SESSION', { migration: session(LAB, LAB.mig, 'migration', { account: `${LAB.run}@${LAB.host}` }) }, 'FAIL:SESSION_IDENTITY_MISMATCH'],
      ['ACCOUNT_MIGRATION_SESSION', { migration: session(LAB, LAB.mig, 'migration', { db: 'otra_db' }) }, 'FAIL:SESSION_IDENTITY_MISMATCH'],
      ['DB_SESSION_IDENTITY', { runtime: session(LAB, LAB.run, 'runtime', { account: `${LAB.mig}@${LAB.host}` }) }, 'FAIL:SESSION_IDENTITY_MISMATCH'],
    ];
    for (const [id, over, expected] of cases) { const r = await runCompositionPreflight({ ...(await input(LAB)), databases: databases(LAB, over) }); expect(st(r)[id], `${id} ${expected}`).toBe(expected); expect(r.passed).toBe(false); }
  });
  it('las tres sesiones deben ser cuentas efectivas DISTINTAS, aunque sus privilegios fueran válidos', async () => {
    const r = await runCompositionPreflight({ ...(await input(LAB)), databases: databases(LAB, { registryWriter: session(LAB, LAB.reg, 'registryWriter', { account: `${LAB.run}@${LAB.host}` }) }) }); expect(st(r).ACCOUNTS_DISTINCT).toBe('FAIL:ACCOUNTS_NOT_DISTINCT');
    const r2 = await runCompositionPreflight({ ...(await input(LAB)), databases: databases(LAB, { migration: session(LAB, LAB.mig, 'migration', { account: `${LAB.run.toUpperCase()}@${LAB.host}` }) }) }); expect(st(r2).ACCOUNTS_DISTINCT).toBe('FAIL:ACCOUNTS_NOT_DISTINCT');
  });
  it('una atestación ausente impide el pase; las excepciones de las dependencias son fallos cerrados sin detalles', async () => {
    expect((await runCompositionPreflight({ ...(await input(LAB)), attestation: undefined })).passed).toBe(false);
    const boom = async () => { throw new Error('secreto-db-9'); };
    const r = await runCompositionPreflight({ ...(await input(LAB)), databases: databases(LAB, { registryWriter: session(LAB, LAB.reg, 'registryWriter', { identity: boom, grants: boom }) }) });
    expect(st(r).ACCOUNT_REGISTRY_WRITER_SESSION).toBe('FAIL:UNAVAILABLE'); expect(st(r).ACCOUNT_REGISTRY_WRITER_GRANTS).toBe('FAIL:UNAVAILABLE'); expect(JSON.stringify(r)).not.toContain('secreto');
    expect((await runCompositionPreflight(null as never)).passed).toBe(false);
  });
  it('el informe no contiene valores y su resumen es determinista', async () => {
    const i = await input(LAB); const [a, b] = [await runCompositionPreflight(i), await runCompositionPreflight(i)]; const text = JSON.stringify(a);
    for (const v of ['lab.k1', LAB.schema, LAB.run, LAB.reg, LAB.mig, '127.0.0.1', 'identidad-ps', LAB.provider, KEY.toString('hex'), AUTH.toString('hex'), '@']) expect(text).not.toContain(v);
    expect(a.digest).toBe(b.digest); expect((await runCompositionPreflight({ ...i, labAdapters: undefined })).digest).not.toBe(a.digest);
  });
});

describe('PRODUCCIÓN: ningún registro inyectado por el llamador puede aprobarla (auditoría de #615)', () => {
  const claimsProd = (d: Dest): KmsAdapterRegistry => registry(d, ['LAB', 'PRODUCTION']);
  const expectClosed = (r: CompositionPreflightReport) => { expect(r.passed).toBe(false); expect(r.ready).toBe(false); expect(r.authorizesInstallation).toBe(false); expect(st(r).KMS_PROVIDER).toBe('FAIL:KMS_PROVIDER_NOT_SELECTED'); for (const id of ['KMS_HEALTH', 'DB_SESSION_IDENTITY', 'DB_GRANTS', 'ATTESTATION']) expect(st(r)[id], id).toBe('FAIL:BLOCKED_BY_PREVIOUS'); };
  it('el registro oficial está vacío y con él un preflight de PRODUCCIÓN con todo lo demás válido falla con KMS_PROVIDER_NOT_SELECTED', async () => {
    expect(Object.keys(REVIEWED_KMS_ADAPTERS)).toEqual([]); const r = await runCompositionPreflight(await input(PROD)); expectClosed(r); expect(st(r).COMPOSITION_CONFIG).toBe('PASS');
  });
  it('un registro sintético que se declara aprobado para PRODUCCIÓN, inyectado por cualquier vía, no cambia el resultado (el defecto de la versión anterior)', async () => {
    const forged = claimsProd(PROD); const base = await input(PROD);
    for (const extra of [{ labAdapters: forged }, { adapters: forged }, { labAdapters: forged, adapters: forged }, { labAdapters: registry(PROD, ['PRODUCTION']) }, { adapters: registry(PROD, ['PRODUCTION']) }, { reviewedAdapters: forged }]) {
      const r = await runCompositionPreflight({ ...base, ...extra } as never); expectClosed(r);
    }
  });
  it('trucos de registro (prototipo, getters, proxies, estructuras raras) tampoco aprueban PRODUCCIÓN', async () => {
    const base = await input(PROD); const entry = { targets: ['LAB', 'PRODUCTION'], create: () => goodKms() };
    const proto = Object.create({ [PROD.provider]: entry }); const getter = { get [PROD.provider]() { return entry; } };
    const liar = { [PROD.provider]: { create: () => goodKms(), targets: new Proxy(['LAB'], { get(t, k) { return k === 'includes' ? () => true : Reflect.get(t, k); } }) } };
    for (const labAdapters of [proto, getter, liar, new Proxy({}, { get: () => entry, has: () => true, ownKeys: () => [PROD.provider], getOwnPropertyDescriptor: () => ({ value: entry, enumerable: true, configurable: true }) }), null, 5, 'x', []]) expectClosed(await runCompositionPreflight({ ...base, labAdapters } as never));
  });
  it('un proveedor aprobado SOLO para LAB (cualquiera sea su declaración) no aprueba PRODUCCIÓN y en LAB sí funciona', async () => {
    const onlyLab = registry(PROD, ['LAB']); expectClosed(await runCompositionPreflight({ ...(await input(PROD)), labAdapters: onlyLab }));
    const labSide = await runCompositionPreflight({ ...(await input(LAB)), labAdapters: registry(LAB, ['LAB']) }); expect(labSide.passed).toBe(true);
    // un registro de laboratorio que se declara aprobado para PRODUCCIÓN: en LAB sus entradas se fuerzan a ['LAB'] y nunca ratifican PRODUCCIÓN
    const sane = sanitizeLabAdapters(claimsProd(LAB)); expect(sane[LAB.provider].targets).toEqual(['LAB']); expect(isReviewedForTarget(parseCfg(PROD), 'PRODUCTION', sane)).toBe(false);
  });
  it('sanitizeLabAdapters descarta entradas sin fábrica y registros hostiles; el resultado está congelado', () => {
    expect(sanitizeLabAdapters(null)).toEqual({}); expect(sanitizeLabAdapters(5)).toEqual({}); expect(sanitizeLabAdapters({ a: { targets: ['PRODUCTION'] }, b: null, c: { create: 'x' } })).toEqual({});
    expect(sanitizeLabAdapters(new Proxy({}, { ownKeys() { throw new Error('secreto'); } }))).toEqual({}); const ok = sanitizeLabAdapters({ x: { targets: ['PRODUCTION'], create: () => goodKms() } }); expect(Object.isFrozen(ok)).toBe(true); expect(ok.x.targets).toEqual(['LAB']);
  });
  it('isReviewedForTarget solo reconoce el registro que se le pasa EXPLÍCITAMENTE; por omisión usa el oficial (vacío)', () => {
    const cfg = parseCfg(PROD); expect(isReviewedForTarget(cfg, 'PRODUCTION')).toBe(false); expect(isReviewedForTarget(cfg, 'LAB')).toBe(false);
    expect(isReviewedForTarget(cfg, 'PRODUCTION', registry(PROD, ['PRODUCTION']))).toBe(true); expect(isReviewedForTarget(cfg, 'PRODUCTION', registry(PROD, ['LAB']))).toBe(false); expect(isReviewedForTarget(cfg, 'PRODUCTION', Object.create({ [PROD.provider]: { targets: ['PRODUCTION'] } }))).toBe(false);
  });
  it('el preflight de API-20 con un cliente KMS inyectado tampoco puede pasar PRODUCCIÓN: exige un proveedor del registro oficial', async () => {
    const a = await attestation(PROD); const r = await runProductionPreflight({ target: 'PRODUCTION', env: env(PROD), kmsClient: goodKms(), database: { lab: { host: '127.0.0.1', port: 3307, schema: LAB.schema, runtimeUser: LAB.run, registryWriterUser: LAB.reg, migrationUser: LAB.mig, runtimeHost: '127.0.0.1', registryWriterHost: '127.0.0.1', migrationHost: '127.0.0.1' }, production: { host: 'db.interno.example', port: 3306, schema: PROD.schema, runtimeUser: PROD.run, registryWriterUser: PROD.reg, migrationUser: PROD.mig, runtimeHost: PROD.host, registryWriterHost: PROD.host, migrationHost: PROD.host } }, db: session(PROD, PROD.run, 'runtime'), trust: a.trust, attestation: a.attestation });
    expect(Object.fromEntries(r.checks.map(c => [c.id, c.status + (c.code ? `:${c.code}` : '')])).KMS_PROVIDER_REVIEWED).toBe('FAIL:KMS_PROVIDER_NOT_SELECTED'); expect(r.passed).toBe(false); expect(r.checks.filter(c => c.status === 'FAIL' && c.id !== 'KMS_PROVIDER_REVIEWED')).toEqual([]);
  });
  it('un preflight de PRODUCCIÓN no pasa con recursos, alias ni cuentas de laboratorio', async () => {
    const r = await runCompositionPreflight({ ...(await input(PROD)), env: env(LAB, { PRICESMART_COMPOSITION_TARGET: 'PRODUCTION' }) }); expect(r.passed).toBe(false); expect(st(r).COMPOSITION_CONFIG).toBe('FAIL:COMPOSITION_CONFIG_INVALID');
  });
});
const parseCfg = (d: Dest) => { const k = parseKmsConfig(env(d)); if (!k.ok) throw new Error(k.issues.join()); return k.config; };

describe('diagnóstico de readiness (API-15) tras API-21: fallos cerrados', () => {
  const diag = (e: Record<string, string | undefined>) => buildReadinessDiagnostic(e, { handlerInstalled: false, labActive: false });
  it('KMS_PROVIDER_NOT_SELECTED aparece siempre mientras el registro revisado esté vacío; ready=false y ningún puerto OK', () => {
    for (const e of [{}, env(PROD), env(LAB), env(PROD, { PRICESMART_KMS_PROVIDER: 'proveedor-aprobado' })]) { const r = diag(e); expect(r.blockers).toContain('KMS_PROVIDER_NOT_SELECTED'); expect(r.ready).toBe(false); expect(r.checks.some(c => c.id.startsWith('PORT:') && c.status === 'OK')).toBe(false); }
  });
  it('sin configuración: MISSING; con configuración válida: solo INFO (nunca OK); inválida o mezclada: bloqueo COMPOSITION_CONFIG_INVALID', () => {
    expect(diag({}).checks.find(c => c.id === 'COMPOSITION_CONFIG')?.status).toBe('MISSING');
    const ok = diag(env(PROD)); expect(ok.checks.find(c => c.id === 'COMPOSITION_CONFIG')?.status).toBe('INFO'); expect(ok.blockers).not.toContain('COMPOSITION_CONFIG_INVALID');
    for (const bad of [{ PRICESMART_DB_RUNTIME_HOST: '%' }, { PRICESMART_LAB_KEY: 'k'.repeat(40) }, { PRICESMART_DB_PASSWORD: 'x' }, { PRICESMART_COMPOSITION_TARGET: 'LAB' }]) expect(diag(env(PROD, bad)).blockers, JSON.stringify(Object.keys(bad))).toContain('COMPOSITION_CONFIG_INVALID');
    expect(diag({ PRICESMART_KMS_PROVIDER: 'x' }).blockers).toContain('COMPOSITION_CONFIG_INVALID');
  });
  it('el diagnóstico no revela valores de la configuración de composición', () => {
    const text = JSON.stringify(diag(env(PROD, { PRICESMART_DB_RUNTIME_HOST: '10.77.%' }))); for (const v of ['ps_runtime', 'db.interno.example', 'identidad-ps', '10.77.%', 'prod.k1', 'proveedor-aprobado']) expect(text).not.toContain(v);
  });
});

describe('aislamiento estático', () => {
  const strip = (f: string) => readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '');
  it('los módulos nuevos no leen el entorno, no usan red/archivos/base de datos propios ni instalan handlers', () => {
    for (const f of ['kms-config.ts', 'kms-provider-selection.ts', 'composition-config.ts', 'account-plans.ts', 'composition-preflight.ts']) { const t = strip(f); expect(t, f).not.toMatch(/process\.env|\bfetch\s*\(|from\s+['"](?:mysql2|@\/lib\/(?:db|tms)|node:(?:net|tls|http|https|fs|child_process))|sandbox-db/); expect(t, f).not.toContain(['install', 'PriceSmartHandler'].join('')); expect(t, f).not.toMatch(/from '\.\/runtime(?:-assembly)?'/); }
  });
  it('el preflight de composición ya no acepta un registro de adaptadores aprobado por el llamador: solo `labAdapters` (aislado, forzado a LAB) y el registro oficial', () => {
    const t = strip('composition-preflight.ts'); expect(t).not.toMatch(/\badapters\s*:\s*KmsAdapterRegistry/); expect(t).toContain('REVIEWED_KMS_ADAPTERS'); expect(t).toContain('sanitizeLabAdapters'); expect(t).toMatch(/target === 'LAB' && input\.labAdapters/);
  });
  it('ninguna ruta ni módulo de la aplicación importa los módulos de composición (salvo el diagnóstico, que solo usa los puros)', () => {
    const root = path.resolve(__dirname, '../../..'); const hits: string[] = []; const names = ['composition-preflight', 'account-plans', 'kms-provider-selection', 'composition-config', 'kms-config'];
    const allowed = ['readiness-diagnostic.ts', 'composition-', 'account-plans', 'kms-', 'production-preflight', 'grants-audit'];
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !n.includes('.test.') && !allowed.some(a => n.startsWith(a))) { const t = readFileSync(f, 'utf8'); if (names.some(x => t.includes(`/${x}'`) || t.includes(`/${x}"`))) hits.push(path.relative(root, f)); } } };
    walk(root); expect(hits).toEqual([]); expect(strip('readiness-diagnostic.ts')).not.toMatch(/composition-preflight|account-plans/);
  }, 30000);
});
