// PORTAL-E2E — entorno LOCAL y DESECHABLE para la prueba funcional integral del Portal del piloto (PR #597). NO es parte de `npm test`.
//   node scripts/ci/portal-e2e/harness.mjs up       → MariaDB 11.8.9 efímero (127.0.0.1, puerto aleatorio) + esquema + datos FICTICIOS. Escribe state.json en el run.
//   node scripts/ci/portal-e2e/harness.mjs app      → inicia `next dev` en modo SANDBOX (validateSandboxConfig) contra ese MariaDB, solo 127.0.0.1.
//   node scripts/ci/portal-e2e/harness.mjs sql "SELECT …"  → consulta de SOLO LECTURA por el pipe administrativo (para comprobar persistencia).
//   node scripts/ci/portal-e2e/harness.mjs down     → detiene la app y el servidor, verifica que no quede nada y (con --keep-evidence) copia la evidencia.
// Reutiliza las guardas ya auditadas del laboratorio de API-06A (motor verificado por hash, argumentos exactos de mariadbd, solo loopback, pipe administrativo, entorno sandbox).
// Sin credenciales ni datos reales: todo se genera aquí y vive en %TEMP%\novalvion-ps-api06a-<id>. No toca Hostinger, producción, MySQL80 ni PostgreSQL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { locate, verifyEngine } from '../pricesmart-api06a/run-windows.mjs';
import {
  createManifest, validateManifest, buildServerArgs, assertServerArgs, initTemplate, initArgs, buildChildEnv, isolationJson, adminOptions, assertAdminOptions,
  validateServerIdentity, IDENTITY_QUERY, processMatches, onlyLoopbackListeners, pickPort, safeRemoveRunDir, fail,
} from '../pricesmart-api06a/safety.mjs';
import { inspectProcess, listenersOfPid, inspectPort } from '../pricesmart-api06a/procinfo.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tempRoot = () => fs.realpathSync.native(os.tmpdir());
const STATE_NOTE = path.join(tempRoot(), 'portal-e2e-current-run.txt');   // apunta al run vigente (solo la ruta; sin secretos), FUERA del repositorio.

const readState = () => {
  const runDir = fs.readFileSync(STATE_NOTE, 'utf8').trim();
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  validateManifest(state.m, tempRoot(), { requirePort: true });
  return state;
};
const writeState = (state) => fs.writeFileSync(path.join(state.m.runDir, 'state.json'), JSON.stringify(state));
const common = (m, home) => ({ SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: m.tmpDir, TMP: m.tmpDir, PATH: `${path.join(home, 'bin')};${process.env.SystemRoot}\\System32` });

async function adminConn(m, { multi = false } = {}) {
  const mysql = (await import('mysql2/promise')).default;
  const o = adminOptions(m); assertAdminOptions(o, m);
  return mysql.createConnection(multi ? { ...o, multipleStatements: true } : o);
}

