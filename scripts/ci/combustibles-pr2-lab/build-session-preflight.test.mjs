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
