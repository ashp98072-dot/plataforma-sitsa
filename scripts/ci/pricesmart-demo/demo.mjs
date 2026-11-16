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
import { securityDdlStatements, attestationDdlStatements } from '../pricesmart-api11/ddl.mjs';

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
/** DDL de laboratorio de API-13 (cola de reintentos y registro de intentos), derivado del .in. */
export const API13_SIGNAL = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'API13_UNRATIFIED_DESIGN_DO_NOT_EXECUTE';";
export function api13DdlStatements(text) {
  const t = lf(text);
  const first = t.split(String.fromCharCode(10)).filter((l) => l.trim() && !l.trim().startsWith('--'))[0];
  if (first !== API13_SIGNAL || t.split(API13_SIGNAL).length !== 2) fail('La primera sentencia de api13/staging-link-retry.sql.in no es el SIGNAL de bloqueo esperado.');
  const st = splitStatements(t.replace(API13_SIGNAL, '-- [LAB API-13] SIGNAL de bloqueo retirada SOLO en la copia de laboratorio.'));
  if (st.length !== 2 || !st[0].startsWith('CREATE TABLE ps_api13_link_jobs (') || !st[1].startsWith('CREATE TABLE ps_api13_link_attempts (')) fail('Se esperaban exactamente 2 CREATE TABLE de API-13.');
  if (st.some((s) => new RegExp('\\b(DROP|TRUNCATE|ALTER|DELETE|GRANT|USE|SIGNAL|CREATE (DATABASE|USER))\\b', 'i').test(s.replaceAll('ON DELETE RESTRICT', '')))) fail('El DDL de API-13 contiene sentencias no permitidas.');
  return st;
}
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
    ...api12DdlStatements(read('docs/integraciones/pricesmart/api12/staging-tms-link.sql.in')), ...api13DdlStatements(read('docs/integraciones/pricesmart/api13/staging-link-retry.sql.in'))]) await c.query(sql);
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
  // Alcances adicionales de la empresa A que COMPARTEN cliente y usuario de servicio con el alcance `a` (pruebas de colisión entre integraciones): c = client_id 2, d = client_id 3.
  for (const [key, clientId] of [['c', 2], ['d', 3]]) {
    const A = demo.empresas.a; const FROM = 1700000000000; const FAR = 4102444800000;
    await c.query("INSERT INTO ps_api01_scopes (environment, tenant_id, client_id, integration_id) VALUES (_binary'sandbox', ?, ?, ?)", [A.empresaId, clientId, Buffer.from(LAB_INTEGRATION)]);
    await c.query("INSERT INTO ps_api11_integrations (issuer, subject, credential_reference, environment, tenant_id, client_id, integration_id, revision, status, valid_from_ms, valid_until_ms, credential_valid_from_ms, credential_valid_until_ms, rotated_at_ms, allowed_clubs_json, scopes_json) VALUES (?, ?, ?, _binary'sandbox', ?, ?, ?, 1, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?)",
      [Buffer.from('lab-issuer'), Buffer.from(`lab-subject-${key}`), Buffer.from(`lab-cred-${key}-1`), A.empresaId, clientId, Buffer.from(LAB_INTEGRATION), FROM, FAR, FROM, FAR, FROM, JSON.stringify([LAB_CLUB]), JSON.stringify(['orders:create', 'orders:read', 'orders:cancel'])]);
    await c.query("INSERT INTO ps_api12_tms_mapping (environment, tenant_id, client_id, integration_id, empresa_id, tms_cliente_id, tms_usuario_cliente_id, pickup_place, dropoff_place) VALUES (_binary'sandbox', ?, ?, ?, ?, ?, ?, 'Centro de distribución ficticio (carga)', 'Punto final ficticio (descarga)')",
      [A.empresaId, clientId, Buffer.from(LAB_INTEGRATION), A.empresaId, A.clienteId, A.usuarioClienteId]);
  }
  // Credencial REVOCADA (misma integración de la empresa A) para la prueba de autenticación.
  await c.query("INSERT INTO ps_api11_integrations (issuer, subject, credential_reference, environment, tenant_id, client_id, integration_id, revision, status, valid_from_ms, valid_until_ms, credential_valid_from_ms, credential_valid_until_ms, rotated_at_ms, allowed_clubs_json, scopes_json) VALUES (?, ?, ?, _binary'sandbox', ?, 1, ?, 1, 'ACTIVE', 1700000000000, 4102444800000, 1700000000000, 4102444800000, 1700000000000, ?, ?)",
    [Buffer.from('lab-issuer'), Buffer.from('lab-subject-rev'), Buffer.from('lab-cred-rev-1'), empresa1, Buffer.from(LAB_INTEGRATION), JSON.stringify([LAB_CLUB]), JSON.stringify(['orders:create', 'orders:read', 'orders:cancel'])]);
  await c.query("INSERT INTO ps_api11_revocations (issuer, subject, credential_reference, revision, revoked_at_ms) VALUES (?, ?, ?, 0, 1700000000005)", [Buffer.from('lab-issuer'), Buffer.from('lab-subject-rev'), Buffer.from('lab-cred-rev-1')]);
  // API-23: cuenta de WORKER de la outbox (misma política mínima que API-07 en el laboratorio de API-06A: leer la cola y actualizar SOLO las 4 columnas de lease/estado/intentos; leer solo las columnas de eventos/órdenes del JOIN).
  const sq = (n) => `\`${n}\``; const w = `'${m.workerUser}'@'127.0.0.1'`; const sch = sq(m.schema);
  if (!/^sandbox_api02_w[a-z0-9]+$/.test(m.workerUser) || !/^sandbox:[a-z0-9-]+:[a-f0-9]{64}$/.test(m.secrets.WORKER_PASSWORD)) fail('Cuenta o contraseña de worker inválidas.');
  for (const sql of [`CREATE USER ${w} IDENTIFIED BY '${m.secrets.WORKER_PASSWORD}'`, `GRANT SELECT ON ${sch}.novalvion_environment TO ${w}`,
    `GRANT SELECT, UPDATE (status, attempts, next_attempt_at, lease_until) ON ${sch}.ps_api01_outbox TO ${w}`,
    `GRANT SELECT (environment, tenant_id, client_id, integration_id, order_id, order_version, event_type, reason, correlation_id) ON ${sch}.ps_api01_events TO ${w}`,
    `GRANT SELECT (environment, tenant_id, client_id, integration_id, id, origin_club_reference) ON ${sch}.ps_api01_orders TO ${w}`]) await c.query(sql);
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