async function up() {
  const loc = locate();
  if (loc.envFilesInCwd.length) fail('Hay archivos .env* en el directorio de trabajo.');
  const engine = verifyEngine(loc);
  const m = createManifest({ randomBytes: crypto.randomBytes, tempRoot: tempRoot() }); validateManifest(m, tempRoot());
  fs.mkdirSync(m.runDir); for (const d of [m.tmpDir, m.filesDir, m.sandboxRoot, m.uploadsDir, m.evidenceDir]) fs.mkdirSync(d);
  fs.writeFileSync(STATE_NOTE, m.runDir);
  fs.writeFileSync(m.initIni, initTemplate(), { flag: 'wx' });
  const env = common(m, loc.home);
  const init = cp.spawnSync(path.join(loc.home, 'bin', 'mariadb-install-db.exe'), initArgs(m), { cwd: m.runDir, env, windowsHide: true, encoding: 'utf8' });
  if (init.status !== 0) fail('Inicialización del datadir fallida.');
  m.port = pickPort(() => crypto.randomInt(0, 2 ** 31 - 1), (p) => inspectPort(p).state !== 'free'); validateManifest(m, tempRoot(), { requirePort: true });
  const args = buildServerArgs(m, loc.home); assertServerArgs(args, m, loc.home);
  const log = fs.openSync(m.serverLog, 'a');
  const server = cp.spawn(path.join(loc.home, 'bin', 'mariadbd.exe'), args, { cwd: m.runDir, env, windowsHide: true, detached: true, stdio: ['ignore', log, log] });
  fs.closeSync(log); server.unref(); m.pid = server.pid ?? 0;
  let s = { state: 'unknown' };
  for (let i = 0; i < 80; i++) { s = inspectProcess(m.pid); if (s.state === 'present') break; await sleep(250); }
  if (s.state !== 'present' || !processMatches(s.info, m, loc.home)) fail(`El proceso iniciado no coincide con el manifiesto (${s.state}).`);
  let admin = null;
  for (let i = 0; i < 120 && !admin; i++) { try { admin = await adminConn(m); } catch { await sleep(500); } }
  if (!admin) fail('No se pudo conectar al pipe administrativo.');
  const [[ident]] = await admin.query(IDENTITY_QUERY); validateServerIdentity(ident, m, loc.home);
  const L = listenersOfPid(m.pid); if (L.state !== 'known' || !onlyLoopbackListeners(L.listeners, m.pid, m.port)) fail('El servidor escucha fuera de 127.0.0.1:<puerto>.');
  await admin.end();

  // Base, entorno sandbox, cuenta de la app (privilegios SOLO sobre esta base desechable) y esquema del proyecto.
  const multi = await adminConn(m, { multi: true });
  const schema = `\`${m.schema}\``; const account = `\`${m.user}\`@\`127.0.0.1\``;
  await multi.query(`CREATE DATABASE ${schema} CHARACTER SET utf8mb4`);
  await multi.query(`USE ${schema}`);
  await multi.query("CREATE TABLE novalvion_environment (id TINYINT NOT NULL PRIMARY KEY CHECK (id = 1), environment VARCHAR(16) NOT NULL CHECK (environment = 'sandbox'), sandbox_id VARCHAR(48) NOT NULL) ENGINE=InnoDB");
  await multi.query("INSERT INTO novalvion_environment (id, environment, sandbox_id) VALUES (1, 'sandbox', ?)", [m.sandboxId]);
  await multi.query(`CREATE USER ${account} IDENTIFIED BY '${m.secrets.DB_PASSWORD}'`);
  await multi.query(`GRANT ALL PRIVILEGES ON ${schema}.* TO ${account}`);
  await multi.end();
  fs.writeFileSync(path.join(m.sandboxRoot, 'isolation.json'), JSON.stringify(isolationJson(m)), { flag: 'wx' });
  writeState({ m, home: loc.home, repo: loc.repo, engineFiles: engine.files, app: null });
  console.log(JSON.stringify({ runDir: m.runDir, db: { host: '127.0.0.1', port: m.port, schema: m.schema, pid: m.pid }, engineFilesVerified: engine.files }));
}

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

