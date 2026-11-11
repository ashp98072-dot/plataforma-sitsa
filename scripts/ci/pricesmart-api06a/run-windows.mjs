// PRICESMART-API-06A — ejecutor del laboratorio MariaDB efímero.
// NO EJECUTAR SIN AUTORIZACIÓN. Importar este archivo no inicia nada: solo `main()` actúa, y solo cuando este archivo es el punto de entrada.
//   node scripts/ci/pricesmart-api06a/run-windows.mjs --preflight-only   → verifica compuertas, motor y rutas; NO crea archivos ni procesos.
//   node scripts/ci/pricesmart-api06a/run-windows.mjs --run-isolated     → requiere PS_API06A_LAB_ACK; inicia MariaDB efímero en 127.0.0.1.
// Correcciones de auditoría: AUD-01 (limpieza fail-closed con estados explícitos), AUD-02 (control de errores por fase, hijos gestionados), AUD-03 (resumen sin PASS engañoso).
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
  processMatches, parsePidFile, onlyLoopbackListeners, pickPort, safeRemoveRunDir, cleanupDecision, labChildBelongs, canProceed, fail,
} from './safety.mjs';
import { adminStatements } from './ddl.mjs';
import { summarize, renderMarkdown, evaluateVitestRun } from './report.mjs';
import { inspectProcess, listenersOfPid, inspectPort, descendantsOf, countProcessesNamed, terminateVerified, terminateStray } from './procinfo.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

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

