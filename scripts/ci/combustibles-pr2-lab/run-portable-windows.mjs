import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runNativeLaboratory } from './run.mjs';

// Solo MariaDB portable de este workspace; sin endpoints, credenciales ni SQL de entrada.
assert.equal(process.platform, 'win32');
assert.deepEqual(process.argv.slice(2), ['--run-isolated']);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runtime = path.join(repo, '.lab-runtime');
const binaryRoot = path.join(runtime, 'mariadb-11.8.9-winx64');
const bin = name => path.join(binaryRoot, 'bin', `${name}.exe`);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const zip = fs.readFileSync(path.join(runtime, 'mariadb-11.8.9-winx64.zip'));
const sums = fs.readFileSync(path.join(runtime, 'sha256sums.txt'), 'utf8');
const expected = sums.split(/\r?\n/).find(line => /[ *](?:\.\/)?mariadb-11\.8\.9-winx64\.zip$/.test(line))?.split(/\s+/)[0];
assert.match(expected ?? '', /^[0-9a-f]{64}$/i);
assert.equal(sha256(zip), expected.toLowerCase(), 'ZIP no coincide con suma oficial');
const runDir = path.join(runtime, `run-${randomUUID()}`);
const evidence = path.join(runDir, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(evidence, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
const childEnv = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: runDir, TMP: runDir, PATH: `${path.join(binaryRoot, 'bin')};${process.env.SystemRoot}\\System32` };
const executeFile = (exe, args, input = '', timeout = 120000) => spawnSync(exe, args, { input, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024, env: childEnv, cwd: runDir });
const instances = new Map();
const wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const clientArgs = instance => ['--no-defaults', '--protocol=PIPE', '--host=.', `--socket=${instance.pipe}`, '-uroot', '--batch', '--raw', '--skip-column-names', '--default-character-set=utf8mb4'];
const sourcePaths = ['run.mjs', 'run-portable-windows.mjs', 'build-phpmyadmin-import.mjs', 'base.sql', 'seed.sql', 'associate.sql'].map(n => path.join(repo, 'scripts/ci/combustibles-pr2-lab', n)).concat(['preflight', 'migrate', 'postcheck'].map(n => path.join(repo, `sql/${n}-2026-10-combustibles-pr2-consumos-facturas.sql`)));
sourcePaths.push(path.join(repo, 'sql/import-phpmyadmin-2026-10-combustibles-pr2.sql'));
save('source.json', { baseline: 'bc12de32f9b3ba3666df4d89ee8707e66cf0b1b4', dateUTC: new Date().toISOString(), platform: process.platform, node: process.version, archiveURL: 'https://archive.mariadb.org/mariadb-11.8.9/winx64-packages/mariadb-11.8.9-winx64.zip', archiveSHA256: sha256(zip), binaries: Object.fromEntries(['mariadbd', 'mariadb', 'mariadb-install-db'].map(n => [n, sha256(fs.readFileSync(bin(n)))])), files: Object.fromEntries(sourcePaths.map(p => [path.relative(repo, p), sha256(fs.readFileSync(p))])) });
console.log(`Evidencia: ${evidence}`);
try {
  runNativeLaboratory({
    evidence,
    execute(id, input, db) {
      const instance = instances.get(id); assert(instance);
      return executeFile(bin('mariadb'), [...clientArgs(instance), ...(db ? ['--database=cb2_lab'] : [])], input);
    },
    laboratory(label, action, fixture, query) {
      const id = `cb2-${randomUUID()}`;
      const datadir = path.join(runDir, id);
      assert(datadir.startsWith(runDir + path.sep));
      const init = executeFile(bin('mariadb-install-db'), [`--datadir=${datadir}`, `--socket=${id}`, '--skip-networking']);
      save(`${label}-init.json`, { status: init.status, stdout: init.stdout, stderr: init.stderr, error: init.error?.message });
      assert.equal(init.status, 0, init.stderr || init.stdout);
      const instance = { datadir, pipe: id };
      const args = ['--no-defaults', `--basedir=${binaryRoot}`, `--datadir=${datadir}`, '--skip-networking', '--enable-named-pipe', `--socket=${id}`, '--sql-mode=STRICT_ALL_TABLES', '--group-concat-max-len=8192', '--innodb-strict-mode=ON', '--innodb-buffer-pool-size=64M', '--console'];
      const out = fs.openSync(path.join(evidence, `${label}-server.log`), 'w');
      const child = spawn(bin('mariadbd'), args, { stdio: ['ignore', out, out], env: childEnv, cwd: runDir, windowsHide: true });
      fs.closeSync(out);
      instances.set(id, instance);
      save(`${label}-process.json`, { pid: child.pid, exe: bin('mariadbd'), args, datadir, pipe: id });
      try {
        let ready = false;
        for (let i = 0; i < 60; i++) {
          const probe = executeFile(bin('mariadb'), clientArgs(instance), 'SELECT VERSION();', 2000);
          if (probe.status === 0) { assert.match(probe.stdout.trim(), /^11\.8\.9-MariaDB/); ready = true; break; }
          wait(500);
        }
        assert(ready, 'MariaDB portable no inicializada; revisar server.log');
        const isolation = query(id, `${label}-isolation`, 'SELECT @@skip_networking, @@named_pipe, @@socket, @@datadir, VERSION();', 0, '', false).trim().split('\t');
        assert.deepEqual(isolation.slice(0, 3), ['1', '1', id]);
        assert.equal(path.resolve(isolation[3]), path.resolve(datadir));
        save(`${label}-isolation.json`, { transport: 'local named pipe (--host=.)', skipNetworking: true, namedPipe: true, datadir, pid: child.pid, version: isolation[4] });
        query(id, `${label}-crear`, 'CREATE DATABASE cb2_lab CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;', 0, '', false);
        query(id, `${label}-base`, fixture('base'));
        query(id, `${label}-version`, 'SELECT VERSION(),@@sql_mode,@@innodb_page_size,@@foreign_key_checks,@@check_constraint_checks,@@group_concat_max_len,@@skip_networking,@@innodb_strict_mode;');
        action(id);
      } catch (error) {
        try {
          query(id, label + '-fallo-preflight', fs.readFileSync(path.join(repo, 'sql/preflight-2026-10-combustibles-pr2-consumos-facturas.sql'), 'utf8'));
          for (const table of ['flota_cb2_importaciones', 'flota_cb2_facturas', 'flota_cb2_consumos', 'flota_cb2_filas']) query(id, label + '-fallo-ddl-' + table, `SHOW CREATE TABLE ${table};`);
        } catch (diagnosticError) { save(label + '-diagnostico-error.txt', diagnosticError.stack); }
        throw error;
      } finally {
        const shutdown = executeFile(bin('mariadb'), clientArgs(instance), 'SHUTDOWN;', 10000);
        save(`${label}-shutdown.json`, { status: shutdown.status, stdout: shutdown.stdout, stderr: shutdown.stderr });
        if (shutdown.status !== 0 && child.pid) child.kill();
        // Verificar que ya no acepta conexiones a la tuberia local exclusiva; nunca tocar servicios ajenos.
        let stopped = false;
        for (let i = 0; i < 40; i++) {
          const probe = executeFile(bin('mariadb'), clientArgs(instance), 'SELECT 1;', 1000);
          if (probe.status !== 0) { stopped = true; break; }
          wait(250);
        }
        save(`${label}-cleanup.json`, { stopped, pid: child.pid, datadirPreserved: true });
        instances.delete(id);
        assert(stopped, 'Servidor de pruebas sigue aceptando conexiones');
      }
    },
  });
} catch (error) {
  save('failure.txt', error.stack ?? error.message);
  process.exitCode = 1;
  console.error(error.stack);
}
