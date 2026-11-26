// PRICESMART — runner de E2E para LINUX (GitHub Actions). NO sustituye ni modifica el arnés de Windows (`demo.mjs` / `portal-e2e/harness.mjs`, que siguen intactos): reutiliza sus DDL, datos ficticios y pruebas `*.e2e.ts` y
// solo reemplaza lo específico de Windows (motor `.exe` verificado por hash, pipe administrativo, `taskkill`, PATH con `;`).
//   node scripts/ci/pricesmart-demo/run-linux.mjs            → MariaDB 11.8.9 desechable (127.0.0.1, puerto aleatorio, socket Unix administrativo) + esquema del proyecto + DDL de laboratorio de PriceSmart + datos
//                                                              FICTICIOS + `next dev` en modo SANDBOX → ejecuta los E2E → apaga todo y borra el directorio del run (siempre, también si algo falla).
// Seguridad: exige PS_API06A_LAB_ACK, Linux y un entorno padre limpio (sin variables de bases/entornos reales ni proxies); el entorno de la app y de las pruebas se CONSTRUYE desde cero (lista blanca); las claves se generan
// aquí y solo viven en el directorio del run; la base solo escucha en 127.0.0.1; no hay secretos, bases, credenciales ni servidores reales. Nada toca Hostinger ni producción.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { createManifest, validateManifest, isolationJson, safeRemoveRunDir, fail } from '../pricesmart-api06a/safety.mjs';
import { ENGINE, FORBIDDEN_PARENT_ENV, FORBIDDEN_PORTS, HOST, LAB_ACK_ENV, LAB_ACK_PHRASE, LOCK_WAIT_SECONDS, PORT_MAX, PORT_MIN } from '../pricesmart-api06a/constants.mjs';
import { labDdlStatements } from '../pricesmart-api06a/ddl.mjs';
import { securityDdlStatements } from '../pricesmart-api11/ddl.mjs';
import { api12DdlStatements, api13DdlStatements, LAB_CLUB, LAB_INTEGRATION } from './demo.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[ps-linux]', ...a);

// ---- compuertas (antes de crear NADA) ----
if (process.platform !== 'linux') throw new Error('PriceSmart run-linux: solo Linux (el arnés de Windows es demo.mjs).');
if (process.env[LAB_ACK_ENV] !== LAB_ACK_PHRASE) throw new Error(`Falta confirmación explícita ${LAB_ACK_ENV}.`);
{
  const bad = Object.keys(process.env).filter((k) => FORBIDDEN_PARENT_ENV.test(k) && process.env[k] !== undefined);
  if (bad.length) throw new Error(`El entorno padre define variables de bases/entornos reales o proxies (${bad.join(', ')}); ejecute desde un entorno limpio.`);
  // Los MISMOS nombres que rechaza `validateSandboxConfig` (un `.env.example` versionado no se carga y no es un problema).
  const envFiles = ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local', '.env.test', '.env.test.local'].filter((f) => fs.existsSync(path.join(repoRoot, f)));
  if (envFiles.length) throw new Error('Hay archivos .env* en el repositorio; validateSandboxConfig los rechaza.');
}
const MARIADBD = process.env.PS_LAB_MARIADBD ?? '/usr/sbin/mariadbd';
const INSTALL_DB = process.env.PS_LAB_INSTALL_DB ?? '/usr/bin/mariadb-install-db';
const BASEDIR = process.env.PS_LAB_BASEDIR ?? '/usr';
for (const bin of [MARIADBD, INSTALL_DB]) if (!fs.existsSync(bin)) throw new Error(`No existe ${bin}`);
const engineVersion = cp.execFileSync(MARIADBD, ['--version'], { encoding: 'utf8' });
if (!new RegExp(` Ver ${ENGINE.versionPrefix.replaceAll('.', '\\.')}-MariaDB\\b`).test(engineVersion)) throw new Error(`Motor no verificado: ${engineVersion.trim()}`);
const engineSha = crypto.createHash('sha256').update(fs.readFileSync(MARIADBD)).digest('hex');
log(`Motor: ${engineVersion.trim()}\nsha256(mariadbd): ${engineSha}`);
if (process.env.PS_LAB_MARIADBD_SHA256 && process.env.PS_LAB_MARIADBD_SHA256 !== engineSha) throw new Error('Hash del motor distinto del fijado.');

