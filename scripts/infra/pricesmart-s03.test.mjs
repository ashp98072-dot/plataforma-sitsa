import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { validateSandboxConfig } from '../sandbox-config.mjs';
import { loadPlan, validatePlan, parseEnvironment, templateRoot } from './pricesmart-plan.mjs';
import { checkBuild } from './pricesmart-build.mjs';

let plan, root;
beforeEach(() => { plan = loadPlan(); root = mkdtempSync(join(tmpdir(), 's03-offline-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function concreteFixture() {
  const env = parseEnvironment(plan.environment), manifest = structuredClone(plan.manifest);
  env.SANDBOX_ROOT = root; env.UPLOAD_DIR = join(root, 'uploads'); mkdirSync(env.UPLOAD_DIR);
  for (const key of ['AUTH_SECRET', 'DB_PASSWORD', 'PORTAL_CREDENTIALS_KEY']) {
    env[key] = `sandbox:${env.SANDBOX_ID}:${randomBytes(32).toString('hex')}`;
    manifest.secretSha256[key] = createHash('sha256').update(env[key]).digest('hex');
  }
  writeFileSync(join(root, 'isolation.json'), JSON.stringify(manifest));
  return { env, manifest };
}
describe('S03 proposed infrastructure, offline only', () => {
  it('accepts the private review profile without installing anything', () => expect(validatePlan(plan).result).toBe('PASS_STATIC_ONLY'));
  it('materialized synthetic templates pass the EXISTING S02 validator', () => {
    const { env } = concreteFixture(); expect(validateSandboxConfig(env, root)?.id).toBe('pricesmart-qa');
  });
  it('unprovisioned placeholders fail S02 rather than creating resources', () => {
    const env = parseEnvironment(plan.environment); env.SANDBOX_ROOT = root; env.UPLOAD_DIR = join(root, 'uploads'); mkdirSync(env.UPLOAD_DIR);
    writeFileSync(join(root, 'isolation.json'), JSON.stringify(plan.manifest)); expect(() => validateSandboxConfig(env, root)).toThrow();
  });
  it('a reviewed template with a mismatched manifest still fails S02', () => {
    const { env, manifest } = concreteFixture(); manifest.id = 'foreign-sandbox'; writeFileSync(join(root, 'isolation.json'), JSON.stringify(manifest));
    expect(() => validateSandboxConfig(env, root)).toThrow();
  });
  it.each([
    ['external target', p => p.inventory.externalDestinations.push('production.invalid')],
    ['public ingress', p => p.inventory.publicIngress = true],
    ['PriceSmart activation', p => p.inventory.pricesmartEndpointsEnabled = true],
    ['ratified decisions', p => p.inventory.decisions = 'APPROVED'],
    ['foreign data path', p => p.inventory.root = '/var/www/production'],
    ['foreign SQL database', p => p.inventory.database.DB_NAME = 'production'],
    ['manifest drift', p => p.manifest.database.DB_PORT = '3306'],
    ['real secret in template', p => p.environment = p.environment.replace('@AUTH_SECRET@', 'do-not-publish-a-secret')],
    ['inherited proxy', p => p.environment += '\nHTTPS_PROXY=http://production.invalid\n'],
    ['missing mode', p => p.environment = p.environment.replace('NOVALVION_ENV=sandbox', '')],
    ['duplicate mode', p => p.environment += '\nNOVALVION_ENV=production\n'],
    ['root runtime', p => p.units.app = p.units.app.replace('User=novalvion-ps-sandbox', 'User=root')],
    ['alternate start path', p => p.units.app = p.units.app.replace('scripts/start-sandbox.mjs', 'scripts/start-hostinger.mjs')],
    ['extra privileged command', p => p.units.app += '\nExecStartPre=/usr/bin/id\n'],
    ['writable manifest parent', p => p.units.app = p.units.app.replace('ReadWritePaths=/srv/novalvion-ps-sandbox/uploads', 'ReadWritePaths=/srv/novalvion-ps-sandbox')],
    ['missing firewall dependency', p => p.units.app = p.units.app.replace('Requires=novalvion-ps-firewall.service ', 'Requires=')],
    ['separate runtime namespace breaks DB loopback', p => p.units.app += '\n[Service]\nPrivateNetwork=yes\n'],
    ['outbound public allow', p => p.firewall = p.firewall.replace('ct state invalid drop', 'ip daddr 203.0.113.10 accept')],
    ['default outbound allow', p => p.firewall = p.firewall.replaceAll('policy drop', 'policy accept')],
    ['DNS bypass', p => p.firewall = p.firewall.replace('ct state invalid drop', 'udp dport 53 accept')],
    ['firewall stop removes rules', p => p.units.firewall += '\n[Service]\nExecStop=/usr/sbin/nft flush ruleset\n'],
    ['public MariaDB', p => p.database = p.database.replace('bind-address=127.0.0.1', 'bind-address=0.0.0.0')],
    ['public TLS', p => p.proxy = p.proxy.replace('listen 127.0.0.1:4316 ssl', 'listen 0.0.0.0:4316 ssl')],
    ['schema-wide grants', p => p.sql += '\nGRANT ALL ON sandbox_pricesmart.* TO x;'],
    ['marker writable', p => p.sql = p.sql.replace('GRANT SELECT ON', 'GRANT SELECT,UPDATE ON')],
    ['old database adoption', p => p.sql = p.sql.replace('CREATE DATABASE', 'CREATE DATABASE IF NOT EXISTS')],
    ['CI scripts in artifact', p => p.artifact.files.push('scripts/ci/c3c15b/lab.mjs')],
  ])('rejects %s', (_label, mutate) => { mutate(plan); expect(() => validatePlan(plan)).toThrow(); });
  it('clean build input passes without runtime credentials', () => expect(() => checkBuild(root, {})).not.toThrow());
  it.each(['DB_PASSWORD', 'NOVALVION_ENV', 'SANDBOX_ID', 'AUTH_SECRET', 'NODE_OPTIONS', 'HTTPS_PROXY', 'NEXT_PUBLIC_SECRET'])('build rejects %s even empty', key => expect(() => checkBuild(root, { [key]: '' })).toThrow());
  it('build rejects an env file before launching Next', () => { writeFileSync(join(root, '.env.local'), 'NO_SECRET'); expect(() => checkBuild(root, {})).toThrow(); });
  it('build rejects ancestor persistent configuration', () => {
    const child = join(root, 'child'); mkdirSync(child); mkdirSync(join(root, 'config')); writeFileSync(join(root, 'config', 'app.env'), 'NO_SECRET');
    expect(() => checkBuild(child, {})).toThrow();
  });
  it('root identities have no login shell and runtime is not in privileged groups', () => {
    const source = readFileSync(join(templateRoot, 'sysusers.conf'), 'utf8');
    expect(source.split('\n').filter(line => line.startsWith('u '))).toHaveLength(4);
    expect(source).not.toMatch(/^m /m); expect(source.match(/\/usr\/sbin\/nologin/g)).toHaveLength(4);
  });
});
