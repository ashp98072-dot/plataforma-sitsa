// PRICESMART-API-11 — ejecutor del laboratorio de endpoints y seguridad M2M (MariaDB 11.8.9 efímero, datos SINTÉTICOS). INDEPENDIENTE del laboratorio de API-06A: lo REUTILIZA importando sus guardas
// (safety.mjs, procinfo.mjs, ddl.mjs, run-windows.mjs: locate/verifyEngine) sin modificarlas. Importar este archivo no inicia nada: solo `main()` actúa, y solo como punto de entrada.
//   node scripts/ci/pricesmart-api11/run-windows.mjs --preflight-only   → verifica compuertas y motor; NO crea archivos ni procesos.
//   node scripts/ci/pricesmart-api11/run-windows.mjs --run-isolated     → requiere PS_API11_LAB_ACK; inicia MariaDB efímero en 127.0.0.1 (puerto aleatorio).
// Nada toca Hostinger, producción, MySQL80, PostgreSQL ni el esquema real.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FORBIDDEN_PARENT_ENV } from '../pricesmart-api06a/constants.mjs';
import { locate, verifyEngine } from '../pricesmart-api06a/run-windows.mjs';
import {
  createManifest, publicManifest, validateManifest, buildServerArgs, assertServerArgs, initTemplate, initArgs, buildChildEnv, isolationJson, adminOptions, assertAdminOptions,
  SqlGate, IDENTITY_QUERIES, IDENTITY_QUERY, SCHEMA_ABSENT_QUERY, validateServerIdentity, processMatches, onlyLoopbackListeners, pickPort, safeRemoveRunDir, cleanupDecision,
  labChildBelongs, fail,
} from '../pricesmart-api06a/safety.mjs';
import { inspectProcess, listenersOfPid, inspectPort, descendantsOf, countProcessesNamed, terminateVerified, terminateStray } from '../pricesmart-api06a/procinfo.mjs';
import { adminStatementsApi11, sha256Lf } from './ddl.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

export const API11_BRANCH = 'feature/pricesmart-api11-endpoints';
export const ACK_ENV = 'PS_API11_LAB_ACK';
export const ACK_PHRASE = 'SINTETICO-LOCAL-SIN-PRODUCCION-NI-HOSTINGER';
export const REQUIRED_CASES = Object.freeze(Array.from({ length: 13 }, (_, i) => `API11.${i + 1}`));

/** Compuerta de ejecución accidental (se evalúa ANTES de crear cualquier archivo o proceso). */
export function assertGate({ argv, env, platform, branch, envFilesInCwd }) {
  const mode = argv.length === 1 ? argv[0] : '';
  if (!['--run-isolated', '--preflight-only'].includes(mode)) fail('Se requiere exactamente un argumento: --run-isolated o --preflight-only.');
  if (platform !== 'win32') fail('Solo Windows.');
  if (![API11_BRANCH, 'feature/pricesmart-api12-demo', 'feature/pricesmart-api13-resiliencia', 'feature/pricesmart-api16-conformidad-puertos'].includes(branch)) fail(`Rama inesperada (${branch}); se exige ${API11_BRANCH} (o la rama de API-12 o API-13, que reejecutan este laboratorio como regresión).`);
  if (envFilesInCwd.length) fail('Hay archivos .env* en el directorio de trabajo.');
  const bad = Object.keys(env).filter((k) => FORBIDDEN_PARENT_ENV.test(k));
  if (bad.length) fail(`El entorno del proceso padre define variables de bases/entornos reales (${bad.join(', ')}). Ejecute desde una consola limpia.`);
  if (mode === '--run-isolated' && env[ACK_ENV] !== ACK_PHRASE) fail(`Falta confirmación explícita ${ACK_ENV}.`);
  return mode;
}