const tempRoot = fs.realpathSync.native(process.env.RUNNER_TEMP ?? os.tmpdir());
const ST = { m: null, repo: repoRoot, seed: null, app: null, demo: null };
const stateFile = () => path.join(ST.m.runDir, 'state.json');
const readState = () => ST;
const writeState = (s) => { Object.assign(ST, s); fs.writeFileSync(stateFile(), JSON.stringify(ST)); };

// ---- entorno de los procesos hijo (lista blanca; equivalente Linux de `buildChildEnv`) ----
function childEnv(m, extra = {}) {
  const env = {
    PATH: `${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, HOME: m.homeDir, TMPDIR: m.tmpDir, LANG: 'C.UTF-8', NODE_ENV: 'test',
    NOVALVION_ENV: 'sandbox', SANDBOX_ID: m.sandboxId, SANDBOX_ROOT: m.sandboxRoot, NEXT_TELEMETRY_DISABLED: '1',
    DB_HOST: HOST, DB_PORT: String(m.port), DB_NAME: m.schema, DB_USER: m.user, DB_PASSWORD: m.secrets.DB_PASSWORD,
    AUTH_SECRET: m.secrets.AUTH_SECRET, PORTAL_CREDENTIALS_KEY: m.secrets.PORTAL_CREDENTIALS_KEY,
    PS06A_APP_PASSWORD: m.secrets.APP_PASSWORD, PS06A_WORKER_PASSWORD: m.secrets.WORKER_PASSWORD,
    CB2_PUBLIC_ORIGIN: 'https://localhost', EMPRESA_DOMINIOS: '{"localhost":"kt-monaco"}', UPLOAD_DIR: m.uploadsDir,
    ...extra,
  };
  const allowed = new Set(['PATH', 'HOME', 'TMPDIR', 'LANG', 'NODE_ENV', 'NOVALVION_ENV', 'SANDBOX_ID', 'SANDBOX_ROOT', 'NEXT_TELEMETRY_DISABLED', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'AUTH_SECRET',
    'PORTAL_CREDENTIALS_KEY', 'CB2_PUBLIC_ORIGIN', 'EMPRESA_DOMINIOS', 'UPLOAD_DIR', 'PS06A_WORKER_PASSWORD', 'PS06A_APP_PASSWORD', 'PRICESMART_LAB_DEMO', 'PRICESMART_LAB_KEY', 'PRICESMART_LAB_WORKER_MS',
    'PS_DEMO_WORKER_USER', 'PS_DEMO_RUNDIR', 'CI']);
  const unknown = Object.keys(env).filter((k) => !allowed.has(k));
  if (unknown.length) fail(`Variable no permitida en el entorno de pruebas: ${unknown.join(', ')}`);
  if (new Set([env.AUTH_SECRET, env.DB_PASSWORD, env.PORTAL_CREDENTIALS_KEY, env.PS06A_WORKER_PASSWORD, env.PS06A_APP_PASSWORD]).size !== 5) fail('Los cinco secretos deben ser distintos.');
  return env;
}

// ---- administración por socket Unix del run (única vía administrativa) ----
let adminSocket = '';
async function adminConn(m, { multi = false } = {}) {
  void m;
  return mysql.createConnection({ socketPath: adminSocket, user: 'root', password: '', multipleStatements: multi, connectTimeout: 5000 });
}

async function freePort() {
  for (let i = 0; i < 64; i++) {
    const port = PORT_MIN + (crypto.randomInt(0, 2 ** 31 - 1) % (PORT_MAX - PORT_MIN + 1));
    if (FORBIDDEN_PORTS.includes(port)) continue;
    const ok = await new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(port, HOST, () => s.close(() => resolve(true))); });
    if (ok) return port;
  }
  throw new Error('No se encontró un puerto libre.');
}

// ===== Copiado SIN CAMBIOS de scripts/ci/portal-e2e/harness.mjs (esquema por sentencias y datos ficticios del TMS) =====
/** Divide un .sql en sentencias (quita comentarios de línea). Los .sql del proyecto no usan DELIMITER ni rutinas. */
const statements = (text) => text.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n').split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean);

/** Aplica archivos .sql SENTENCIA POR SENTENCIA con reintentos (el orden de dependencias del proyecto no siempre es lineal). Informa lo que no se pudo crear. */
async function schema(files, quiet = false) {
  const { m, repo } = readState(); const c = await adminConn(m, { multi: true }); await c.query(`USE \`${m.schema}\``);
  const out = [];
  for (const file of files) {
    const lastErr = new Map(); let pending = statements(fs.readFileSync(path.join(repo, file), 'utf8')); let ok = 0;
    for (let pass = 0; pass < 6 && pending.length; pass++) {
      const next = [];
      for (const sql of pending) { try { await c.query(sql); ok++; } catch (e) { next.push(sql); lastErr.set(sql, String(e.message).slice(0, 140)); if (false) out.push({ file, error: String(e.message).slice(0, 160), sql: sql.slice(0, 70) }); } }
      if (next.length === pending.length && pass > 0) { pending = next; break; } pending = next;
    }
    out.push({ file, applied: ok, pendingAtEnd: pending.length, errors: pending.slice(0, 3).map((q) => `${q.slice(0, 60)} => ${lastErr.get(q)}`) });
  }
  await c.end(); if (!quiet) console.log(JSON.stringify(out, null, 1)); return out;
}


