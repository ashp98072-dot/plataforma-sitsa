// PRICESMART-DEMO (API-12) — entorno LOCAL y DESECHABLE para la demostración POST → MariaDB → bandeja TMS → GET. NO es parte de `npm test`.
//   node scripts/ci/pricesmart-demo/demo.mjs up        → MariaDB 11.8.9 efímero (127.0.0.1, puerto aleatorio) + esquema completo del proyecto + DDL de laboratorio de PriceSmart + datos FICTICIOS + `next dev`
//                                                         con la composición de laboratorio activada. Escribe un entorno de Postman (con la clave de laboratorio del run) FUERA del repositorio.
//   node scripts/ci/pricesmart-demo/demo.mjs e2e       → prueba completa de principio a fin (Vitest, bajo el mismo entorno sandbox).
//   node scripts/ci/pricesmart-demo/demo.mjs postman   → ejecuta la colección Postman del repositorio contra la app local (Postman CLI).
//   node scripts/ci/pricesmart-demo/demo.mjs down      → detiene la app y el servidor, verifica que no quede nada.
// Reutiliza (sin modificar sus guardas) el arnés portal-e2e y el laboratorio de API-06A: motor verificado por hash, solo loopback, pipe administrativo, entorno sandbox.
// Nada toca Hostinger, producción, MySQL80 ni PostgreSQL. Las claves del run se generan aquí y solo viven en %TEMP%.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateManifest, buildChildEnv, adminOptions, assertAdminOptions, pickPort, fail } from '../pricesmart-api06a/safety.mjs';
import { inspectPort } from '../pricesmart-api06a/procinfo.mjs';
import { labDdlStatements, splitStatements } from '../pricesmart-api06a/ddl.mjs';
import { securityDdlStatements } from '../pricesmart-api11/ddl.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const tempRoot = () => fs.realpathSync.native(os.tmpdir());
const STATE_NOTE = path.join(tempRoot(), 'portal-e2e-current-run.txt');   // el mismo apuntador del arnés portal-e2e
const harness = path.join(repoRoot, 'scripts', 'ci', 'portal-e2e', 'harness.mjs');
const lf = (t) => String(t).replace(/\r\n/g, '\n');

export const LAB_CLUB = 'QA-CLUB';
export const LAB_INTEGRATION = 'pricesmart-lab';

const readState = () => {
  const runDir = fs.readFileSync(STATE_NOTE, 'utf8').trim();
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  validateManifest(state.m, tempRoot(), { requirePort: true });
  return state;
};
const writeState = (state) => fs.writeFileSync(path.join(state.m.runDir, 'state.json'), JSON.stringify(state));
async function adminConn(m) {
  const mysql = (await import('mysql2/promise')).default;
  const o = adminOptions(m); assertAdminOptions(o, m);
  return mysql.createConnection({ ...o, multipleStatements: true });
}

/** DDL de laboratorio de API-12 (derivado del .in: solo se retira el SIGNAL de bloqueo). */
export const API12_SIGNAL = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'API12_UNRATIFIED_DESIGN_DO_NOT_EXECUTE';";
export function api12DdlStatements(text) {
  const t = lf(text);
  const first = t.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))[0];
  if (first !== API12_SIGNAL || t.split(API12_SIGNAL).length !== 2) fail('La primera sentencia de api12/staging-tms-link.sql.in no es el SIGNAL de bloqueo esperado.');
  const st = splitStatements(t.replace(`${API12_SIGNAL}\n`, '-- [LAB API-12] SIGNAL de bloqueo retirada SOLO en la copia de laboratorio.\n'));
  if (st.length !== 2 || !st[0].startsWith('CREATE TABLE ps_api12_tms_mapping (') || !st[1].startsWith('CREATE TABLE ps_api12_tms_links (')) fail('Se esperaban exactamente 2 CREATE TABLE de API-12.');
  if (st.some((s) => /\b(DROP|TRUNCATE|ALTER|DELETE|GRANT|USE|SIGNAL|CREATE (DATABASE|USER))\b/i.test(s.replaceAll('ON DELETE RESTRICT', '')))) fail('El DDL de API-12 contiene sentencias no permitidas.');
  return st;
}

async function up() { await bootstrapBase(); await prepare(); }

async function bootstrapBase() {
  const boot = cp.spawnSync(process.execPath, [harness, 'bootstrap', '--no-app'], { cwd: repoRoot, windowsHide: true, encoding: 'utf8', timeout: 540000, maxBuffer: 32 * 1024 * 1024 });
  if (boot.status !== 0) { console.error((boot.stdout ?? '').split('\n').slice(-15).join('\n'), boot.stderr); fail('El arnés base no pudo prepararse.'); }
}

