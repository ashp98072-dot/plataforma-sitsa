// PRICESMART-API-06A — guardas de aislamiento PURAS (sin red, sin procesos, sin base de datos). Importar no tiene efectos.
// Todo lo que decide si el laboratorio puede arrancar, a qué se conecta o qué se borra está aquí, para poder auditarlo y probarlo sin MariaDB.
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ALLOWED_BRANCHES, LAB_ACK_ENV, LAB_ACK_PHRASE, RUN_PREFIX, HOST, PORT_MIN, PORT_MAX, FORBIDDEN_PORTS,
  FORBIDDEN_PARENT_ENV, LOCK_WAIT_SECONDS, ENGINE,
} from './constants.mjs';

export const fail = (message) => { throw new Error(`API-06A: ${message}`); };
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const norm = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();

/** Protección contra ejecución accidental. Se evalúa ANTES de crear cualquier archivo o proceso. */
export function assertLabGate({ argv, env, platform, branch, envFilesInCwd }) {
  const mode = argv.length === 1 ? argv[0] : '';
  if (!['--run-isolated', '--preflight-only'].includes(mode)) fail('Se requiere exactamente un argumento: --run-isolated o --preflight-only.');
  if (platform !== 'win32') fail('Solo Windows.');
  if (!ALLOWED_BRANCHES.includes(branch)) fail(`Rama inesperada (${branch}); se exige una de: ${ALLOWED_BRANCHES.join(', ')}.`);
  if (envFilesInCwd.length) fail('Hay archivos .env* en el directorio de trabajo; validateSandboxConfig los rechaza.');
  const bad = Object.keys(env).filter((k) => FORBIDDEN_PARENT_ENV.test(k));
  if (bad.length) fail(`El entorno del proceso padre define variables de bases/entornos reales (${bad.join(', ')}). Ejecute desde una consola limpia.`);
  if (mode === '--run-isolated' && env[LAB_ACK_ENV] !== LAB_ACK_PHRASE) fail(`Falta confirmación explícita ${LAB_ACK_ENV}.`);
  return mode;
}

/** Puerto aleatorio en el rango dinámico, nunca uno de los puertos de otros servicios; `isBusy` sondea localhost. */
export function pickPort(randomInt, isBusy) {
  for (let i = 0; i < 64; i++) {
    const port = PORT_MIN + (randomInt() % (PORT_MAX - PORT_MIN + 1));
    if (port < PORT_MIN || port > PORT_MAX || FORBIDDEN_PORTS.includes(port)) continue;
    if (!isBusy(port)) return port;
  }
  return fail('No se encontró un puerto libre.');
}

/** Manifiesto de la ejecución. Los secretos solo viven en memoria (`secrets`); `publicManifest` los omite. */
export function createManifest({ randomBytes, tempRoot }) {
  const id = randomBytes(16).toString('hex');
  const short = id.slice(0, 20);
  const runDir = path.join(tempRoot, `${RUN_PREFIX}${id}`);
  const sandboxId = `api06a-${short}`;
  const secret = () => `sandbox:${sandboxId}:${randomBytes(32).toString('hex')}`;
  return {
    id, sandboxId, schema: `sandbox_api02_${short}`, user: `sandbox_api02_${short}`, workerUser: `sandbox_api02_w${short}`, appUser: `sandbox_api02_a${short}`, pipe: `ps06a-${id}`, port: 0, pid: 0,
    runDir, datadir: path.join(runDir, 'data'), pidFile: path.join(runDir, 'server.pid'), tmpDir: path.join(runDir, 'tmp'),
    filesDir: path.join(runDir, 'files'), sandboxRoot: path.join(runDir, 'sandbox'), uploadsDir: path.join(runDir, 'sandbox', 'uploads'),
    evidenceDir: path.join(runDir, 'evidence'), initIni: path.join(runDir, 'init-template.ini'), serverLog: path.join(runDir, 'server.log'),
    secrets: { DB_PASSWORD: secret(), AUTH_SECRET: secret(), PORTAL_CREDENTIALS_KEY: secret(), WORKER_PASSWORD: secret(), APP_PASSWORD: secret() },
  };
}
export function publicManifest(m) { const copy = { ...m }; delete copy.secrets; return copy; }

