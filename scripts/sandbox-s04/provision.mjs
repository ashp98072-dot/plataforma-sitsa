// No driver, credentials reader, --apply or live CLI. S06 must supply an approved
// SINGLE physical admin socket connection and durable exclusive journal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateSandboxConfig, assertSandboxPath } from '../sandbox-config.mjs';
import { buildPlan, grantSql, referentialChecks, indexSignatures } from './plan.mjs';
import { loadFixtures, materialize, fixtureStatements, validateFixtures } from './fixtures.mjs';

export function fileJournal(directory) {
  assertSandboxPath(directory, directory, true);
  const dir = fs.lstatSync(directory); assert.ok(dir.isDirectory() && !dir.isSymbolicLink(), 'S04_JOURNAL_DIRECTORY');
  if (process.platform === 'linux') assert.ok(dir.uid === 0 && (dir.mode & 0o077) === 0, 'S04_JOURNAL_OWNER_MODE');
  const file = path.join(directory, 's04-attempt.json'); let fd;
  return {
    exists: () => fs.existsSync(file),
    claim() { fd = fs.openSync(file, 'wx', 0o600); },
    write(state) { fs.ftruncateSync(fd); fs.writeSync(fd, JSON.stringify({ state }), 0, 'utf8'); fs.fsyncSync(fd); },
    close() { if (fd !== undefined) fs.closeSync(fd); },
  };
}
export function validateRuntimeGrants(grants, plan = buildPlan()) {
  const found = new Set(); let usage = false;
  for (const raw of grants) {
    const sql = typeof raw === 'string' ? raw : String(Object.values(raw)[0]);
    const m = /^GRANT (.+) ON (.+) TO [`']sandbox_pricesmart[`']@[`']127\.0\.0\.1[`'](?: IDENTIFIED BY PASSWORD '[^']*'| IDENTIFIED VIA mysql_native_password USING '[^']*')?$/.exec(sql);
    assert.ok(m, 'S04_GRANT_ACCOUNT_OR_ROLE');
    if (m[1] === 'USAGE' && m[2] === '*.*') { assert.ok(!usage); usage = true; continue; }
    const target = /^`sandbox_pricesmart`\.`([a-z0-9_]+)`$/.exec(m[2]);
    assert.ok(target && m[1] === 'SELECT' && plan.grants.some(g => g.table === target[1]) && !found.has(target[1]), 'S04_FORBIDDEN_GRANT');
    found.add(target[1]);
  }
  assert.equal(found.size, plan.grants.length, 'S04_MISSING_GRANT'); return true;
}
export async function prepare(conn, { env, cwd, approval, journal, passwords }) {
  const plan = buildPlan();
  assert.deepEqual(plan, JSON.parse(fs.readFileSync(new URL('../../infra/pricesmart-sandbox/s04/plan.json', import.meta.url), 'utf8')), 'S04_REVIEWED_PLAN_DRIFT');
  validateSandboxConfig(env, cwd); // Reuse S02; never a second secrets/manifest policy.
  assert.equal(env.SANDBOX_ID, plan.id); assert.equal(env.DB_NAME, plan.database); assert.equal(env.DB_USER, plan.user); assert.equal(env.DB_PORT, '43306');
  assert.ok(approval?.authorizedForS06 === true && approval.newDedicatedInstance === true && /^[a-f0-9]{64}$/.test(approval.evidenceSha256 ?? '') && approval.datadir === '/var/lib/novalvion-ps-db' && approval.socket === '/run/novalvion-ps-db/mariadb.sock', 'S04_APPROVED_NEW_INSTANCE_REQUIRED');
  assert.ok(conn.config?.socketPath === approval.socket && conn.config.user === 'root' && !conn.config.password && !conn.config.database, 'S04_LOCAL_SOCKET_ADMIN_ONLY');
  assert.ok(!journal.exists(), 'S04_ALREADY_ATTEMPTED');
  const secrets = Object.values(passwords ?? {});
  assert.ok(secrets.length === 3 && new Set(secrets).size === 3 && secrets.every(s => ![env.DB_PASSWORD, env.AUTH_SECRET, env.PORTAL_CREDENTIALS_KEY].includes(s)), 'S04_SEPARATE_QA_PASSWORDS');
  const fixture = materialize(loadFixtures(), passwords); validateFixtures(fixture, plan);
  const rows = async (sql, params = []) => (await conn.query(sql, params))[0];
  let connectionId, claimed = false, locked = false, transaction = false, phase = 'PREFLIGHT';
  const identity = async () => {
    const [r] = await rows('SELECT VERSION() version,@@datadir datadir,@@port port,@@bind_address bind,@@foreign_key_checks fk,@@check_constraint_checks checks,@@local_infile localInfile,@@sql_mode mode,CURRENT_USER() account,USER() login,CONNECTION_ID() connectionId');
    assert.ok(r && /^11\.8\.\d+.*MariaDB/.test(r.version) && String(r.datadir).replace(/\/$/, '') === approval.datadir && Number(r.port) === 43306 && r.bind === '127.0.0.1' && Number(r.fk) === 1 && Number(r.checks) === 1 && Number(r.localInfile) === 0 && /(?:^|,)STRICT_(?:TRANS|ALL)_TABLES(?:,|$)/.test(r.mode) && r.account === 'root@localhost' && r.login === 'root@localhost' && Number(r.connectionId) > 0, 'S04_IDENTITY');
    if (connectionId) assert.equal(Number(r.connectionId), connectionId, 'S04_CONNECTION_CHANGED');
    connectionId = Number(r.connectionId);
  };
  const empty = async () => {
    const databases = await rows('SELECT SCHEMA_NAME name FROM information_schema.SCHEMATA');
    assert.ok(databases.every(r => ['mysql', 'sys', 'information_schema', 'performance_schema'].includes(r.name)), 'S04_NONEMPTY_INSTANCE');
    const users = await rows('SELECT User name,Host host FROM mysql.user');
    assert.ok(users.every(r => ['root', 'mysql', 'mariadb.sys', 'novalvion-ps-db'].includes(r.name) && r.host === 'localhost'), 'S04_UNEXPECTED_ACCOUNT');
    const grants = await rows('SHOW GRANTS FOR PUBLIC');
    assert.ok(grants.every(r => /^GRANT USAGE ON \*\.\* TO PUBLIC$/.test(String(Object.values(r)[0]))), 'S04_PUBLIC_GRANTS');
  };
  const mutate = async (sql, params = []) => { await identity(); return conn.query(sql, params); };
  try {
    await identity(); await empty();
    journal.claim(); claimed = true; journal.write('INITIALIZING');
    const [lock] = await rows("SELECT GET_LOCK('pricesmart-s04-install',0) acquired"); assert.equal(Number(lock.acquired), 1, 'S04_BUSY'); locked = true;
    await identity(); await empty(); // Recheck under lock; never adopt a pre-existing DB.
    phase = 'DDL';
    await mutate('CREATE DATABASE sandbox_pricesmart CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await mutate('USE sandbox_pricesmart');
    for (const sql of plan.ddl) await mutate(sql);
    const objects = await rows("SELECT TABLE_NAME name,TABLE_TYPE type,ENGINE engine FROM information_schema.TABLES WHERE TABLE_SCHEMA='sandbox_pricesmart'");
    assert.deepEqual(objects.map(r => r.name).sort(), plan.grants.map(g => g.table).sort(), 'S04_TABLE_SET');
    assert.ok(objects.every(r => r.type === 'BASE TABLE' && r.engine === 'InnoDB'), 'S04_TABLE_ENGINE');
    const indexes = await rows("SELECT TABLE_NAME tableName,NON_UNIQUE nonUnique,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='sandbox_pricesmart' GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE");
    const actualIndexes = new Set(indexes.map(r => `${r.tableName}:${Number(r.nonUnique)}:${r.cols}`));
    assert.ok(indexSignatures(plan).every(s => actualIndexes.has(s)), 'S04_MISSING_INDEX');
    const constraints = await rows("SELECT CONSTRAINT_NAME name FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='sandbox_pricesmart'");
    assert.deepEqual(constraints.map(r => r.name).sort(), plan.foreignKeys.map(fk => fk.name).sort(), 'S04_FK_SET');
    const extras = await rows("SELECT TRIGGER_NAME name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='sandbox_pricesmart' UNION ALL SELECT ROUTINE_NAME name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='sandbox_pricesmart' UNION ALL SELECT EVENT_NAME name FROM information_schema.EVENTS WHERE EVENT_SCHEMA='sandbox_pricesmart'");
    assert.equal(extras.length, 0, 'S04_EXTRA_OBJECTS');
    phase = 'FIXTURES';
    await mutate('START TRANSACTION'); transaction = true;
    await mutate("INSERT INTO novalvion_environment VALUES (1,'sandbox','pricesmart-qa')");
    for (const command of fixtureStatements(fixture, plan)) await mutate(command.sql, command.params);
    for (const sql of referentialChecks(plan)) { await identity(); const [r] = await rows(sql); assert.equal(Number(r.errors), 0, 'S04_REFERENTIAL_INTEGRITY'); }
    for (const table of plan.tables) {
      const [r] = await rows(`SELECT COUNT(*) n FROM \`${table.name}\``); assert.equal(Number(r.n), fixture.tables[table.name]?.length ?? 0, 'S04_ROW_COUNT');
    }
    await mutate('COMMIT'); transaction = false;
    phase = 'GRANTS';
    // Hold account locked even on success. Runtime credentials may NOT be issued
    // until approved S06 native tests and an explicit operator unlock.
    await mutate("CREATE USER 'sandbox_pricesmart'@'127.0.0.1' IDENTIFIED BY ? ACCOUNT LOCK", [env.DB_PASSWORD]);
    for (const sql of grantSql(plan)) await mutate(sql);
    validateRuntimeGrants(await rows("SHOW GRANTS FOR 'sandbox_pricesmart'@'127.0.0.1'"), plan);
    journal.write('PREPARED_LOCKED_REQUIRES_S06');
    return { state: 'PREPARED_LOCKED_REQUIRES_S06', tables: plan.tables.length + 1, fixtureRows: Object.values(fixture.tables).reduce((n, r) => n + r.length, 0), runtimeAccountLocked: true };
  } catch {
    if (transaction) try { await identity(); await conn.query('ROLLBACK'); } catch { /* Preserve failure and partial DDL, never reset. */ }
    if (claimed) journal.write(`INCOMPLETE_DO_NOT_REUSE_${phase}`);
    throw new Error(`S04_ABORT_${phase}`); // No raw SQL/driver/password errors.
  } finally {
    if (locked) try { await identity(); await conn.query("SELECT RELEASE_LOCK('pricesmart-s04-install')"); } catch { /* S06 owns connection lifecycle. */ }
    journal.close();
  }
}