/** Segunda parte (idempotente solo sobre un run recién arrancado): DDL de laboratorio de PriceSmart, datos ficticios y la app con la composición de laboratorio. */
async function prepare() {
  const state = readState(); const { m } = state;
  const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  const c = await adminConn(m); await c.query(`USE \`${m.schema}\``);
  for (const sql of [...labDdlStatements(read('docs/integraciones/pricesmart/api01/staging.sql.in')), ...securityDdlStatements(read('docs/integraciones/pricesmart/api11/staging-security.sql.in')),
    ...api12DdlStatements(read('docs/integraciones/pricesmart/api12/staging-tms-link.sql.in'))]) await c.query(sql);
  // ---- datos FICTICIOS: 2 empresas, 1 cliente de servicio por empresa (usuario inactivo para el portal), alcances, catálogo M2M y mapeo.
  const id = async (sql, params) => Number((await c.query(sql, params))[0].insertId);
  const empresa1 = state.seed.empresa;
  const empresa2 = await id("INSERT INTO empresas (codigo, nombre, slug, activa, modulos_json, creado_en) VALUES ('K2', 'Segunda Empresa Ficticia', 'otra-empresa', 1, '[\"rrhh\",\"tms\",\"flota\"]', NOW())", []);
  const inactiveHash = () => ({ salt: crypto.randomBytes(16).toString('hex'), hash: crypto.randomBytes(32).toString('hex') });   // sin contraseña conocida: nadie puede iniciar sesión con este usuario
  const demo = { empresas: {} };
  for (const [key, empresa] of [['a', empresa1], ['b', empresa2]]) {
    const cliente = await id("INSERT INTO tms_clientes (empresa_id, nombre) VALUES (?, 'PriceSmart (laboratorio)')", [empresa]);
    const h = inactiveHash();
    const usuario = await id("INSERT INTO tms_cliente_usuarios (empresa_id, cliente_id, nombre, email, password_hash, salt, activo, debe_cambiar_password) VALUES (?, ?, 'Integración PriceSmart (laboratorio)', ?, ?, ?, 0, 1)", [empresa, cliente, `integracion-${key}@lab.invalid`, h.hash, h.salt]);
    await c.query("INSERT INTO ps_api01_scopes (environment, tenant_id, client_id, integration_id) VALUES (_binary'sandbox', ?, 1, ?)", [empresa, Buffer.from(LAB_INTEGRATION)]);
    const FROM = 1700000000000; const FAR = 4102444800000;
    await c.query("INSERT INTO ps_api11_integrations (issuer, subject, credential_reference, environment, tenant_id, client_id, integration_id, revision, status, valid_from_ms, valid_until_ms, credential_valid_from_ms, credential_valid_until_ms, rotated_at_ms, allowed_clubs_json, scopes_json) VALUES (?, ?, ?, _binary'sandbox', ?, 1, ?, 1, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?)",
      [Buffer.from('lab-issuer'), Buffer.from(`lab-subject-${key}`), Buffer.from(`lab-cred-${key}-1`), empresa, Buffer.from(LAB_INTEGRATION), FROM, FAR, FROM, FAR, FROM, JSON.stringify([LAB_CLUB]), JSON.stringify(['orders:create', 'orders:read', 'orders:cancel'])]);
    await c.query("INSERT INTO ps_api12_tms_mapping (environment, tenant_id, client_id, integration_id, empresa_id, tms_cliente_id, tms_usuario_cliente_id, pickup_place, dropoff_place) VALUES (_binary'sandbox', ?, 1, ?, ?, ?, ?, 'Centro de distribución ficticio (carga)', 'Punto final ficticio (descarga)')",
      [empresa, Buffer.from(LAB_INTEGRATION), empresa, cliente, usuario]);
    demo.empresas[key] = { empresaId: empresa, clienteId: cliente, usuarioClienteId: usuario, slug: key === 'a' ? 'kt-monaco' : 'otra-empresa' };
  }
  // Credencial REVOCADA (misma integración de la empresa A) para la prueba de autenticación.
  await c.query("INSERT INTO ps_api11_integrations (issuer, subject, credential_reference, environment, tenant_id, client_id, integration_id, revision, status, valid_from_ms, valid_until_ms, credential_valid_from_ms, credential_valid_until_ms, rotated_at_ms, allowed_clubs_json, scopes_json) VALUES (?, ?, ?, _binary'sandbox', ?, 1, ?, 1, 'ACTIVE', 1700000000000, 4102444800000, 1700000000000, 4102444800000, 1700000000000, ?, ?)",
    [Buffer.from('lab-issuer'), Buffer.from('lab-subject-rev'), Buffer.from('lab-cred-rev-1'), empresa1, Buffer.from(LAB_INTEGRATION), JSON.stringify([LAB_CLUB]), JSON.stringify(['orders:create', 'orders:read', 'orders:cancel'])]);
  await c.query("INSERT INTO ps_api11_revocations (issuer, subject, credential_reference, revision, revoked_at_ms) VALUES (?, ?, ?, 0, 1700000000005)", [Buffer.from('lab-issuer'), Buffer.from('lab-subject-rev'), Buffer.from('lab-cred-rev-1')]);
  // Usuario interno ficticio (Admin) para la bandeja de Operaciones. Sin contraseña conocida: la sesión del e2e se firma con la clave del run.
  const h = inactiveHash();
  demo.staff = { id: await id("INSERT INTO usuarios (username, password_hash, salt, nombre, rol_global) VALUES ('ops.lab', ?, ?, 'Operaciones Ficticio', 'Admin')", [h.hash, h.salt]), username: 'ops.lab' };
  await c.end();

  // ---- clave de laboratorio del run (solo en %TEMP%) y app con la composición de laboratorio.
  demo.labKey = crypto.randomBytes(32).toString('hex');
  const port = pickPort(() => crypto.randomInt(0, 2 ** 31 - 1), (p) => inspectPort(p).state !== 'free');
  const env = buildChildEnv(m, process.env, { NODE_ENV: 'development' });
  delete env.PS06A_APP_PASSWORD; delete env.PS06A_WORKER_PASSWORD;
  env.PATH = `${path.dirname(process.execPath)};${env.PATH}`;
  env.PRICESMART_LAB_DEMO = 'SINTETICO-LOCAL-SIN-PRODUCCION'; env.PRICESMART_LAB_KEY = demo.labKey;
  const logFile = path.join(m.runDir, 'next.log'); const log = fs.openSync(logFile, 'a');
  const next = cp.spawn(process.execPath, [path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: repoRoot, env, windowsHide: true, detached: true, stdio: ['ignore', log, log] });
  fs.closeSync(log); next.unref();
  state.app = { pid: next.pid, port }; state.demo = demo; writeState(state);
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i++) { try { const r = await fetch(`${baseUrl}/portal/login`, { redirect: 'manual' }); if (r.status < 500) break; } catch { /* aún no */ } await new Promise((r) => setTimeout(r, 1000)); }
  // Entorno de Postman (con la clave del run) en %TEMP%, fuera del repositorio.
  const postmanEnv = path.join(m.runDir, 'postman-environment.json');
  fs.writeFileSync(postmanEnv, JSON.stringify({ name: 'PriceSmart laboratorio local', values: [
    { key: 'baseUrl', value: baseUrl }, { key: 'labKey', value: demo.labKey }, { key: 'club', value: LAB_CLUB },
    { key: 'tenantA', value: String(demo.empresas.a.empresaId) }, { key: 'tenantB', value: String(demo.empresas.b.empresaId) }, { key: 'integrationId', value: LAB_INTEGRATION },
  ] }));
  console.log(JSON.stringify({ baseUrl, appPid: next.pid, postmanEnvironment: postmanEnv, log: logFile }));
}