export function validateManifest(m, tempRoot, { requirePort = false } = {}) {
  const ok = m && /^[a-f0-9]{32}$/.test(m.id) && m.sandboxId === `api06a-${m.id.slice(0, 20)}` &&
    m.schema === `sandbox_api02_${m.id.slice(0, 20)}` && m.user === m.schema && m.workerUser === `sandbox_api02_w${m.id.slice(0, 20)}` && m.appUser === `sandbox_api02_a${m.id.slice(0, 20)}` && m.pipe === `ps06a-${m.id}`;
  if (!ok) fail('Manifiesto inválido.');
  const expected = path.resolve(tempRoot, `${RUN_PREFIX}${m.id}`);
  const under = (p, ...parts) => path.resolve(p) === path.join(expected, ...parts);
  if (path.resolve(m.runDir) !== expected || !under(m.datadir, 'data') || !under(m.pidFile, 'server.pid') || !under(m.tmpDir, 'tmp') ||
      !under(m.filesDir, 'files') || !under(m.sandboxRoot, 'sandbox') || !under(m.uploadsDir, 'sandbox', 'uploads') ||
      !under(m.evidenceDir, 'evidence') || !under(m.initIni, 'init-template.ini') || !under(m.serverLog, 'server.log')) fail('Directorio fuera del laboratorio.');
  if (requirePort || m.port) {
    if (!Number.isInteger(m.port) || m.port < PORT_MIN || m.port > PORT_MAX || FORBIDDEN_PORTS.includes(m.port)) fail('Puerto no permitido.');
  }
  return m;
}

/** Argumentos EXACTOS de mariadbd. Solo loopback, nombre-DNS desactivado, sin carga de archivos locales, datadir/pid/tmp propios. */
export function buildServerArgs(m, home) {
  return [
    '--no-defaults', `--basedir=${home}`, `--datadir=${m.datadir}`, `--pid-file=${m.pidFile}`, `--tmpdir=${m.tmpDir}`,
    `--bind-address=${HOST}`, `--port=${m.port}`, '--skip-name-resolve', '--enable-named-pipe', `--socket=${m.pipe}`,
    '--local-infile=0', `--secure-file-priv=${m.filesDir}`, '--max-connections=40', `--innodb-lock-wait-timeout=${LOCK_WAIT_SECONDS}`,
    '--innodb-buffer-pool-size=64M', '--innodb-flush-log-at-trx-commit=1', '--character-set-server=utf8mb4',
    '--sql-mode=STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO', '--console',
  ];
}
const FORBIDDEN_FLAG = /skip-grant-tables|bind-address=(?!127\.0\.0\.1$)|--skip-networking|--init-file|--plugin-load|general-log|log-bin|--defaults-file|--defaults-extra-file|replicate|--master|--install|--standalone|federated|--event-scheduler=on/i;
export function assertServerArgs(args, m, home) {
  const expected = buildServerArgs(m, home);
  if (args.length !== expected.length || args.some((a, i) => a !== expected[i])) fail('Argumentos del servidor distintos de los aprobados.');
  const bad = args.find((a) => FORBIDDEN_FLAG.test(a));
  if (bad) fail(`Argumento prohibido del servidor: ${bad}`);
  if (!args.includes(`--bind-address=${HOST}`) || !args.includes('--skip-name-resolve') || !args.includes('--local-infile=0')) fail('Faltan controles de aislamiento.');
  return args;
}

/** Plantilla de mariadb-install-db (solo escribe en el datadir del run). */
export function initTemplate() { return '[mysqld]\r\nskip-networking=ON\r\nnamed-pipe=ON\r\n'; }
export function initArgs(m) { return [`--datadir=${m.datadir}`, `--socket=${m.pipe}`, '--skip-networking', `--config=${m.initIni}`]; }

