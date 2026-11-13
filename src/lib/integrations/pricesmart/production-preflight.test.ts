import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PayloadCipher } from './mariadb-repository';
import type { AtomicCounterPort, AtomicReplayPort, EvidenceVerifier, IntegrationCatalog, TrustedClock } from './security-contracts';
import { createInProcessIdentityAuthority, issueAttestation, type CompositionDescriptor } from './conformance-attestation';
import type { KmsClient } from './kms-adapter';
import type { DbIdentity } from './database-identity';
import { PREFLIGHT_STATEMENTS, mariaDbPreflightDatabase } from './preflight-mariadb';
import { createProductionPreflightRunnerForTests, runProductionPreflight as officialRunner, type PreflightDatabase, type PreflightInput } from './production-preflight';
import type { KmsAdapterRegistry } from './kms-provider-selection';
import { RUNTIME_PRIVILEGE_POLICY } from './grants-audit';
import { buildReadinessDiagnostic } from './readiness-diagnostic';
import { isPriceSmartHandlerInstalled } from './runtime-state';
import type { PortName } from './port-conformance';

const KEY = randomBytes(32); const AUTH = randomBytes(32); const LAB_AUTH = randomBytes(32);
const S = 'prod_pricesmart'; const U = '`ps_runtime`@`localhost`';
const grantLines = (): string[] => [
  `GRANT USAGE ON *.* TO ${U} IDENTIFIED BY PASSWORD '*HASHSECRETO1234'`,
  ...Object.entries({ novalvion_environment: 'SELECT', ps_api01_orders: 'SELECT, INSERT, UPDATE (`state`, `version`, `cancellation_hash`, `cancellation_reason`, `cancellation_receipt_json`)', ps_api01_events: 'SELECT, INSERT', ps_api01_outbox: 'INSERT', ps_api01_audit: 'INSERT',
    ps_api11_integrations: 'SELECT', ps_api11_revocations: 'SELECT', ps_api11_rate_counters: 'SELECT, INSERT, UPDATE (`used`)', ps_api11_proof_claims: 'SELECT, INSERT', ps_api18_attestation_nonces: 'SELECT, INSERT', ps_api18_resource_registry: 'SELECT' })
    .map(([t, p]) => `GRANT ${p} ON \`${S}\`.\`${t}\` TO ${U}`),
];
const database = (): { lab: DbIdentity; production: DbIdentity } => ({
  lab: { host: '127.0.0.1', port: 3307, schema: 'sandbox_api02_x', runtimeUser: 'sandbox_api02_run', registryWriterUser: 'sandbox_api02_reg', migrationUser: 'sandbox_api02_mig', runtimeHost: '127.0.0.1', registryWriterHost: '127.0.0.1', migrationHost: '127.0.0.1' },
  production: { host: 'db.interno.example', port: 3306, schema: S, runtimeUser: 'ps_runtime', registryWriterUser: 'ps_registry', migrationUser: 'ps_migrator', runtimeHost: 'localhost', registryWriterHost: 'localhost', migrationHost: 'localhost' } });
const kmsEnv = (over: Record<string, string | undefined> = {}) => ({ PRICESMART_KMS_TARGET: 'PRODUCTION', PRICESMART_KMS_CURRENT_ALIAS: 'prod.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'prod.k1', PRICESMART_KMS_PROVIDER: 'proveedor-aprobado', PRICESMART_KMS_SERVICE_IDENTITY: 'identidad-ps', ...over });
const goodKms = (): KmsClient => ({ encrypt: async () => new Uint8Array(1), decrypt: async () => new Uint8Array(32), health: async () => true });
const fakeDb = (over: Partial<PreflightDatabase> = {}): PreflightDatabase => ({ identity: async () => ({ db: S, account: 'ps_runtime@localhost' }), grants: async () => grantLines(), ...over });

// ---- composición completa y conforme con una atestación válida (destino PRODUCTION: contador/replay solo como copia aislada)
function cipher(): PayloadCipher { const k = randomBytes(32); return {
  async seal(i, c) { const iv = randomBytes(12); const x = createCipheriv('aes-256-gcm', k, iv); x.setAAD(Buffer.from(c)); const b = Buffer.concat([x.update(JSON.stringify(i)), x.final()]); return { ciphertext: Buffer.concat([iv, x.getAuthTag(), b]), keyReference: 'k' }; },
  async open(buf, r, c) { if (r !== 'k') throw new Error('x'); const d = createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12)); d.setAAD(Buffer.from(c)); d.setAuthTag(buf.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString()); } }; }
