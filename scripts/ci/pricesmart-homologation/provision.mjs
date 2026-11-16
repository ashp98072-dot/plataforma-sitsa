// PRICESMART API-26 — CLI de aprovisionamiento del sandbox de homologación (se ejecuta EN el host del sandbox; NADA se ejecuta desde CI ni contra producción).
//   node provision.mjs plan --n sbx1 --out <dir> --hostname <dns> --cert <ruta> --key <ruta> --allow <cidr,cidr> [--app-port 3100] [--db-port 3306]   → genera archivos de REVISIÓN (sin secretos, sin tocar bases)
//   node provision.mjs init-secrets --n sbx1 --root <dir> --out-env <archivo> [--db-port 3306]                                                       → secretos INTERNOS del sandbox + isolation.json (0600; no se imprimen)
//   node provision.mjs finalize --n sbx1 --root <dir> --secrets-env <archivo> [--db-port 3306]   → esquema de ejecución del proyecto + privilegios finales (tras apply)
//   node provision.mjs apply --n sbx1 --db-port 3306 [--execute]    → por omisión solo muestra el resumen; con --execute aplica (loopback, ACK, credenciales por variables de entorno)
//   node provision.mjs register-integration|revoke|destroy ...      → mismas barreras (loopback + ACK)
// Variables (nunca por argumentos): PS_HOMOLOG_ADMIN_USER, PS_HOMOLOG_ADMIN_PASSWORD, PS_HOMOLOG_PROVISION_ACK, PS_HOMOLOG_APP_PASSWORD, PS_HOMOLOG_WORKER_PASSWORD, PS_HOMOLOG_MONITOR_PASSWORD.
// No genera ni comparte credenciales de PriceSmart; el verificador HMAC de laboratorio no interviene. La conexión SOLO puede ser 127.0.0.1/::1 (assertApplyTarget).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as B from './bundle.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fail = (m) => { throw new Error(m); };
function parseArgs(argv) {
  const out = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith('--')) fail(`Argumento inesperado: ${a}`); const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; } }
  return out;
}
const num = (v, d) => (v === undefined ? d : Number(v));

export async function plan(args) {
  const n = args.n; const names = B.homologNames(n); const out = path.resolve(String(args.out ?? fail('Falta --out')));
  if (fs.existsSync(out) && fs.readdirSync(out).length) fail('El directorio de salida no está vacío.');
  const nginxOpts = { publicHostname: args.hostname, certPath: args.cert, keyPath: args.key, allowlist: String(args.allow ?? '').split(',').filter(Boolean), appPort: num(args['app-port'], 3100) };
  const files = {
    'bootstrap.sql': B.renderBootstrapSql(B.buildBootstrap(n, repo)), 'destroy.sql': B.destroyStatements(n).map((s) => `${s};`).join('\n'),
    'nginx-pricesmart-sandbox.conf': B.renderNginx(nginxOpts), 'pricesmart-sandbox-proxy.conf': B.NGINX_PROXY_INCLUDE,
    'pricesmart-sandbox.service': B.renderSystemd({ appPort: nginxOpts.appPort }), 'runtime.env.template': B.renderEnvTemplate(names, { dbPort: num(args['db-port'], 3306) }),
    'monitoring.json': JSON.stringify({ queries: B.MONITORING_QUERIES, alerts: B.ALERT_RULES, account: names.monitorUser }, null, 2),
    'tms-schema-files.txt': B.tmsSchemaFiles(repo).join('\n'),
  };
  fs.mkdirSync(out, { recursive: true }); for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(out, f), `${text}\n`, { flag: 'wx' });
  return { out, files: Object.keys(files) };
}