/** Reinicia SOLO la app (la base sigue igual): simula un reinicio del proceso. `--worker-ms=N` activa el trabajador de reintentos dentro de la app (N ≥ 1000). */
async function restartApp() {
  const state = readState(); const { m } = state;
  const workerMs = Number(process.argv.find((a) => a.startsWith('--worker-ms='))?.split('=')[1] ?? 0);
  if (state.app?.pid) cp.spawnSync('taskkill', ['/PID', String(state.app.pid), '/T', '/F'], { windowsHide: true });
  const port = pickPort(() => crypto.randomInt(0, 2 ** 31 - 1), (p) => inspectPort(p).state !== 'free');
  const env = buildChildEnv(m, process.env, { NODE_ENV: 'development' });
  delete env.PS06A_APP_PASSWORD; delete env.PS06A_WORKER_PASSWORD;
  env.PATH = `${path.dirname(process.execPath)};${env.PATH}`;
  env.PRICESMART_LAB_DEMO = 'SINTETICO-LOCAL-SIN-PRODUCCION'; env.PRICESMART_LAB_KEY = state.demo.labKey;
  if (workerMs) env.PRICESMART_LAB_WORKER_MS = String(workerMs);
  const log = fs.openSync(path.join(m.runDir, 'next.log'), 'a');
  const next = cp.spawn(process.execPath, [path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: repoRoot, env, windowsHide: true, detached: true, stdio: ['ignore', log, log] });
  fs.closeSync(log); next.unref();
  state.app = { pid: next.pid, port }; writeState(state);
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i++) { try { const r = await fetch(`${baseUrl}/portal/login`, { redirect: 'manual' }); if (r.status < 500) break; } catch { /* aún no */ } await new Promise((r) => setTimeout(r, 1000)); }
  // El primer acceso a la ruta instala la composición (y arranca el trabajador): se dispara una solicitud sin credenciales.
  await fetch(`${baseUrl}/api/integrations/pricesmart/v1/orders/WARMUP`).catch(() => undefined);
  const postmanEnv = path.join(m.runDir, 'postman-environment.json');
  try { const e = JSON.parse(fs.readFileSync(postmanEnv, 'utf8')); e.values = e.values.map((v) => (v.key === 'baseUrl' ? { ...v, value: baseUrl } : v)); fs.writeFileSync(postmanEnv, JSON.stringify(e)); } catch { /* opcional */ }
  console.log(JSON.stringify({ baseUrl, appPid: next.pid, workerMs }));
}