/** Datos COMPLETAMENTE FICTICIOS: 1 empresa, 1 piloto principal, 1 auxiliar, 1 cliente, 1 unidad y 1 viaje «En ruta» con 4 paradas (Carga, 2 Entrega, Descarga). Las contraseñas se generan aquí y solo existen en este run. */
async function seed() {
  const state = readState(); const { m } = state;
  const c = await adminConn(m, { multi: true }); await c.query(`USE \`${m.schema}\``);
  const id = async (sql, params) => Number((await c.query(sql, params))[0].insertId);
  const hash = (password) => { const salt = crypto.randomBytes(32).toString('hex'); return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }; };
  const pwPiloto = `E2E-${crypto.randomBytes(9).toString('hex')}`; const pwAux = `E2E-${crypto.randomBytes(9).toString('hex')}`;
  const empresa = await id("INSERT INTO empresas (codigo, nombre, slug, activa, modulos_json, creado_en) VALUES ('KT', 'Empresa Ficticia E2E', 'kt-monaco', 1, '[\"rrhh\",\"tms\",\"flota\"]', NOW())", []);
  const empPiloto = await id("INSERT INTO empleados (empresa_id, codigo, nombre, puesto, categoria_ops) VALUES (?, 'E2E-P1', 'Piloto Ficticio Uno', 'Piloto', 'Piloto')", [empresa]);
  const empAux = await id("INSERT INTO empleados (empresa_id, codigo, nombre, puesto, categoria_ops) VALUES (?, 'E2E-A1', 'Auxiliar Ficticio Uno', 'Auxiliar', 'Auxiliar')", [empresa]);
  for (const [emp, user, pw] of [[empPiloto, 'piloto.e2e', pwPiloto], [empAux, 'auxiliar.e2e', pwAux]]) {
    const h = hash(pw); await c.query("INSERT INTO colaborador_credenciales (empleado_id, username, password_hash, salt, activo, debe_cambiar_password) VALUES (?, ?, ?, ?, 1, 0)", [emp, user, h.hash, h.salt]);
  }
  const persPiloto = await id("INSERT INTO tms_personal (empresa_id, id_empleado, codigo, nombre, tipo) VALUES (?, ?, 'E2E-P1', 'Piloto Ficticio Uno', 'Piloto')", [empresa, empPiloto]);
  const persAux = await id("INSERT INTO tms_personal (empresa_id, id_empleado, codigo, nombre, tipo) VALUES (?, ?, 'E2E-A1', 'Auxiliar Ficticio Uno', 'Auxiliar')", [empresa, empAux]);
  const cliente = await id("INSERT INTO tms_clientes (empresa_id, nombre) VALUES (?, 'Cliente Ficticio E2E')", [empresa]);
  const vehiculo = await id("INSERT INTO flota_vehiculos (empresa_id, placa) VALUES (?, 'E2E-001')", [empresa]);
  const unidad = await id("INSERT INTO tms_unidades (empresa_id, placa, flota_vehiculo_id) VALUES (?, 'E2E-001', ?)", [empresa, vehiculo]);
  const hoy = new Date().toISOString().slice(0, 10);
  const plan = await id("INSERT INTO tms_planes_viaje (empresa_id, codigo, cliente_id, unidad_id, piloto_id, fecha_plan, estado) VALUES (?, 'E2E-0001', ?, ?, ?, ?, 'En ruta')", [empresa, cliente, unidad, persPiloto, hoy]);
  await c.query("INSERT INTO tms_plan_auxiliares (plan_id, personal_id, orden) VALUES (?, ?, 1)", [plan, persAux]);
  const viaje = await id("INSERT INTO flota_viajes (empresa_id, vehiculo_id, piloto_nombre, hora_salida, km_salida, estado, empleado_id, plan_id) VALUES (?, ?, 'Piloto Ficticio Uno', NOW(), 1000, 'abierto', ?, ?)", [empresa, vehiculo, empPiloto, plan]);
  const paradas = [];
  for (const [i, [tipo, lugar]] of [['Carga', 'Centro de distribución ficticio'], ['Entrega', 'Club ficticio Norte'], ['Entrega', 'Club ficticio Sur'], ['Descarga', 'Club ficticio Final']].entries()) {
    paradas.push(await id("INSERT INTO tms_plan_paradas (plan_id, orden, lugar_nombre, tipo, requiere_evidencia) VALUES (?, ?, ?, ?, 1)", [plan, i + 1, lugar, tipo]));
  }
  await c.end();
  state.seed = { empresa, plan, viaje, paradas, piloto: { empleado: empPiloto, personal: persPiloto, username: 'piloto.e2e', password: pwPiloto }, auxiliar: { empleado: empAux, personal: persAux, username: 'auxiliar.e2e', password: pwAux } };
  writeState(state); console.log(JSON.stringify(state.seed));
}


