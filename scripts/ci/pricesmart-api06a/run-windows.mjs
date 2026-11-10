// PRICESMART-API-06A — ejecutor del laboratorio MariaDB efímero.
// NO EJECUTAR SIN AUTORIZACIÓN. Importar este archivo no inicia nada: solo `main()` actúa, y solo cuando este archivo es el punto de entrada.
//   node scripts/ci/pricesmart-api06a/run-windows.mjs --preflight-only   → verifica compuertas, motor y rutas; NO crea archivos ni procesos.
//   node scripts/ci/pricesmart-api06a/run-windows.mjs --run-isolated     → requiere PS_API06A_LAB_ACK; inicia MariaDB efímero en 127.0.0.1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENGINE } from './constants.mjs';
import {
  assertLabGate, createManifest, publicManifest, validateManifest, buildServerArgs, assertServerArgs, initTemplate, initArgs, buildChildEnv, isolationJson,
  adminOptions, assertAdminOptions, SqlGate, IDENTITY_QUERIES, IDENTITY_QUERY, SCHEMA_ABSENT_QUERY, USER_ABSENT_QUERY, validateServerIdentity,
  processMatches, parsePidFile, onlyLoopbackListeners, pickPort, safeRemoveRunDir, fail,
} from './safety.mjs';
import { adminStatements } from './ddl.mjs';
import { summarize, renderMarkdown } from './report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const ps = (script) => cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function locate() {
  const repo = path.resolve(here, '../../..');
  const common = cp.spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repo, encoding: 'utf8' });
  if (common.status !== 0) fail('No se pudo ubicar el repositorio principal.');
  const main = path.dirname(path.resolve(common.stdout.trim()));
  const branch = cp.spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const envFilesInCwd = ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local', '.env.test', '.env.test.local']
    .filter((n) => fs.existsSync(path.join(repo, n)));
  return { repo, main, branch, envFilesInCwd, home: path.join(main, '.lab-runtime', ENGINE.dirName), zip: path.join(main, '.lab-runtime', ENGINE.zipName) };
}

/** Revalida el motor: ZIP oficial, manifiesto de 624 archivos y CADA archivo extraído (sin extras ni ausentes). */
export function verifyEngine({ home, zip }) {
  if (sha256File(zip) !== ENGINE.zipSha256) fail('El ZIP del motor no coincide con el SHA-256 oficial registrado.');
  const manifestPath = path.join(here, 'engine-manifest.json');
  if (sha256File(manifestPath) !== ENGINE.manifestSha256) fail('engine-manifest.json alterado.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.zipSha256 !== ENGINE.zipSha256 || Object.keys(manifest.files).length !== ENGINE.fileCount) fail('Manifiesto del motor inconsistente.');
  const seen = new Set(); const stack = [home];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (fs.lstatSync(full).isSymbolicLink()) fail(`Enlace dentro del motor: ${full}`);
      if (entry.isDirectory()) stack.push(full);
      else {
        const rel = path.relative(home, full).split(path.sep).join('/');
        if (!(rel in manifest.files)) fail(`Archivo extra en el motor: ${rel}`);
        if (sha256File(full) !== manifest.files[rel]) fail(`Hash distinto en el motor: ${rel}`);
        seen.add(rel);
      }
    }
  }
  if (seen.size !== ENGINE.fileCount) fail('Faltan archivos del motor.');
  if (manifest.files['bin/mariadbd.exe'] !== ENGINE.mariadbdSha256) fail('mariadbd.exe inesperado.');
  return { files: seen.size };
}

function queryProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const r = ps(`Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress`);
  if (r.status !== 0 || !r.stdout.trim()) return null;
  const o = JSON.parse(r.stdout); return { pid, exe: o.ExecutablePath, cmd: o.CommandLine };
}
function listenersOf(pid) {
  const r = ps(`@(Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort) | ConvertTo-Json -Compress`);
  const t = r.stdout.trim(); if (!t) return [];
  const j = JSON.parse(t); return (Array.isArray(j) ? j : [j]).map((x) => ({ pid, address: x.LocalAddress, port: x.LocalPort }));
}
function portBusy(port) {
  const r = ps(`@(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue).Count`);
  return Number(r.stdout.trim() || '1') !== 0;
}