class Counter implements AtomicCounterPort { private m = new Map<string, { used: number; resetAtMs: number }>(); async consume({ identityKey, limit, windowMs, nowMs }: Parameters<AtomicCounterPort['consume']>[0]) { let w = this.m.get(identityKey); if (!w || nowMs >= w.resetAtMs) w = { used: 0, resetAtMs: nowMs + windowMs }; const allowed = w.used < limit; if (allowed) w = { ...w, used: w.used + 1 }; this.m.set(identityKey, w); return { allowed, used: w.used, resetAtMs: w.resetAtMs, assurance: 'DISTRIBUTED_ATOMIC' as const }; } }
class Replay implements AtomicReplayPort { private m = new Map<string, string>(); async claim({ identityKey, proofId, bindingDigest }: Parameters<AtomicReplayPort['claim']>[0]) { const k = `${identityKey}|${proofId}`; const s = this.m.get(k); if (s === undefined) { this.m.set(k, bindingDigest); return { status: 'CLAIMED' as const, assurance: 'DURABLE_ATOMIC' as const }; } return { status: s === bindingDigest ? ('REUSED' as const) : ('COLLISION' as const), assurance: 'DURABLE_ATOMIC' as const }; } }
const clock = (): TrustedClock => { let last = 0; return { nowMs: () => (last = Math.max(last, Date.now())) }; };
const catalog = (): IntegrationCatalog => ({ findByCredential: async () => [] }); const verifier = (): EvidenceVerifier => ({ verify: async () => null });
async function attestedComposition() {
  const authority = createInProcessIdentityAuthority({ authorityId: 'auth-prod', key: AUTH });
  const inst: Record<PortName, object> = { cipher: cipher(), clock: clock(), counter: new Counter(), replay: new Replay(), catalog: catalog(), verifier: verifier() };
  const composition: CompositionDescriptor = {};
  for (const [port, instance] of Object.entries(inst) as [PortName, object][]) { composition[port] = { instance, implementationId: `${port}-ref`, version: '1.0.0' }; authority.enroll(instance, port, { resourceId: `${port}-res`, subject: port === 'counter' || port === 'replay' ? 'ISOLATED_COPY' : 'LIVE' }); }
  const trust = { lab: { 'auth-lab': LAB_AUTH }, production: { 'auth-prod': AUTH } };
  const { attestation } = await issueAttestation({ composition, target: 'PRODUCTION', key: KEY, nowMs: Date.now(), ttlMs: 600_000, identity: { authority, trusted: trust.production } });
  return { composition, authority, trust, attestation };
}
async function input(over: Partial<PreflightInput> = {}, withAttestation = true): Promise<PreflightInput> {
  const a = await attestedComposition();
  return { target: 'PRODUCTION', env: kmsEnv(), kmsClient: goodKms(), database: database(), db: fakeDb(), trust: a.trust,
    ...(withAttestation ? { attestation: { composition: a.composition, attestation: a.attestation, key: KEY, authority: a.authority, clock: { nowMs: () => Date.now() } } } : {}), ...over };
}
/** Registro oficial SIMULADO y aislado (no es `REVIEWED_KMS_ADAPTERS`): su adaptador entrega `client`. Permite probar el resto del preflight de PRODUCCIÓN sin que el llamador inyecte nada. */
const simulatedOfficial = (client: KmsClient, targets: ('LAB' | 'PRODUCTION')[] = ['PRODUCTION']): KmsAdapterRegistry => ({ 'proveedor-aprobado': { targets, create: () => client } });
/** Atajo de las pruebas heredadas: el `kmsClient` de la entrada (si lo hay) pasa a ser el cliente que entrega el adaptador oficial simulado; la entrada que recibe el ejecutor NO lleva `kmsClient`. */
const runProductionPreflight = (i: PreflightInput) => { const { kmsClient, ...rest } = i ?? ({} as PreflightInput); return createProductionPreflightRunnerForTests(simulatedOfficial(kmsClient ?? goodKms()))(i ? (rest as PreflightInput) : (i as never)); };
const status = (r: Awaited<ReturnType<typeof officialRunner>>) => Object.fromEntries(r.checks.map(c => [c.id, c.status + (c.code ? `:${c.code}` : '')]));

