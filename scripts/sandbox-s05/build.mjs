import { readFileSync, writeFileSync, existsSync, cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { checkBuild } from '../infra/pricesmart-build.mjs';
import { checked, sha, pack } from './artifact.mjs';

// Run only from a newly staged, reviewed source tree under the S03 build unit.
// No npm install, no network fallback, no runtime configuration here.
try {
  const root = process.cwd();
  checkBuild(root);
  if (process.platform !== 'linux' || !/^24\./.test(process.versions.node) || readFileSync('/proc/net/route', 'utf8').trim().split('\n').length !== 1) throw new Error('isolation');
  if (process.argv.length !== 4) throw new Error('arguments');
  if (JSON.parse(readFileSync(checked(root, 'node_modules/next/package.json'))).version !== '16.4.1') throw new Error('Next version');
  const destination = resolve(process.argv[2]);
  const commit = process.argv[3];
  if (existsSync('.next') || existsSync('next.config.ts.original')) throw new Error('previous build');
  const config = readFileSync(checked(root, 'next.config.ts'), 'utf8');
  if (!config.includes('const nextConfig: NextConfig = {')) throw new Error('config');
  // Only the disposable build copy is changed. Application configuration remains intact.
  writeFileSync('next.config.ts', config.replace('const nextConfig: NextConfig = {', 'const nextConfig: NextConfig = {\n  output: "standalone",'));
  const journal = join(root, 's05-build-denials');
  writeFileSync(journal, '', { flag: 'wx', mode: 0o600 });
  const guard = checked(root, 'scripts/sandbox-s05/build-guard.cjs');
  const buildSecret = randomBytes(48).toString('hex');
  const result = spawnSync(process.execPath, ['scripts/next-command.mjs', 'build'], {
    stdio: 'inherit', env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', NEXT_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: `--require=${guard}`, S05_DENIAL_JOURNAL: journal, AUTH_SECRET: buildSecret },
  });
  if (result.status !== 0 || result.error || readFileSync(journal).length) throw new Error('build');
  const standalone = checked(root, '.next/standalone');
  // Inspect the actual traced output, not S03's directory-wide deployment allowlist.
  const traced = [];
  function auditTraces(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'standalone' || entry.name === 'cache') continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('trace link');
      if (entry.isDirectory()) auditTraces(path);
      else if (entry.name.endsWith('.nft.json')) {
        const trace = JSON.parse(readFileSync(path));
        if (!Array.isArray(trace.files) || trace.additionalRoots || Object.keys(trace.symlinks ?? {}).length) throw new Error('trace');
        for (const name of trace.files) {
          const absolute = resolve(directory, name);
          const rel = absolute.slice(root.length + 1).replaceAll('\\', '/');
          if (!absolute.startsWith(root + '/') || !/^(node_modules\/|src\/|public\/|\.next\/|scripts\/sandbox-config\.mjs$|package.json$)/.test(rel)) throw new Error('trace escape');
          checked(root, rel);
        }
        traced.push(sha(readFileSync(path)));
      }
    }
  }
  auditTraces(join(root, '.next'));
  if (!traced.length) throw new Error('missing traces');
  for (const name of ['public', '.next/static']) cpSync(checked(root, name), join(standalone, name), { recursive: true, dereference: false, errorOnExist: true, force: false });
  mkdirSync(join(standalone, 'scripts'), { recursive: true });
  for (const [from, to] of [['scripts/sandbox-s05/start-sandbox-s05.mjs', 'start-sandbox-s05.mjs'], ['scripts/sandbox-s05/artifact.mjs', 'artifact.mjs'], ['scripts/sandbox-config.mjs', 'sandbox-config.mjs']]) {
    const input = checked(root, from); const output = join(standalone, 'scripts', to);
    if (existsSync(output)) { if (sha(readFileSync(input)) !== sha(readFileSync(output))) throw new Error('control mismatch'); }
    else cpSync(input, output, { errorOnExist: true, force: false });
  }
  const pkg = JSON.parse(readFileSync(join(standalone, 'package.json')));
  writeFileSync(join(standalone, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, ...(pkg.type ? { type: pkg.type } : {}) }, null, 2) + '\n');
  // Files read dynamically that must not disappear from the trace result.
  for (const name of ['node_modules/next/package.json', 'node_modules/pdfkit/js/data/Helvetica.afm', 'public/brands/monaco/logo.png', '.next/BUILD_ID']) checked(standalone, name);
  writeFileSync(join(standalone, '.next/s05-traces.json'), JSON.stringify(traced.sort()) + '\n', { flag: 'wx' });
  function scanCanary(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('link');
      if (entry.isDirectory()) scanCanary(path);
      else if (readFileSync(path).includes(Buffer.from(buildSecret))) throw new Error('build secret in bundle');
    }
  }
  scanCanary(standalone);
  const next = JSON.parse(readFileSync(checked(root, 'node_modules/next/package.json'))).version;
  console.log(pack(standalone, destination, { next, node: process.versions.node, platform: process.platform, arch: process.arch, commit, lockSha256: sha(readFileSync('package-lock.json')) }));
} catch { console.error('S05_BUILD_REJECTED'); process.exitCode = 1; }