export async function main(argv, env = process.env) {
  const loc = locate();
  const mode = assertLabGate({ argv, env, platform: process.platform, branch: loc.branch, envFilesInCwd: loc.envFilesInCwd });
  if (!fs.existsSync(loc.home) || !fs.existsSync(loc.zip)) fail('Motor portable no disponible en .lab-runtime/.');
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  if (!fs.statSync(tempRoot).isDirectory()) fail('Raíz temporal inválida.');
  const engine = verifyEngine(loc);
  if (mode === '--preflight-only') {
    const running = ps('@(Get-Process -Name mariadbd -ErrorAction SilentlyContinue).Count').stdout.trim();
    console.log(JSON.stringify({ mode, branch: loc.branch, tempRoot, engineFilesVerified: engine.files, mariadbdProcessesRunning: Number(running || 0), note: 'No se creó ningún archivo ni proceso.' }, null, 2));
    return;
  }
  const stagingText = fs.readFileSync(path.join(loc.repo, 'docs/integraciones/pricesmart/api01/staging.sql.in'), 'utf8');
  const m = createManifest({ randomBytes: crypto.randomBytes, tempRoot });
  validateManifest(m, tempRoot);
  const checks = []; // B0 medidos por el ejecutor
  const note = (id, name, status, detail = '') => checks.push({ id, name, status, detail });
  fs.mkdirSync(m.runDir); // sin recursive: si existe, se detiene
  for (const d of [m.tmpDir, m.filesDir, m.sandboxRoot, m.uploadsDir, m.evidenceDir]) fs.mkdirSync(d);
  note('B0.1', 'Motor 11.8.9: ZIP oficial + manifiesto + 624 archivos verificados', 'PASS', `${engine.files} archivos`);
  const common = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: m.tmpDir, TMP: m.tmpDir, PATH: `${path.join(loc.home, 'bin')};${process.env.SystemRoot}\\System32` };
  let server; let serverExited = false;
  const startServer = async () => {
    const args = buildServerArgs(m, loc.home); assertServerArgs(args, m, loc.home);
    const log = fs.openSync(m.serverLog, 'a');
    server = cp.spawn(path.join(loc.home, 'bin', 'mariadbd.exe'), args, { cwd: m.runDir, env: common, windowsHide: true, stdio: ['ignore', log, log] });
    fs.closeSync(log); serverExited = false; server.on('exit', () => { serverExited = true; });
    m.pid = server.pid ?? 0;
    for (let i = 0; i < 80 && !serverExited; i++) { if (queryProcess(m.pid)) break; await sleep(250); }
    if (!processMatches(queryProcess(m.pid), m, loc.home)) fail('El proceso iniciado no coincide con el manifiesto (PID/ejecutable/línea de comandos).');
  };
  const mysql = (await import('mysql2/promise')).default;
  const connectAdmin = async () => {
    for (let i = 0; i < 120; i++) {
      if (serverExited) fail('El servidor terminó antes de aceptar conexiones.');
      const o = adminOptions(m); assertAdminOptions(o, m);
      try { return await mysql.createConnection(o); } catch { await sleep(500); }
    }
    return fail('No se pudo conectar al pipe administrativo.');
  };
  let ok = false; let admin; const summaries = [];
  try {
    // 1) Inicialización con plantilla propia (solo escribe en el datadir del run)
    fs.writeFileSync(m.initIni, initTemplate(), { flag: 'wx' });
    const init = cp.spawnSync(path.join(loc.home, 'bin', 'mariadb-install-db.exe'), initArgs(m), { cwd: m.runDir, env: common, windowsHide: true, encoding: 'utf8' });
    if (init.status !== 0) { fs.writeFileSync(path.join(m.evidenceDir, 'init.log'), `${init.stdout}\n${init.stderr}`); fail('Inicialización fallida; sin reintento.'); }
    // 2) Puerto aleatorio en loopback, nunca los de otros servicios
    m.port = pickPort(() => crypto.randomInt(0, 2 ** 31 - 1), portBusy); validateManifest(m, tempRoot, { requirePort: true });
    // 3) Arranque y comprobación de identidad ANTES de cualquier SQL administrativo
    await startServer();
    admin = await connectAdmin();
    const gate = new SqlGate(IDENTITY_QUERIES, [...adminStatements(m, stagingText), 'SHUTDOWN']);
    const [[ident]] = await gate.run(admin, IDENTITY_QUERY);
    validateServerIdentity(ident, m, loc.home);
    if (fs.existsSync(m.pidFile) && parsePidFile(fs.readFileSync(m.pidFile, 'utf8')) !== m.pid) fail('El PID del archivo no coincide con el proceso lanzado.');
    const listeners = listenersOf(m.pid);
    if (!onlyLoopbackListeners(listeners, m.pid, m.port)) fail(`El servidor escucha fuera de 127.0.0.1:${m.port}: ${JSON.stringify(listeners)}`);
    const [[{ n: nSchema }]] = await gate.run(admin, SCHEMA_ABSENT_QUERY, [m.schema]);
    const [[{ n: nUser }]] = await gate.run(admin, USER_ABSENT_QUERY, [m.user]);
    if (Number(nSchema) !== 0 || Number(nUser) !== 0) fail('Base o usuario preexistente; no se reutiliza.');
    gate.confirm();
    note('B0.2', 'Identidad: datadir/pid/puerto/bind 127.0.0.1/versión/pipe/basedir/skip_name_resolve/local_infile=0', 'PASS');
    note('B0.3', 'Único socket en escucha del PID: 127.0.0.1:<puerto del run>', 'PASS', `puerto ${m.port}`);
    note('B0.4', 'Base y usuario del laboratorio inexistentes antes de crear (no se reutiliza nada)', 'PASS');
    // 4) DDL de laboratorio y cuenta mínima, SOLO sentencias exactas aprobadas
    for (const sql of adminStatements(m, stagingText)) await gate.run(admin, sql);
    note('B0.5', 'SQL administrativo = lista cerrada aprobada (DDL derivado + cuenta mínima); nada fuera de ella', 'PASS', `${gate.executed.length} sentencias`);
    fs.writeFileSync(path.join(m.evidenceDir, 'sql-ejecutado.json'), JSON.stringify(gate.executed, null, 2), { flag: 'wx' });
    // 5) Manifiestos para el proceso de pruebas
    fs.writeFileSync(path.join(m.sandboxRoot, 'isolation.json'), JSON.stringify(isolationJson(m)), { flag: 'wx' });
    const manifestFile = path.join(m.runDir, 'manifest.json');
    const writeManifest = () => fs.writeFileSync(manifestFile, JSON.stringify(publicManifest(m)));
    writeManifest();
    const vitest = path.join(loc.main, 'node_modules', 'vitest', 'vitest.mjs');
    const config = path.join(here, 'vitest.lab.config.mts');
    const runVitest = (phase, extraEnv = {}, sync = true) => {
      const out = path.join(m.evidenceDir, `vitest-${phase}.json`);
      const args = [vitest, 'run', '--config', config, '--reporter=json', `--outputFile=${out}`, '--maxWorkers=1', '--no-file-parallelism'];
      const env = buildChildEnv(m, process.env, { PS06A_MANIFEST: manifestFile, PS06A_PHASE: phase, ...extraEnv });
      const opts = { cwd: loc.repo, env, windowsHide: true, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024 };
      return { out, run: sync ? cp.spawnSync(process.execPath, args, opts) : cp.spawn(process.execPath, args, { ...opts, stdio: 'ignore' }) };
    };
    // 6) Fase principal B1–B6, B8
    const main1 = runVitest('main'); fs.writeFileSync(path.join(m.evidenceDir, 'vitest-main.log'), `${main1.run.stdout}\n${main1.run.stderr}`);
    // 7) Fase de recuperación (B7): preparar → caída dura del PID verificado → reinicio sobre el MISMO datadir → verificar
    const ready = path.join(m.evidenceDir, 'crash-ready.json');
    const prep = runVitest('crash-prepare', { PS06A_CRASH_READY: ready }, false);
    for (let i = 0; i < 240 && !fs.existsSync(ready) && prep.run.exitCode === null; i++) await sleep(250);
    if (!fs.existsSync(ready)) fail('B7: la preparación no llegó al punto de caída.');
    if (!processMatches(queryProcess(m.pid), m, loc.home)) fail('B7: el PID a terminar no coincide con el manifiesto.');
    server.kill('SIGKILL'); await sleep(1500);
    await new Promise((r) => (prep.run.exitCode !== null ? r() : prep.run.once('exit', r)));
    await admin.end().catch(() => {}); admin = undefined;
    await startServer(); admin = await connectAdmin();
    const [[ident2]] = await gate.run(admin, IDENTITY_QUERY); validateServerIdentity(ident2, m, loc.home);
    if (!onlyLoopbackListeners(listenersOf(m.pid), m.pid, m.port)) fail('Tras reiniciar, el servidor escucha fuera de loopback.');
    note('B0.6', 'Tras caída dura y reinicio: misma identidad y solo loopback', 'PASS');
    writeManifest();
    const ver = runVitest('crash-verify'); fs.writeFileSync(path.join(m.evidenceDir, 'vitest-crash-verify.log'), `${ver.run.stdout}\n${ver.run.stderr}`);
    // 8) Cierre ordenado
    await gate.run(admin, 'SHUTDOWN').catch(() => {});
    for (let i = 0; i < 120 && !serverExited; i++) await sleep(250);
    if (!serverExited) { server.kill(); await sleep(1500); }
    if (!serverExited) fail('El servidor no se detuvo.');
    if (portBusy(m.port)) fail('El puerto del run sigue ocupado tras el apagado.');
    note('B9.1', 'Apagado: proceso terminado y puerto liberado', 'PASS');
    const reports = [main1.out, prep.out, ver.out].filter((f) => fs.existsSync(f)).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
    const summary = summarize(reports, checks);
    fs.writeFileSync(path.join(m.evidenceDir, 'resultados.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(m.evidenceDir, 'resultados.md'), renderMarkdown(summary, `run ${m.id}`));
    summaries.push(summary); ok = summary.overall === 'PASS';
  } finally {
    try { if (admin) await admin.end(); } catch { /* ignorar */ }
    try { if (server && !serverExited) server.kill(); } catch { /* ignorar */ }
    // Evidencia fuera del directorio efímero (carpeta ignorada por git); la limpieza solo procede si el servidor ya no existe.
    const keep = path.join(loc.main, '.lab-runtime', `ps-api06a-evidence-${m.id}`);
    try { fs.cpSync(m.evidenceDir, keep, { recursive: true, errorOnExist: true }); fs.writeFileSync(path.join(keep, 'manifest.public.json'), JSON.stringify(publicManifest(m), null, 2)); fs.copyFileSync(m.serverLog, path.join(keep, 'server.log')); } catch (e) { console.error('Evidencia no copiada:', e.message); }
    await sleep(500);
    if (queryProcess(m.pid)) console.error(`PID ${m.pid} sigue vivo; se conserva ${m.runDir}.`);
    else { try { safeRemoveRunDir(m, tempRoot, fs); } catch (e) { console.error('Limpieza rechazada, se conserva el directorio:', e.message); } }
    console.log(`Evidencia: ${keep}`);
  }
  if (!summaries[0]) fail('El laboratorio no produjo resultados.');
  console.log(renderMarkdown(summaries[0], `run ${m.id}`).split('\n').slice(0, 18).join('\n'));
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