// ===== Copiado SIN CAMBIOS de scripts/ci/pricesmart-demo/demo.mjs `prepare()` (DDL de laboratorio de PriceSmart, alcances, catálogo M2M, mapeo y cuenta de worker) =====
async function prepareData() {
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

  return demo;
}

// ===== Específico de Linux =====
let serverProc = null; let appProc = null; let sockDir = '';
const tailOf = (file, n = 60) => { try { return fs.readFileSync(file, 'utf8').split('\n').slice(-n).join('\n'); } catch { return '(sin registro)'; } };

async function startDb(m) {
  fs.mkdirSync(m.runDir, { mode: 0o700 }); for (const d of [m.tmpDir, m.filesDir, m.sandboxRoot, m.uploadsDir, m.evidenceDir, m.homeDir]) fs.mkdirSync(d);
  sockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-')); fs.chmodSync(sockDir, 0o700); adminSocket = path.join(sockDir, 's');
  if (Buffer.byteLength(adminSocket) > 100) throw new Error('Ruta de socket demasiado larga');
  m.port = await freePort(); validateManifest(m, tempRoot, { requirePort: true });
  const asRoot = process.getuid?.() === 0 ? ['--user=root'] : [];
  const env = { PATH: process.env.PATH, HOME: m.homeDir, TMPDIR: m.tmpDir, LANG: 'C.UTF-8' };
  const init = cp.spawnSync(INSTALL_DB, ['--no-defaults', `--basedir=${BASEDIR}`, `--datadir=${m.datadir}`, '--auth-root-authentication-method=normal', '--skip-test-db', ...asRoot], { env, encoding: 'utf8', timeout: 120000 });
  if (init.status !== 0) throw new Error(`Inicialización del datadir fallida: ${(init.stderr ?? '').slice(-500)}`);
  const fd = fs.openSync(m.serverLog, 'a');
  // Mismos controles de aislamiento que `buildServerArgs` de Windows (solo loopback, sin DNS, sin LOAD DATA LOCAL, datadir/pid/tmp propios, mismo modo SQL y espera de bloqueos); max_connections ya en 400 (el arnés
  // de Windows lo sube con SET GLOBAL tras arrancar: `next dev` duplica los pools). Sin `--enable-named-pipe` (solo Windows); el acceso administrativo es el socket Unix del run.
  const args = ['--no-defaults', ...asRoot, `--basedir=${BASEDIR}`, `--datadir=${m.datadir}`, `--pid-file=${m.pidFile}`, `--tmpdir=${m.tmpDir}`, `--bind-address=${HOST}`, `--port=${m.port}`, '--skip-name-resolve',
    `--socket=${adminSocket}`, '--local-infile=0', `--secure-file-priv=${m.filesDir}`, '--max-connections=400', `--innodb-lock-wait-timeout=${LOCK_WAIT_SECONDS}`, '--innodb-buffer-pool-size=64M',
    '--innodb-flush-log-at-trx-commit=1', '--character-set-server=utf8mb4', '--sql-mode=STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO', '--console'];
  serverProc = cp.spawn(MARIADBD, args, { env, stdio: ['ignore', fd, fd] }); fs.closeSync(fd);
  let admin = null;
  for (let i = 0; i < 120 && !admin; i++) {
    if (serverProc.exitCode !== null) throw new Error(`Servidor detenido: ${tailOf(m.serverLog)}`);
    try { admin = await adminConn(m); } catch { await sleep(500); }
  }
  if (!admin) throw new Error('No se pudo conectar al socket administrativo.');
  const [[id]] = await admin.query('SELECT @@version AS version, @@port AS port, @@bind_address AS bind, @@datadir AS datadir, @@socket AS socket, @@skip_name_resolve AS snr, @@local_infile AS li, @@innodb_lock_wait_timeout AS lw, @@read_only AS ro, @@log_bin AS lb');
  const bad = [];
  if (!String(id.version).startsWith(`${ENGINE.versionPrefix}-MariaDB`)) bad.push('version'); if (Number(id.port) !== m.port) bad.push('port'); if (id.bind !== HOST) bad.push('bind');
  if (path.resolve(id.datadir) !== path.resolve(m.datadir)) bad.push('datadir'); if (id.socket !== adminSocket) bad.push('socket'); if (Number(id.snr) !== 1) bad.push('skipNameResolve');
  if (Number(id.li) !== 0) bad.push('localInfile'); if (Number(id.lw) !== LOCK_WAIT_SECONDS) bad.push('lockWait'); if (Number(id.ro) !== 0) bad.push('readOnly'); if (Number(id.lb) !== 0) bad.push('logBin');
  if (bad.length) throw new Error(`Identidad/configuración del servidor no autorizada (${bad.join(', ')}).`);
  log(`MariaDB ${id.version} en ${HOST}:${m.port} (socket administrativo, solo loopback)`);
  await admin.end();
}

