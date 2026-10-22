import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const generator = fileURLToPath(new URL('./build-session-preflight.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [generator, ...args]);

test('archivo directo y stdout: UTF-8 sin BOM, SELECT inicial y preflight intacto', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb2-encoding-'));
  try {
    const file = join(dir, 'preflight con espacios.sql');
    const result = run('--output', file);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stdout.length, 0);
    const bytes = readFileSync(file);
    assert.deepEqual([...bytes.subarray(0, 6)], [0x53, 0x45, 0x4c, 0x45, 0x43, 0x54]);
    assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assert(text.startsWith("SELECT 'ANTES'"));
    const preflight = readFileSync(new URL('../../../sql/preflight-2026-10-combustibles-pr2-consumos-facturas.sql', import.meta.url));
    const offset = bytes.indexOf(preflight);
    assert(offset > 0);
    assert.equal(bytes.indexOf(preflight, offset + 1), -1);
    const stdout = run();
    assert.equal(stdout.status, 0);
    assert.deepEqual(stdout.stdout, bytes);
    assert.equal(run('--check', file).status, 0);
    // Reproduce exactamente el prefijo que agrega Set-Content -Encoding utf8 en PS 5.1.
    for (const [label, bad, error] of [
      ['BOM de Windows PowerShell', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]), /BOM UTF-8/],
      ['UTF-16LE de redireccion antigua', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]), /encoded data|encoding/i],
      ['comentario inicial', Buffer.concat([Buffer.from('-- cabecera\n'), bytes]), /empezar directamente/],
      ['UTF-8 invalido', Buffer.concat([bytes, Buffer.from([0xff])]), /encoded data|encoding/i],
      ['contenido truncado', bytes.subarray(0, bytes.length - 10), /no coincide/],
    ]) {
      writeFileSync(file, bad);
      const check = run('--check', file);
      assert.notEqual(check.status, 0, label);
      assert.match(check.stderr.toString(), error, label);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('metadata usa objetivo explicito aunque el contexto sea information_schema', () => {
  const contracts = [];
  for (const name of ['preflight', 'migrate', 'postcheck']) {
    const sql = readFileSync(new URL(`../../../sql/${name}-2026-10-combustibles-pr2-consumos-facturas.sql`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    contracts.push(...[...sql.matchAll(/-- BEGIN CB2_METADATA_CANONICO\n([\s\S]*?)\n-- END CB2_METADATA_CANONICO/g)].map(m => m[1]));
    if (name !== 'preflight') assert(sql.includes('COALESCE(CONVERT(DATABASE() USING utf8mb4) COLLATE utf8mb4_bin ='));
  }
  assert.equal(contracts.length, 4);
  assert.equal(new Set(contracts).size, 1);
  const validate = contract => {
    assert(!contract.includes('DATABASE()'), 'no depender del esquema seleccionado');
    assert(contract.includes('@cb2_schema IS NOT NULL'));
    assert.equal((contract.match(/CONVERT\(@cb2_schema USING utf8mb4\) COLLATE utf8mb4_bin/g) || []).length, 16);
    for (const check of ['@@innodb_strict_mode = 1', '@@foreign_key_checks = 1', '@@check_constraint_checks = 1', "FIND_IN_SET('STRICT_ALL_TABLES', @@sql_mode)", '= 86', '= 34', '= 18', '= 26']) assert(contract.includes(check), check);
  };
  validate(contracts[0]);
  assert.throws(() => validate(contracts[0].replaceAll('@cb2_schema', 'DATABASE()')));
  assert.throws(() => validate(contracts[0].replace('@@innodb_strict_mode = 1', '1 = 1')));
  const generated = run().stdout.toString();
  assert(generated.includes("SET @cb2_schema = _utf8mb4'u611730801_Plataforma';"));
  assert(generated.includes('SET SESSION innodb_strict_mode = ON;'));
  assert(generated.includes('SET SESSION innodb_strict_mode = @cb2_audit_innodb_before;'));
  assert(!/SET\s+(?:@@)?GLOBAL/i.test(generated));
});