describe('preflight de la composición productiva', () => {
  it('con un registro oficial SIMULADO y aislado, todo en orden pasa; con el registro oficial REAL (vacío) un preflight de PRODUCCIÓN NO puede pasar; ninguno autoriza nada ni cambia el readiness', async () => {
    const simulated = await runProductionPreflight(await input()); expect(status(simulated)).toEqual({ KMS_CONFIG: 'PASS', KMS_TARGET: 'PASS', KMS_PROVIDER_REVIEWED: 'PASS', KMS_HEALTH: 'PASS', DB_SEPARATION: 'PASS', DB_SESSION_IDENTITY: 'PASS', DB_GRANTS: 'PASS', TRUST_SEPARATION: 'PASS', ATTESTATION: 'PASS' });
    expect(simulated.passed).toBe(true); expect(simulated.ready).toBe(false); expect(simulated.authorizesInstallation).toBe(false);
    const real = await officialRunner(await input()); expect(status(real)).toEqual({ KMS_CONFIG: 'PASS', KMS_TARGET: 'PASS', KMS_PROVIDER_REVIEWED: 'FAIL:KMS_PROVIDER_NOT_SELECTED', KMS_HEALTH: 'FAIL:BLOCKED_BY_PREVIOUS', DB_SEPARATION: 'PASS', DB_SESSION_IDENTITY: 'PASS', DB_GRANTS: 'PASS', TRUST_SEPARATION: 'PASS', ATTESTATION: 'PASS' });
    expect(real.passed).toBe(false); expect(real.ready).toBe(false); expect(real.authorizesInstallation).toBe(false); expect(real.digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it('sin atestación el preflight no pasa (ATTESTATION omitida)', async () => {
    const r = await runProductionPreflight(await input({}, false)); expect(status(r).ATTESTATION).toBe('SKIPPED:NOT_PROVIDED'); expect(r.passed).toBe(false);
  });
  it('cada comprobación fallida hace fallar el preflight con su código', async () => {
    const cases: [string, Partial<PreflightInput>, string][] = [
      ['KMS_CONFIG', { env: kmsEnv({ PRICESMART_KMS_CURRENT_ALIAS: 'x' }) }, 'KMS_CONFIG_INVALID'],
      ['KMS_CONFIG', { env: kmsEnv({ PRICESMART_KMS_SECRET: 'abc' }) }, 'KMS_CONFIG_INVALID'],
      ['KMS_TARGET', { env: { PRICESMART_KMS_TARGET: 'LAB', PRICESMART_KMS_CURRENT_ALIAS: 'lab.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1' } }, 'KMS_TARGET_MISMATCH'],
      ['KMS_HEALTH', { kmsClient: { ...goodKms(), health: async () => false } }, 'KMS_UNHEALTHY'], ['KMS_HEALTH', { kmsClient: { encrypt: async () => new Uint8Array(1), decrypt: async () => new Uint8Array(32) } }, 'KMS_UNHEALTHY'],
      ['DB_SEPARATION', { database: { ...database(), production: { ...database().production, schema: 'sandbox_api02_x' } } }, 'PRODUCTION_USES_LAB_NAME'],
      ['DB_SESSION_IDENTITY', { db: fakeDb({ identity: async () => ({ db: 'sandbox_api02_x', account: 'sandbox_api02_run@127.0.0.1' }) }) }, 'SESSION_IDENTITY_MISMATCH'],
      ['DB_SESSION_IDENTITY', { db: fakeDb({ identity: async () => ({ db: S, account: 'otro@localhost' }) }) }, 'SESSION_IDENTITY_MISMATCH'],
      ['DB_GRANTS', { db: fakeDb({ grants: async () => [...grantLines(), `GRANT ALL PRIVILEGES ON *.* TO ${U}`] }) }, 'GLOBAL_PRIVILEGE'],
      ['DB_GRANTS', { db: fakeDb({ grants: async () => [...grantLines(), `GRANT DELETE ON \`${S}\`.\`ps_api11_proof_claims\` TO ${U}`] }) }, 'EXCESS_PRIVILEGE'],
      ['DB_GRANTS', { db: fakeDb({ grants: async () => grantLines().slice(0, 4) }) }, 'MISSING_PRIVILEGE'],
      ['TRUST_SEPARATION', { trust: { lab: { x: AUTH }, production: { y: AUTH } } }, 'UNAVAILABLE'], ['TRUST_SEPARATION', { trust: { lab: {}, production: { y: AUTH } } }, 'UNAVAILABLE'],
    ];
    for (const [id, over, code] of cases) { const r = await runProductionPreflight(await input(over)); expect(status(r)[id], id).toBe(`FAIL:${code}`); expect(r.passed, id).toBe(false); }
  });
  it('una atestación inválida (otra composición, caducada, de otro destino o con identidad ajena) falla en ATTESTATION', async () => {
    const base = await input(); const other = await attestedComposition();
    const swapped = { ...base, attestation: { ...base.attestation!, composition: other.composition } }; expect(status(await runProductionPreflight(swapped)).ATTESTATION).toBe('FAIL:IDENTITY_MISMATCH');
    const expired = { ...base, attestation: { ...base.attestation!, clock: { nowMs: () => Date.now() + 3_600_000 } } }; expect(status(await runProductionPreflight(expired)).ATTESTATION).toBe('FAIL:EXPIRED');
    expect(status(await runProductionPreflight({ ...base, target: 'LAB' })).ATTESTATION).toMatch(/^FAIL:/);
    const tampered = { ...base, attestation: { ...base.attestation!, attestation: { ...base.attestation!.attestation, signature: '0'.repeat(64) } } }; expect(status(await runProductionPreflight(tampered)).ATTESTATION).toBe('FAIL:BAD_SIGNATURE');
  });
  it('un preflight de PRODUCCIÓN contra recursos de laboratorio nunca pasa', async () => {
    const lab = await input({ db: fakeDb({ identity: async () => ({ db: 'sandbox_api02_x', account: 'sandbox_api02_run@127.0.0.1' }), grants: async () => grantLines().map(l => l.replace(S, 'sandbox_api02_x')) }) });
    const r = await runProductionPreflight(lab); expect(r.passed).toBe(false); expect(status(r).DB_SESSION_IDENTITY).toBe('FAIL:SESSION_IDENTITY_MISMATCH'); expect(status(r).DB_GRANTS).toMatch(/^FAIL:/);
  });
  it('identidad EFECTIVA completa usuario@host: otro host, comodín, mismo usuario con otro host y formatos inválidos NO pasan; solo la cuenta exacta', async () => {
    const run = async (account: string, db = S) => status(await runProductionPreflight(await input({ db: fakeDb({ identity: async () => ({ db, account }) }) }))).DB_SESSION_IDENTITY;
    expect(await run('ps_runtime@localhost')).toBe('PASS'); expect(await run('ps_runtime@LOCALHOST')).toBe('PASS');
    for (const bad of ['ps_runtime@%', 'ps_runtime@10.0.0.5', 'ps_runtime@127.0.0.1', 'ps_runtime@local%', 'ps_runtime@localhost.evil', 'PS_RUNTIME@localhost', 'otro@localhost', 'ps_registry@localhost']) expect(await run(bad), bad).toBe('FAIL:SESSION_IDENTITY_MISMATCH');
    for (const bad of ['ps_runtime', '', '@localhost', 'ps_runtime@', 'a@b@c', 'ps_runtime@ localhost', "ps_runtime@'localhost'"]) expect(await run(bad), bad).toBe('FAIL:SESSION_IDENTITY_MALFORMED');
    expect(await run('ps_runtime@localhost', 'otra_db')).toBe('FAIL:SESSION_IDENTITY_MISMATCH');
  });
  it('producción con cuentas de host comodín en el descriptor, o con el mismo usuario en otro host, falla en DB_SEPARATION', async () => {
    const wild = await input({ database: { ...database(), production: { ...database().production, runtimeHost: '%' } } }); expect(status(await runProductionPreflight(wild)).DB_SEPARATION).toBe('FAIL:WILDCARD_ACCOUNT_HOST');
    const same = await input({ database: { ...database(), production: { ...database().production, registryWriterUser: 'ps_runtime', registryWriterHost: '10.0.0.9' } } }); expect(status(await runProductionPreflight(same)).DB_SEPARATION).toBe('FAIL:ACCOUNTS_NOT_DISTINCT');
  });
  it('una política propia que amplía la base nunca da PASS en DB_GRANTS (aunque los grants coincidan con ella), y una vacía tampoco', async () => {
    const lax = { ...Object.fromEntries(Object.entries(RUNTIME_PRIVILEGE_POLICY).map(([t, p]) => [t, [...p]])), ps_api11_proof_claims: ['SELECT', 'INSERT', 'DELETE'] };
    const r = await runProductionPreflight(await input({ policy: lax, db: fakeDb({ grants: async () => [...grantLines(), `GRANT DELETE ON \`${S}\`.\`ps_api11_proof_claims\` TO ${U}`] }) })); expect(status(r).DB_GRANTS).toBe('FAIL:POLICY_EXCEEDS_BASE'); expect(r.passed).toBe(false);
    expect(status(await runProductionPreflight(await input({ policy: {} as never }))).DB_GRANTS).toBe('FAIL:POLICY_INVALID');
    expect(status(await runProductionPreflight(await input({ policy: { novalvion_environment: ['SELECT'] } }))).DB_GRANTS).toMatch(/^FAIL:/);   // restricción válida, pero ya no cubre lo requerido
  });
  it('el informe público no contiene identificadores de cuenta ni hosts (ni «@»)', async () => {
    const r = await runProductionPreflight(await input({ db: fakeDb({ identity: async () => ({ db: S, account: 'intruso@10.9.8.7' }) }) })); const text = JSON.stringify(r);
    for (const v of ['intruso', '10.9.8.7', 'ps_runtime', 'localhost', '@']) expect(text).not.toContain(v);
  });
  it('cualquier excepción de las dependencias es un fallo cerrado sin detalles', async () => {
    const boom = async () => { throw new Error('secreto-db-777'); };
    const r = await runProductionPreflight(await input({ db: fakeDb({ identity: boom, grants: boom }), kmsClient: { ...goodKms(), health: boom } }));
    expect(status(r)).toMatchObject({ KMS_HEALTH: 'FAIL:KMS_UNHEALTHY', DB_SESSION_IDENTITY: 'FAIL:UNAVAILABLE', DB_GRANTS: 'FAIL:UNAVAILABLE' }); expect(JSON.stringify(r)).not.toContain('secreto');
    expect((await runProductionPreflight(null as never)).passed).toBe(false);
  });
  it('el informe no contiene valores: ni alias, esquema, cuentas, hashes ni claves; el resumen es determinista y cambia si cambia un resultado', async () => {
    const i = await input(); const [a, b] = [await runProductionPreflight(i), await runProductionPreflight(i)]; const text = JSON.stringify(a);
    for (const v of ['prod.k1', S, 'ps_runtime', 'db.interno.example', '*HASHSECRETO1234', KEY.toString('hex'), AUTH.toString('hex')]) expect(text).not.toContain(v);
    expect(a.digest).toBe(b.digest); expect((await runProductionPreflight({ ...i, db: fakeDb({ grants: async () => [] }) })).digest).not.toBe(a.digest);
  });
  it('no consume nonces: puede repetirse (la verificación de la atestación es de solo lectura)', async () => {
    const i = await input(); for (let n = 0; n < 3; n++) { const r = await runProductionPreflight(i); expect(status(r).ATTESTATION).toBe('PASS'); expect(r.passed).toBe(true); }   // la atestación se verifica sin consumirse; lo único que falla es la selección oficial de proveedor
  });
  it('no cambia el readiness ni instala nada: el diagnóstico sigue ready=false y sin handler', async () => {
    await runProductionPreflight(await input()); expect(isPriceSmartHandlerInstalled()).toBe(false);
    const r = buildReadinessDiagnostic({ PRICESMART_RUNTIME_MODE: 'ENABLED' }, { handlerInstalled: false, labActive: false }); expect(r.ready).toBe(false); expect(r.blockers).toContain('PRODUCTION_COMPOSITION_NOT_IMPLEMENTED');
  });
});

describe('lector de preflight sobre MariaDB: solo dos lecturas fijas', () => {
  function pool(rowsFor: (sql: string) => unknown[] | Error) {
    const sql: string[] = []; const calls = { released: 0, destroyed: 0 };
    const conn = { async query(s: string) { sql.push(s); const r = rowsFor(s); if (r instanceof Error) throw r; return [r]; }, release() { calls.released++; }, destroy() { calls.destroyed++; } };
    return { sql, calls, pool: { getConnection: async () => conn } as never };
  }
  it('ejecuta exactamente las dos sentencias fijas de solo lectura y devuelve identidad y grants', async () => {
    const h = pool(s => (s.startsWith('SELECT') ? [{ db: S, account: 'ps_runtime@localhost' }] : [{ 'Grants for ps_runtime@localhost': 'GRANT USAGE ON *.* TO x' }, { g: 'GRANT SELECT ON `a`.`b` TO x' }]));
    const db = mariaDbPreflightDatabase(h.pool); expect(await db.identity()).toEqual({ db: S, account: 'ps_runtime@localhost' }); expect(await db.grants()).toEqual(['GRANT USAGE ON *.* TO x', 'GRANT SELECT ON `a`.`b` TO x']);
    expect(h.sql).toEqual([...PREFLIGHT_STATEMENTS]); expect(PREFLIGHT_STATEMENTS.every(s => /^(SELECT DATABASE\(\)|SHOW GRANTS FOR CURRENT_USER\(\))/.test(s))).toBe(true); expect(h.calls).toEqual({ released: 2, destroyed: 0 });
  });
  it('los errores del motor se vuelven UNAVAILABLE, sin detalles, y la conexión se destruye', async () => {
    const h = pool(() => new Error('secreto-motor-9')); const db = mariaDbPreflightDatabase(h.pool);
    for (const op of [db.identity(), db.grants()]) { const e = await op.catch((x: Error) => x); expect((e as Error).message).toBe('UNAVAILABLE'); expect(String((e as Error).stack)).not.toContain('secreto'); }
    expect(h.calls.destroyed).toBe(2);
    await expect(mariaDbPreflightDatabase(pool(() => []).pool).identity()).rejects.toThrow('UNAVAILABLE');   // identidad ambigua o vacía
  });
  it('el módulo solo contiene lecturas: sin INSERT/UPDATE/DELETE/DDL ni entorno, y los módulos nuevos no los importa la aplicación', () => {
    const strip = (f: string) => readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '');
    for (const f of ['preflight-mariadb.ts', 'production-preflight.ts', 'grants-audit.ts', 'database-identity.ts']) { const t = strip(f); if (['preflight-mariadb.ts', 'production-preflight.ts'].includes(f)) expect(t, f).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\s+(INTO|TABLE|FROM|DATABASE|USER)?/); /* los módulos que tocan la base solo leen */ expect(t, f).not.toMatch(/process\.env|\bfetch\s*\(/); expect(t, f).not.toContain(['install', 'PriceSmartHandler'].join('')); expect(t, f).not.toMatch(/from '\.\/runtime/); }
    const root = path.resolve(__dirname, '../../..'); const hits: string[] = []; const names = ['preflight-mariadb', 'production-preflight', 'grants-audit', 'database-identity'];
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !names.some(x => n.startsWith(x)) && !n.startsWith('attestation-mariadb') && !n.startsWith('composition-') && !n.startsWith('account-plans') && !n.includes('.test.')) { const t = readFileSync(f, 'utf8'); if (names.some(x => t.includes(`/${x}'`) || t.includes(`/${x}"`))) hits.push(path.relative(root, f)); } } };
    walk(root); expect(hits).toEqual([]);
  }, 30000);
});

// ---- API-21 (auditoría de #615, SHA 1d5e5f16): el cliente KMS de PRODUCCIÓN procede EXCLUSIVAMENTE de la selección oficial
describe('el cliente KMS verificado en PRODUCCIÓN procede solo del registro oficial; un cliente inyectado no lo sustituye', () => {
  const counting = (healthy: boolean) => { const c = { calls: 0, health: 0, client: undefined as unknown as KmsClient }; c.client = { encrypt: async () => { c.calls++; return new Uint8Array(1); }, decrypt: async () => { c.calls++; return new Uint8Array(32); }, health: async () => { c.health++; return healthy; } }; return c; };
  const run = async (registry: KmsAdapterRegistry, over: Partial<PreflightInput> = {}) => createProductionPreflightRunnerForTests(registry)(await input(over));
  it('con un registro oficial simulado NO VACÍO, la salud se mide sobre el cliente del adaptador oficial: el inyectado no se usa ni una vez', async () => {
    const official = counting(true); const injected = counting(false);
    const r = await run(simulatedOfficial(official.client), { kmsClient: injected.client }); expect(status(r).KMS_HEALTH).toBe('PASS'); expect(r.passed).toBe(true);
    expect(official.health).toBe(1); expect(injected.health).toBe(0); expect(injected.calls).toBe(0);
  });
  it('cliente sustituido: un cliente inyectado sano NO compensa un cliente oficial enfermo; uno inyectado enfermo no daña a un oficial sano', async () => {
    const sickOfficial = counting(false); const healthyInjected = counting(true);
    const r = await run(simulatedOfficial(sickOfficial.client), { kmsClient: healthyInjected.client }); expect(status(r).KMS_HEALTH).toBe('FAIL:KMS_UNHEALTHY'); expect(r.passed).toBe(false); expect(healthyInjected.health).toBe(0);
    const healthyOfficial = counting(true); const sickInjected = counting(false); const ok = await run(simulatedOfficial(healthyOfficial.client), { kmsClient: sickInjected.client }); expect(status(ok).KMS_HEALTH).toBe('PASS'); expect(sickInjected.health).toBe(0);
  });
  it('sin adaptador oficial para el proveedor configurado, un cliente inyectado sano no aprueba nada y ni siquiera se consulta', async () => {
    const injected = counting(true);
    for (const registry of [{} as KmsAdapterRegistry, { 'otro-proveedor': { targets: ['PRODUCTION'], create: () => counting(true).client } } as KmsAdapterRegistry]) {
      const r = await run(registry, { kmsClient: injected.client }); expect(status(r).KMS_PROVIDER_REVIEWED).toMatch(/^FAIL:KMS_PROVIDER_(NOT_SELECTED|UNKNOWN)$/); expect(status(r).KMS_HEALTH).toBe('FAIL:BLOCKED_BY_PREVIOUS'); expect(r.passed).toBe(false);
    }
    expect(injected.health).toBe(0); expect(injected.calls).toBe(0);
  });
  it('un adaptador oficial aprobado solo para LAB, sin identidad de servicio, con configuración de otro destino o que falla: PRODUCCIÓN no pasa y el cliente inyectado no interviene', async () => {
    const injected = counting(true);
    expect(status(await run(simulatedOfficial(counting(true).client, ['LAB']), { kmsClient: injected.client })).KMS_PROVIDER_REVIEWED).toBe('FAIL:KMS_PROVIDER_NOT_APPROVED_FOR_TARGET');
    expect(status(await run(simulatedOfficial(counting(true).client), { env: kmsEnv({ PRICESMART_KMS_SERVICE_IDENTITY: undefined }), kmsClient: injected.client })).KMS_PROVIDER_REVIEWED).toBe('FAIL:SERVICE_IDENTITY_MISSING');
    expect(status(await run(simulatedOfficial(counting(true).client, ['LAB', 'PRODUCTION']), { env: { PRICESMART_KMS_TARGET: 'LAB', PRICESMART_KMS_CURRENT_ALIAS: 'lab.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1', PRICESMART_KMS_PROVIDER: 'proveedor-aprobado', PRICESMART_KMS_SERVICE_IDENTITY: 'identidad-ps' }, kmsClient: injected.client })).KMS_PROVIDER_REVIEWED).toBe('FAIL:KMS_TARGET_MISMATCH');
    const boom = await run({ 'proveedor-aprobado': { targets: ['PRODUCTION'], create: () => { throw new Error('secreto-adaptador'); } } }, { kmsClient: injected.client }); expect(status(boom).KMS_PROVIDER_REVIEWED).toBe('FAIL:ADAPTER_FAILED'); expect(JSON.stringify(boom)).not.toContain('secreto');
    expect(injected.health).toBe(0);
  });
  it('el adaptador oficial solo recibe la configuración y una referencia de identidad; el cliente que devuelva debe ser un KmsClient', async () => {
    let seen: unknown; const r = await run({ 'proveedor-aprobado': { targets: ['PRODUCTION'], create: (i) => { seen = i; return counting(true).client; } } }); expect(r.passed).toBe(true);
    expect(Object.keys(seen as object).sort()).toEqual(['config', 'serviceIdentityRef']);
    for (const bad of [null, {}, 'x']) expect(status(await run({ 'proveedor-aprobado': { targets: ['PRODUCTION'], create: () => bad as never } })).KMS_PROVIDER_REVIEWED).toBe('FAIL:ADAPTER_FAILED');
  });
  it('el ejecutor público está ligado al registro OFICIAL (vacío): con cualquier cliente inyectado, sano o no, PRODUCCIÓN no pasa y el cliente no se consulta', async () => {
    const injected = counting(true); const r = await officialRunner(await input({ kmsClient: injected.client }));
    expect(status(r).KMS_PROVIDER_REVIEWED).toBe('FAIL:KMS_PROVIDER_NOT_SELECTED'); expect(status(r).KMS_HEALTH).toBe('FAIL:BLOCKED_BY_PREVIOUS'); expect(r.passed).toBe(false); expect(injected.health).toBe(0); expect(injected.calls).toBe(0);
  });
  it('en LAB sí se usa el cliente sintético inyectado (nunca ratifica PRODUCCIÓN); sin cliente falla', async () => {
    const injected = counting(true); const labEnv = { PRICESMART_KMS_TARGET: 'LAB', PRICESMART_KMS_CURRENT_ALIAS: 'lab.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1' };
    const lab = await officialRunner({ ...(await input()), target: 'LAB', env: labEnv, kmsClient: injected.client }); expect(status(lab).KMS_PROVIDER_REVIEWED).toBe('PASS'); expect(status(lab).KMS_HEALTH).toBe('PASS'); expect(injected.health).toBe(1);
    const none = await officialRunner({ ...(await input()), target: 'LAB', env: labEnv, kmsClient: undefined }); expect(status(none).KMS_PROVIDER_REVIEWED).toBe('FAIL:KMS_CLIENT_MISSING');
  });
  it('REVIEWED_KMS_ADAPTERS sigue vacío y las fábricas de ejecutores de prueba solo se usan en pruebas', async () => {
    const { REVIEWED_KMS_ADAPTERS } = await import('./kms-provider-selection'); expect(Object.keys(REVIEWED_KMS_ADAPTERS)).toEqual([]);
    const root = path.resolve(__dirname, '../../..'); const hits: string[] = []; const needle = ['createProductionPreflight', 'RunnerForTests'].join('');
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !n.includes('.test.') && n !== 'production-preflight.ts' && readFileSync(f, 'utf8').includes(needle)) hits.push(path.relative(root, f)); } };
    walk(root); expect(hits).toEqual([]);
  }, 30000);
});