async function bootstrapDb(m) {
  const multi = await adminConn(m, { multi: true });
  const schemaName = `\`${m.schema}\``; const account = `\`${m.user}\`@\`127.0.0.1\``;
  await multi.query(`CREATE DATABASE ${schemaName} CHARACTER SET utf8mb4`);
  await multi.query(`USE ${schemaName}`);
  await multi.query("CREATE TABLE novalvion_environment (id TINYINT NOT NULL PRIMARY KEY CHECK (id = 1), environment VARCHAR(16) NOT NULL CHECK (environment = 'sandbox'), sandbox_id VARCHAR(48) NOT NULL) ENGINE=InnoDB");
  await multi.query("INSERT INTO novalvion_environment (id, environment, sandbox_id) VALUES (1, 'sandbox', ?)", [m.sandboxId]);
  await multi.query(`CREATE USER ${account} IDENTIFIED BY '${m.secrets.DB_PASSWORD}'`);
  await multi.query(`GRANT ALL PRIVILEGES ON ${schemaName}.* TO ${account}`);
  await multi.end();
  fs.writeFileSync(path.join(m.sandboxRoot, 'isolation.json'), JSON.stringify(isolationJson(m)), { flag: 'wx' });
}

/** Ejecuta Vitest (hijo) con un entorno construido desde cero; la salida va directa al registro de CI. */
function vitest(config, files, env, extra = []) {
  const r = cp.spawnSync(process.execPath, [path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', config, ...extra, ...files], { cwd: repoRoot, env, stdio: 'inherit', timeout: 40 * 60 * 1000 });
  return r.status ?? 1;
}

async function startApp(m, demo) {
  const port = await freePort();
  const env = childEnv(m, { NODE_ENV: 'development', PRICESMART_LAB_DEMO: 'SINTETICO-LOCAL-SIN-PRODUCCION', PRICESMART_LAB_KEY: demo.labKey });
  delete env.PS06A_APP_PASSWORD; delete env.PS06A_WORKER_PASSWORD;
  const fd = fs.openSync(path.join(m.runDir, 'next.log'), 'a');
  appProc = cp.spawn(process.execPath, [path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--webpack', '--hostname', HOST, '--port', String(port)], { cwd: repoRoot, env, detached: true, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  let up = false;
  for (let i = 0; i < 420 && !up; i++) {
    if (appProc.exitCode !== null) throw new Error(`La app terminó: ${tailOf(path.join(m.runDir, 'next.log'))}`);
    try { const r = await fetch(`http://${HOST}:${port}/portal/login`, { redirect: 'manual' }); if (r.status < 500) up = true; } catch { /* aún no */ }
    if (!up) await sleep(1000);
  }
  if (!up) throw new Error('La app no respondió a tiempo.');
  writeState({ app: { pid: appProc.pid, port } });
  log(`app en http://${HOST}:${port}`);
}

async function stopAll(m) {
  const report = { app: 'sin app', db: 'sin servidor', removed: false };
  if (appProc?.pid) {
    try { process.kill(-appProc.pid, 'SIGTERM'); } catch { /* ya terminó */ }
    for (let i = 0; i < 20 && appProc.exitCode === null; i++) await sleep(250);
    if (appProc.exitCode === null) { try { process.kill(-appProc.pid, 'SIGKILL'); } catch { /* ya terminó */ } }
    report.app = 'detenida';
  }
  if (serverProc) {
    try { const a = await adminConn(m); try { await a.query('SHUTDOWN'); } catch { /* cierra la conexión */ } await a.end().catch(() => undefined); } catch { /* ya caído */ }
    for (let i = 0; i < 60 && serverProc.exitCode === null; i++) await sleep(500);
    if (serverProc.exitCode === null) serverProc.kill('SIGKILL');
    report.db = serverProc.exitCode === null ? 'no se pudo detener' : 'detenido';
  }
  try { if (sockDir) fs.rmSync(sockDir, { recursive: true, force: true }); } catch { /* ok */ }
  try { safeRemoveRunDir(m, tempRoot, fs); report.removed = true; } catch (e) { report.reason = String(e.message).slice(0, 200); }
  log('cierre', JSON.stringify(report));
}

const DEFAULT_FILES = ['demo', 'api13', 'pricesmart-flow', 'homologation', 'sandbox-readiness', 'contract-not-mapped'].map((f) => `scripts/ci/pricesmart-demo/${f}.e2e.ts`);

async function main() {
  const m = createManifest({ randomBytes: crypto.randomBytes, tempRoot }); m.homeDir = path.join(m.runDir, 'home'); validateManifest(m, tempRoot);
  ST.m = m; let code = 1;
  try {
    await startDb(m); fs.writeFileSync(stateFile(), JSON.stringify(ST));
    await bootstrapDb(m);
    // Mismo orden que el arnés de Windows (`harness.mjs bootstrap`): esquema base → esquema de tiempo de ejecución (código real) → migraciones del proyecto (2 rondas) → confirmaciones → datos ficticios.
    await schema(['sql/schema.sql', 'sql/migrate-2026-08-rrhh-colaborador-auth.sql'], true);
    const ensureEnv = childEnv(m); delete ensureEnv.PS06A_APP_PASSWORD; delete ensureEnv.PS06A_WORKER_PASSWORD;
    if (vitest('scripts/ci/portal-e2e/vitest.e2e.config.mts', ['scripts/ci/portal-e2e/ensure.e2e.ts'], ensureEnv) !== 0) throw new Error('No se pudo crear el esquema de tiempo de ejecución.');
    const migrations = fs.readdirSync(path.join(repoRoot, 'sql')).filter((f) => /^migrate-2026-.*\.sql$/.test(f) && !f.includes('tms-parada-confirmaciones')).sort().map((f) => `sql/${f}`);
    await schema(migrations, true); const second = await schema(migrations, true);
    await schema(['sql/migrate-2026-11-tms-parada-confirmaciones.sql'], true);
    log('migraciones pendientes tras la segunda ronda:', second.filter((r) => r.pendingAtEnd > 0).length);
    await seed();
    const demo = await prepareData(); demo.labKey = crypto.randomBytes(32).toString('hex');
    // `prepareData` obtiene su conexión por `adminConn` (socket Unix); la clave de laboratorio solo vive en este run.
    writeState({ demo });
    await startApp(m, demo);
    const files = (process.env.PS_E2E_FILES ? process.env.PS_E2E_FILES.split(',') : DEFAULT_FILES).map((f) => f.trim()).filter(Boolean);
    const testEnv = childEnv(m, { PS_DEMO_WORKER_USER: m.workerUser, PS_DEMO_RUNDIR: m.runDir }); delete testEnv.PS06A_APP_PASSWORD;
    log('E2E:', files.join(' '));
    code = vitest('scripts/ci/pricesmart-demo/vitest.demo.config.mts', files, testEnv, ['--reporter=verbose']);
    if (code !== 0) { console.error('--- next.log (cola) ---\n' + tailOf(path.join(m.runDir, 'next.log'), 80)); }
  } catch (e) {
    console.error(`[ps-linux] ERROR: ${e.message}`);
    console.error('--- server.log (cola) ---\n' + tailOf(m.serverLog, 60)); console.error('--- next.log (cola) ---\n' + tailOf(path.join(m.runDir, 'next.log'), 60));
    code = 1;
  } finally { await stopAll(m); }
  return code;
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