export function initSecrets(args) {
  const names = B.homologNames(args.n); const root = path.resolve(String(args.root ?? fail('Falta --root'))); const outEnv = path.resolve(String(args['out-env'] ?? fail('Falta --out-env')));
  if (fs.existsSync(path.join(root, 'isolation.json')) || fs.existsSync(outEnv)) fail('Ya existen secretos o manifiesto: no se sobrescriben.');
  const secrets = B.generateSandboxSecrets(names); fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify(B.buildIsolationManifest(names, secrets, { dbPort: num(args['db-port'], 3306) })), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(outEnv, Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  return { manifest: path.join(root, 'isolation.json'), envFile: outEnv, secretNames: Object.keys(secrets) };   // nunca se devuelven valores
}

async function adminConnection(args, ackName) {
  const env = process.env; const port = num(args['db-port'], 3306);
  B.assertApplyTarget({ host: '127.0.0.1', port, env, ack: env.PS_HOMOLOG_PROVISION_ACK, expectedAck: ackName });
  const mysql = (await import('mysql2/promise')).default;
  return mysql.createConnection({ host: '127.0.0.1', port, user: env.PS_HOMOLOG_ADMIN_USER, password: env.PS_HOMOLOG_ADMIN_PASSWORD, multipleStatements: false });
}

export async function apply(args) {
  const bundle = B.buildBootstrap(args.n, repo); const env = process.env;
  const secrets = { app: env.PS_HOMOLOG_APP_PASSWORD, worker: env.PS_HOMOLOG_WORKER_PASSWORD, monitor: env.PS_HOMOLOG_MONITOR_PASSWORD };
  if (!args.execute) return { dryRun: true, schema: bundle.names.schema, accounts: [bundle.names.appUser, bundle.names.workerUser, bundle.names.monitorUser], statements: bundle.head.length + bundle.ddl.length + bundle.accounts.length + bundle.grants.app.length + bundle.grants.worker.length + bundle.grants.monitor.length, tmsFiles: B.tmsSchemaFiles(repo).length };
  B.assertApplyTarget({ host: '127.0.0.1', port: num(args['db-port'], 3306), env, ack: env.PS_HOMOLOG_PROVISION_ACK, secrets });
  const conn = await adminConnection(args, B.HOMOLOG_ACK);
  try { return await B.executeBundle(conn, bundle, secrets, { tms: { repo, files: B.tmsSchemaFiles(repo) } }); } finally { await conn.end(); }
}

/** Segunda parte tras `apply`: esquema de ejecución del proyecto con el entorno del sandbox (secretos de `init-secrets`: --secrets-env <archivo>) y privilegios finales. */
export async function finalize(args) {
  const bundle = B.buildBootstrap(args.n, repo); const envFile = path.resolve(String(args['secrets-env'] ?? fail('Falta --secrets-env'))); const sandboxRoot = path.resolve(String(args.root ?? fail('Falta --root')));
  const sandboxSecrets = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  if (!['DB_PASSWORD', 'AUTH_SECRET', 'PORTAL_CREDENTIALS_KEY'].every((k) => sandboxSecrets[k])) fail('SECRETS_INCOMPLETE');
  const conn = await adminConnection(args, B.HOMOLOG_ACK);
  try { return await B.finalizeBundle(conn, bundle, { repo, sandboxRoot, sandboxSecrets, dbPort: num(args['db-port'], 3306) }); } finally { await conn.end(); }
}

export async function destroy(args) {
  const conn = await adminConnection(args, B.HOMOLOG_DESTROY_ACK);
  try { for (const s of B.destroyStatements(args.n)) await conn.query(s); return { destroyed: B.homologNames(args.n).schema }; } finally { await conn.end(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [cmd, ...rest] = process.argv.slice(2); const args = parseArgs(rest);
  const run = { plan, 'init-secrets': async (a) => initSecrets(a), apply, finalize, destroy }[cmd];
  if (!run) { console.error('Uso: plan | init-secrets | apply [--execute] | finalize | destroy'); process.exitCode = 2; }
  else run(args).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(String(e.message).slice(0, 200)); process.exitCode = 1; });
}