/** API-26 (solo laboratorio): crea, en el esquema del run, las TRES cuentas de homologación (aplicación, worker, monitor) con los privilegios EXACTOS del paquete de aprovisionamiento. Las contraseñas son del run (state.json). */
async function prepareHomologation() {
  const state = readState(); const { m } = state; const B = await import('../pricesmart-homologation/bundle.mjs');
  const c = await adminConn(m); await c.query(`USE \`${m.schema}\``);
  for (const sql of attestationDdlStatements(fs.readFileSync(path.join(repoRoot, 'docs/integraciones/pricesmart/api18/staging-attestation.sql.in'), 'utf8'))) { try { await c.query(sql); } catch (e) { if (e.code !== 'ER_TABLE_EXISTS_ERROR') throw e; } }
  const names = { schema: m.schema, appUser: `${m.schema}_ha`, workerUser: `${m.schema}_hw`, monitorUser: `${m.schema}_hm` };
  const homolog = { names };
  for (const [role, key] of [['app', 'appUser'], ['worker', 'workerUser'], ['monitor', 'monitorUser']]) {
    const password = role === 'app' ? `sandbox:${m.sandboxId}:${crypto.randomBytes(32).toString('hex')}` : crypto.randomBytes(24).toString('hex');   // la de la aplicación sigue el formato de secretos del sandbox
    await c.query(`CREATE USER \`${names[key]}\`@\`127.0.0.1\` IDENTIFIED BY '${password}'`);
    for (const sql of B.grantStatements(names, role)) await c.query(sql);
    homolog[role] = { user: names[key], password };
  }
  await c.end();
  // Raíz y manifiesto de aislamiento para ejecutar TODO el proceso de pruebas (incluido el pool general del TMS) COMO la cuenta de la aplicación: `e2e --as-homolog-app`.
  const root = path.join(m.runDir, 'homolog-app-root'); fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
  const lab = JSON.parse(fs.readFileSync(path.join(m.sandboxRoot, 'isolation.json'), 'utf8'));
  const secretOf = { DB_PASSWORD: homolog.app.password, AUTH_SECRET: m.secrets.AUTH_SECRET, PORTAL_CREDENTIALS_KEY: m.secrets.PORTAL_CREDENTIALS_KEY };
  fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify({ ...lab, database: { ...lab.database, DB_USER: names.appUser }, secretSha256: Object.fromEntries(Object.entries(secretOf).map(([k, v]) => [k, crypto.createHash('sha256').update(v).digest('hex')])) }));
  homolog.root = root; state.demo.homolog = homolog; writeState(state);
  console.log(JSON.stringify({ homologAccounts: [names.appUser, names.workerUser, names.monitorUser] }));
}

/** API-26 (solo laboratorio): EJECUTA el paquete de aprovisionamiento en un esquema aparte `sandbox_api02_homolog_r1` del servidor desechable, comprueba cuentas/privilegios con conexiones reales, verifica las barreras
 *  (segunda aplicación falla, base destruible) y escribe el informe en <run>/homolog-rehearsal.json. Todo se destruye al final. */