/** Ejecuta un archivo *.e2e.ts con Vitest bajo el MISMO entorno sandbox que la app (db.ts en modo sandbox; nunca otra base). */
function vitestRun(file) {
  const { m, repo } = readState();
  const env = buildChildEnv(m, process.env, { NODE_ENV: 'test' }); delete env.PS06A_APP_PASSWORD; delete env.PS06A_WORKER_PASSWORD;
  env.PATH = `${path.dirname(process.execPath)};${env.PATH}`;
  const r = cp.spawnSync(process.execPath, [path.join(repo, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', path.join(here, 'vitest.e2e.config.mts'), file], { cwd: repo, env, windowsHide: true, encoding: 'utf8', timeout: 240000 });
  console.log([r.stdout ?? '', r.stderr ?? ''].join('\n').split('\n').slice(-25).join('\n')); if (r.status !== 0) process.exitCode = 1;
}

/** El servidor del laboratorio limita max_connections=40; el servidor de desarrollo de Next duplica el pool por paquete y lo satura. Solo en ESTE run desechable se sube el límite (SET GLOBAL; sentencia fija). */
async function tune() { const { m } = readState(); const c = await adminConn(m); try { await c.query('SET GLOBAL max_connections = 400'); console.log('max_connections=400'); } finally { await c.end(); } }

/** Todo el entorno, en el orden que necesita el proyecto: esquema base → esquema de tiempo de ejecución (código real) → migraciones del proyecto (2 rondas) → migración de confirmaciones → datos ficticios → app. */
async function bootstrap() {
  await up(); await tune();
  await schema(['sql/schema.sql', 'sql/migrate-2026-08-rrhh-colaborador-auth.sql'], true);
  vitestRun('scripts/ci/portal-e2e/ensure.e2e.ts');
  const { repo } = readState();
  const migrations = fs.readdirSync(path.join(repo, 'sql')).filter((f) => /^migrate-2026-.*\.sql$/.test(f) && !f.includes('tms-parada-confirmaciones')).sort().map((f) => `sql/${f}`);
  await schema(migrations, true); const second = await schema(migrations, true);
  await schema(['sql/migrate-2026-11-tms-parada-confirmaciones.sql'], true);
  console.log(JSON.stringify({ migracionesPendientesTrasLaSegundaRonda: second.filter((r) => r.pendingAtEnd > 0).length }));
  await seed(); await app();
}

async function app() {
  const state = readState(); const { m, repo } = state;
  const port = pickPort(() => crypto.randomInt(0, 2 ** 31 - 1), (p) => inspectPort(p).state !== 'free');
  const env = buildChildEnv(m, process.env, { NODE_ENV: 'development' });
  delete env.PS06A_APP_PASSWORD; delete env.PS06A_WORKER_PASSWORD;
  env.PATH = `${path.dirname(process.execPath)};${env.PATH}`;
  const logFile = path.join(m.runDir, 'next.log'); const log = fs.openSync(logFile, 'a');
  const next = cp.spawn(process.execPath, [path.join(repo, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: repo, env, windowsHide: true, detached: true, stdio: ['ignore', log, log] });
  fs.closeSync(log); next.unref();
  state.app = { pid: next.pid, port }; writeState(state);
  for (let i = 0; i < 240; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/portal/login`, { redirect: 'manual' }); if (r.status < 500) break; } catch { /* aún no */ }
    await sleep(1000);
  }
  console.log(JSON.stringify({ appPort: port, appPid: next.pid, log: logFile }));
}

async function sqlRead(query) {
  if (!/^\s*(SELECT|SHOW)\s/i.test(query) || query.includes(';')) fail('Solo SELECT/SHOW de una sentencia.');
  const { m } = readState(); const c = await adminConn(m);
  try { await c.query(`USE \`${m.schema}\``); const [rows] = await c.query(query); console.log(JSON.stringify(rows, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2)); } finally { await c.end(); }
}

async function down(keep) {
  const state = readState(); const { m } = state; const report = { next: 'sin app', db: 'desconocido', removed: false };
  if (state.app?.pid) {
    const s = inspectProcess(state.app.pid);
    if (s.state === 'present') { try { cp.spawnSync('taskkill', ['/PID', String(state.app.pid), '/T', '/F'], { windowsHide: true }); report.next = 'detenida (árbol del PID verificado)'; } catch { report.next = 'no se pudo detener'; } }
    else report.next = `ya ausente (${s.state})`;
  }
  let admin = null; try { admin = await adminConn(m); } catch { /* ya caído */ }
  if (admin) { try { await admin.query('SHUTDOWN'); } catch { /* cierra la conexión */ } try { await admin.end(); } catch { /* ok */ } }
  for (let i = 0; i < 60; i++) { const s = inspectProcess(m.pid); if (s.state !== 'present') { report.db = `detenido (${s.state})`; break; } await sleep(500); }
  const proc = inspectProcess(m.pid); const portState = inspectPort(m.port, undefined, { ignoreTimeWait: true });   // sockets TIME_WAIT sin dueño no son un servidor vivo (mismo criterio que el laboratorio)
  if (keep) { fs.mkdirSync(keep, { recursive: true }); for (const f of ['server.log', 'next.log']) if (fs.existsSync(path.join(m.runDir, f))) fs.copyFileSync(path.join(m.runDir, f), path.join(keep, f)); }
  if (proc.state === 'absent' && portState.state === 'free') { safeRemoveRunDir(m, tempRoot(), fs); report.removed = true; try { fs.rmSync(STATE_NOTE); } catch { /* ok */ } }
  else report.reason = `proceso=${proc.state} puerto=${portState.state}; se conserva el directorio`;
  console.log(JSON.stringify(report));
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

const [cmd, ...rest] = process.argv.slice(2);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const run = { up, app, seed, tune, bootstrap, schema: () => schema(rest), vitest: async () => vitestRun(rest[0]), down: () => down(rest.find((a) => a.startsWith('--keep-evidence='))?.split('=')[1]), sql: () => sqlRead(rest[0] ?? '') }[cmd];
  if (!run) { console.error('Uso: up | schema <archivo.sql…> | app | sql "<SELECT>" | down [--keep-evidence=<dir>]'); process.exitCode = 2; }
  else run().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
