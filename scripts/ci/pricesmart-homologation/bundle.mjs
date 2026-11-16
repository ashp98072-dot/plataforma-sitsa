// PRICESMART API-26 — PAQUETE DE APROVISIONAMIENTO del sandbox de homologación. Funciones PURAS (texto) más un ejecutor con barreras. NO se ejecuta nada al importar este archivo.
//
// Modelo («sandbox appliance»): UN host dedicado con MariaDB escuchando SOLO en 127.0.0.1, la aplicación en 127.0.0.1 y un proxy inverso HTTPS delante. Es el único modelo compatible con las
// guardas vigentes del repositorio (`validateSandboxConfig`: DB_HOST=127.0.0.1; puertos: cuentas `@127.0.0.1`, esquema/cuenta `sandbox_api02_*`; secretos `sandbox:<id>:<hex>`), que NO se relajan.
// Por construcción el ejecutor solo se conecta a loopback: no puede apuntar a un servidor remoto (p. ej. Hostinger). Nada aquí crea ni imprime credenciales de PriceSmart; el verificador HMAC
// de laboratorio no se menciona ni se usa. Los diseños SQL (`*.sql.in`) siguen «no ratificados»: aplicarlos exige confirmación explícita de una persona (HOMOLOG_ACK).
import { createHash, randomBytes } from 'node:crypto';
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { labDdlStatements } from '../pricesmart-api06a/ddl.mjs';
import { securityDdlStatements, attestationDdlStatements } from '../pricesmart-api11/ddl.mjs';
import { api12DdlStatements, api13DdlStatements } from '../pricesmart-demo/demo.mjs';

export const HOMOLOG_ACK = 'CONFIRMO-APROVISIONAR-SANDBOX-HOMOLOGACION-AISLADO';
export const HOMOLOG_DESTROY_ACK = 'CONFIRMO-DESTRUIR-SANDBOX-HOMOLOGACION-AISLADO';
export const ACCOUNT_HOST = '127.0.0.1';
const N_RE = /^[a-z0-9]{1,16}$/;
const q = (id) => `\`${id}\``;
const fail = (m) => { throw new Error(m); };

/** Nombres derivados de `n` (1–16 caracteres [a-z0-9]). El prefijo `homolog` contiene letras NO hexadecimales: un nombre de laboratorio (`sandbox_api02_<hex>`) jamás coincide. */
export function homologNames(n) {
  if (typeof n !== 'string' || !N_RE.test(n)) fail('INVALID_SANDBOX_NAME');
  const schema = `sandbox_api02_homolog_${n}`;
  return Object.freeze({ n, sandboxId: `homolog-${n}`, schema, appUser: schema, workerUser: `sandbox_api02_homolog_w${n}`, monitorUser: `sandbox_api02_homolog_m${n}` });
}