export async function main(argv, env = process.env) {
  const loc = locate();
  const mode = assertLabGate({ argv, env, platform: process.platform, branch: loc.branch, envFilesInCwd: loc.envFilesInCwd });
  if (!fs.existsSync(loc.home) || !fs.existsSync(loc.zip)) fail('Motor portable no disponible en .lab-runtime/.');
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  if (!fs.statSync(tempRoot).isDirectory()) fail('Raíz temporal inválida.');
  const engine = verifyEngine(loc);
  if (mode === '--preflight-only') {
    const running = countProcessesNamed('mariadbd');
    console.log(JSON.stringify({ mode, branch: loc.branch, tempRoot, engineFilesVerified: engine.files, mariadbdProcessesRunning: running.state === 'known' ? running.count : `DESCONOCIDO (${running.reason})`, note: 'No se creó ningún archivo ni proceso.' }, null, 2));
    if (running.state !== 'known') process.exitCode = 1;
    return;
  }
  const stagingText = fs.readFileSync(path.join(loc.repo, 'docs/integraciones/pricesmart/api01/staging.sql.in'), 'utf8');
  const mysql = (await import('mysql2/promise')).default;
  const m = createManifest({ randomBytes: crypto.randomBytes, tempRoot });
  validateManifest(m, tempRoot);
  const checks = []; // B0/B9 medidos por el ejecutor
  const note = (id, name, status, detail = '') => checks.push({ id, name, status, detail });
  fs.mkdirSync(m.runDir); // sin recursive: si existe, se detiene
  for (const d of [m.tmpDir, m.filesDir, m.sandboxRoot, m.uploadsDir, m.evidenceDir]) fs.mkdirSync(d);
  note('B0.1', 'Motor 11.8.9: ZIP oficial + manifiesto + 624 archivos verificados', 'PASS', `${engine.files} archivos`);
  const common = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: m.tmpDir, TMP: m.tmpDir, PATH: `${path.join(loc.home, 'bin')};${process.env.SystemRoot}\\System32` };
  const vitestRoot = path.join(loc.main, 'node_modules', 'vitest');
  const vitest = path.join(vitestRoot, 'vitest.mjs');
  const config = path.join(here, 'vitest.lab.config.mts');
  const belongsVitest = (info) => labChildBelongs(info, { nodeExe: process.execPath, vitestRoot, runDir: m.runDir });
  const belongsServer = (info) => processMatches(info, m, loc.home);

  // ---- estado del ejecutor
  const phases = []; let halted = null; let runError = null; const children = new Set();
  let server; let serverExited = true; let admin; let gate; let shutdown = { proven: false, reasons: ['no evaluado'] };
  const halt = (phase, reason) => { halted ??= { phase, reason }; };

  const startServer = async () => {
    const args = buildServerArgs(m, loc.home); assertServerArgs(args, m, loc.home);
    const log = fs.openSync(m.serverLog, 'a');
    server = cp.spawn(path.join(loc.home, 'bin', 'mariadbd.exe'), args, { cwd: m.runDir, env: common, windowsHide: true, stdio: ['ignore', log, log] });
    fs.closeSync(log); serverExited = false; server.on('exit', () => { serverExited = true; });
    m.pid = server.pid ?? 0;
    let s = { state: 'unknown' };
    for (let i = 0; i < 80 && !serverExited; i++) { s = inspectProcess(m.pid); if (s.state === 'present') break; await sleep(250); }
    if (s.state !== 'present' || !belongsServer(s.info)) fail(`El proceso iniciado no coincide con el manifiesto o no se pudo verificar (${s.state}).`);
  };
  const connectAdmin = async () => {
    for (let i = 0; i < 120; i++) {
      if (serverExited) fail('El servidor terminó antes de aceptar conexiones.');
      const o = adminOptions(m); assertAdminOptions(o, m);
      try { return await mysql.createConnection(o); } catch { await sleep(500); }
    }
    return fail('No se pudo conectar al pipe administrativo.');
  };
  const assertOnlyLoopback = () => {
    const L = listenersOfPid(m.pid);
    if (L.state !== 'known') fail(`No se pudieron verificar los sockets en escucha (${L.reason ?? L.state}).`);
    if (!onlyLoopbackListeners(L.listeners, m.pid, m.port)) fail(`El servidor escucha fuera de 127.0.0.1:${m.port}: ${JSON.stringify(L.listeners)}`);
  };
  const writeManifest = (file) => fs.writeFileSync(file, JSON.stringify(publicManifest(m)));
  /** AUD-02: ejecuta Vitest y evalúa status, señal, error, JSON y bloques. Tras cada ejecución comprueba que no queden descendientes huérfanos. */
  const runVitest = (phase, extraEnv = {}) => {
    const out = path.join(m.evidenceDir, `vitest-${phase}.json`);
    const args = [vitest, 'run', '--config', config, '--reporter=json', `--outputFile=${out}`, '--maxWorkers=1', '--no-file-parallelism'];
    const childEnv = buildChildEnv(m, process.env, { PS06A_MANIFEST: path.join(m.runDir, 'manifest.json'), PS06A_PHASE: phase, ...extraEnv });
    const run = cp.spawnSync(process.execPath, args, { cwd: loc.repo, env: childEnv, windowsHide: true, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
    fs.writeFileSync(path.join(m.evidenceDir, `vitest-${phase}.log`), `${run.stdout ?? ''}\n${run.stderr ?? ''}\n[status=${run.status} signal=${run.signal} error=${run.error?.code ?? run.error?.message ?? ''}]`);
    return { out, run: { status: run.status, signal: run.signal, error: run.error } };
  };
  const record = (phase, run, out) => {
    const ev = evaluateVitestRun(phase, run, readJson(out));
    phases.push({ name: phase, state: ev.state, reasons: ev.reasons });
    return ev;
  };
  /** Descendientes del ejecutor que NO sean el servidor: se verifican y, si pertenecen al laboratorio, se terminan; si no se pueden demostrar, se detiene todo. */
  const reapStrays = async (phase) => {
    const d = descendantsOf(process.pid);
    if (d.state === 'unknown') { halt(phase, `no se pudo comprobar procesos hijos (${d.reason})`); return false; }
    if (d.state === 'none') return true;
    for (const proc of d.procs.filter((p) => p.pid !== m.pid)) {
      const t = await terminateStray(proc, belongsVitest);
      if (!t.done) { halt(phase, t.reason); return false; }
    }
    return true;
  };

  try {
    // 1) Inicialización con plantilla propia (solo escribe en el datadir del run)
    fs.writeFileSync(m.initIni, initTemplate(), { flag: 'wx' });
    const init = cp.spawnSync(path.join(loc.home, 'bin', 'mariadb-install-db.exe'), initArgs(m), { cwd: m.runDir, env: common, windowsHide: true, encoding: 'utf8' });
    if (init.status !== 0) { fs.writeFileSync(path.join(m.evidenceDir, 'init.log'), `${init.stdout}\n${init.stderr}`); fail('Inicialización fallida; sin reintento.'); }
    // 2) Puerto aleatorio en loopback; una consulta fallida cuenta como OCUPADO (fail-closed)
    m.port = pickPort(() => crypto.randomInt(0, 2 ** 31 - 1), (p) => inspectPort(p).state !== 'free'); validateManifest(m, tempRoot, { requirePort: true });
    // 3) Arranque y comprobación de identidad ANTES de cualquier SQL administrativo
    await startServer();
    admin = await connectAdmin();
    gate = new SqlGate(IDENTITY_QUERIES, [...adminStatements(m, stagingText), 'SHUTDOWN']);
    const [[ident]] = await gate.run(admin, IDENTITY_QUERY);
    validateServerIdentity(ident, m, loc.home);
    if (fs.existsSync(m.pidFile) && parsePidFile(fs.readFileSync(m.pidFile, 'utf8')) !== m.pid) fail('El PID del archivo no coincide con el proceso lanzado.');
    assertOnlyLoopback();
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
    const manifestFile = path.join(m.runDir, 'manifest.json'); writeManifest(manifestFile);

    // 6) Fase principal B0–B6, B8. AUD-02: si NO es PASS completo, no se continúa a B7.
    const main1 = runVitest('main'); record('main', main1.run, main1.out);
    await reapStrays('main');
    if (!halted && !canProceed(phases)) halt('main', `fase principal ${phases.at(-1).state}: ${phases.at(-1).reasons.join('; ')}`);

    // 7) B7: preparar → caída dura del PID verificado → reinicio sobre el MISMO datadir → verificar. Cada paso vigilado.
    if (!halted) {
      const ready = path.join(m.evidenceDir, 'crash-ready.json');
      const outPrep = path.join(m.evidenceDir, 'vitest-crash-prepare.json');
      const prepLog = fs.openSync(path.join(m.evidenceDir, 'vitest-crash-prepare.log'), 'a');
      const prepEnv = buildChildEnv(m, process.env, { PS06A_MANIFEST: manifestFile, PS06A_PHASE: 'crash-prepare', PS06A_CRASH_READY: ready });
      const prep = cp.spawn(process.execPath, [vitest, 'run', '--config', config, '--reporter=json', `--outputFile=${outPrep}`, '--maxWorkers=1', '--no-file-parallelism'], { cwd: loc.repo, env: prepEnv, windowsHide: true, stdio: ['ignore', prepLog, prepLog] });
      fs.closeSync(prepLog); children.add(prep);
      const prepRes = { status: null, signal: null, error: null };
      prep.on('exit', (code, signal) => { prepRes.status = code; prepRes.signal = signal; }); prep.on('error', (e) => { prepRes.error = e; });
      const prepExited = () => prep.exitCode !== null || Boolean(prep.signalCode) || Boolean(prepRes.error);
      const deadline = Date.now() + 60000; let prepProblem = null;
      while (!fs.existsSync(ready)) {
        if (prepExited()) { prepProblem = 'la preparación terminó antes de dar la señal de caída'; break; }
        if (Date.now() > deadline) { prepProblem = 'timeout esperando la señal de la preparación'; break; }
        await sleep(250);
      }
      if (prepProblem) {
        await terminateVerified(prep, belongsVitest, 'preparación B7');
        phases.push({ name: 'crash-prepare', state: 'INCOMPLETO', reasons: [prepProblem] }); halt('crash-prepare', prepProblem);
      } else {
        const sInfo = inspectProcess(m.pid);
        if (sInfo.state !== 'present' || !belongsServer(sInfo.info)) {
          const why = `PID del servidor no verificable antes de derribarlo (${sInfo.state})`;
          await terminateVerified(prep, belongsVitest, 'preparación B7');
          phases.push({ name: 'crash-prepare', state: 'INCOMPLETO', reasons: [why] }); halt('crash-prepare', why);
        } else {
          const killed = await terminateVerified(server, belongsServer, 'servidor (caída B7)');
          if (!killed.done) { phases.push({ name: 'crash-prepare', state: 'INCOMPLETO', reasons: [killed.reason] }); halt('crash-prepare', killed.reason); await terminateVerified(prep, belongsVitest, 'preparación B7'); }
          else {
            for (let i = 0; i < 360 && !prepExited(); i++) await sleep(250);
            if (!prepExited()) { await terminateVerified(prep, belongsVitest, 'preparación B7'); phases.push({ name: 'crash-prepare', state: 'INCOMPLETO', reasons: ['la preparación no terminó tras la caída (timeout)'] }); halt('crash-prepare', 'timeout tras la caída'); }
            else {
              record('crash-prepare', prepRes, outPrep);
              await admin.end().catch(() => {}); admin = undefined;
              if (canProceed(phases)) {
                await startServer(); admin = await connectAdmin();
                const [[ident2]] = await gate.run(admin, IDENTITY_QUERY); validateServerIdentity(ident2, m, loc.home);
                assertOnlyLoopback();
                note('B0.6', 'Tras caída dura y reinicio: misma identidad y solo loopback', 'PASS');
                writeManifest(manifestFile);
                const ver = runVitest('crash-verify'); record('crash-verify', ver.run, ver.out);
                await reapStrays('crash-verify');
                if (!halted && !canProceed(phases)) halt('crash-verify', `${phases.at(-1).state}: ${phases.at(-1).reasons.join('; ')}`);
              } else halt('crash-prepare', `fase ${phases.at(-1).state}: ${phases.at(-1).reasons.join('; ')}`);
            }
          }
        }
      }
    }
  } catch (e) {
    runError = e.message; halt('ejecutor', e.message);
  } finally {
    // 8) Cierre AUD-01/AUD-02: apagado ordenado, terminación VERIFICADA y limpieza solo con estado demostrado.
    try { if (gate?.state === 'LAB' && admin && !serverExited) await gate.run(admin, 'SHUTDOWN').catch(() => {}); } catch { /* se comprueba abajo */ }
    for (let i = 0; i < 120 && server && !serverExited; i++) await sleep(250);
    const closing = [];
    if (server && !serverExited) closing.push(await terminateVerified(server, belongsServer, 'servidor'));
    for (const c of children) closing.push(await terminateVerified(c, belongsVitest, 'proceso hijo de pruebas'));
    try { if (admin) await admin.end(); } catch { /* ignorar */ }
    const procState = m.pid ? inspectProcess(m.pid) : { state: 'absent' };
    const portState = m.port ? inspectPort(m.port) : { state: 'free' };
    const strays = descendantsOf(process.pid);
    // Evidencia: se copia SIEMPRE antes de decidir el borrado; si no se puede copiar, el directorio se conserva.
    const keep = path.join(loc.main, '.lab-runtime', `ps-api06a-evidence-${m.id}`);
    let evidenceKept = false;
    const decisionPre = cleanupDecision({ exited: !server || serverExited, proc: procState, port: portState, strays, evidence: true });
    shutdown = { proven: decisionPre.remove, reasons: [...decisionPre.reasons, ...closing.filter((c) => !c.done).map((c) => c.reason)] };
    if (shutdown.reasons.length) shutdown.proven = false;
    note('B9.1', 'Apagado demostrado: proceso ausente, puerto libre, sin descendientes', shutdown.proven ? 'PASS' : 'FAIL', shutdown.reasons.join('; '));
    const reports = ['main', 'crash-prepare', 'crash-verify'].map((p) => readJson(path.join(m.evidenceDir, `vitest-${p}.json`))).filter(Boolean);
    const summary = summarize(reports, checks, { phases, halted, shutdown, error: runError });
    try {
      fs.writeFileSync(path.join(m.evidenceDir, 'resultados.json'), JSON.stringify(summary, null, 2));
      fs.writeFileSync(path.join(m.evidenceDir, 'resultados.md'), renderMarkdown(summary, `run ${m.id}`));
      fs.cpSync(m.evidenceDir, keep, { recursive: true, errorOnExist: true });
      fs.writeFileSync(path.join(keep, 'manifest.public.json'), JSON.stringify(publicManifest(m), null, 2));
      if (fs.existsSync(m.serverLog)) fs.copyFileSync(m.serverLog, path.join(keep, 'server.log'));
      evidenceKept = true;
    } catch (e) { console.error('Evidencia no copiada:', e.message); }
    const decision = cleanupDecision({ exited: !server || serverExited, proc: procState, port: portState, strays, evidence: evidenceKept });
    if (decision.remove) { try { safeRemoveRunDir(m, tempRoot, fs); } catch (e) { console.error('Limpieza rechazada, se conserva el directorio:', e.message); } }
    else console.error(`Directorio CONSERVADO (${m.runDir}): ${decision.reasons.join('; ')}`);
    console.log(`Evidencia: ${keep}`);
    console.log(renderMarkdown(summary, `run ${m.id}`).split('\n').slice(0, 22).join('\n'));
    process.exitCode = ['PASS', 'PASS CON LIMITACIONES'].includes(summary.overall) ? 0 : 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
