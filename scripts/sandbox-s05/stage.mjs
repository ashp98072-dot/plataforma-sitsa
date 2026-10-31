import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checked, checkRoot } from './artifact.mjs';
import { checkBuild } from '../infra/pricesmart-build.mjs';

export function stage(source, destination) {
  checkBuild(source);
  const clean = spawnSync('git', ['diff', '--quiet', 'HEAD', '--'], { cwd: source });
  if (clean.status !== 0) throw new Error('S05_STAGE_DIRTY');
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: source, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('S05_STAGE_GIT');
  const fixed = new Set(['package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs',
    'scripts/next-command.mjs', 'scripts/sandbox-config.mjs', 'scripts/infra/pricesmart-build.mjs',
    'scripts/sandbox-s05/build.mjs', 'scripts/sandbox-s05/build-guard.cjs', 'scripts/sandbox-s05/artifact.mjs', 'scripts/sandbox-s05/start-sandbox-s05.mjs']);
  const names = result.stdout.split('\0').filter(name => fixed.has(name) || /^(src|public)\//.test(name)).sort();
  for (const name of fixed) if (!names.includes(name)) throw new Error('S05_STAGE_MISSING');
  const inputs = names.map(name => {
    const path = checked(source, name);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:mysql|mariadb):\/\/[^\s]+/.test(readFileSync(path).toString('utf8'))) throw new Error('S05_STAGE_SECRET');
    return [name, path];
  });
  // Validate destination ancestry before creating anything. Never overwrite/adopt a tree.
  checkRoot(dirname(resolve(destination)));
  mkdirSync(destination, { mode: 0o700 });
  for (const [name, path] of inputs) {
    mkdirSync(dirname(join(destination, name)), { recursive: true, mode: 0o700 });
    copyFileSync(path, join(destination, name), 1);
  }
  writeFileSync(join(destination, 's05-source-files.json'), JSON.stringify(names, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return names.length;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('arguments');
    console.log(`S05_STAGE_FILES=${stage(resolve(process.argv[2]), resolve(process.argv[3]))}`);
  } catch { console.error('S05_STAGE_REJECTED'); process.exitCode = 1; }
}