// ---- Privilegios por rol (mínimos, tabla/columna). `app` = cuenta de la aplicación (puertos PriceSmart + vinculación al TMS); `worker` = consumidor de la outbox; `monitor` = solo lectura de contadores.
// Ni DELETE, ni DDL, ni GRANT OPTION, ni privilegios globales. La política PriceSmart se compara contra `RUNTIME_PRIVILEGE_POLICY` por una prueba de deriva (src/.../homologation-provisioning.test.ts).
export const ROLE_POLICY = Object.freeze({
  app: Object.freeze({
    novalvion_environment: ['SELECT'],
    ps_api01_orders: ['SELECT', 'INSERT', 'UPDATE(state,version,cancellation_hash,cancellation_reason,cancellation_receipt_json)'],
    ps_api01_events: ['SELECT', 'INSERT'], ps_api01_outbox: ['INSERT'], ps_api01_audit: ['INSERT'],
    ps_api11_integrations: ['SELECT'], ps_api11_revocations: ['SELECT'], ps_api11_rate_counters: ['SELECT', 'INSERT', 'UPDATE(used)'], ps_api11_proof_claims: ['SELECT', 'INSERT'],
    ps_api18_attestation_nonces: ['SELECT', 'INSERT'], ps_api18_resource_registry: ['SELECT'],
    // Vinculación al TMS (API-12/13): mapeo de solo lectura; vínculo y cola con columnas mutables acotadas; bitácora solo INSERT.
    ps_api12_tms_mapping: ['SELECT'],
    ps_api12_tms_links: ['SELECT', 'INSERT', 'UPDATE(solicitud_id,linked_at,cancellation_requested_at)'],
    ps_api13_link_jobs: ['SELECT', 'INSERT', 'UPDATE(empresa_id,status,attempts,next_attempt_at,lease_owner,lease_until,last_outcome,last_detail,ack_by,ack_at,updated_at)'],
    ps_api13_link_attempts: ['SELECT', 'INSERT'],
    // TMS: alta de la solicitud (crearSolicitudCliente) y lectura del estado (GET); la auditoría es solo INSERT.
    tms_solicitudes_cliente: ['SELECT', 'INSERT'], tms_solicitud_paradas: ['SELECT', 'INSERT'], tms_cliente_ubicaciones: ['SELECT'],
    tms_planes_viaje: ['SELECT'], tms_plan_paradas: ['SELECT'], tms_parada_confirmaciones: ['SELECT'], auditoria: ['INSERT'],
  }),
  worker: Object.freeze({
    novalvion_environment: ['SELECT'],
    ps_api01_outbox: ['SELECT', 'UPDATE(status,attempts,next_attempt_at,lease_until)'],
    ps_api01_events: ['SELECT(environment,tenant_id,client_id,integration_id,order_id,order_version,event_type,reason,correlation_id)'],
    ps_api01_orders: ['SELECT(environment,tenant_id,client_id,integration_id,id,origin_club_reference)'],
  }),
  monitor: Object.freeze({
    novalvion_environment: ['SELECT'],
    ps_api01_outbox: ['SELECT(status,attempts,next_attempt_at,lease_until)'],
    ps_api13_link_jobs: ['SELECT(status,attempts,next_attempt_at,lease_until,updated_at)'],
    ps_api11_rate_counters: ['SELECT(window_start_ms,used)'], ps_api11_revocations: ['SELECT(revoked_at_ms)'],
  }),
});
const ROLE_USER = { app: 'appUser', worker: 'workerUser', monitor: 'monitorUser' };
/** Tablas del TMS que el proyecto crea EN TIEMPO DE EJECUCIÓN (`asegurarSchemaFlota`/`asegurarSchemaEmpleados`), no con archivos SQL: sus privilegios se conceden DESPUÉS del paso de esquema de ejecución. */
export const ENSURED_TABLES = Object.freeze(['tms_plan_paradas', 'tms_parada_confirmaciones']);

/** GRANT por rol. Las columnas van en una sentencia por tabla y privilegio; los privilegios de tabla completa se agrupan. */
export function grantStatements(names, role, phase = 'all') {
  if (!['all', 'core', 'ensured'].includes(phase)) fail('INVALID_PHASE');
  const policy = Object.fromEntries(Object.entries(ROLE_POLICY[role] ?? fail('INVALID_ROLE')).filter(([table]) => phase === 'all' || (phase === 'ensured') === ENSURED_TABLES.includes(table)));
  const account = `${q(names[ROLE_USER[role]])}@${q(ACCOUNT_HOST)}`; const out = [];
  for (const [table, specs] of Object.entries(policy)) {
    const plain = [];
    for (const spec of specs) {
      const m = /^([A-Z]+)(?:\(([a-z0-9_,]+)\))?$/.exec(spec) ?? fail('INVALID_POLICY');
      if (m[2] === undefined) plain.push(m[1]); else out.push(`GRANT ${m[1]} (${m[2].split(',').map(q).join(', ')}) ON ${q(names.schema)}.${q(table)} TO ${account}`);
    }
    if (plain.length) out.unshift(`GRANT ${plain.join(', ')} ON ${q(names.schema)}.${q(table)} TO ${account}`);
  }
  return out;
}

/** CREATE USER con la contraseña tomada de una VARIABLE DE SESIÓN (nunca en el texto del paquete). */
const createUser = (names, role, variable) => [
  `SET @ps_sql = CONCAT('CREATE USER ${q(names[ROLE_USER[role]])}@${q(ACCOUNT_HOST)} IDENTIFIED BY ', QUOTE(${variable}))`, 'PREPARE ps_stmt FROM @ps_sql', 'EXECUTE ps_stmt', 'DEALLOCATE PREPARE ps_stmt', 'SET @ps_sql = NULL',
];

