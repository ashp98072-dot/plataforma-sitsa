import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildImport, compoundBody, importOutput } from './build-phpmyadmin-import.mjs';

test('import publicado exacto, sin BOM y con los tres contratos integros', () => {
  const content = buildImport();
  const bytes = readFileSync(importOutput);
  assert.deepEqual(bytes, Buffer.from(content, 'utf8'));
  assert(bytes.subarray(0, 4).equals(Buffer.from('USE ')));
  assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
  assert.equal((content.match(/^USE /gm) || []).length, 1);
  assert.equal((content.match(/^DELIMITER /gm) || []).length, 2);
  assert.equal((content.match(/^BEGIN NOT ATOMIC$/gm) || []).length, 1);
  assert.equal((content.match(/-- BEGIN CB2_METADATA_CANONICO/g) || []).length, 4);
  for (const name of ['preflight', 'migrate', 'postcheck']) {
    const source = readFileSync(new URL(`../../../sql/${name}-2026-10-combustibles-pr2-consumos-facturas.sql`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert(content.includes(compoundBody(source)), name + ': cuerpo canonico preservado');
    if (name === 'migrate') assert.deepEqual(content.match(/^CREATE TABLE [\s\S]*?COLLATE=utf8mb4_bin;/gm), source.match(/^CREATE TABLE [\s\S]*?COLLATE=utf8mb4_bin;/gm));
  }
  assert(content.includes('DECLARE EXIT HANDLER FOR SQLEXCEPTION'));
  assert(content.includes('RESIGNAL;'));
  assert.equal((content.match(/SET SESSION sql_mode = v_cb2_mode;/g) || []).length, 2);
  assert.equal((content.match(/SET SESSION innodb_strict_mode = v_cb2_innodb;/g) || []).length, 2);
  assert(content.includes("SET @cb2_schema = _utf8mb4'u611730801_Plataforma';"));
  assert(!/SET\s+(?:@@)?GLOBAL/i.test(content));
  for (const schema of ['information_schema', 'mysql', 'SYS', 'a`b', 'a;DROP TABLE x', '']) assert.throws(() => buildImport(schema));
});