/** Entorno del proceso de pruebas: CONSTRUIDO desde cero (lista blanca). No hereda nada de la consola. */
export function buildChildEnv(m, base, extra = {}) {
  const sysRoot = base.SystemRoot ?? base.SYSTEMROOT;
  if (!sysRoot) fail('SystemRoot no disponible.');
  const env = {
    SystemRoot: sysRoot, WINDIR: base.WINDIR ?? sysRoot, TEMP: m.tmpDir, TMP: m.tmpDir, PATH: `${sysRoot}\\System32`, NODE_ENV: 'test',
    NOVALVION_ENV: 'sandbox', SANDBOX_ID: m.sandboxId, SANDBOX_ROOT: m.sandboxRoot, NEXT_TELEMETRY_DISABLED: '1',
    DB_HOST: HOST, DB_PORT: String(m.port), DB_NAME: m.schema, DB_USER: m.user, DB_PASSWORD: m.secrets.DB_PASSWORD,
    AUTH_SECRET: m.secrets.AUTH_SECRET, PORTAL_CREDENTIALS_KEY: m.secrets.PORTAL_CREDENTIALS_KEY,
    PS06A_APP_PASSWORD: m.secrets.APP_PASSWORD,   // TMS-ENTREGA-PILOTO-1 (B12): cuenta de aplicación con privilegios acotados; solo para el proceso de pruebas
    PS06A_WORKER_PASSWORD: m.secrets.WORKER_PASSWORD,   // API-07: contraseña de la cuenta de worker (outbox); solo para el proceso de pruebas
    CB2_PUBLIC_ORIGIN: 'https://localhost', EMPRESA_DOMINIOS: '{"localhost":"kt-monaco"}', UPLOAD_DIR: m.uploadsDir,
    ...extra,
  };
  const allowed = new Set(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'NODE_ENV', 'NOVALVION_ENV', 'SANDBOX_ID', 'SANDBOX_ROOT', 'NEXT_TELEMETRY_DISABLED',
    'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'AUTH_SECRET', 'PORTAL_CREDENTIALS_KEY', 'CB2_PUBLIC_ORIGIN', 'EMPRESA_DOMINIOS', 'UPLOAD_DIR',
    'PS06A_MANIFEST', 'PS06A_PHASE', 'PS06A_CRASH_READY', 'PS06A_WORKER_PASSWORD', 'PS06A_APP_PASSWORD']);
  const unknown = Object.keys(env).filter((k) => !allowed.has(k));
  if (unknown.length) fail(`Variable no permitida en el entorno de pruebas: ${unknown.join(', ')}`);
  if (new Set([env.AUTH_SECRET, env.DB_PASSWORD, env.PORTAL_CREDENTIALS_KEY, env.PS06A_WORKER_PASSWORD, env.PS06A_APP_PASSWORD]).size !== 5) fail('Los cinco secretos deben ser distintos.');
  return env;
}
export function isolationJson(m) {
  return {
    environment: 'sandbox', id: m.sandboxId, origin: 'https://localhost',
    database: { DB_HOST: HOST, DB_PORT: String(m.port), DB_NAME: m.schema, DB_USER: m.user },
    secretSha256: Object.fromEntries(['AUTH_SECRET', 'DB_PASSWORD', 'PORTAL_CREDENTIALS_KEY'].map((k) => [k, sha256(m.secrets[k])])),
  };
}

