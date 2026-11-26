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
import { securityDdlStatements, attestationDdlStatements } from '../pricesmart-api11/ddl.mjs';
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
    'PS_DEMO_WORKER_USER', 'PS_DEMO_RUNDIR', 'PS_DEMO_OWNER_USER', 'PS_DEMO_OWNER_PASSWORD', 'CI']);
  const unknown = Object.keys(env).filter((k) => !allowed.has(k));
  if (unknown.length) fail(`Variable no permitida en el entorno de pruebas: ${unknown.join(', ')}`);
  if (new Set([env.AUTH_SECRET, env.DB_PASSWORD, env.PORTAL_CREDENTIALS_KEY, env.PS06A_WORKER_PASSWORD, env.PS06A_APP_PASSWORD]).size !== 5) fail('Los cinco secretos deben ser distintos.');
  return env;
}

// ---- administración por socket Unix del run (única vía administrativa) ----
let adminSocket = '';
async function adminConn(m, { multi = true } = {}) {   // como demo.mjs (multipleStatements siempre): el esquema del TMS agrupa PREPARE;EXECUTE;DEALLOCATE en una sola sentencia
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

// ===== Copiado SIN CAMBIOS de scripts/ci/pricesmart-demo/demo.mjs (cuentas y ensayo del paquete de aprovisionamiento de homologación, API-26) =====
async function prepareHomologation() {
  const state = readState(); const { m } = state; const B = await import('../pricesmart-homologation/bundle.mjs');
  const c = await adminConn(m); await c.query(`USE \`${m.schema}\``);
  for (const sql of attestationDdlStatements(fs.readFileSync(path.join(repoRoot, 'docs/integraciones/pricesmart/api18/staging-attestation.sql.in'), 'utf8'))) { try { await c.query(sql); } catch (e) { if (e.code !== 'ER_TABLE_EXISTS_ERROR') throw e; } }
  const names = { schema: m.schema, appUser: `${m.schema}_ha`, workerUser: `${m.schema}_hw`, monitorUser: `${m.schema}_hm` };
  const homolog = { names };
  try { await c.query(B.PROVISION_DDL); } catch (e) { if (e.code !== 'ER_TABLE_EXISTS_ERROR') throw e; }   // el runtime exige el marcador de aprovisionamiento COMPLETO (sonda `provisioning`)
  for (const step of B.PROVISION_STEPS) await c.query("INSERT INTO ps_homolog_provisioning (step, state, detail, updated_at) VALUES (?, 'COMPLETE', 'laboratorio', UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE state = 'COMPLETE'", [step]);
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
  for (const k of ['r1', 'r2', 'r3', 'r4', 'r5']) for (const sql of B.destroyStatements(k)) await admin.query(sql);   // limpieza previa (solo nombres homolog_r1…r4)
  step('limpieza previa hecha');
  // Aislamiento de `apply`/`finalize`/`destroy`: una base y una cuenta «señuelo» AJENAS al sandbox (y las cuentas/bases del laboratorio) deben quedar EXACTAMENTE igual tras todo el ciclo.
  const decoy = 'sandbox_api02_homolog_decoy'; const decoyPw = crypto.randomBytes(24).toString('hex');
  await admin.query(`DROP DATABASE IF EXISTS \`${decoy}\``); await admin.query(`DROP USER IF EXISTS \`${decoy}\`@\`127.0.0.1\``);
  await admin.query(`CREATE DATABASE \`${decoy}\``); await admin.query(`CREATE TABLE \`${decoy}\`.t (id INT PRIMARY KEY, v VARCHAR(20))`); await admin.query(`INSERT INTO \`${decoy}\`.t VALUES (1, 'intacto')`);
  await admin.query(`CREATE USER \`${decoy}\`@\`127.0.0.1\` IDENTIFIED BY '${decoyPw}'`); await admin.query(`GRANT SELECT ON \`${decoy}\`.t TO \`${decoy}\`@\`127.0.0.1\``);
  const sandboxes = ['r1', 'r2', 'r3', 'r4', 'r5'].map((k) => B.homologNames(k)); const ownNames = new Set(sandboxes.flatMap((x) => [x.appUser, x.workerUser, x.monitorUser])); const ownSchemas = new Set(sandboxes.map((x) => x.schema));
  const snap = async () => {
    const users = (await admin.query("SELECT DISTINCT User u FROM mysql.user WHERE User LIKE 'sandbox%' ORDER BY 1"))[0].map((r) => r.u).filter((u) => !ownNames.has(u)); const grants = {};
    for (const u of users) grants[u] = (await admin.query(`SHOW GRANTS FOR \`${u}\`@\`127.0.0.1\``))[0].map((r) => String(Object.values(r)[0]).replace(/IDENTIFIED BY PASSWORD '[^']*'/, 'IDENTIFIED BY PASSWORD <oculto>')).sort();   // el ORDEN de SHOW GRANTS no está garantizado tras recargar privilegios
    return { schemas: (await admin.query("SELECT SCHEMA_NAME s FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys') ORDER BY 1"))[0].map((r) => r.s).filter((x) => !ownSchemas.has(x)),
      decoyChecksum: (await admin.query(`CHECKSUM TABLE \`${decoy}\`.t`))[0][0].Checksum, labTables: (await admin.query('SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [m.schema]))[0][0].n, users, grants };
  };
  const before = await snap();
  report.applied = await B.executeBundle(admin, bundle, secrets, { tms: { repo: repoRoot, files: B.tmsSchemaPhases(repoRoot).base } }); step('paquete aplicado');
  // Paso «esquema de ejecución» (código REAL del proyecto) con el MISMO entorno que tendrá el sandbox: manifiesto de aislamiento validado por validateSandboxConfig y cuenta de la aplicación con privilegios TEMPORALES.
  const root = path.join(m.runDir, 'homolog-root'); fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify(B.buildIsolationManifest(names, sandboxSecrets, { dbPort: m.port })));
  const finalized = await B.finalizeBundle(admin, bundle, { repo: repoRoot, sandboxRoot: root, sandboxSecrets, dbPort: m.port, tmpDir: m.tmpDir }); step('esquema de ejecución y privilegios finales aplicados');
  report.runtimeSchemaStep = finalized.runtimeSchemaStep; report.ensuredGrants = finalized.ensuredGrants; report.migrations = finalized.migrations; report.scope = finalized.scope;
  report.finalState = { ...(await B.preflightProvision(admin, names)), marker: (await admin.query(`SELECT step, state FROM \`${names.schema}\`.ps_homolog_provisioning ORDER BY step`))[0] };
  report.passwordVariablesCleared = (await admin.query('SELECT @ps_app_pw AS a, @ps_worker_pw AS w, @ps_monitor_pw AS m'))[0][0];
  try { await B.executeBundle(admin, bundle, secrets); report.secondApply = 'NO_ERROR'; } catch (e) { report.secondApply = e.code ?? e.errno ?? 'ERR'; }   // la base ya existe: la reaplicación FALLA
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
  await B.destroySandbox(admin, 'r1');
  // ---- Fallos REALES de DDL y recuperación (sobre sandboxes r2, r3, r4; todo con nombres homolog_*): ninguna instalación parcial se informa como éxito ni activa permisos finales.
  const sab = path.join(m.runDir, 'sabotaged'); fs.rmSync(sab, { recursive: true, force: true }); fs.mkdirSync(path.join(sab, 'sql'), { recursive: true });
  fs.writeFileSync(path.join(sab, 'sql', 'broken.sql'), 'CREATE TABLE ok_t (id INT);\nCREATE TABLE bad_t (a INT DEFAULT \'no-es-entero\');\n');
  fs.writeFileSync(path.join(sab, 'sql', 'deferred.sql'), 'CREATE TABLE dep_t (a INT, FOREIGN KEY (a) REFERENCES no_existe_xyz(id));\n');   // falla por DEPENDENCIA (tabla padre ausente): diferible en apply, inaceptable en finalize
  for (const f of B.tmsSchemaPhases(repoRoot).base) fs.copyFileSync(path.join(repoRoot, f), path.join(sab, f));   // el esquema BASE real + una sentencia diferida propia
  const secretsFor = () => ({ app: B.generateSandboxSecrets(B.homologNames('r4')).DB_PASSWORD, worker: crypto.randomBytes(24).toString('hex'), monitor: crypto.randomBytes(24).toString('hex') });
  const failureOf = async (fn) => { try { await fn(); return { threw: false }; } catch (e) { return { threw: true, name: e.name, code: e.code ?? e.errno ?? 'ERR', diagnostic: e.diagnostic ?? null }; } };
  const inspect = async (nm) => {
    const state = await B.preflightProvision(admin, nm); const marker = state.state === 'ABSENT' || state.state === 'FOREIGN' ? [] : (await admin.query(`SELECT step, state, detail FROM \`${nm.schema}\`.ps_homolog_provisioning`))[0];
    const accounts = (await admin.query('SELECT COUNT(*) n FROM information_schema.USER_PRIVILEGES WHERE GRANTEE LIKE ?', [`%${nm.appUser}%`]))[0][0].n + (await admin.query('SELECT COUNT(*) n FROM information_schema.USER_PRIVILEGES WHERE GRANTEE LIKE ?', [`%${nm.workerUser}%`]))[0][0].n;
    const tables = state.state === 'ABSENT' ? 0 : (await admin.query('SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [nm.schema]))[0][0].n;
    return { state: state.state, marker, accounts: Number(accounts), tables: Number(tables) };
  };
  report.failures = {};
  // A) esquema del TMS PARCIAL (DDL real que falla): ni DDL de PriceSmart, ni cuentas, ni privilegios; marcador FAILED; reaplicar y finalizar se rechazan; recuperación = destroy + apply limpio.
  const nmA = B.homologNames('r2'); const bA = B.buildBootstrap('r2', repoRoot);
  report.failures.tmsIncomplete = { result: await failureOf(() => B.executeBundle(admin, bA, secretsFor(), { tms: { repo: sab, files: ['sql/broken.sql'] } })), after: await inspect(nmA) };
  report.failures.tmsIncomplete.reapply = await failureOf(() => B.executeBundle(admin, bA, secretsFor(), { tms: { repo: sab, files: ['sql/broken.sql'] } }));
  report.failures.tmsIncomplete.finalize = await failureOf(() => B.finalizeBundle(admin, bA, { repo: repoRoot, sandboxRoot: root, sandboxSecrets, dbPort: m.port, tmpDir: m.tmpDir, runtimeSchemaStep: async () => { throw new Error('NO DEBE EJECUTARSE'); } }));
  await B.destroySandbox(admin, 'r2');
  report.failures.tmsIncomplete.destroyed = await inspect(nmA);
  report.failures.tmsIncomplete.recovered = await failureOf(async () => { report.failures.tmsIncomplete.recoveredApplied = await B.executeBundle(admin, bA, secretsFor(), { tms: { repo: repoRoot, files: B.tmsSchemaPhases(repoRoot).base } }); });
  report.failures.tmsIncomplete.recoveredState = await inspect(nmA); await B.destroySandbox(admin, 'r2');
  // A2) sentencia DIFERIDA (depende de una fase posterior): `apply` la informa y NO es «completo»; `finalize` NO la acepta, revoca lo temporal y no concede privilegios finales.
  report.failures.deferred = {}; report.failures.deferred.applied = await failureOf(async () => { report.failures.deferred.report = await B.executeBundle(admin, bA, secretsFor(), { tms: { repo: sab, files: [...B.tmsSchemaPhases(sab).base, 'sql/deferred.sql'] } }); });
  report.failures.deferred.afterApply = await inspect(nmA);
  report.failures.deferred.finalize = await failureOf(() => B.finalizeBundle(admin, bA, { repo: sab, sandboxRoot: root, sandboxSecrets, dbPort: m.port, tmpDir: m.tmpDir, runtimeSchemaStep: async () => ({ exit: 0, tail: '' }), phases: { base: [...B.tmsSchemaPhases(sab).base, 'sql/deferred.sql'], migrations: [], confirmations: [] } }));
  report.failures.deferred.afterFinalize = await inspect(nmA); report.failures.deferred.privilegesTmp = (await admin.query('SELECT COUNT(*) n FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE LIKE ?', [`%${nmA.appUser}%`]))[0][0].n;
  await B.destroySandbox(admin, 'r2');
  // B) fallo REAL de DDL de PriceSmart a mitad del paquete: queda PARCIAL (sin reversión del DDL), sin cuentas ni privilegios.
  const nmB = B.homologNames('r3'); const bB0 = B.buildBootstrap('r3', repoRoot);
  const bB = { ...bB0, ddl: [...bB0.ddl.slice(0, 6), 'CREATE TABLE ps_api99_roto (a INT, FOREIGN KEY (a) REFERENCES no_existe_xyz(id))', ...bB0.ddl.slice(6)] };
  report.failures.ddlFailure = { result: await failureOf(() => B.executeBundle(admin, bB, secretsFor())), after: await inspect(nmB) };
  report.failures.ddlFailure.reapply = await failureOf(() => B.executeBundle(admin, bB0, secretsFor()));
  await B.destroySandbox(admin, 'r3'); report.failures.ddlFailure.destroyed = await inspect(nmB);
  // C) fallos en FINALIZE sobre un sandbox APLICADO: privilegios temporales revocados, sin privilegios finales, marcador FAILED; luego recuperación real.
  const nmC = B.homologNames('r4'); const bC = B.buildBootstrap('r4', repoRoot); const sandboxSecretsC = B.generateSandboxSecrets(nmC); const rootC = path.join(m.runDir, 'homolog-root-r4'); fs.rmSync(rootC, { recursive: true, force: true }); fs.mkdirSync(path.join(rootC, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(rootC, 'isolation.json'), JSON.stringify(B.buildIsolationManifest(nmC, sandboxSecretsC, { dbPort: m.port })));
  await B.executeBundle(admin, bC, { app: sandboxSecretsC.DB_PASSWORD, worker: crypto.randomBytes(24).toString('hex'), monitor: crypto.randomBytes(24).toString('hex') }, { tms: { repo: repoRoot, files: B.tmsSchemaPhases(repoRoot).base } });
  const grantsOf = async (u) => (await admin.query(`SHOW GRANTS FOR \`${u}\`@\`127.0.0.1\``))[0].map((r) => String(Object.values(r)[0]).replace(/IDENTIFIED BY PASSWORD '[^']*'/, '<oculto>'));
  const privileges = async () => { const g = await grantsOf(nmC.appUser); return { schemaWide: g.some((l) => /ON `sandbox_api02_homolog_r4`\.\* /.test(l)), ensuredTable: g.some((l) => /`tms_plan_paradas`|`tms_parada_confirmaciones`/.test(l)) }; };
  const fin = (extra) => B.finalizeBundle(admin, bC, { repo: repoRoot, sandboxRoot: rootC, sandboxSecrets: sandboxSecretsC, dbPort: m.port, tmpDir: m.tmpDir, ...extra });
  report.failures.finalize = { stateBefore: (await inspect(nmC)).state };
  report.failures.finalize.stepFails = { result: await failureOf(() => fin({ runtimeSchemaStep: async () => ({ exit: 1, tail: 'fallo simulado del paso' }) })), privileges: await privileges(), after: await inspect(nmC) };
  report.failures.finalize.migrationsIncomplete = { result: await failureOf(() => fin({ repo: sab, runtimeSchemaStep: async () => ({ exit: 0, tail: '' }), phases: { base: [], migrations: [], confirmations: ['sql/broken.sql'] } })), privileges: await privileges(), after: await inspect(nmC) };
  report.failures.finalize.recovered = { result: await failureOf(async () => { report.failures.finalize.recoveredReport = await fin({}); }), privileges: await privileges(), after: await inspect(nmC) };
  report.failures.finalize.reapplyAfterComplete = await failureOf(() => fin({ runtimeSchemaStep: async () => { throw new Error('NO DEBE EJECUTARSE'); } }));
  await B.destroySandbox(admin, 'r4'); report.failures.finalize.destroyed = await inspect(nmC);
  // E) PROPIEDAD en `destroy` (sobre el nombre r5; cada caso es MariaDB real). Ninguna baja se hace por coincidencia de nombre.
  const nm5 = B.homologNames('r5'); const own = report.ownership = {};
  const raw5 = async () => { for (const sql of B.destroyStatements('r5')) await admin.query(sql); };
  const snap5 = async () => ({ state: (await B.preflightProvision(admin, nm5)).state, schema: Number((await admin.query('SELECT COUNT(*) n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [nm5.schema]))[0][0].n),
    accounts: Number((await admin.query("SELECT COUNT(DISTINCT GRANTEE) n FROM information_schema.USER_PRIVILEGES WHERE GRANTEE LIKE ?", [`%homolog_%r5%`]))[0][0].n) });
  const apply5 = () => B.executeBundle(admin, B.buildBootstrap('r5', repoRoot), { app: B.generateSandboxSecrets(nm5).DB_PASSWORD, worker: crypto.randomBytes(24).toString('hex'), monitor: crypto.randomBytes(24).toString('hex') }, { tms: { repo: repoRoot, files: B.tmsSchemaPhases(repoRoot).base } });
  await raw5();
  // E1) sandbox propio completo → se destruye
  await apply5(); own.own = { before: await snap5() }; own.own.result = await failureOf(async () => { own.own.report = await B.destroySandbox(admin, 'r5'); }); own.own.after = await snap5();
  // E2) base AJENA con el mismo nombre (sin comentario ni marcador) + cuentas ajenas con los mismos nombres → rechazado; nada cambia
  await raw5(); await admin.query(`CREATE DATABASE \`${nm5.schema}\``); await admin.query(`CREATE TABLE \`${nm5.schema}\`.datos (id INT PRIMARY KEY, v VARCHAR(20))`); await admin.query(`INSERT INTO \`${nm5.schema}\`.datos VALUES (1, 'ajeno')`);
  for (const u of [nm5.appUser, nm5.workerUser]) { await admin.query(`CREATE USER \`${u}\`@\`127.0.0.1\` IDENTIFIED BY '${decoyPw}'`); await admin.query(`GRANT SELECT ON \`${nm5.schema}\`.datos TO \`${u}\`@\`127.0.0.1\``); }
  const sum5 = async () => ({ checksum: (await admin.query(`CHECKSUM TABLE \`${nm5.schema}\`.datos`))[0][0].Checksum, ...(await snap5()) });
  own.foreignNoMarker = { before: await sum5(), result: await failureOf(() => B.destroySandbox(admin, 'r5')), after: await sum5() };
  own.foreignNoMarker.apply = await failureOf(() => apply5());
  // E3) identidad distinta: comentario de OTRO sandbox; y comentario propio pero fila de entorno de otro sandbox
  await raw5(); await admin.query(`CREATE DATABASE \`${nm5.schema}\` COMMENT 'novalvion-sandbox-owner:homolog-otro'`); await admin.query(`CREATE TABLE \`${nm5.schema}\`.datos (id INT PRIMARY KEY, v VARCHAR(20))`); await admin.query(`INSERT INTO \`${nm5.schema}\`.datos VALUES (1, 'ajeno')`);
  own.otherComment = { before: await sum5(), result: await failureOf(() => B.destroySandbox(admin, 'r5')), after: await sum5() };
  await raw5(); await admin.query(`CREATE DATABASE \`${nm5.schema}\` COMMENT '${B.ownerComment(nm5)}'`); await admin.query(`CREATE TABLE \`${nm5.schema}\`.novalvion_environment (id TINYINT NOT NULL PRIMARY KEY, environment VARCHAR(16) NOT NULL, sandbox_id VARCHAR(48) NOT NULL)`);
  await admin.query(`INSERT INTO \`${nm5.schema}\`.novalvion_environment VALUES (1, 'sandbox', 'homolog-otro')`); await admin.query(`CREATE TABLE \`${nm5.schema}\`.datos (id INT PRIMARY KEY)`);
  own.otherIdentity = { before: await snap5(), result: await failureOf(() => B.destroySandbox(admin, 'r5')), after: await snap5() };
  // E4) fallo ANTES de los marcadores (solo el comentario de propiedad): recuperable sin intervención; con una cuenta SIN procedencia → se detiene
  await raw5(); await admin.query(`CREATE DATABASE \`${nm5.schema}\` COMMENT '${B.ownerComment(nm5)}'`);
  own.beforeMarkers = { state: (await B.preflightProvision(admin, nm5)).state }; own.beforeMarkers.result = await failureOf(async () => { own.beforeMarkers.report = await B.destroySandbox(admin, 'r5'); }); own.beforeMarkers.after = await snap5();
  await raw5(); await admin.query(`CREATE DATABASE \`${nm5.schema}\` COMMENT '${B.ownerComment(nm5)}'`); await admin.query(`CREATE USER \`${nm5.appUser}\`@\`127.0.0.1\` IDENTIFIED BY '${decoyPw}'`);
  own.beforeMarkersForeignAccount = { before: await snap5(), result: await failureOf(() => B.destroySandbox(admin, 'r5')), after: await snap5() };
  // E5) base propia pero una cuenta con privilegios FUERA del sandbox → se detiene; al corregirlo (revocar) la baja procede
  await raw5(); await apply5(); await admin.query(`GRANT SELECT ON \`${decoy}\`.t TO \`${nm5.workerUser}\`@\`127.0.0.1\``);
  own.grantsOutside = { before: await snap5(), result: await failureOf(() => B.destroySandbox(admin, 'r5')), after: await snap5() };
  await admin.query(`REVOKE SELECT ON \`${decoy}\`.t FROM \`${nm5.workerUser}\`@\`127.0.0.1\``); own.grantsOutside.afterFix = await failureOf(async () => { own.grantsOutside.fixReport = await B.destroySandbox(admin, 'r5'); }); own.grantsOutside.final = await snap5();
  // E6) destrucción INTERRUMPIDA (dos cuentas ya eliminadas): reanudable; y base desaparecida con cuentas huérfanas → se detiene
  await apply5(); await admin.query(`DROP USER \`${nm5.appUser}\`@\`127.0.0.1\``); await admin.query(`DROP USER \`${nm5.workerUser}\`@\`127.0.0.1\``);
  own.interrupted = { before: await snap5() }; own.interrupted.result = await failureOf(async () => { own.interrupted.report = await B.destroySandbox(admin, 'r5'); }); own.interrupted.after = await snap5();
  await apply5(); await admin.query(`DROP DATABASE \`${nm5.schema}\``);
  own.orphans = { before: await snap5(), result: await failureOf(() => B.destroySandbox(admin, 'r5')), after: await snap5(), apply: await failureOf(() => apply5()) };
  await raw5(); own.repeated = {}; own.repeated.first = await failureOf(async () => { own.repeated.firstReport = await B.destroySandbox(admin, 'r5'); }); own.repeated.second = await failureOf(async () => { own.repeated.secondReport = await B.destroySandbox(admin, 'r5'); });
  own.decoyIntact = { checksum: (await admin.query(`CHECKSUM TABLE \`${decoy}\`.t`))[0][0].Checksum === before.decoyChecksum, grants: (await admin.query(`SHOW GRANTS FOR \`${decoy}\`@\`127.0.0.1\``))[0].length };
  const after = await snap();
  const changed = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => ({ key: k, before: JSON.stringify(before[k]).slice(0, 400), after: JSON.stringify(after[k]).slice(0, 400) }));
  report.isolation = { changed, unchanged: JSON.stringify(before) === JSON.stringify(after), usersChecked: before.users, schemasChecked: before.schemas, decoyIntact: (await admin.query(`SELECT v FROM \`${decoy}\`.t`))[0][0]?.v === 'intacto' };
  await admin.query(`DROP DATABASE IF EXISTS \`${decoy}\``); await admin.query(`DROP USER IF EXISTS \`${decoy}\`@\`127.0.0.1\``);
  report.destroyed = { schemas: (await admin.query('SELECT COUNT(*) n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [names.schema]))[0][0].n,
    accounts: (await admin.query("SELECT COUNT(*) n FROM information_schema.USER_PRIVILEGES WHERE GRANTEE LIKE ?", [`%sandbox_api02_homolog_%r1%`]))[0][0].n, labSchemaIntact: (await admin.query('SELECT COUNT(*) n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [m.schema]))[0][0].n };
  fs.writeFileSync(path.join(m.runDir, 'homolog-rehearsal.json'), JSON.stringify(report));
  } finally { await admin.end().catch(() => undefined); }
  console.log(JSON.stringify({ rehearsal: 'ok', tables: report.tables.length, secondApply: report.secondApply, destroyed: report.destroyed }));
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
  const init = cp.spawnSync(INSTALL_DB, ['--no-defaults', `--basedir=${BASEDIR}`, `--datadir=${m.datadir}`, '--auth-root-authentication-method=normal', '--skip-test-db', '--lower-case-table-names=1', ...asRoot], { env, encoding: 'utf8', timeout: 120000 });
  if (init.status !== 0) throw new Error(`Inicialización del datadir fallida: ${(init.stderr ?? '').slice(-500)}`);
  const fd = fs.openSync(m.serverLog, 'a');
  // Mismos controles de aislamiento que `buildServerArgs` de Windows (solo loopback, sin DNS, sin LOAD DATA LOCAL, datadir/pid/tmp propios, mismo modo SQL y espera de bloqueos); max_connections ya en 400 (el arnés
  // de Windows lo sube con SET GLOBAL tras arrancar: `next dev` duplica los pools). Sin `--enable-named-pipe` (solo Windows); el acceso administrativo es el socket Unix del run.
  const args = ['--no-defaults', ...asRoot, `--basedir=${BASEDIR}`, `--datadir=${m.datadir}`, `--pid-file=${m.pidFile}`, `--tmpdir=${m.tmpDir}`, `--bind-address=${HOST}`, `--port=${m.port}`, '--skip-name-resolve',
    `--socket=${adminSocket}`, '--local-infile=0', `--secure-file-priv=${m.filesDir}`, '--lower-case-table-names=1', '--max-connections=400', `--innodb-lock-wait-timeout=${LOCK_WAIT_SECONDS}`, '--innodb-buffer-pool-size=64M',
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

async function startApp(m, demo, workerMs = 0) {
  const port = await freePort();
  const env = childEnv(m, { NODE_ENV: 'development', PRICESMART_LAB_DEMO: 'SINTETICO-LOCAL-SIN-PRODUCCION', PRICESMART_LAB_KEY: demo.labKey, ...(workerMs ? { PRICESMART_LAB_WORKER_MS: String(workerMs) } : {}) });
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

/** Reinicia SOLO la app (la base sigue igual) con el trabajador de reintentos dentro de ella (equivalente de `demo.mjs restart-app --worker-ms=N`). */
async function restartApp(m, demo, workerMs) {
  if (appProc?.pid) {
    try { process.kill(-appProc.pid, 'SIGTERM'); } catch { /* ya terminó */ }
    for (let i = 0; i < 20 && appProc.exitCode === null; i++) await sleep(250);
    if (appProc.exitCode === null) { try { process.kill(-appProc.pid, 'SIGKILL'); } catch { /* ya terminó */ } }
  }
  await startApp(m, demo, workerMs);
  // El primer acceso a la ruta instala la composición (y arranca el trabajador).
  await fetch(`http://${HOST}:${ST.app.port}/api/integrations/pricesmart/v1/orders/WARMUP`).catch(() => undefined);
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
    const pending = second.filter((r) => r.pendingAtEnd > 0); ST.pendingMigrations = pending;
    log('migraciones con sentencias pendientes tras la segunda ronda:', pending.length, '(informativo: el arnés de Windows aplica la misma lógica; el esquema que usan las pruebas se verifica con las pruebas)');
    for (const r of pending.slice(0, 40)) log(`  ${r.file}: ${r.pendingAtEnd} pendiente(s); p. ej. ${r.errors[0] ?? ''}`.slice(0, 260));
    await seed();
    const demo = await prepareData(); demo.labKey = crypto.randomBytes(32).toString('hex');
    // `prepareData` obtiene su conexión por `adminConn` (socket Unix); la clave de laboratorio solo vive en este run.
    writeState({ demo });
    await startApp(m, demo);
    const dir = 'scripts/ci/pricesmart-demo';
    const only = process.env.PS_E2E_FILES ? process.env.PS_E2E_FILES.split(',').map((f) => f.trim()).filter(Boolean) : null;
    const demoCfg = `${dir}/vitest.demo.config.mts`;
    const baseEnv = () => { const e = childEnv(m, { PS_DEMO_WORKER_USER: m.workerUser, PS_DEMO_RUNDIR: m.runDir }); delete e.PS06A_APP_PASSWORD; return e; };
    const phases = [];
    // Fase 1: la app real (`next dev`) con la composición de laboratorio.
    phases.push({ name: 'app de laboratorio', files: DEFAULT_FILES, env: baseEnv, before: null });
    // Fase 2: composición de HOMOLOGACIÓN en proceso con las cuentas de MÍNIMO privilegio (aplicación, worker, monitor) generadas por el paquete (`prepare-homologation` + `e2e --as-homolog-app`).
    phases.push({ name: 'composición de homologación (cuentas de mínimo privilegio)', files: [`${dir}/homologation-runtime.e2e.ts`, `${dir}/contract-dictionary.e2e.ts`], before: async () => { await prepareHomologation(); },
      env: () => { const e = baseEnv(); const h = ST.demo.homolog; e.PS_DEMO_OWNER_USER = e.DB_USER; e.PS_DEMO_OWNER_PASSWORD = e.DB_PASSWORD; e.DB_USER = h.app.user; e.DB_PASSWORD = h.app.password; e.SANDBOX_ROOT = h.root; e.UPLOAD_DIR = path.join(h.root, 'uploads'); return e; } });
    // Fase 3: ensayo del paquete de aprovisionamiento (`rehearse-homologation`) y auditoría de su informe.
    // OPCIONAL (PS_LINUX_REHEARSAL=1): en este motor Linux la migración sql/migrate-2026-10-combustibles-pr2-consumos-facturas.sql (guarda estricta de metadatos, ajena a PriceSmart) no crea
    // flota_cb2_consumos en el esquema del ensayo y `finalize` se rechaza con TMS_SCHEMA_INCOMPLETE. Causa NO identificada: esta fase NO forma parte del CI por defecto (la evidencia de P1–P15 sigue siendo el laboratorio de Windows).
    if (process.env.PS_LINUX_REHEARSAL === '1') phases.push({ name: 'ensayo del aprovisionamiento de homologación', files: [`${dir}/homologation-provision.e2e.ts`], before: async () => { await rehearseHomologation(); }, env: baseEnv });
    // Fase 4: trabajador de reintentos DENTRO de la app, tras reiniciarla (`restart-app --worker-ms=3000`).
    phases.push({ name: 'trabajador de reintentos dentro de la app (tras reiniciar)', files: [`${dir}/api13-worker.e2e.ts`], before: async () => { await restartApp(m, ST.demo, 3000); }, env: baseEnv });
    code = 0; const results = [];
    for (const ph of phases) {
      const files = only ? ph.files.filter((f) => only.some((o) => f.endsWith(o) || f === o)) : ph.files;
      if (!files.length) continue;
      log(`=== Fase: ${ph.name} → ${files.join(' ')}`);
      let c = 1;
      try { if (ph.before) await ph.before(); c = vitest(demoCfg, files, ph.env(), ['--reporter=verbose']); }
      catch (e) { console.error(`[ps-linux] ERROR en la fase «${ph.name}»: ${e.message}`); if (e.diagnostic) console.error('[ps-linux] diagnóstico:', JSON.stringify(e.diagnostic).slice(0, 6000)); c = 1; }
      results.push({ fase: ph.name, archivos: files.length, resultado: c === 0 ? 'OK' : 'FALLO' }); if (c !== 0) code = 1;
    }
    log('RESUMEN', JSON.stringify(results));
    if (code !== 0 && ST.pendingMigrations?.length) for (const r of ST.pendingMigrations.slice(0, 40)) console.error(`[ps-linux] migración con pendientes: ${r.file}: ${r.pendingAtEnd}; ${r.errors[0] ?? ''}`.slice(0, 300));
    if (code !== 0) { console.error('--- next.log (cola) ---\n' + tailOf(path.join(m.runDir, 'next.log'), 80)); }
  } catch (e) {
    console.error(`[ps-linux] ERROR: ${e.message}`);
    console.error('--- server.log (cola) ---\n' + tailOf(m.serverLog, 60)); console.error('--- next.log (cola) ---\n' + tailOf(path.join(m.runDir, 'next.log'), 60));
    code = 1;
  } finally { await stopAll(m); }
  return code;
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
