import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { allowed, checked, pack, verify } from './artifact.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const metadata = { next: '16.4.1', node: '24.18.0', arch: 'x64', platform: 'linux', commit: 'a'.repeat(40), lockSha256: 'b'.repeat(64) };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 's05-test-')); roots.push(root);
  const source = join(root, 'source'); mkdirSync(source);
  function put(path, data = 'synthetic') { mkdirSync(join(source, path, '..'), { recursive: true }); writeFileSync(join(source, path), data); }
  for (const path of ['server.js', 'package.json', '.next/BUILD_ID', 'scripts/start-sandbox-s05.mjs', 'scripts/sandbox-config.mjs', 'scripts/artifact.mjs', 'node_modules/next/package.json', '.next/static/a.js', 'public/logo.svg']) put(path);
  return { root, source, put, destination: join(root, 'release') };
}
describe('S05 real filesystem, synthetic content (not a Next runtime)', () => {
  it('packages and verifies deterministic bytes twice', () => {
    const f = fixture(); const digest = pack(f.source, f.destination, metadata);
    expect(verify(f.destination, digest).files).toHaveLength(9);
    const second = join(f.root, 'second'); expect(pack(f.source, second, metadata)).toBe(digest);
    expect(readFileSync(join(second, 'artifact.json'))).toEqual(readFileSync(join(f.destination, 'artifact.json')));
  });
  it.each(['.env', '.env.production', 'sql/a.sql', 'uploads/a.jpg', 'scripts/init-db.mjs', '.next/cache/a', 'node_modules/pkg/test/a.js', 'public/key.pem', '.next/static/a.js.map', 'src/app.ts'])('rejects prohibited %s', path => {
    const f = fixture(); f.put(path); expect(() => pack(f.source, f.destination, metadata)).toThrow();
  });
  it.each(['../a', '/a', 'a/../b', 'a\\b', 'a:b', 'a//b'])('rejects unsafe path %s', path => {
    const f = fixture(); expect(() => checked(f.source, path)).toThrow();
  });
  it('rejects junction source and ancestor', () => {
    const f = fixture(); const link = join(f.root, 'linked'); symlinkSync(f.source, link, 'junction');
    expect(() => pack(link, f.destination, metadata)).toThrow();
    expect(() => checked(link, '.next/BUILD_ID')).toThrow();
  });
  it('rejects junction inside source', () => {
    const f = fixture(); symlinkSync(f.root, join(f.source, 'public', 'escape'), 'junction');
    expect(() => pack(f.source, f.destination, metadata)).toThrow();
  });
  it('rejects linked destination parent', () => {
    const f = fixture(); const link = join(f.root, 'linked'); symlinkSync(f.source, link, 'junction');
    expect(() => pack(f.source, join(link, 'release'), metadata)).toThrow();
  });
  it.each(['-----BEGIN PRIVATE KEY-----', 'mysql://user:password@invalid/db', `sandbox:pricesmart-qa:${'a'.repeat(64)}`])('rejects synthetic secret patterns', value => {
    const f = fixture(); f.put('.next/static/canary.js', value); expect(() => pack(f.source, f.destination, metadata)).toThrow();
  });
  it('rejects altered bytes, extra files, missing files and wrong manifest anchor', () => {
    const f = fixture(); const digest = pack(f.source, f.destination, metadata);
    expect(() => verify(f.destination, '0'.repeat(64))).toThrow();
    writeFileSync(join(f.destination, 'server.js'), 'modified'); expect(() => verify(f.destination, digest)).toThrow();
    writeFileSync(join(f.destination, 'server.js'), 'synthetic');
    writeFileSync(join(f.destination, 'extra'), 'extra'); expect(() => verify(f.destination, digest)).toThrow();
    rmSync(join(f.destination, 'extra')); rmSync(join(f.destination, 'server.js')); expect(() => verify(f.destination, digest)).toThrow();
  });
  it('does not adopt an existing destination', () => {
    const f = fixture(); mkdirSync(f.destination); expect(() => pack(f.source, f.destination, metadata)).toThrow();
  });
  it('separates technical cache at runtime without accepting code alterations', () => {
    const f = fixture(); const digest = pack(f.source, f.destination, metadata);
    mkdirSync(join(f.destination, '.next/cache')); writeFileSync(join(f.destination, '.next/cache/image'), 'synthetic cache');
    expect(() => verify(f.destination, digest)).toThrow();
    expect(verify(f.destination, digest, true).mutablePaths).toEqual(['.next/cache']);
    writeFileSync(join(f.destination, 'server.js'), 'changed'); expect(() => verify(f.destination, digest, true)).toThrow();
  });
  it('rejects cache junction even in runtime verification', () => {
    const f = fixture(); const digest = pack(f.source, f.destination, metadata);
    symlinkSync(f.source, join(f.destination, '.next/cache'), 'junction');
    expect(() => verify(f.destination, digest, true)).toThrow();
  });
  it('rejects unapproved build metadata', () => {
    const f = fixture(); expect(() => pack(f.source, f.destination, { ...metadata, next: '16.0.0' })).toThrow();
    expect(() => pack(f.source, f.destination, { ...metadata, DB_PASSWORD: 'synthetic-secret' })).toThrow();
  });
  it('does not allow administrative or source directories', () => {
    for (const name of ['infra/a', 'docs/a', 'scripts/ci/a', '.git/config', 'next.config.ts']) expect(allowed(name)).toBe(false);
  });
});
