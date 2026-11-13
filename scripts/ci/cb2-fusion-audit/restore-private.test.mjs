import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./restore-private.mjs', import.meta.url), 'utf8');
const backup = 'CREATE DATABASE u611730801_Plataforma; -- BACKUP';
const cb2 = '-- CB2';
const fusion = '-- FUSION\nDELIMITER //\n-- FUSION TAIL\nDELIMITER ;';
const postcheck = '-- POSTCHECK';

// Execute the actual runner with isolated I/O doubles: no backup, files, processes,
// database, credentials or flags are accessed by these failure-path regressions.
function laboratory(failure = null) {
  const calls = [], evidence = new Map();
  let integrationRuns = 0, partialObjects = false;
  const result = (status = 0, stdout = '', stderr = '') => ({ status, stdout, stderr });
  const manifest = {
    zipSha256: 'verified',
    files: Object.fromEntries(['mariadb.exe', 'mariadbd.exe', 'mariadb-install-db.exe'].map(n => ['bin/' + n, 'verified'])),
  };
  const fs = {
    readFileSync(file) {
      if (file.endsWith('engine-manifest.json')) return JSON.stringify(manifest);
      if (file === 'private-backup.sql') return backup;
      if (file.endsWith('migrate-2026-11-cb2-terceros-directos.sql')) return cb2;
      if (file.endsWith('migrate-2026-11-flota-fusiones.sql')) return fusion;
      if (file.endsWith('postcheck-2026-11-flota-fusiones.sql')) return postcheck;
      if (file.endsWith('.zip') || file.endsWith('.exe')) return Buffer.from('verified engine fixture');
      throw Error('Unexpected read: ' + file);
    },
    mkdirSync() {}, openSync() { return 1; }, closeSync() {},
    writeFileSync(file, data) { evidence.set(path.basename(file), data); },
  };
  const cp = {
    spawn() { return { exitCode: 0, kill() { throw Error('Unexpected forced shutdown'); } }; },
    spawnSync(exe, args, options) {
      if (exe === 'fixture-node') {
        integrationRuns++;
        // Deliberately permissive: partial objects could let integration pass.
        return result();
      }
      if (path.basename(exe) === 'mariadb-install-db.exe') return result();
      assert.equal(path.basename(exe), 'mariadb.exe');
      const sql = options.input;
      calls.push(sql);
      if (sql === 'SELECT VERSION(),@@skip_networking,@@socket;') return result(0, '11.8.9-MariaDB\t1\tcb2-audit-fixture');
      if (sql === 'USE u611730801_Plataforma;\n' + fusion) partialObjects = true;
      if (failure?.sql === sql) return result(failure.status, '', 'SQL error after partial DDL');
      // The intentional restricted-user error is independently checked by the runner.
      if (args.includes('-ulab_ddl')) return result(1, '', 'TRIGGER command denied');
      if (sql === 'USE u611730801_Plataforma;\n' + postcheck) return result(0, '4\n0\n');
      if (sql === 'USE cb2_partial;\n' + postcheck) return result(0, 'ffi_missing\nffu_missing\n4\n1\n');
      return result();
    },
  };
  const context = {
    fs, path, cp, assert, Buffer,
    randomUUID: () => 'fixture',
    createHash: () => ({ update() { return this; }, digest: () => 'verified' }),
    process: { argv: ['fixture-node', 'runner', 'private-backup.sql'], execPath: 'fixture-node', env: {} },
    console: { log() {} },
    setTimeout() { throw Error('Unexpected wait'); },
  };
  const run = () => vm.runInNewContext('(async () => {\n' + source.replace(/^import .*;\r?\n/gm, '') + '\n})()', context);
  return { run, calls, evidence, get integrationRuns() { return integrationRuns; }, get partialObjects() { return partialObjects; } };
}

for (const status of [1, null]) {
  test(`fusion SQL status ${status} stops before integration/postchecks despite partial objects`, async () => {
    const lab = laboratory({ sql: 'USE u611730801_Plataforma;\n' + fusion, status });
    await assert.rejects(lab.run(), /fusion-original: SQL failed/);
    assert.equal(lab.partialObjects, true);
    assert.equal(lab.integrationRuns, 0);
    assert.equal(lab.calls.some(sql => sql.includes(postcheck)), false);
    assert.equal(lab.calls.some(sql => sql.includes('cb2_partial')), false);
    assert.equal(JSON.parse(lab.evidence.get('fusion-original.json')).status, status);
    assert.equal(lab.calls.at(-1), 'SHUTDOWN;');
  });
}

test('an earlier SQL error also aborts without running fusion or integration', async () => {
  const lab = laboratory({ sql: 'USE u611730801_Plataforma;\n' + cb2, status: 1 });
  await assert.rejects(lab.run(), /cb2: SQL failed/);
  assert.equal(lab.partialObjects, false);
  assert.equal(lab.integrationRuns, 0);
  assert.equal(lab.calls.at(-1), 'SHUTDOWN;');
});

test('a final SQL error cannot report success after passing integration and postchecks', async () => {
  const sql = 'USE u611730801_Plataforma;\nSELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE(); SELECT COUNT(*) FROM flota_vehiculos_fusiones;';
  const lab = laboratory({ sql, status: 1 });
  await assert.rejects(lab.run(), /schema-check: SQL failed/);
  assert.equal(lab.integrationRuns, 1);
  assert.equal(lab.calls.at(-1), 'SHUTDOWN;');
});

test('successful SQL retains integration, postchecks and the expected privilege-failure scenario', async () => {
  const lab = laboratory();
  await lab.run();
  assert.equal(lab.integrationRuns, 1);
  assert.equal(JSON.parse(lab.evidence.get('partial-failure.json')).status, 1);
  assert.equal(lab.calls.filter(sql => sql.includes(postcheck)).length, 2);
  assert.equal(lab.calls.at(-1), 'SHUTDOWN;');
});
