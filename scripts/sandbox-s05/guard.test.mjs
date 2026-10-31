import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

it.each(["require('node:net').connect(43306,'127.0.0.1')", "require('node:tls').connect(443,'example.invalid')", "fetch('https://example.invalid')", "require('mysql2/promise').createPool({})"] )('preload blocks actual child invocation before I/O', expression => {
  const root = mkdtempSync(join(tmpdir(), 's05-guard-')); const journal = join(root, 'denials');
  try {
    const child = spawnSync(process.execPath, ['--require', resolve('scripts/sandbox-s05/build-guard.cjs'), '-e', `try { ${expression} } catch { process.exitCode=42; }`], {
      env: { ...process.env, S05_DENIAL_JOURNAL: journal }, encoding: 'utf8', timeout: 10000,
    });
    expect(child.status).toBe(42); expect(readFileSync(journal, 'utf8')).toBe('DENIED\n');
    expect(child.stdout).toBe('');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
