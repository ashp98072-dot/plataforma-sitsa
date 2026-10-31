import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync, copyFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = () => { throw new Error('S05_ARTIFACT_REJECTED'); };
export const sha = value => createHash('sha256').update(value).digest('hex');
export function checkRoot(root) {
  for (let p = resolve(root);; p = dirname(p)) {
    if (lstatSync(p).isSymbolicLink() || realpathSync(p).toLowerCase() !== p.toLowerCase()) fail();
    if (dirname(p) === p) break;
  }
}
export function checked(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || name.split('/').some(x => !x || x === '.' || x === '..') || isAbsolute(name)) fail();
  const base = resolve(root);
  checkRoot(base);
  let current = base;
  for (const part of name.split('/')) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) fail();
  }
  return current;
}
function files(root, prefix = '') {
  const result = [];
  for (const name of readdirSync(prefix ? checked(root, prefix) : root).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(checked(root, rel));
    if (stat.isDirectory()) result.push(...files(root, rel));
    else if (stat.isFile() && stat.nlink === 1) result.push(rel);
    else fail();
  }
  return result;
}
export function allowed(name) {
  if (/(^|\/)(\.env[^/]*|\.git|uploads?|private|\.cache|cache|test[s]?|__tests__|coverage|\.bin)(\/|$)/i.test(name) || /\.(?:map|sql|pem|key|p12|pfx|log|tsbuildinfo)$/i.test(name)) return false;
  return ['server.js', 'package.json', 'scripts/start-sandbox-s05.mjs', 'scripts/sandbox-config.mjs', 'scripts/artifact.mjs'].includes(name) ||
    /^(?:node_modules\/.+|\.next\/(?:server\/.+|static\/.+|[a-zA-Z0-9_-]+\.(?:json|js)|BUILD_ID)|public\/.+)$/.test(name);
}
function content(bytes) {
  // Heuristics are additional rejection rules, not proof that arbitrary source is secret-free.
  if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----|(?:mysql|mariadb):\/\/[^\s]+|sandbox:[a-z0-9-]+:[a-f0-9]{64}/i.test(bytes.toString('utf8'))) fail();
}
export function verify(root, expectedDigest, runtimeCache = false) {
  if (!/^[a-f0-9]{64}$/.test(expectedDigest ?? '')) fail();
  const bytes = readFileSync(checked(root, 'artifact.json'));
  if (sha(bytes) !== expectedDigest) fail();
  const manifest = JSON.parse(bytes);
  if (manifest.version !== 1 || manifest.profile !== 'S05-standalone-candidate' || !Array.isArray(manifest.files)) fail();
  if (manifest.next !== '16.4.1' || manifest.platform !== 'linux' || !/^[a-f0-9]{40}$/.test(manifest.commit ?? '') || !/^[a-f0-9]{64}$/.test(manifest.lockSha256 ?? '')) fail();
  if (JSON.stringify(manifest.mutablePaths) !== JSON.stringify(['.next/cache'])) fail();
  const names = manifest.files.map(x => x.path);
  if (new Set(names.map(x => x.toLowerCase())).size !== names.length || JSON.stringify(names) !== JSON.stringify([...names].sort())) fail();
  if (JSON.stringify(files(root).filter(x => x !== 'artifact.json' && !(runtimeCache && x.startsWith('.next/cache/'))).sort()) !== JSON.stringify(names)) fail();
  for (const item of manifest.files) {
    if (!allowed(item.path)) fail();
    const data = readFileSync(checked(root, item.path)); content(data);
    if (data.length !== item.size || sha(data) !== item.sha256) fail();
  }
  for (const required of ['server.js', 'package.json', '.next/BUILD_ID', 'scripts/start-sandbox-s05.mjs', 'scripts/sandbox-config.mjs', 'scripts/artifact.mjs']) if (!names.includes(required)) fail();
  return manifest;
}
export function pack(source, destination, metadata) {
  if (metadata?.next !== '16.4.1' || metadata?.platform !== 'linux' || !/^[a-f0-9]{40}$/.test(metadata?.commit ?? '') || !/^[a-f0-9]{64}$/.test(metadata?.lockSha256 ?? '')) fail();
  // Source is the isolated build's standalone directory, never an application checkout.
  const names = files(source).sort();
  if (names.some(name => !allowed(name))) fail();
  const entries = names.map(path => {
    const bytes = readFileSync(checked(source, path)); content(bytes);
    return { path, size: bytes.length, sha256: sha(bytes) };
  });
  checkRoot(dirname(resolve(destination)));
  // No overwrite/adoption of an existing release, including an empty directory.
  mkdirSync(destination, { mode: 0o700 });
  for (const entry of entries) {
    const target = join(destination, entry.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    copyFileSync(checked(source, entry.path), target, 1);
  }
  const bytes = Buffer.from(JSON.stringify({ ...metadata, version: 1, profile: 'S05-standalone-candidate', mutablePaths: ['.next/cache'], files: entries }, null, 2) + '\n');
  writeFileSync(join(destination, 'artifact.json'), bytes, { flag: 'wx', mode: 0o600 });
  const digest = sha(bytes);
  verify(destination, digest);
  return digest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, root, argument, metadata] = process.argv.slice(2);
    if (command === 'verify') { verify(root, argument); console.log('S05_VERIFY_PASS'); }
    else if (command === 'pack') console.log(pack(root, argument, JSON.parse(readFileSync(metadata, 'utf8'))));
    else fail();
  } catch { console.error('S05_ARTIFACT_REJECTED'); process.exitCode = 1; }
}
