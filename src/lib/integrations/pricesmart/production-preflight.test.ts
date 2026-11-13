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
import { runProductionPreflight, type PreflightDatabase, type PreflightInput } from './production-preflight';
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
  lab: { host: '127.0.0.1', port: 3307, schema: 'sandbox_api02_x', runtimeUser: 'sandbox_api02_run', registryWriterUser: 'sandbox_api02_reg', migrationUser: 'sandbox_api02_mig' },
  production: { host: 'db.interno.example', port: 3306, schema: S, runtimeUser: 'ps_runtime', registryWriterUser: 'ps_registry', migrationUser: 'ps_migrator' } });
const kmsEnv = (over: Record<string, string | undefined> = {}) => ({ PRICESMART_KMS_TARGET: 'PRODUCTION', PRICESMART_KMS_CURRENT_ALIAS: 'prod.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'prod.k1', ...over });
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
const status = (r: Awaited<ReturnType<typeof runProductionPreflight>>) => Object.fromEntries(r.checks.map(c => [c.id, c.status + (c.code ? `:${c.code}` : '')]));

describe('preflight de la composición productiva', () => {
  it('con todo en orden pasa, pero NO autoriza nada ni cambia el readiness (ready=false)', async () => {
    const r = await runProductionPreflight(await input()); expect(status(r)).toEqual({ KMS_CONFIG: 'PASS', KMS_TARGET: 'PASS', KMS_HEALTH: 'PASS', DB_SEPARATION: 'PASS', DB_SESSION_IDENTITY: 'PASS', DB_GRANTS: 'PASS', TRUST_SEPARATION: 'PASS', ATTESTATION: 'PASS' });
    expect(r.passed).toBe(true); expect(r.ready).toBe(false); expect(r.authorizesInstallation).toBe(false); expect(r.digest).toMatch(/^[a-f0-9]{64}$/);
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
    const i = await input(); for (let n = 0; n < 3; n++) expect((await runProductionPreflight(i)).passed).toBe(true);
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
    for (const f of ['preflight-mariadb.ts', 'production-preflight.ts', 'grants-audit.ts', 'database-identity.ts']) { const t = strip(f); expect(t, f).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\s+(INTO|TABLE|FROM|DATABASE|USER)?/); expect(t, f).not.toMatch(/process\.env|\bfetch\s*\(/); expect(t, f).not.toContain(['install', 'PriceSmartHandler'].join('')); expect(t, f).not.toMatch(/from '\.\/runtime/); }
    const root = path.resolve(__dirname, '../../..'); const hits: string[] = []; const names = ['preflight-mariadb', 'production-preflight', 'grants-audit', 'database-identity'];
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !names.some(x => n.startsWith(x)) && !n.includes('.test.')) { const t = readFileSync(f, 'utf8'); if (names.some(x => t.includes(`/${x}'`) || t.includes(`/${x}"`))) hits.push(path.relative(root, f)); } } };
    walk(root); expect(hits).toEqual([]);
  }, 30000);
});