const read = (repo, rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
/** Archivos SQL del TMS que arma el sandbox (mismo orden que el arnés `portal-e2e`). Se aplican sentencia por sentencia con reintentos; NO forman parte del texto del paquete. */
export function tmsSchemaFiles(repo) {
  const migrations = fs.readdirSync(path.join(repo, 'sql')).filter((f) => /^migrate-2026-.*\.sql$/.test(f) && !f.includes('tms-parada-confirmaciones')).sort().map((f) => `sql/${f}`);
  return ['sql/schema.sql', 'sql/migrate-2026-08-rrhh-colaborador-auth.sql', ...migrations.filter((f) => f !== 'sql/migrate-2026-08-rrhh-colaborador-auth.sql'), 'sql/migrate-2026-11-tms-parada-confirmaciones.sql'];
}

/** Paquete SQL completo (texto): base, entorno, DDL de PriceSmart, cuentas y privilegios. Falla si la base ya existe (CREATE DATABASE sin IF NOT EXISTS). */
export function buildBootstrap(n, repo) {
  const names = homologNames(n);
  const ddl = [
    ...labDdlStatements(read(repo, 'docs/integraciones/pricesmart/api01/staging.sql.in')), ...securityDdlStatements(read(repo, 'docs/integraciones/pricesmart/api11/staging-security.sql.in')),
    ...attestationDdlStatements(read(repo, 'docs/integraciones/pricesmart/api18/staging-attestation.sql.in')),
    ...api12DdlStatements(read(repo, 'docs/integraciones/pricesmart/api12/staging-tms-link.sql.in')), ...api13DdlStatements(read(repo, 'docs/integraciones/pricesmart/api13/staging-link-retry.sql.in')),
  ];
  const head = [
    `CREATE DATABASE ${q(names.schema)} CHARACTER SET utf8mb4`, `USE ${q(names.schema)}`,
    "CREATE TABLE novalvion_environment (id TINYINT NOT NULL PRIMARY KEY CHECK (id = 1), environment VARCHAR(16) NOT NULL CHECK (environment = 'sandbox'), sandbox_id VARCHAR(48) NOT NULL) ENGINE=InnoDB",
    `INSERT INTO novalvion_environment (id, environment, sandbox_id) VALUES (1, 'sandbox', '${names.sandboxId}')`,
  ];
  const accounts = [...createUser(names, 'app', '@ps_app_pw'), ...createUser(names, 'worker', '@ps_worker_pw'), ...createUser(names, 'monitor', '@ps_monitor_pw')];
  const grants = { app: grantStatements(names, 'app', 'core'), worker: grantStatements(names, 'worker', 'core'), monitor: grantStatements(names, 'monitor', 'core') };
  const ensuredGrants = { app: grantStatements(names, 'app', 'ensured'), worker: grantStatements(names, 'worker', 'ensured'), monitor: grantStatements(names, 'monitor', 'ensured') };
  return Object.freeze({ names, head, ddl, accounts, grants, ensuredGrants, passwordVariables: ['@ps_app_pw', '@ps_worker_pw', '@ps_monitor_pw'] });
}

/** Texto único para revisión (sin contraseñas: solo las variables de sesión que las reemplazan). */
export function renderBootstrapSql(bundle) {
  const all = [...bundle.head, ...bundle.ddl, ...bundle.accounts, ...bundle.grants.app, ...bundle.grants.worker, ...bundle.grants.monitor, '-- Tras el esquema de ejecución del proyecto (tablas creadas en tiempo de ejecución):', ...bundle.ensuredGrants.app, ...bundle.ensuredGrants.worker, ...bundle.ensuredGrants.monitor];
  return [`-- PRICESMART API-26 — aprovisionamiento del sandbox ${bundle.names.sandboxId}. PARA REVISIÓN. Las contraseñas llegan como variables de sesión (${bundle.passwordVariables.join(', ')}); no están en este texto.`,
    '-- Se ejecuta SOLO por una persona, en el host del sandbox, tras confirmar HOMOLOG_ACK. Falla si la base ya existe.', ...all.map((s) => `${s};`)].join('\n');
}

// ---- Barreras del ejecutor.
const SECRET_RE = /^[A-Za-z0-9_\-+=/.:]{24,128}$/;
/** El ejecutor solo opera sobre loopback, con confirmación explícita, sin indicios de producción y con credenciales distintas entre sí. */
export function assertApplyTarget({ host, port, env, secrets, ack, expectedAck = HOMOLOG_ACK }) {
  if (host !== '127.0.0.1' && host !== '::1') fail('TARGET_NOT_LOOPBACK');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('INVALID_PORT');
  if (ack !== expectedAck) fail('ACK_MISSING');
  if (env?.NOVALVION_ENV === 'production' || env?.NODE_ENV === 'production' || env?.PRICESMART_RUNTIME_ENVIRONMENT === 'production') fail('PRODUCTION_MARKERS_PRESENT');
  if (env?.PRICESMART_LAB_DEMO !== undefined || env?.PRICESMART_LAB_KEY !== undefined) fail('LAB_COMPOSITION_FLAGS_PRESENT');   // el verificador de laboratorio no convive con un sandbox externo
  if (secrets) {
    const values = Object.values(secrets); if (values.some((v) => typeof v !== 'string' || !SECRET_RE.test(v)) || new Set(values).size !== values.length) fail('WEAK_OR_REUSED_SECRETS');
  }
  return true;
}

/** Divisor del esquema del TMS (mismo criterio que el arnés `portal-e2e`): quita comentarios de línea y separa en `;` + salto de línea. Los .sql del proyecto no usan DELIMITER ni rutinas. */
const tmsStatements = (text) => text.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n').split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean);

/** Aplica un archivo .sql del TMS sentencia por sentencia con reintentos (dependencias no lineales). Devuelve lo que no se pudo crear. */
export async function applySchemaFiles(conn, repo, files) {
  const report = [];
  for (const file of files) {
    let pending = tmsStatements(read(repo, file)); let ok = 0; const last = new Map();
    for (let pass = 0; pass < 6 && pending.length; pass++) {
      const next = [];
      for (const sql of pending) { try { await conn.query(sql); ok++; } catch (e) { next.push(sql); last.set(sql, String(e.code ?? e.message).slice(0, 60)); } }
      if (next.length === pending.length && pass > 0) { pending = next; break; } pending = next;
    }
    report.push({ file, applied: ok, pendingAtEnd: pending.length, errors: pending.slice(0, 3).map((s) => `${s.slice(0, 50)} => ${last.get(s)}`) });
  }
  return report;
}

/** Ejecuta el paquete con una conexión YA abierta (la abre quien llama: TCP a loopback o, en el laboratorio, el pipe administrativo). No imprime contraseñas. */
export async function executeBundle(conn, bundle, secrets, options = {}) {
  const pw = { '@ps_app_pw': secrets.app, '@ps_worker_pw': secrets.worker, '@ps_monitor_pw': secrets.monitor };
  assertApplyTarget({ host: '127.0.0.1', port: 3306, ack: HOMOLOG_ACK, secrets: { ...secrets } });   // misma validación de secretos (ack ya confirmado por quien llama)
  for (const s of bundle.head) await conn.query(s);
  // El DDL de PriceSmart referencia tablas del TMS (FK): el esquema del TMS se aplica ANTES (mismos archivos y orden que el arnés). `options.tms = { repo, files }`.
  const tmsSchema = options.tms ? await applySchemaFiles(conn, options.tms.repo, options.tms.files) : null;
  for (const s of bundle.ddl) await conn.query(s);
  for (const [variable, value] of Object.entries(pw)) await conn.query(`SET ${variable} = ?`, [value]);
  for (const s of bundle.accounts) await conn.query(s);
  for (const variable of Object.keys(pw)) await conn.query(`SET ${variable} = NULL`);
  for (const role of ['app', 'worker', 'monitor']) for (const s of bundle.grants[role]) await conn.query(s);
  return { schema: bundle.names.schema, accounts: [bundle.names.appUser, bundle.names.workerUser, bundle.names.monitorUser], tables: bundle.ddl.length, tmsSchema: tmsSchema?.map(({ file, applied, pendingAtEnd }) => ({ file, applied, pendingAtEnd })) ?? null };
}

/** Privilegios TEMPORALES del paso de «esquema de ejecución» (el código del proyecto crea tablas con la cuenta de la aplicación): se conceden, se ejecuta el paso y se REVOCAN; los privilegios por tabla/columna no se tocan. */
export function temporaryEnsureStatements(names) {
  const account = `${q(names.appUser)}@${q(ACCOUNT_HOST)}`;
  return { grant: `GRANT ALL PRIVILEGES ON ${q(names.schema)}.* TO ${account}`, revoke: `REVOKE ALL PRIVILEGES ON ${q(names.schema)}.* FROM ${account}` };
}
/** Concede, tras el esquema de ejecución, los privilegios sobre las tablas creadas en tiempo de ejecución. Falla si alguna no existe (el paso previo no se hizo). */
export async function applyEnsuredGrants(conn, bundle) {
  for (const role of ['app', 'worker', 'monitor']) for (const s of bundle.ensuredGrants[role]) await conn.query(s);
  return bundle.ensuredGrants.app.length + bundle.ensuredGrants.worker.length + bundle.ensuredGrants.monitor.length;
}

/**
 * Segunda parte del aprovisionamiento: «esquema de ejecución» del proyecto (tablas que el código crea en tiempo de ejecución) con EL MISMO entorno que tendrá el sandbox (validateSandboxConfig lo valida) y la cuenta de la
 * aplicación con privilegios TEMPORALES (siempre revocados, también si el paso falla); después la migración de confirmaciones y los privilegios restantes. `o`: { repo, sandboxRoot, sandboxSecrets, dbPort, extraEnv }.
 */
export async function finalizeBundle(conn, bundle, o) {
  const { names } = bundle; const { repo, sandboxRoot, sandboxSecrets, dbPort } = o;
  if (!fs.existsSync(path.join(sandboxRoot, 'isolation.json'))) fail('MANIFEST_MISSING');
  const sysRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT; const tmpDir = o.tmpDir ?? process.env.TEMP ?? '/tmp';
  const env = { ...(sysRoot ? { SystemRoot: sysRoot, WINDIR: sysRoot } : {}), TEMP: tmpDir, TMP: tmpDir, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`, NODE_ENV: 'test', NOVALVION_ENV: 'sandbox', SANDBOX_ID: names.sandboxId, SANDBOX_ROOT: sandboxRoot,
    NEXT_TELEMETRY_DISABLED: '1', DB_HOST: '127.0.0.1', DB_PORT: String(dbPort), DB_NAME: names.schema, DB_USER: names.appUser, ...sandboxSecrets, CB2_PUBLIC_ORIGIN: 'https://localhost', EMPRESA_DOMINIOS: '{"localhost":"kt-monaco"}', UPLOAD_DIR: path.join(sandboxRoot, 'uploads') };
  const tmp = temporaryEnsureStatements(names); const report = {};
  await conn.query(tmp.grant);
  try {
    const run = cp.spawnSync(process.execPath, [path.join(repo, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', path.join(repo, 'scripts', 'ci', 'portal-e2e', 'vitest.e2e.config.mts'), 'scripts/ci/portal-e2e/ensure.e2e.ts'], { cwd: repo, env, windowsHide: true, encoding: 'utf8', timeout: 300000 });
    report.runtimeSchemaStep = { exit: run.status, tail: [run.stdout ?? '', run.stderr ?? ''].join('\n').split('\n').filter((l) => l.trim()).slice(-4).join(' | ').slice(0, 400) };
  } finally { await conn.query(tmp.revoke); }   // los privilegios temporales NUNCA quedan, ni siquiera si el paso falla
  if (report.runtimeSchemaStep.exit !== 0) fail(`RUNTIME_SCHEMA_STEP_FAILED: ${report.runtimeSchemaStep.tail}`);
  await conn.query(`USE ${q(names.schema)}`); await applySchemaFiles(conn, repo, ['sql/migrate-2026-11-tms-parada-confirmaciones.sql']);
  report.ensuredGrants = await applyEnsuredGrants(conn, bundle);
  return report;
}

/** Baja de un sandbox: SOLO nombres `sandbox_api02_homolog_*` y sus tres cuentas. */
export function destroyStatements(n) {
  const names = homologNames(n);
  return [`DROP USER IF EXISTS ${q(names.appUser)}@${q(ACCOUNT_HOST)}`, `DROP USER IF EXISTS ${q(names.workerUser)}@${q(ACCOUNT_HOST)}`, `DROP USER IF EXISTS ${q(names.monitorUser)}@${q(ACCOUNT_HOST)}`, `DROP DATABASE IF EXISTS ${q(names.schema)}`];
}

// ---- Revocación y alta de credenciales de integración (las ejecuta la cuenta ADMINISTRATIVA: el runtime solo lee el catálogo).
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
/** Revoca una credencial: el motor M2M lee las revocaciones en CADA solicitud, así que surte efecto de inmediato (sin reinicio). */
export function revokeStatement(ids) {
  const { issuer, subject, credentialReference } = ids ?? {};
  if (![issuer, subject, credentialReference].every((v) => typeof v === 'string' && REF_RE.test(v))) fail('INVALID_CREDENTIAL_REFERENCE');
  return { sql: 'INSERT INTO ps_api11_revocations (issuer, subject, credential_reference, revision, revoked_at_ms) VALUES (?, ?, ?, 0, ?)', params: [Buffer.from(issuer), Buffer.from(subject), Buffer.from(credentialReference), Date.now()] };
}
/** Alta de una integración: TODOS los valores los aporta la persona que opera (no hay valores por omisión atribuibles a PriceSmart). Los alcances y clubes son listas cerradas. */
export function registerIntegrationStatement(input) {
  const { issuer, subject, credentialReference, tenantId, clientId, integrationId, allowedClubs, scopes, validFromMs, validUntilMs } = input ?? {};
  const SCOPES = ['orders:create', 'orders:read', 'orders:cancel'];
  if (![issuer, subject, credentialReference, integrationId].every((v) => typeof v === 'string' && REF_RE.test(v))) fail('INVALID_CREDENTIAL_REFERENCE');
  if (![tenantId, clientId].every((v) => Number.isSafeInteger(v) && v > 0)) fail('INVALID_SCOPE');
  if (!Array.isArray(scopes) || !scopes.length || scopes.some((s) => !SCOPES.includes(s)) || new Set(scopes).size !== scopes.length) fail('INVALID_SCOPES');
  if (!Array.isArray(allowedClubs) || !allowedClubs.length || allowedClubs.some((c) => typeof c !== 'string' || !REF_RE.test(c))) fail('INVALID_CLUBS');
  if (![validFromMs, validUntilMs].every(Number.isSafeInteger) || validUntilMs <= validFromMs || validUntilMs - validFromMs > 400 * 86400000) fail('INVALID_VALIDITY');   // vigencia acotada: sin credenciales eternas
  return { sql: "INSERT INTO ps_api11_integrations (issuer, subject, credential_reference, environment, tenant_id, client_id, integration_id, revision, status, valid_from_ms, valid_until_ms, credential_valid_from_ms, credential_valid_until_ms, rotated_at_ms, allowed_clubs_json, scopes_json) VALUES (?, ?, ?, _binary'sandbox', ?, ?, ?, 1, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?)",
    params: [Buffer.from(issuer), Buffer.from(subject), Buffer.from(credentialReference), tenantId, clientId, Buffer.from(integrationId), validFromMs, validUntilMs, validFromMs, validUntilMs, validFromMs, JSON.stringify(allowedClubs), JSON.stringify(scopes)] };
}

// ---- Monitoreo: SOLO lectura, con la cuenta `monitor` (columnas acotadas).
export const MONITORING_QUERIES = Object.freeze({
  outbox_pending: "SELECT COUNT(*) AS n, COALESCE(TIMESTAMPDIFF(SECOND, MIN(next_attempt_at), UTC_TIMESTAMP(6)), 0) AS oldest_due_seconds FROM ps_api01_outbox WHERE status = 'PENDING' AND next_attempt_at <= UTC_TIMESTAMP(6)",
  outbox_leased_expired: "SELECT COUNT(*) AS n FROM ps_api01_outbox WHERE status = 'LEASED' AND lease_until <= UTC_TIMESTAMP(6)",
  outbox_review: "SELECT COUNT(*) AS n FROM ps_api01_outbox WHERE status = 'REVIEW'",
  link_jobs_blocked: "SELECT COUNT(*) AS n FROM ps_api13_link_jobs WHERE status IN ('BLOCKED','EXHAUSTED')",
  link_jobs_retrying: "SELECT COUNT(*) AS n FROM ps_api13_link_jobs WHERE status = 'PENDING' AND attempts > 0",
  quota_peak: 'SELECT COALESCE(MAX(used), 0) AS max_used FROM ps_api11_rate_counters WHERE window_start_ms >= ?',
  revocations: 'SELECT COUNT(*) AS n FROM ps_api11_revocations',
});
/** Umbrales de alerta (valores acotados y revisables): cualquier fila que los supere debe avisar a una persona. */
export const ALERT_RULES = Object.freeze([
  { id: 'outbox_stuck', query: 'outbox_pending', field: 'oldest_due_seconds', above: 300 }, { id: 'outbox_leases_expired', query: 'outbox_leased_expired', field: 'n', above: 0 },
  { id: 'outbox_review', query: 'outbox_review', field: 'n', above: 0 }, { id: 'link_blocked', query: 'link_jobs_blocked', field: 'n', above: 0 },
]);

// ---- Proxy inverso HTTPS (plantilla). Solo se exponen las TRES rutas de la integración; todo lo demás responde 404 en el borde.
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const PATH_RE = /^\/[A-Za-z0-9._\/-]{3,200}$/;
const octetsOk = (c) => !/^\d/.test(c) || c.split('/')[0].split('.').every((o) => Number(o) <= 255);
const CIDR_RE = /^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:[0-9]|[12]\d|3[0-2]))?|[0-9a-f:]{2,39}(?:\/(?:[0-9]|[1-9]\d|1[01]\d|12[0-8]))?)$/i;
export function renderNginx(o) {
  const { publicHostname, certPath, keyPath, allowlist, appPort = 3100, ratePerSecond = 20, burst = 40 } = o ?? {};
  if (typeof publicHostname !== 'string' || !HOST_RE.test(publicHostname)) fail('INVALID_HOSTNAME');
  if (![certPath, keyPath].every((p) => typeof p === 'string' && PATH_RE.test(p))) fail('INVALID_TLS_PATH');
  if (!Array.isArray(allowlist) || !allowlist.length || allowlist.length > 32 || allowlist.some((c) => typeof c !== 'string' || !CIDR_RE.test(c) || !octetsOk(c) || c === '0.0.0.0/0' || c === '::/0' || /^0\.0\.0\.0/.test(c))) fail('INVALID_ALLOWLIST');
  if (![appPort, ratePerSecond, burst].every(Number.isInteger) || appPort < 1024 || appPort > 65535 || ratePerSecond < 1 || ratePerSecond > 200 || burst < 1 || burst > 400) fail('INVALID_LIMITS');
  const api = '/api/integrations/pricesmart/v1/orders';
  return [`# PRICESMART API-26 — proxy inverso del sandbox de homologación (PLANTILLA para revisión; no se instala desde este repositorio).`,
    `limit_req_zone $binary_remote_addr zone=ps_sandbox:10m rate=${ratePerSecond}r/s;`, 'server_tokens off;',
    'server {', '  listen 80;', `  server_name ${publicHostname};`, '  return 301 https://$host$request_uri;', '}',
    'server {', '  listen 443 ssl;', `  server_name ${publicHostname};`, `  ssl_certificate ${certPath};`, `  ssl_certificate_key ${keyPath};`,
    '  ssl_protocols TLSv1.2 TLSv1.3;', '  ssl_prefer_server_ciphers off;', '  add_header Strict-Transport-Security "max-age=31536000" always;', '  add_header X-Content-Type-Options "nosniff" always;',
    '  client_max_body_size 8k;', '  client_body_timeout 10s;', '  client_header_timeout 10s;', '  keepalive_timeout 15s;', '  access_log /var/log/nginx/pricesmart-sandbox.access.log;   # el formato por omisión no registra cuerpos ni cabeceras',
    '  # Allowlist de red: solo los orígenes acordados con PriceSmart.', ...allowlist.map((c) => `  allow ${c};`), '  deny all;',
    `  location = ${api} {`, '    limit_req zone=ps_sandbox burst=' + burst + ' nodelay;', '    limit_except POST { deny all; }', `    proxy_pass http://127.0.0.1:${appPort};`, '    include /etc/nginx/pricesmart-sandbox-proxy.conf;', '  }',
    `  location ~ ^${api}/[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$ {`, '    limit_req zone=ps_sandbox burst=' + burst + ' nodelay;', '    limit_except GET { deny all; }', `    proxy_pass http://127.0.0.1:${appPort};`, '    include /etc/nginx/pricesmart-sandbox-proxy.conf;', '  }',
    `  location ~ ^${api}/[A-Za-z0-9][A-Za-z0-9._:-]{0,119}/cancellation-requests$ {`, '    limit_req zone=ps_sandbox burst=' + burst + ' nodelay;', '    limit_except POST { deny all; }', `    proxy_pass http://127.0.0.1:${appPort};`, '    include /etc/nginx/pricesmart-sandbox-proxy.conf;', '  }',
    '  location / { return 404; }', '}'].join('\n');
}
/** Cabeceras comunes del proxy: elimina cualquier cabecera de laboratorio y fija el origen real. */
export const NGINX_PROXY_INCLUDE = ['proxy_http_version 1.1;', 'proxy_set_header Host 127.0.0.1;', 'proxy_set_header X-Real-IP $remote_addr;', 'proxy_set_header X-Forwarded-For $remote_addr;', 'proxy_set_header x-lab-evidence "";', 'proxy_set_header Connection "";', 'proxy_read_timeout 25s;', 'proxy_connect_timeout 5s;'].join('\n');

/** Unidad systemd de la aplicación (loopback, usuario sin privilegios, secretos en un EnvironmentFile FUERA del repositorio). */
export function renderSystemd(o) {
  const { root = '/opt/pricesmart-sandbox', envFile = '/etc/pricesmart-sandbox/runtime.env', user = 'pricesmart-sandbox', appPort = 3100 } = o ?? {};
  if (![root, envFile].every((p) => typeof p === 'string' && PATH_RE.test(p)) || !/^[a-z][a-z0-9_-]{1,31}$/.test(user) || !Number.isInteger(appPort) || appPort < 1024 || appPort > 65535) fail('INVALID_SYSTEMD_OPTIONS');
  return ['# PRICESMART API-26 — unidad de la aplicación del sandbox (PLANTILLA para revisión).', '[Unit]', 'Description=PriceSmart sandbox de homologacion (aislado)', 'After=network.target mariadb.service', 'Requires=mariadb.service', '',
    '[Service]', `User=${user}`, `WorkingDirectory=${root}/app`, `EnvironmentFile=${envFile}`, `ExecStart=/usr/bin/node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${appPort}`, 'Restart=on-failure', 'RestartSec=5',
    'NoNewPrivileges=true', 'ProtectSystem=strict', 'ProtectHome=true', 'PrivateTmp=true', `ReadWritePaths=${root}/uploads`, 'PrivateDevices=true', 'RestrictAddressFamilies=AF_INET AF_UNIX', 'MemoryMax=1G', '', '[Install]', 'WantedBy=multi-user.target'].join('\n');
}

/** Variables de entorno del sandbox: SOLO marcadores. El modo del runtime nace DISABLED y ninguna decisión figura como ratificada. */
export function renderEnvTemplate(names, o = {}) {
  const { root = '/opt/pricesmart-sandbox', dbPort = 3306, originClub = '<CLUB-SINTETICO>' } = o;
  if (typeof root !== 'string' || !PATH_RE.test(root) || !Number.isInteger(dbPort) || dbPort < 1024 || dbPort > 65535) fail('INVALID_ENV_OPTIONS');
  return [`# PRICESMART API-26 — plantilla de entorno del sandbox ${names.sandboxId}. Copiar a ${root}/../etc (FUERA del repositorio, permisos 0600). Los valores <...> los genera el operador en el host; NUNCA se versionan.`,
    'NOVALVION_ENV=sandbox', `SANDBOX_ID=${names.sandboxId}`, `SANDBOX_ROOT=${root}/sandbox`, 'NEXT_TELEMETRY_DISABLED=1', 'DB_HOST=127.0.0.1', `DB_PORT=${dbPort}`, `DB_NAME=${names.schema}`, `DB_USER=${names.appUser}`,
    'DB_PASSWORD=<sandbox:ID:64hex — generado por `provision.mjs init-secrets`>', 'AUTH_SECRET=<ídem>', 'PORTAL_CREDENTIALS_KEY=<ídem>', 'CB2_PUBLIC_ORIGIN=https://localhost', 'EMPRESA_DOMINIOS={"localhost":"kt-monaco"}', `UPLOAD_DIR=${root}/sandbox/uploads`,
    `PS_HOMOLOG_WORKER_USER=${names.workerUser}`, 'PS_HOMOLOG_WORKER_PASSWORD=<generada por el operador>', `PS_HOMOLOG_KILLSWITCH_FILE=${root}/sandbox/killswitch`,
    '# Runtime PriceSmart: APAGADO por omisión. Solo se enciende con las decisiones ratificadas por PriceSmart, un verificador aprobado (D02) y un adaptador KMS revisado.',
    'PRICESMART_RUNTIME_MODE=DISABLED', 'PRICESMART_RUNTIME_ENVIRONMENT=sandbox', `PRICESMART_ORIGIN_CLUB=${originClub}`, `PRICESMART_DB_SCHEMA=${names.schema}`, `PRICESMART_DB_RUNTIME_USER=${names.appUser}`, 'PRICESMART_RATIFIED_DECISIONS='].join('\n');
}

// ---- Secretos internos del sandbox (formato exigido por validateSandboxConfig). NO son credenciales de PriceSmart. Se generan en el host y nunca se imprimen.
export const generateSandboxSecrets = (names) => Object.fromEntries(['DB_PASSWORD', 'AUTH_SECRET', 'PORTAL_CREDENTIALS_KEY'].map((k) => [k, `sandbox:${names.sandboxId}:${randomBytes(32).toString('hex')}`]));
/** Manifiesto de aislamiento (`isolation.json`) que valida `validateSandboxConfig`; guarda solo los hashes de los secretos. */
export function buildIsolationManifest(names, secrets, o = {}) {
  const { dbPort = 3306, origin = 'https://localhost' } = o;
  return { environment: 'sandbox', id: names.sandboxId, origin, database: { DB_HOST: '127.0.0.1', DB_PORT: String(dbPort), DB_NAME: names.schema, DB_USER: names.appUser },
    secretSha256: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, createHash('sha256').update(v).digest('hex')])) };
}