async function rehearseHomologation() {
  const state = readState(); const { m } = state; const B = await import('../pricesmart-homologation/bundle.mjs'); const mysql = (await import('mysql2/promise')).default;
  const bundle = B.buildBootstrap('r1', repoRoot); const names = bundle.names;
  const sandboxSecrets = B.generateSandboxSecrets(names);   // formato exigido por validateSandboxConfig (internos del sandbox; no son credenciales de PriceSmart)
  const secrets = { app: sandboxSecrets.DB_PASSWORD, worker: crypto.randomBytes(24).toString('hex'), monitor: crypto.randomBytes(24).toString('hex') };
  const step = (x) => { if (process.env.PS_DEMO_DEBUG) console.error(`[rehearse] ${x}`); };
  const admin = await adminConn(m); const report = { names, errors: {} }; step('conectado');
  try {
  await admin.query(B.destroyStatements('r1').join(';\n'));   // limpieza previa (solo nombres homolog_r1)
  step('limpieza previa hecha');
  // Aislamiento de `apply`/`finalize`/`destroy`: una base y una cuenta «señuelo» AJENAS al sandbox (y las cuentas/bases del laboratorio) deben quedar EXACTAMENTE igual tras todo el ciclo.
  const decoy = 'sandbox_api02_homolog_decoy'; const decoyPw = crypto.randomBytes(24).toString('hex');
  await admin.query(`DROP DATABASE IF EXISTS \`${decoy}\``); await admin.query(`DROP USER IF EXISTS \`${decoy}\`@\`127.0.0.1\``);
  await admin.query(`CREATE DATABASE \`${decoy}\``); await admin.query(`CREATE TABLE \`${decoy}\`.t (id INT PRIMARY KEY, v VARCHAR(20))`); await admin.query(`INSERT INTO \`${decoy}\`.t VALUES (1, 'intacto')`);
  await admin.query(`CREATE USER \`${decoy}\`@\`127.0.0.1\` IDENTIFIED BY '${decoyPw}'`); await admin.query(`GRANT SELECT ON \`${decoy}\`.t TO \`${decoy}\`@\`127.0.0.1\``);
  const ownNames = new Set([names.appUser, names.workerUser, names.monitorUser]);
  const snap = async () => {
    const users = (await admin.query("SELECT DISTINCT User u FROM mysql.user WHERE User LIKE 'sandbox%' ORDER BY 1"))[0].map((r) => r.u).filter((u) => !ownNames.has(u)); const grants = {};
    for (const u of users) grants[u] = (await admin.query(`SHOW GRANTS FOR \`${u}\`@\`127.0.0.1\``))[0].map((r) => String(Object.values(r)[0]).replace(/IDENTIFIED BY PASSWORD '[^']*'/, 'IDENTIFIED BY PASSWORD <oculto>'));
    return { schemas: (await admin.query("SELECT SCHEMA_NAME s FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys') ORDER BY 1"))[0].map((r) => r.s).filter((x) => x !== names.schema),
      decoyChecksum: (await admin.query(`CHECKSUM TABLE \`${decoy}\`.t`))[0][0].Checksum, labTables: (await admin.query('SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [m.schema]))[0][0].n, users, grants };
  };
  const before = await snap();
  report.applied = await B.executeBundle(admin, bundle, secrets, { tms: { repo: repoRoot, files: B.tmsSchemaFiles(repoRoot) } }); step('paquete aplicado');
  // Paso «esquema de ejecución» (código REAL del proyecto) con el MISMO entorno que tendrá el sandbox: manifiesto de aislamiento validado por validateSandboxConfig y cuenta de la aplicación con privilegios TEMPORALES.
  const root = path.join(m.runDir, 'homolog-root'); fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify(B.buildIsolationManifest(names, sandboxSecrets, { dbPort: m.port })));
  const finalized = await B.finalizeBundle(admin, bundle, { repo: repoRoot, sandboxRoot: root, sandboxSecrets, dbPort: m.port, tmpDir: m.tmpDir }); step('esquema de ejecución y privilegios finales aplicados');
  report.runtimeSchemaStep = finalized.runtimeSchemaStep; report.ensuredGrants = finalized.ensuredGrants;
  report.passwordVariablesCleared = (await admin.query('SELECT @ps_app_pw AS a, @ps_worker_pw AS w, @ps_monitor_pw AS m'))[0][0];
  try { await B.executeBundle(admin, bundle, secrets); report.secondApply = 'NO_ERROR'; } catch (e) { report.secondApply = e.errno ?? String(e.code); }   // la base ya existe: la reaplicación FALLA
  report.grants = {};
  for (const [role, key] of [['app', 'appUser'], ['worker', 'workerUser'], ['monitor', 'monitorUser']]) report.grants[role] = (await admin.query(`SHOW GRANTS FOR \`${names[key]}\`@\`127.0.0.1\``))[0].map((r) => String(Object.values(r)[0]).replace(/IDENTIFIED BY PASSWORD '[^']*'/, 'IDENTIFIED BY PASSWORD <oculto>'));
  const connect = (user, password) => mysql.createConnection({ host: '127.0.0.1', port: m.port, user, password, database: names.schema });
  const attempt = async (c, sql, params = []) => { try { await c.query(sql, params); return 'OK'; } catch (e) { return e.errno ?? String(e.code); } };
  step('grants leídos'); const monitor = await connect(names.monitorUser, secrets.monitor); step('monitor conectado'); report.monitor = { queries: {}, forbidden: {} };
  for (const [id, sql] of Object.entries(B.MONITORING_QUERIES)) report.monitor.queries[id] = await attempt(monitor, sql, sql.includes('?') ? [0] : []);
  for (const [id, sql] of Object.entries({ insertOutbox: 'INSERT INTO ps_api01_outbox (environment) VALUES (1)', updateOutbox: "UPDATE ps_api01_outbox SET status = 'DONE'", selectOrders: 'SELECT * FROM ps_api01_orders', selectPayloadViaEvents: 'SELECT payload_ciphertext FROM ps_api01_orders', deleteCounters: 'DELETE FROM ps_api11_rate_counters', selectIntegrations: 'SELECT * FROM ps_api11_integrations' })) report.monitor.forbidden[id] = await attempt(monitor, sql);
  await monitor.end();
  const worker = await connect(names.workerUser, secrets.worker); report.worker = { forbidden: {} };
  for (const [id, sql] of Object.entries({ readPayload: 'SELECT payload_ciphertext FROM ps_api01_orders', insertOutbox: 'INSERT INTO ps_api01_outbox (environment) VALUES (1)', deleteOutbox: 'DELETE FROM ps_api01_outbox', readIntegrations: 'SELECT * FROM ps_api11_integrations', writeLinks: "UPDATE ps_api12_tms_links SET claim_token = claim_token", dropTable: 'DROP TABLE ps_api01_outbox' })) report.worker.forbidden[id] = await attempt(worker, sql);
  report.worker.allowed = { readOutbox: await attempt(worker, 'SELECT status, attempts FROM ps_api01_outbox'), updateOutboxColumns: await attempt(worker, "UPDATE ps_api01_outbox SET attempts = attempts WHERE 1 = 0") };
  await worker.end();
  const app = await connect(names.appUser, secrets.app); report.app = { forbidden: {}, allowed: {} };
  for (const [id, sql] of Object.entries({ deleteOrders: 'DELETE FROM ps_api01_orders', updateOutbox: "UPDATE ps_api01_outbox SET status = 'DONE'", insertRevocation: "INSERT INTO ps_api11_revocations (issuer, subject, credential_reference, revision, revoked_at_ms) VALUES ('a','b','c',0,1)",
    insertIntegration: 'INSERT INTO ps_api11_integrations (issuer) VALUES (1)', dropTable: 'DROP TABLE ps_api01_orders', createTable: 'CREATE TABLE x (a INT)', readUsers: 'SELECT * FROM mysql.user', updateAudit: 'UPDATE ps_api01_audit SET environment = environment', deleteAudit: 'DELETE FROM ps_api01_audit' })) report.app.forbidden[id] = await attempt(app, sql);
  report.app.allowed = { readEnv: await attempt(app, 'SELECT environment FROM novalvion_environment'), readIntegrations: await attempt(app, 'SELECT COUNT(*) FROM ps_api11_integrations') };
  await app.end();
  // Alta y revocación de una credencial SINTÉTICA con las funciones del paquete (cuenta administrativa).
  const FROM = Date.now() - 60000; await admin.query(`USE \`${names.schema}\``);
  await admin.query("INSERT INTO ps_api01_scopes (environment, tenant_id, client_id, integration_id) VALUES (_binary'sandbox', 1, 1, ?)", [Buffer.from('ps-homolog')]);
  const reg = B.registerIntegrationStatement({ issuer: 'iss-sintetico', subject: 'sub-sintetico', credentialReference: 'cred-sintetica-1', tenantId: 1, clientId: 1, integrationId: 'ps-homolog', allowedClubs: ['CLUB-SINTETICO'], scopes: ['orders:read'], validFromMs: FROM, validUntilMs: FROM + 86400000 });
  await admin.query(reg.sql, reg.params);
  const rev = B.revokeStatement({ issuer: 'iss-sintetico', subject: 'sub-sintetico', credentialReference: 'cred-sintetica-1' }); await admin.query(rev.sql, rev.params);
  report.catalog = { integrations: (await admin.query('SELECT COUNT(*) n FROM ps_api11_integrations'))[0][0].n, revocations: (await admin.query('SELECT COUNT(*) n FROM ps_api11_revocations'))[0][0].n };
  report.tables = (await admin.query('SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY 1', [names.schema]))[0].map((r) => r.t);
  report.environmentRow = (await admin.query('SELECT environment, sandbox_id FROM novalvion_environment'))[0][0];
  for (const sql of B.destroyStatements('r1')) await admin.query(sql);
  const after = await snap();
  report.isolation = { unchanged: JSON.stringify(before) === JSON.stringify(after), usersChecked: before.users, schemasChecked: before.schemas, decoyIntact: (await admin.query(`SELECT v FROM \`${decoy}\`.t`))[0][0]?.v === 'intacto' };
  await admin.query(`DROP DATABASE IF EXISTS \`${decoy}\``); await admin.query(`DROP USER IF EXISTS \`${decoy}\`@\`127.0.0.1\``);
  report.destroyed = { schemas: (await admin.query('SELECT COUNT(*) n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [names.schema]))[0][0].n,
    accounts: (await admin.query("SELECT COUNT(*) n FROM information_schema.USER_PRIVILEGES WHERE GRANTEE LIKE ?", [`%sandbox_api02_homolog_%r1%`]))[0][0].n, labSchemaIntact: (await admin.query('SELECT COUNT(*) n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [m.schema]))[0][0].n };
  fs.writeFileSync(path.join(m.runDir, 'homolog-rehearsal.json'), JSON.stringify(report));
  } finally { await admin.end().catch(() => undefined); }
  console.log(JSON.stringify({ rehearsal: 'ok', tables: report.tables.length, secondApply: report.secondApply, destroyed: report.destroyed }));
}

function e2e() {
  const state = readState(); const { m } = state;
  const env = buildChildEnv(m, process.env, { NODE_ENV: 'test' }); delete env.PS06A_APP_PASSWORD;   // API-23: el e2e conserva la contraseña del worker de la outbox (solo laboratorio)
  env.PS_DEMO_WORKER_USER = m.workerUser;
  env.PS_DEMO_RUNDIR = m.runDir;
  if (process.argv.includes('--as-homolog-app')) {   // API-26: el proceso entero (incl. el pool general del TMS) opera con la cuenta MÍNIMA de la aplicación y el manifiesto de su propio sandbox
    const h = state.demo.homolog; if (!h?.root) fail('Falta prepare-homologation.');
    env.PS_DEMO_OWNER_USER = env.DB_USER; env.PS_DEMO_OWNER_PASSWORD = env.DB_PASSWORD;   // la prueba conserva una conexión de PROPIETARIO solo para sembrar/verificar
    env.DB_USER = h.app.user; env.DB_PASSWORD = h.app.password; env.SANDBOX_ROOT = h.root; env.UPLOAD_DIR = path.join(h.root, 'uploads');
  }   // el e2e lee state.json de aquí (TEMP del proceso hijo apunta al directorio del run)
  env.PATH = `${path.dirname(process.execPath)};${env.PATH}`;
  const r = cp.spawnSync(process.execPath, [path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', path.join(here, 'vitest.demo.config.mts'), '--reporter=verbose', ...process.argv.slice(3).filter((a) => a.endsWith('.e2e.ts') && !a.includes('..'))], { cwd: repoRoot, env, windowsHide: true, encoding: 'utf8', timeout: 420000 });
  console.log([r.stdout ?? '', r.stderr ?? ''].join('\n').split('\n').filter((l) => l.trim()).slice(-Number(process.env.PS_DEMO_TAIL ?? 45)).join('\n')); if (r.status !== 0) process.exitCode = 1;
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
  const run = { up, prepare, 'prepare-homologation': prepareHomologation, 'rehearse-homologation': rehearseHomologation, 'restart-app': restartApp, e2e: async () => e2e(), postman: async () => postman(), down: async () => down() }[cmd];
  if (!run) { console.error('Uso: up | prepare | prepare-homologation | rehearse-homologation | restart-app [--worker-ms=N] | e2e | postman | down [--keep-evidence=<dir>]'); process.exitCode = 2; }
  else run().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
