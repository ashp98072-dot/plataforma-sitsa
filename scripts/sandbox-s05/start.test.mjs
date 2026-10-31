import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it.each([{}, { NOVALVION_ENV: 'sandbox', S05_ARTIFACT_SHA256: '0'.repeat(64) }])('real supervisor rejects incomplete/untrusted configuration without launching server', env => {
  const root = mkdtempSync(join(tmpdir(), 's05-start-')); mkdirSync(join(root, 'scripts'));
  try {
    for (const [from, to] of [['scripts/sandbox-s05/start-sandbox-s05.mjs', 'start-sandbox-s05.mjs'], ['scripts/sandbox-s05/artifact.mjs', 'artifact.mjs'], ['scripts/sandbox-config.mjs', 'sandbox-config.mjs']]) copyFileSync(resolve(from), join(root, 'scripts', to));
    writeFileSync(join(root, 'server.js'), "require('node:fs').writeFileSync('unexpected-start', 'BAD')");
    const child = spawnSync(process.execPath, [join(root, 'scripts/start-sandbox-s05.mjs')], { cwd: root, env, encoding: 'utf8', timeout: 10000 });
    expect(child.status).toBe(1); expect(child.stderr.trim()).toBe('S05_START_REJECTED');
    expect(child.stdout).toBe(''); expect(existsSync(join(root, 'unexpected-start'))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