/** Única conexión permitida: pipe administrativo del run, o TCP 127.0.0.1:<puerto del run>. */
export function isAllowedConnect(target, m) {
  const { host, port, path: pipePath } = target;
  if (pipePath !== undefined) return String(pipePath).toLowerCase() === `\\\\.\\pipe\\${m.pipe}`.toLowerCase();
  return host === HOST && Number(port) === m.port && m.port >= PORT_MIN;
}
export function adminOptions(m) {
  return { socketPath: `\\\\.\\pipe\\${m.pipe}`, user: 'root', password: '', multipleStatements: false, connectTimeout: 5000 };
}
export function assertAdminOptions(o, m) {
  const e = adminOptions(m);
  if (Object.keys(o).length !== Object.keys(e).length || Object.keys(e).some((k) => o[k] !== e[k])) fail('Opciones administrativas no permitidas (se prohíbe TCP, hosts y overrides).');
}
export function runtimeOptions(m) {
  return { host: HOST, port: m.port, user: m.user, password: m.secrets.DB_PASSWORD, database: m.schema, connectionLimit: 8, multipleStatements: false, connectTimeout: 5000 };
}

/** Compuerta de SQL administrativo: antes de confirmar la identidad solo pasan las consultas de identidad; después, solo sentencias EXACTAS aprobadas. */
export class SqlGate {
  constructor(identityQueries, approvedStatements) {
    this.identity = new Set(identityQueries); this.approved = new Set(approvedStatements); this.state = 'UNVERIFIED'; this.executed = [];
  }
  check(sql) {
    if (typeof sql !== 'string' || !sql.trim()) fail('SQL vacío.');
    if (this.identity.has(sql)) return 'identity';
    if (this.state !== 'LAB') fail('Se intentó SQL administrativo antes de confirmar la identidad del laboratorio.');
    if (!this.approved.has(sql)) fail('Sentencia administrativa no aprobada.');
    return 'approved';
  }
  confirm() { if (this.state === 'LAB') fail('Identidad ya confirmada.'); this.state = 'LAB'; }
  async run(connection, sql, params) {
    const kind = this.check(sql);
    this.executed.push({ kind, redacted: /IDENTIFIED BY/i.test(sql) ? '[CREATE USER redactado]' : sql.slice(0, 120) });
    return params === undefined ? connection.query(sql) : connection.query(sql, params);
  }
}

export const IDENTITY_QUERY = 'SELECT @@datadir AS datadir, @@pid_file AS pidFile, @@port AS port, @@bind_address AS bindAddress, @@version AS version, @@socket AS socket, @@basedir AS basedir, @@skip_name_resolve AS skipNameResolve, @@local_infile AS localInfile, @@foreign_key_checks AS fk, @@check_constraint_checks AS checks, @@secure_file_priv AS securePriv, @@innodb_lock_wait_timeout AS lockWait, @@read_only AS readOnly, @@log_bin AS logBin';
export const SCHEMA_ABSENT_QUERY = 'SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?';
export const USER_ABSENT_QUERY = 'SELECT COUNT(*) AS n FROM mysql.user WHERE User = ?';
export const IDENTITY_QUERIES = Object.freeze([IDENTITY_QUERY, SCHEMA_ABSENT_QUERY, USER_ABSENT_QUERY]);

export function validateServerIdentity(r, m, home) {
  const checks = {
    datadir: r && norm(r.datadir) === norm(m.datadir), pidFile: r && norm(r.pidFile) === norm(m.pidFile),
    port: r && Number(r.port) === m.port, bind: r && r.bindAddress === HOST, version: r && String(r.version).startsWith(ENGINE.versionPrefix) && String(r.version).includes('MariaDB'),
    socket: r && String(r.socket).toLowerCase() === m.pipe.toLowerCase(), basedir: r && norm(r.basedir) === norm(home),
    skipNameResolve: r && Number(r.skipNameResolve) === 1, localInfile: r && Number(r.localInfile) === 0, fk: r && Number(r.fk) === 1, checks: r && Number(r.checks) === 1,
    securePriv: r && norm(r.securePriv) === norm(m.filesDir), lockWait: r && Number(r.lockWait) === LOCK_WAIT_SECONDS, readOnly: r && Number(r.readOnly) === 0, logBin: r && Number(r.logBin) === 0,
  };
  const wrong = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  if (wrong.length) fail(`Identidad/configuración del servidor no autorizada (${wrong.join(', ')}).`);
}