/** Evalúa la ejecución de Vitest: estado de proceso, JSON, y que CADA caso obligatorio exista una vez y haya PASADO (sin omitidos). */
export function evaluateRun(run, report) {
  const reasons = [];
  if (!run) return { state: 'INCOMPLETO', reasons: ['sin resultado de la ejecución'], cases: [] };
  if (run.error) reasons.push(`error de proceso: ${run.error.code ?? run.error.message}`);
  if (run.signal) reasons.push(`terminado por señal ${run.signal}`);
  if (run.status === null || run.status === undefined) reasons.push('sin código de salida');
  let tests = [];
  if (!report || typeof report !== 'object') reasons.push('JSON de Vitest ausente o ilegible');
  else {
    tests = (Array.isArray(report.testResults) ? report.testResults : []).flatMap((f) => (Array.isArray(f.assertionResults) ? f.assertionResults : []));
    if (!tests.length) reasons.push('Vitest no reportó ningún caso');
    if (Number.isFinite(Number(report.numTotalTests)) && Number(report.numTotalTests) !== tests.length) reasons.push(`recuento inconsistente (${report.numTotalTests} vs ${tests.length})`);
  }
  const idOf = (t) => /^(API11\.\d+)\b/.exec(String(t.title ?? ''))?.[1];
  const cases = tests.map((t) => ({ id: idOf(t) ?? '?', title: String(t.title ?? ''), status: t.status === 'passed' ? 'PASS' : t.status === 'failed' ? 'FAIL' : 'SKIP', message: (t.failureMessages ?? []).join('\n').slice(0, 1200) }));
  for (const id of REQUIRED_CASES) {
    const items = cases.filter((c) => c.id === id);
    if (items.length === 0) reasons.push(`caso obligatorio ausente: ${id}`);
    else if (items.length > 1) reasons.push(`caso obligatorio duplicado: ${id}`);
    else if (items[0].status === 'SKIP') reasons.push(`caso obligatorio OMITIDO: ${id}`);
  }
  for (const c of cases) if (c.id === '?') reasons.push(`caso sin identificador API11.n: ${c.title}`);
  const failed = cases.filter((c) => c.status === 'FAIL');
  if (failed.length) return { state: 'FAIL', reasons: [`${failed.length} caso(s) FAIL`, ...reasons], cases };
  if (run.status !== 0 && !reasons.length) reasons.push(`código de salida ${run.status}`);
  return { state: reasons.length ? 'INCOMPLETO' : 'PASS', reasons, cases };
}

export function renderMarkdown(summary, title) {
  const c = summary.cases; const n = (s) => c.filter((x) => x.status === s).length;
  const lines = [`# Resultados API-11 — ${title}`, '', `Global: **${summary.overall}** (PASS ${n('PASS')} / FAIL ${n('FAIL')} / SKIP ${n('SKIP')})`, ''];
  if (summary.reasons.length) lines.push(`Motivos: ${summary.reasons.join('; ')}`, '');
  lines.push('| Caso | Estado |', '|---|---|', ...c.map((x) => `| ${x.title.slice(0, 150).replaceAll('|', '/')} | ${x.status} |`));
  for (const x of c.filter((y) => y.status === 'FAIL')) lines.push('', `**${x.id} FAIL**`, '```', x.message, '```');
  return lines.join('\n');
}

