// Offline review of the ONE proposed Linux profile; never installs or connects.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const templateRoot = fileURLToPath(new URL('../../infra/pricesmart-sandbox/', import.meta.url));
export function loadPlan(root = templateRoot) {
  const read = file => readFileSync(join(root, file), 'utf8');
  return {
    inventory: JSON.parse(read('inventory.example.json')),
    manifest: JSON.parse(read('isolation.json.example')),
    environment: read('runtime.env.example'), firewall: read('nftables.conf'),
    database: read('mariadb.cnf'), proxy: read('nginx.conf'), sql: read('provision-identity.sql.in'),
    artifact: JSON.parse(read('runtime-files.json')),
    units: Object.fromEntries(['app', 'db', 'proxy', 'firewall', 'build', 'backup'].map(name => [name, read(`systemd/novalvion-ps-${name}.service`)])),
  };
}
export function parseEnvironment(text) {
  const result = {};
  for (const line of text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    assert.ok(match && !(match[1] in result), 'S03_ENV_SYNTAX');
    result[match[1]] = match[2].replace(/^'(.*)'$/, '$1');
  }
  return result;
}
function parseUnit(text) {
  const values = {}; let section = '';
  const allowed = new Set('Description Requires After Before Conflicts StartLimitIntervalSec StartLimitBurst Type User Group UMask WorkingDirectory EnvironmentFile ExecStart Restart RestartSec TimeoutStartSec TimeoutStopSec KillMode RuntimeDirectory RuntimeDirectoryMode ProtectSystem ProtectHome PrivateTmp PrivateDevices NoNewPrivileges CapabilityBoundingSet ProtectKernelTunables ProtectKernelModules ProtectControlGroups RestrictSUIDSGID RestrictAddressFamilies IPAddressDeny IPAddressAllow ReadWritePaths InaccessiblePaths PrivateNetwork RemainAfterExit WantedBy'.split(' '));
  for (const line of text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))) {
    if (/^\[(Unit|Service|Install)\]$/.test(line)) { section = line.slice(1, -1); continue; }
    const match = /^([A-Za-z]+)=(.*)$/.exec(line);
    assert.ok(match && section && allowed.has(match[1]), 'S03_UNIT_DIRECTIVE');
    const key = `${section}.${match[1]}`; assert.ok(!(key in values), 'S03_UNIT_DUPLICATE'); values[key] = match[2];
  }
  return values;
}
const compact = text => text.split(/\r?\n/).map(line => line.replace(/#.*/, '')).join('').replace(/\s+/g, '');
export function validatePlan(plan) {
  const i = plan.inventory, env = parseEnvironment(plan.environment);
  assert.equal(i.schemaVersion, 1); assert.equal(i.environment, 'sandbox');
  assert.equal(i.id, 'pricesmart-qa'); assert.equal(i.tenant, 'kt-monaco');
  assert.equal(i.root, '/srv/novalvion-ps-sandbox'); assert.equal(i.app, '/opt/novalvion-ps-sandbox/app');
  assert.equal(i.runtimeUser, 'novalvion-ps-sandbox');
  assert.deepEqual(i.database, { DB_HOST: '127.0.0.1', DB_PORT: '43306', DB_NAME: 'sandbox_pricesmart', DB_USER: 'sandbox_pricesmart' });
  assert.deepEqual(i.ports, { app: 3000, tls: 4316 }); assert.equal(i.origin, 'https://localhost:4316');
  assert.deepEqual(i.externalDestinations, []); assert.equal(i.publicIngress, false); assert.equal(i.pricesmartEndpointsEnabled, false);
  assert.equal(i.decisions, 'D01-D16_PENDING_RATIFICATION');
  assert.deepEqual(plan.manifest, { environment: 'sandbox', id: i.id, database: i.database, origin: i.origin,
    secretSha256: Object.fromEntries(['AUTH_SECRET', 'DB_PASSWORD', 'PORTAL_CREDENTIALS_KEY'].map(key => [key, `@${key}_SHA256@`])) });
  assert.deepEqual(env, { NOVALVION_ENV: 'sandbox', NODE_ENV: 'production', SANDBOX_ID: i.id, SANDBOX_ROOT: i.root, ...i.database,
    AUTH_SECRET: '@AUTH_SECRET@', DB_PASSWORD: '@DB_PASSWORD@', PORTAL_CREDENTIALS_KEY: '@PORTAL_CREDENTIALS_KEY@',
    UPLOAD_DIR: `${i.root}/uploads`, CB2_PUBLIC_ORIGIN: i.origin, EMPRESA_DOMINIOS: '{"localhost":"kt-monaco"}',
    NEXT_TELEMETRY_DISABLED: '1', CB2_DOCUMENTOS_FASE2: '0', FLOTA_PROPIEDAD_EXTERNA: '0', PORT: '3000' });
  const expectedExec = {
    app: '/usr/bin/node scripts/start-sandbox.mjs',
    db: '/usr/sbin/mariadbd --defaults-file=/etc/novalvion-ps-sandbox/mariadb.cnf',
    proxy: '/usr/sbin/nginx -c /etc/novalvion-ps-sandbox/nginx.conf -g "daemon off;"',
    firewall: '/usr/sbin/nft -f /etc/novalvion-ps-sandbox/nftables.conf',
    build: '/usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent NEXT_TELEMETRY_DISABLED=1 /usr/bin/node scripts/infra/pricesmart-build.mjs',
    backup: '/usr/local/libexec/novalvion-ps-backup',
  };
  for (const [name, text] of Object.entries(plan.units)) {
    const u = parseUnit(text); assert.equal(u['Service.ExecStart'], expectedExec[name]);
    if (name === 'firewall') {
      assert.equal(u['Service.Type'], 'oneshot'); assert.equal(u['Service.RemainAfterExit'], 'yes');
      assert.equal(u['Service.User'], 'root'); assert.equal(u['Service.CapabilityBoundingSet'], 'CAP_NET_ADMIN');
      assert.equal(u['Service.NoNewPrivileges'], 'yes'); continue;
    }
    assert.equal(u['Service.User'], ['build', 'db', 'proxy'].includes(name) ? `novalvion-ps-${name}` : name === 'backup' ? 'root' : i.runtimeUser);
    for (const [key, value] of Object.entries({ UMask: '0077', ProtectSystem: 'strict', ProtectHome: 'yes', NoNewPrivileges: 'yes', PrivateTmp: 'yes', PrivateDevices: 'yes' })) assert.equal(u[`Service.${key}`], value);
    assert.equal(u['Service.CapabilityBoundingSet'], name === 'backup' ? 'CAP_DAC_READ_SEARCH' : '');
    if (['app', 'db', 'proxy'].includes(name)) {
      assert.equal(u['Service.IPAddressDeny'], 'any'); assert.equal(u['Service.IPAddressAllow'], '127.0.0.1/32');
      assert.equal(u['Service.RestrictAddressFamilies'], 'AF_UNIX AF_INET'); assert.equal(u['Service.KillMode'], 'control-group');
      assert.ok(u['Unit.Requires'].split(' ').includes('novalvion-ps-firewall.service'));
      assert.ok(u['Unit.After'].split(' ').includes('novalvion-ps-firewall.service'));
      assert.equal(u['Service.PrivateNetwork'], undefined, 'S03_SHARED_LOOPBACK');
    } else assert.equal(u['Service.PrivateNetwork'], 'yes');
    if (name !== 'app') assert.equal(u['Service.EnvironmentFile'], undefined);
  }
  const app = parseUnit(plan.units.app);
  const writable = {
    db: '/var/lib/novalvion-ps-db /run/novalvion-ps-db', proxy: '/run/novalvion-ps-proxy',
    build: '/var/lib/novalvion-ps-build/source', backup: '/var/backups/novalvion-ps-sandbox',
  };
  for (const [name, paths] of Object.entries(writable)) assert.equal(parseUnit(plan.units[name])['Service.ReadWritePaths'], paths);
  assert.equal(parseUnit(plan.units.firewall)['Service.PrivateNetwork'], undefined);
  assert.equal(parseUnit(plan.units.firewall)['Service.EnvironmentFile'], undefined);
  assert.equal(app['Service.EnvironmentFile'], '/etc/novalvion-ps-sandbox/runtime.env');
  assert.equal(app['Service.WorkingDirectory'], i.app);
  assert.equal(app['Service.ReadWritePaths'], `${i.root}/uploads ${i.app}/.next/cache /run/novalvion-ps-app`);
  assert.equal(app['Service.InaccessiblePaths'], '/var/lib/novalvion-ps-db /var/backups/novalvion-ps-sandbox');
  // Finite firewall grammar: extra rules, IPv6/external accepts/includes fail closed.
  const rule = (direction, iface) => `${direction}ifname "lo" ip saddr 127.0.0.1 ip daddr 127.0.0.1 ${iface}`;
  const chain = (name, direction) => `chain ${name} { type filter hook ${name} priority 0; policy drop; ct state invalid drop ${rule(direction, 'ct state established accept')} ${rule(direction, 'tcp dport { 3000, 4316, 43306 } accept')} }`;
  assert.equal(compact(plan.firewall), compact(`table inet novalvion_ps_sandbox { ${chain('input', 'i')} chain forward { type filter hook forward priority 0; policy drop; } ${chain('output', 'o')} }`));
  assert.match(plan.database, /^bind-address=127\.0\.0\.1$/m); assert.match(plan.database, /^port=43306$/m);
  assert.match(plan.database, /^datadir=\/var\/lib\/novalvion-ps-db$/m);
  assert.ok(!/!include|bind-address=(?!127\.0\.0\.1)|\[client\]/.test(plan.database));
  const databaseLines = plan.database.split(/\r?\n/).map(line => line.replace(/#.*/, '').trim()).filter(Boolean);
  assert.deepEqual(databaseLines, ['[mariadbd]', 'bind-address=127.0.0.1', 'port=43306', 'datadir=/var/lib/novalvion-ps-db',
    'socket=/run/novalvion-ps-db/mariadb.sock', 'pid-file=/run/novalvion-ps-db/mariadb.pid', 'skip-name-resolve', 'local-infile=0',
    'skip-symbolic-links', 'event-scheduler=OFF', 'general-log=0', 'slow-query-log=0', 'max-connections=40', 'character-set-server=utf8mb4', 'collation-server=utf8mb4_unicode_ci']);
  assert.match(plan.proxy, /listen 127\.0\.0\.1:4316 ssl;/); assert.equal((plan.proxy.match(/\blisten\s/g) ?? []).length, 1);
  assert.match(plan.proxy, /proxy_pass http:\/\/127\.0\.0\.1:3000;/);
  assert.equal((plan.proxy.match(/\bproxy_pass\s/g) ?? []).length, 1);
  assert.ok(!/\b(?:include|resolver|perl|lua|upstream)\b/.test(plan.proxy.replace(/#[^\n]*/g, '')));
  assert.match(plan.sql, /GRANT SELECT ON sandbox_pricesmart\.novalvion_environment/);
  const sql = plan.sql.replace(/--[^\n]*/g, '');
  assert.ok(!/IF NOT EXISTS|GRANT (?!SELECT ON sandbox_pricesmart\.novalvion_environment)|\*|DROP\s|ALTER\s|DELETE\s|UPDATE\s/i.test(sql));
  assert.equal(sql.split(';').filter(s => s.trim()).length, 7);
  assert.match(sql, /^\s*SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'S03_TEMPLATE_REQUIRES_REVIEW';/);
  assert.match(sql, /CREATE USER 'sandbox_pricesmart'@'127\.0\.0\.1' IDENTIFIED BY '@DB_PASSWORD@'/);
  assert.match(sql, /INSERT INTO sandbox_pricesmart\.novalvion_environment VALUES \(1, 'sandbox', 'pricesmart-qa'\)/);
  assert.deepEqual(plan.artifact.directories, ['.next', 'public', 'node_modules']);
  assert.deepEqual(plan.artifact.files, ['package.json', 'package-lock.json', 'next.config.ts', 'scripts/start-sandbox.mjs', 'scripts/start-hostinger.mjs', 'scripts/sandbox-config.mjs']);
  return { result: 'PASS_STATIC_ONLY', profile: i.id, externalDestinations: 0, services: Object.keys(plan.units), s02Controls: 'reused unchanged', decisions: i.decisions };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(validatePlan(loadPlan()), null, 2)); }
  catch { console.error('S03_PLAN_REJECTED'); process.exitCode = 1; }
}