/** Proceso identificado por PID: ruta del ejecutable y línea de comandos deben coincidir con el manifiesto. Nunca se actúa por nombre. */
export function processMatches(info, m, home) {
  if (!info || info.pid !== m.pid || m.pid <= 0) return false;
  const exe = norm(info.exe ?? '');
  const cmd = String(info.cmd ?? '');
  return exe === norm(path.join(home, 'bin', 'mariadbd.exe')) && cmd.includes(`--datadir=${m.datadir}`) && cmd.includes(`--port=${m.port}`) && cmd.includes(`--socket=${m.pipe}`);
}
export function parsePidFile(text) { const n = Number(String(text).trim()); return Number.isInteger(n) && n > 0 ? n : 0; }
/** Todos los sockets en escucha del PID deben ser exactamente 127.0.0.1:<puerto del run>. */
export function onlyLoopbackListeners(listeners, pid, port) {
  const own = listeners.filter((l) => l.pid === pid);
  return own.length === 1 && own[0].address === HOST && own[0].port === port;
}

/** Limpieza segura: recorre el árbol y se niega ante enlaces/uniones o rutas fuera del run; solo entonces borra. `fsApi` permite probarlo. */
export function walkAssertNoLinks(dir, fsApi) {
  const stack = [dir]; let files = 0;
  while (stack.length) {
    const current = stack.pop();
    const st = fsApi.lstatSync(current);
    if (st.isSymbolicLink()) fail(`Enlace/unión detectado, limpieza rechazada: ${current}`);
    if (st.isDirectory()) { for (const name of fsApi.readdirSync(current)) stack.push(path.join(current, name)); } else files++;
  }
  return files;
}
export function safeRemoveRunDir(m, tempRoot, fsApi) {
  validateManifest(m, tempRoot);
  if (path.dirname(path.resolve(m.runDir)) !== path.resolve(tempRoot)) fail('El directorio no es hijo directo de la raíz temporal.');
  if (fsApi.realpathSync(m.runDir) !== path.resolve(m.runDir)) fail('La ruta real difiere de la esperada (enlace o nombre corto).');
  walkAssertNoLinks(m.runDir, fsApi);
  fsApi.rmSync(m.runDir, { recursive: true, force: false, maxRetries: 3 });
}

// ---- AUD-01 / AUD-02 (correcciones de auditoría) ----

/** Decisión de limpieza FAIL-CLOSED: solo se borra el directorio si TODO está demostrado. Cualquier estado 'unknown', 'present', 'busy' o ausente de consulta lo impide. */
export function cleanupDecision({ exited, proc, port, strays, evidence }) {
  const reasons = [];
  if (evidence !== true) reasons.push('la evidencia no se copió fuera del directorio efímero');
  if (exited !== true) reasons.push('el servidor no consta como terminado');
  if (!proc || proc.state !== 'absent') reasons.push(`proceso del servidor: ${proc?.state ?? 'sin consulta'} (se exige absent)`);
  if (!port || port.state !== 'free') reasons.push(`puerto del run: ${port?.state ?? 'sin consulta'} (se exige free)`);
  if (!strays || strays.state !== 'none') reasons.push(`procesos descendientes del ejecutor: ${strays?.state ?? 'sin consulta'} (se exige none)`);
  return { remove: reasons.length === 0, reasons };
}
/** Pertenencia de un proceso hijo (node/vitest) al laboratorio: ejecutable = node actual y línea de comandos dentro de vitest o del directorio del run. */
export function labChildBelongs(info, { nodeExe, vitestRoot, runDir }) {
  if (!info || !info.exe || !info.cmd) return false;
  const cmd = String(info.cmd).toLowerCase();
  return norm(info.exe) === norm(nodeExe) && (cmd.includes(norm(vitestRoot)) || cmd.includes(norm(runDir)));
}
/** Solo se continúa a la fase siguiente si TODAS las anteriores dieron PASS (un FAIL o INCOMPLETO detiene). */
export function canProceed(evaluations) { return evaluations.length > 0 && evaluations.every((e) => e.state === 'PASS'); }