function e2e() {
  const state = readState(); const { m } = state;
  const env = buildChildEnv(m, process.env, { NODE_ENV: 'test' }); delete env.PS06A_APP_PASSWORD; delete env.PS06A_WORKER_PASSWORD;
  env.PS_DEMO_RUNDIR = m.runDir;   // el e2e lee state.json de aquí (TEMP del proceso hijo apunta al directorio del run)
  env.PATH = `${path.dirname(process.execPath)};${env.PATH}`;
  const r = cp.spawnSync(process.execPath, [path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', path.join(here, 'vitest.demo.config.mts'), '--reporter=verbose'], { cwd: repoRoot, env, windowsHide: true, encoding: 'utf8', timeout: 420000 });
  console.log([r.stdout ?? '', r.stderr ?? ''].join('\n').split('\n').filter((l) => l.trim()).slice(-45).join('\n')); if (r.status !== 0) process.exitCode = 1;
}

function postman() {
  const state = readState(); const envFile = path.join(state.m.runDir, 'postman-environment.json');
  const r = cp.spawnSync('postman', ['collection', 'run', path.join(repoRoot, 'docs', 'integraciones', 'pricesmart', 'api12', 'postman_collection.json'), '-e', envFile, '--bail'], { cwd: repoRoot, windowsHide: true, encoding: 'utf8', timeout: 240000, shell: true });
  console.log([r.stdout ?? '', r.stderr ?? ''].join('\n').split('\n').filter((l) => l.trim()).slice(-60).join('\n')); process.exitCode = r.status === 0 ? 0 : 1;
}

function down() {
  const r = cp.spawnSync(process.execPath, [harness, 'down', ...process.argv.slice(3)], { cwd: repoRoot, windowsHide: true, encoding: 'utf8' });
  console.log(r.stdout ?? '', r.stderr ?? '');
}

const [cmd] = process.argv.slice(2);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const run = { up, prepare, e2e: async () => e2e(), postman: async () => postman(), down: async () => down() }[cmd];
  if (!run) { console.error('Uso: up | e2e | postman | down [--keep-evidence=<dir>]'); process.exitCode = 2; }
  else run().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