export async function main(argv, env = process.env) {
  const loc = locate();
  const mode = assertGate({ argv, env, platform: process.platform, branch: loc.branch, envFilesInCwd: loc.envFilesInCwd });
  if (!fs.existsSync(loc.home) || !fs.existsSync(loc.zip)) fail('Motor portable no disponible en .lab-runtime/.');
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  const engine = verifyEngine(loc);
  const read = (rel) => fs.readFileSync(path.join(loc.repo, rel), 'utf8');
  const securityText = read('docs/integraciones/pricesmart/api11/staging-security.sql.in');
  if (mode === '--preflight-only') {
    const running = countProcessesNamed('mariadbd');
    console.log(JSON.stringify({ mode, branch: loc.branch, tempRoot, engineFilesVerified: engine.files, securityDdlSha256: sha256Lf(securityText), mariadbdProcessesRunning: running.state === 'known' ? running.count : `DESCONOCIDO (${running.reason})`, note: 'No se creó ningún archivo ni proceso.' }, null, 2));
    if (running.state !== 'known') process.exitCode = 1;
    return;
  }
  const texts = { stagingText: read('docs/integraciones/pricesmart/api01/staging.sql.in'), adaptationText: read('docs/integraciones/pricesmart/api09/staging.sql.in'), securityText };
  const mysql = (await import('mysql2/promise')).default;
  const m = createManifest({ randomBytes: crypto.randomBytes, tempRoot }); validateManifest(m, tempRoot);
  const stmts = adminStatementsApi11(m, texts);
  fs.mkdirSync(m.runDir); for (const d of [m.tmpDir, m.filesDir, m.sandboxRoot, m.uploadsDir, m.evidenceDir]) fs.mkdirSync(d);
  const common = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: m.tmpDir, TMP: m.tmpDir, PATH: `${path.join(loc.home, 'bin')};${process.env.SystemRoot}\\System32` };
  const vitestRoot = path.join(loc.main, 'node_modules', 'vitest'); const vitest = path.join(vitestRoot, 'vitest.mjs'); const config = path.join(here, 'vitest.lab.config.mts');
  const belongsVitest = (info) => labChildBelongs(info, { nodeExe: process.execPath, vitestRoot, runDir: m.runDir });
  const belongsServer = (info) => processMatches(info, m, loc.home);
  let server; let serverExited = true; let admin; let gate; let halted = null; let runError = null; const children = new Set(); const checks = [];
  const halt = (reason) => { halted ??= reason; };

  const startServer = async () => {
    const args = buildServerArgs(m, loc.home); assertServerArgs(args, m, loc.home);
    const log = fs.openSync(m.serverLog, 'a');
    server = cp.spawn(path.join(loc.home, 'bin', 'mariadbd.exe'), args, { cwd: m.runDir, env: common, windowsHide: true, stdio: ['ignore', log, log] });
    fs.closeSync(log); serverExited = false; server.on('exit', () => { serverExited = true; }); m.pid = server.pid ?? 0;
    let s = { state: 'unknown' };
    for (let i = 0; i < 80 && !serverExited; i++) { s = inspectProcess(m.pid); if (s.state === 'present') break; await sleep(250); }
    if (s.state !== 'present' || !belongsServer(s.info)) fail(`El proceso iniciado no coincide con el manifiesto (${s.state}).`);
  };
  const connectAdmin = async () => {
    for (let i = 0; i < 120; i++) {
      if (serverExited) fail('El servidor terminó antes de aceptar conexiones.');
      const o = adminOptions(m); assertAdminOptions(o, m);
      try { return await mysql.createConnection(o); } catch { await sleep(500); }
    }
    return fail('No se pudo conectar al pipe administrativo.');
  };
  try {
    fs.writeFileSync(m.initIni, initTemplate(), { flag: 'wx' });
    const init = cp.spawnSync(path.join(loc.home, 'bin', 'mariadb-install-db.exe'), initArgs(m), { cwd: m.runDir, env: common, windowsHide: true, encoding: 'utf8' });
    if (init.status !== 0) fail('Inicialización fallida; sin reintento.');
    m.port = pickPort(() => crypto.randomInt(0, 2 ** 31 - 1), (p) => inspectPort(p).state !== 'free'); validateManifest(m, tempRoot, { requirePort: true });
    await startServer(); admin = await connectAdmin();
    gate = new SqlGate(IDENTITY_QUERIES, [...stmts.setup, ...stmts.after, 'SHUTDOWN']);
    const [[ident]] = await gate.run(admin, IDENTITY_QUERY); validateServerIdentity(ident, m, loc.home);
    const L = listenersOfPid(m.pid);
    if (L.state !== 'known' || !onlyLoopbackListeners(L.listeners, m.pid, m.port)) fail('El servidor escucha fuera de 127.0.0.1:<puerto del run>.');
    const [[{ n: nSchema }]] = await gate.run(admin, SCHEMA_ABSENT_QUERY, [m.schema]); if (Number(nSchema) !== 0) fail('Base preexistente; no se reutiliza.');
    gate.confirm();
    checks.push({ id: 'B0', name: 'Motor 11.8.9 verificado, identidad y solo loopback', status: 'PASS', detail: `${engine.files} archivos; puerto ${m.port}` });
    for (const sql of stmts.setup) await gate.run(admin, sql);
    for (const sql of stmts.after) await gate.run(admin, sql);
    fs.writeFileSync(path.join(m.evidenceDir, 'sql-ejecutado.json'), JSON.stringify(gate.executed, null, 2), { flag: 'wx' });
    fs.writeFileSync(path.join(m.sandboxRoot, 'isolation.json'), JSON.stringify(isolationJson(m)), { flag: 'wx' });
    const manifestFile = path.join(m.runDir, 'manifest.json'); fs.writeFileSync(manifestFile, JSON.stringify(publicManifest(m)));

    const out = path.join(m.evidenceDir, 'vitest-api11.json');
    const childEnv = buildChildEnv(m, process.env, { PS06A_MANIFEST: manifestFile, PS06A_PHASE: 'api11' });
    const run = cp.spawnSync(process.execPath, [vitest, 'run', '--config', config, '--reporter=json', `--outputFile=${out}`, '--maxWorkers=1', '--no-file-parallelism'],
      { cwd: loc.repo, env: childEnv, windowsHide: true, encoding: 'utf8', timeout: 540000, maxBuffer: 16 * 1024 * 1024 });
    fs.writeFileSync(path.join(m.evidenceDir, 'vitest-api11.log'), `${run.stdout ?? ''}\n${run.stderr ?? ''}\n[status=${run.status} signal=${run.signal} error=${run.error?.code ?? run.error?.message ?? ''}]`);
    const evaluation = evaluateRun({ status: run.status, signal: run.signal, error: run.error }, readJson(out));
    checks.push({ id: 'API11', name: 'Pruebas API-11 contra el motor real', status: evaluation.state, detail: evaluation.reasons.join('; ') });
    runnerEvaluation = evaluation;
    const d = descendantsOf(process.pid);
    if (d.state === 'unknown') halt(`no se pudo comprobar procesos hijos (${d.reason})`);
    else if (d.state !== 'none') for (const proc of d.procs.filter((p) => p.pid !== m.pid)) { const t = await terminateStray(proc, belongsVitest); if (!t.done) halt(t.reason); }
  } catch (e) {
    runError = e.message; halt(e.message);
  } finally {
    try { if (gate?.state === 'LAB' && admin && !serverExited) await gate.run(admin, 'SHUTDOWN').catch(() => {}); } catch { /* se comprueba abajo */ }
    for (let i = 0; i < 120 && server && !serverExited; i++) await sleep(250);
    const closing = [];
    if (server && !serverExited) closing.push(await terminateVerified(server, belongsServer, 'servidor'));
    for (const c of children) closing.push(await terminateVerified(c, belongsVitest, 'proceso hijo de pruebas'));
    try { if (admin) await admin.end(); } catch { /* ignorar */ }
    const procState = m.pid ? inspectProcess(m.pid) : { state: 'absent' };
    const portState = m.port ? inspectPort(m.port, undefined, { ignoreTimeWait: true }) : { state: 'free' };
    const strays = descendantsOf(process.pid);
    const keep = path.join(loc.main, '.lab-runtime', `ps-api11-evidence-${m.id}`);
    const pre = cleanupDecision({ exited: !server || serverExited, proc: procState, port: portState, strays, evidence: true });
    const shutdownProven = pre.remove && closing.every((c) => c.done);
    const evaluation = runnerEvaluation ?? { state: 'INCOMPLETO', reasons: [runError ?? 'las pruebas no se ejecutaron'], cases: [] };
    const reasons = [...evaluation.reasons, ...(halted ? [`ejecución detenida: ${halted}`] : []), ...(shutdownProven ? [] : [`apagado no demostrado: ${[...pre.reasons, ...closing.filter((c) => !c.done).map((c) => c.reason)].join('; ')}`])];
    const overall = evaluation.state === 'FAIL' ? 'FAIL' : (evaluation.state === 'PASS' && !halted && shutdownProven) ? 'PASS' : 'INCOMPLETO';
    const summary = { overall, reasons, cases: evaluation.cases, checks, shutdownProven };
    let evidenceKept = false;
    try {
      fs.writeFileSync(path.join(m.evidenceDir, 'resultados.json'), JSON.stringify(summary, null, 2));
      fs.writeFileSync(path.join(m.evidenceDir, 'resultados.md'), renderMarkdown(summary, `run ${m.id}`));
      fs.cpSync(m.evidenceDir, keep, { recursive: true, errorOnExist: true });
      fs.writeFileSync(path.join(keep, 'manifest.public.json'), JSON.stringify(publicManifest(m), null, 2));
      for (const f of ['server.log']) { const p = path.join(m.runDir, f); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(keep, f)); }
      evidenceKept = true;
    } catch (e) { console.error('Evidencia no copiada:', e.message); }
    const decision = cleanupDecision({ exited: !server || serverExited, proc: procState, port: portState, strays, evidence: evidenceKept });
    if (decision.remove) { try { safeRemoveRunDir(m, tempRoot, fs); } catch (e) { console.error('Limpieza rechazada, se conserva el directorio:', e.message); } }
    else console.error(`Directorio CONSERVADO (${m.runDir}): ${decision.reasons.join('; ')}`);
    console.log(`Evidencia: ${keep}`);
    console.log(renderMarkdown(summary, `run ${m.id}`).split('\n').slice(0, 40).join('\n'));
    process.exitCode = overall === 'PASS' ? 0 : 1;
  }
}
let runnerEvaluation = null;

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
