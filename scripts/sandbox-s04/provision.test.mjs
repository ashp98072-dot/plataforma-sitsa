import { it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { parseEnvironment } from '../infra/pricesmart-plan.mjs';
import { repo, statements, audit, schemaTables } from './audit.mjs';
import { buildPlan, grantSql, indexSignatures } from './plan.mjs';
import { loadFixtures, validateFixtures, materialize } from './fixtures.mjs';
import { prepare, validateRuntimeGrants, fileJournal } from './provision.mjs';

const plan = buildPlan(), fixture = loadFixtures();
let root, options;
const secret = () => `sandbox:pricesmart-qa:${randomBytes(32).toString('hex')}`;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 's04-offline-')); fs.mkdirSync(path.join(root, 'uploads'));
  const env = parseEnvironment(fs.readFileSync(path.join(repo, 'infra/pricesmart-sandbox/runtime.env.example'), 'utf8'));
  env.SANDBOX_ROOT = root; env.UPLOAD_DIR = path.join(root, 'uploads'); const secretSha256 = {};
  for (const key of ['AUTH_SECRET', 'DB_PASSWORD', 'PORTAL_CREDENTIALS_KEY']) { env[key] = secret(); secretSha256[key] = createHash('sha256').update(env[key]).digest('hex'); }
  fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify({ environment: 'sandbox', id: plan.id, database: { DB_HOST: env.DB_HOST, DB_PORT: env.DB_PORT, DB_NAME: env.DB_NAME, DB_USER: env.DB_USER }, origin: env.CB2_PUBLIC_ORIGIN, secretSha256 }));
  const journal = { state: '', claimed: false, exists() { return this.claimed; }, claim() { if (this.claimed) throw Error('EXISTS'); this.claimed = true; }, write(state) { this.state = state; }, close() {} };
  options = { env, cwd: root, approval: { authorizedForS06: true, newDedicatedInstance: true, evidenceSha256: 'a'.repeat(64), datadir: '/var/lib/novalvion-ps-db', socket: '/run/novalvion-ps-db/mariadb.sock' }, journal,
    passwords: Object.fromEntries(['qa-s04-reader', 'qa-s04-other', 'qa-s04-portal'].map(u => [u, secret()])) };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function fake(patch = {}) {
  const log = []; let mutations = 0, identities = 0, catalogReads = 0;
  const identity = { version: '11.8.9-MariaDB', datadir: '/var/lib/novalvion-ps-db/', port: 43306, bind: '127.0.0.1', fk: 1, checks: 1, localInfile: 0, mode: 'STRICT_TRANS_TABLES', account: 'root@localhost', login: 'root@localhost', connectionId: 77, ...patch.identity };
  return { config: { socketPath: '/run/novalvion-ps-db/mariadb.sock', user: 'root' }, log, async query(sql) {
    log.push(sql);
    if (/^(CREATE|ALTER|INSERT|GRANT|USE|START|COMMIT)\b/.test(sql)) { mutations++; if (mutations === patch.failAt) throw Error('raw-driver-secret-canary'); }
    if (sql.startsWith('SELECT VERSION')) { identities++; return [[{ ...identity, ...(identities > (patch.changeAfter ?? Infinity) ? { connectionId: 99 } : {}) }]]; }
    if (sql.includes('information_schema.SCHEMATA')) { catalogReads++; return [[...['mysql', 'sys', 'information_schema', 'performance_schema', ...((patch.existing || (patch.appearAfterLock && catalogReads > 1)) ? ['sandbox_pricesmart'] : [])].map(name => ({ name }))]]; }
    if (sql.includes('FROM mysql.user')) return [[{ name: 'root', host: 'localhost' }, ...(patch.foreignUser ? [{ name: 'production-user', host: 'localhost' }] : [])]];
    if (sql === 'SHOW GRANTS FOR PUBLIC') return [[{ g: patch.publicGrant ?? 'GRANT USAGE ON *.* TO PUBLIC' }]];
    if (sql.includes('GET_LOCK')) return [[{ acquired: patch.busy ? 0 : 1 }]];
    if (sql.includes('information_schema.TABLES')) return [plan.grants.map(g => ({ name: g.table, type: 'BASE TABLE', engine: patch.engine ?? 'InnoDB' }))];
    if (sql.includes('information_schema.STATISTICS')) return [patch.missingIndex ? [] : indexSignatures(plan).map(s => { const [tableName, nonUnique, cols] = s.split(':'); return { tableName, nonUnique: Number(nonUnique), cols }; })];
    if (sql.includes('information_schema.REFERENTIAL_CONSTRAINTS')) return [patch.missingFk ? [] : plan.foreignKeys.map(fk => ({ name: fk.name }))];
    if (sql.includes('information_schema.TRIGGERS')) return [patch.extraObjects ? [{ name: 'foreign-trigger' }] : []];
    if (sql.startsWith('SELECT COUNT(*) AS errors')) return [[{ errors: patch.orphan ? 1 : 0 }]];
    const count = /^SELECT COUNT\(\*\) n FROM `(\w+)`/.exec(sql);
    if (count) return [[{ n: fixture.tables[count[1]]?.length ?? 0 }]];
    if (sql.startsWith("SHOW GRANTS FOR 'sandbox_pricesmart'")) return [runtimeGrants()];
    return [[], []];
  } };
}
function runtimeGrants() { return ['GRANT USAGE ON *.* TO `sandbox_pricesmart`@`127.0.0.1`', ...plan.grants.map(g => `GRANT SELECT ON \`sandbox_pricesmart\`.\`${g.table}\` TO \`sandbox_pricesmart\`@\`127.0.0.1\``)]; }
it('source SQL splitter respects comments, quotes and semicolons', () => {
  expect(statements("-- comment ;\nSELECT ';'; /* hidden ; */ SELECT 'it''s;ok';")).toHaveLength(2);
  expect(() => statements("SELECT 'broken")).toThrow('S04_SQL_UNTERMINATED');
});
it('source inventory and generated DDL are reproducible across CRLF and LF', () => {
  const source = 'CREATE TABLE x (id INT PRIMARY KEY,\n name VARCHAR(20)) ENGINE=InnoDB;';
  expect(schemaTables(source.replaceAll('\n', '\r\n'))).toEqual(schemaTables(source));
});
it('pins generated schema, FK closure and table permissions to reviewed sources', () => {
  expect(JSON.parse(fs.readFileSync(path.join(repo, 'infra/pricesmart-sandbox/s04/plan.json'), 'utf8'))).toEqual(plan);
  expect(plan.grants).toHaveLength(26); expect(plan.foreignKeys).toHaveLength(49);
  expect(plan.foreignKeys.every(fk => plan.grants.some(g => g.table === fk.target))).toBe(true);
  expect(grantSql().every(sql => /^GRANT SELECT ON `sandbox_pricesmart`\.`\w+` TO 'sandbox_pricesmart'@'127.0.0.1'$/.test(sql))).toBe(true);
});
it('static inventory includes source tables, deferred FKs, migrations and runtime DDL', () => {
  const inventory = audit(); expect(inventory.tables).toHaveLength(108); expect(inventory.sqlFiles.length).toBeGreaterThan(250);
  expect(inventory.runtime.some(r => r.file === 'src/lib/clientes/schema.ts' && r.operation === 'CREATE TABLE')).toBe(true);
  expect(inventory.additionalDefinitions.some(t => t.name === 'flota_vehiculo_acceso' && t.file === 'src/lib/flota/schema.ts')).toBe(true);
  expect(inventory.crossSchema.some(r => r.qualified.some(q => q.schema.toLowerCase() === 'information_schema'))).toBe(true);
});
it('synthetic fixture has complete physical and logical references', () => expect(validateFixtures(fixture)).toBe(true));
it.each([
  ['orphan customer', f => f.tables.tms_solicitudes_cliente[0].cliente_id = 123],
  ['cross-tenant simple FK', f => f.tables.tms_cliente_rutas[0].cliente_id = 750002],
  ['duplicate key', f => f.tables.usuarios.push({ ...f.tables.usuarios[0] })],
  ['unknown column', f => f.tables.empresas[0].pricesmart_contract = 'invented'],
  ['real email domain', f => f.tables.usuarios[0].email = 'user@company.com'],
  ['active portal', f => f.tables.tms_cliente_usuarios[0].activo = 1],
  ['missing required value', f => delete f.tables.tms_solicitudes_cliente[0].fecha_solicitada],
])('rejects fixture %s', (_label, mutate) => { const f = structuredClone(fixture); mutate(f); expect(() => validateFixtures(f)).toThrow(); });
it('uses real password helper with scrypt hashes (no legacy rehash grant)', () => {
  const f = materialize(fixture, options.passwords); expect(f.tables.usuarios.every(u => /^[a-f0-9]{128}$/.test(u.password_hash))).toBe(true);
  expect(() => materialize(fixture, {})).toThrow('S04_SYNTHETIC_PASSWORD_REQUIRED');
});
it('model completes fresh initialization but leaves runtime ACCOUNT LOCK', async () => {
  const c = fake(), result = await prepare(c, options); expect(result.state).toBe('PREPARED_LOCKED_REQUIRES_S06');
  expect(options.journal.state).toBe(result.state); expect(c.log.some(s => /ACCOUNT LOCK$/.test(s))).toBe(true);
  expect(c.log.some(s => /ACCOUNT UNLOCK|DROP DATABASE|FOREIGN_KEY_CHECKS\s*=\s*0/i.test(s))).toBe(false);
});
it('rejects repeated Prepare without any further query or secret changes', async () => {
  const c = fake(); await prepare(c, options); const calls = c.log.length, before = JSON.stringify(options.passwords);
  await expect(prepare(c, options)).rejects.toThrow('S04_ALREADY_ATTEMPTED'); expect(c.log).toHaveLength(calls); expect(JSON.stringify(options.passwords)).toBe(before);
});
it.each([
  ['existing database', { existing: true }], ['database created during lock acquisition', { appearAfterLock: true }], ['foreign user', { foreignUser: true }],
  ['PUBLIC grant', { publicGrant: 'GRANT SELECT ON `test`.* TO PUBLIC' }],
  ['foreign datadir', { identity: { datadir: '/production' } }], ['foreign port', { identity: { port: 3306 } }],
  ['remote bind', { identity: { bind: '0.0.0.0' } }], ['wrong installer', { identity: { account: 'sandbox_pricesmart@127.0.0.1' } }],
  ['disabled FK', { identity: { fk: 0 } }], ['wrong version', { identity: { version: '10.6-MariaDB' } }], ['lock held', { busy: true }],
  ['not MariaDB', { identity: { version: '11.8.9-Other' } }], ['non-strict SQL mode', { identity: { mode: '' } }],
])('model rejects %s before DDL', async (_label, patch) => {
  const c = fake(patch); await expect(prepare(c, options)).rejects.toThrow('S04_ABORT_PREFLIGHT'); expect(c.log.some(s => /^CREATE/.test(s))).toBe(false);
});
it.each([{ changeAfter: 5 }, { engine: 'MyISAM' }, { missingFk: true }, { missingIndex: true }, { extraObjects: true }, { orphan: true }])('model aborts unsafe intermediate state %j', async patch => {
  await expect(prepare(fake(patch), options)).rejects.toThrow('S04_ABORT_'); expect(options.journal.state).toContain('INCOMPLETE_DO_NOT_REUSE');
});
it.each([1, 3, 12, 34, 45, 64, 88])('model injected mutation failure %i stops without cleanup/adoption', async failAt => {
  const c = fake({ failAt }); await expect(prepare(c, options)).rejects.toThrow('S04_ABORT_');
  expect(c.log.some(s => /DROP|TRUNCATE|DELETE FROM/.test(s))).toBe(false); expect(options.journal.state).toContain('INCOMPLETE');
});
it('requires new-instance approval before any SQL', async () => { options.approval.newDedicatedInstance = false; const c = fake(); await expect(prepare(c, options)).rejects.toThrow('S04_APPROVED'); expect(c.log).toEqual([]); });
it('rejects TCP or password-based installer before any SQL', async () => { const c = fake(); c.config.socketPath = 'tcp'; await expect(prepare(c, options)).rejects.toThrow('S04_LOCAL_SOCKET_ADMIN_ONLY'); expect(c.log).toEqual([]); });
it('rejects foreign runtime secret through unchanged S02 before SQL', async () => { options.env.DB_PASSWORD = 'production-canary'; const c = fake(); await expect(prepare(c, options)).rejects.toThrow(); expect(c.log).toEqual([]); });
it('runtime grants require exact SELECT per table, marker included', () => expect(validateRuntimeGrants(runtimeGrants())).toBe(true));
it.each([
  'GRANT ALL PRIVILEGES ON *.* TO `sandbox_pricesmart`@`127.0.0.1`',
  'GRANT SELECT ON `other`.`usuarios` TO `sandbox_pricesmart`@`127.0.0.1`',
  'GRANT UPDATE ON `sandbox_pricesmart`.`novalvion_environment` TO `sandbox_pricesmart`@`127.0.0.1`',
  'GRANT SELECT ON `sandbox_pricesmart`.* TO `sandbox_pricesmart`@`127.0.0.1`',
  'GRANT SELECT ON `sandbox_pricesmart`.`usuarios` TO `sandbox_pricesmart`@`127.0.0.1` WITH GRANT OPTION',
  'GRANT some_role TO `sandbox_pricesmart`@`127.0.0.1`',
])('rejects broad/foreign grant %s', grant => expect(() => validateRuntimeGrants([...runtimeGrants(), grant])).toThrow());
it('durable journal rejects non-root Linux owner or cannot be claimed twice after failure', () => {
  if (process.platform === 'linux' && process.getuid() !== 0) { expect(() => fileJournal(root)).toThrow('S04_JOURNAL_OWNER_MODE'); return; }
  const j = fileJournal(root); j.claim(); j.write('INCOMPLETE'); j.close(); const second = fileJournal(root); expect(second.exists()).toBe(true); expect(() => second.claim()).toThrow();
});
