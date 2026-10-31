// Manual offline build unit only. No production environment or runtime secrets.
import { lstatSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

export function checkBuild(root, env = process.env) {
  if (Object.keys(env).some(key => /^(DB_|MYSQL_|MARIADB_|SANDBOX_|NOVALVION_ENV$|AUTH_SECRET$|PORTAL_|FEL_|SMTP_|NEXT_PUBLIC_|NODE_OPTIONS$|NODE_PATH$|.*PROXY$)/i.test(key))) throw new Error('S03_BUILD_ENV');
  if (readdirSync(root).some(name => /^\.env(?:\.|$)/.test(name) && name !== '.env.example')) throw new Error('S03_BUILD_ENV_FILE');
  for (let current = resolve(root);;) {
    for (const name of ['.env', 'app.env']) {
      try { lstatSync(join(current, 'config', name)); throw new Error('S03_BUILD_ANCESTOR_CONFIG'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const parent = dirname(current); if (parent === current) break; current = parent;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkBuild(process.cwd());
    // Build only: no NOVALVION_ENV/SANDBOX_*; S02 intentionally rejects sandbox build.
    // This ephemeral auth key is never reused for runtime and is not printed.
    const env = { PATH: '/usr/bin:/bin', HOME: '/nonexistent', NEXT_TELEMETRY_DISABLED: '1', AUTH_SECRET: randomBytes(48).toString('hex') };
    const child = spawn(process.execPath, ['scripts/next-command.mjs', 'build'], { cwd: process.cwd(), env, stdio: 'inherit' });
    child.on('error', () => { console.error('S03_BUILD_SPAWN'); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
  } catch { console.error('S03_BUILD_REJECTED'); process.exitCode = 1; }
}
