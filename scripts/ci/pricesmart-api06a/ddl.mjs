// PRICESMART-API-06A — DDL del laboratorio derivado de docs/integraciones/pricesmart/api01/staging.sql.in. PURO: no lee ni escribe archivos, no se conecta.
// El original NO se modifica. La única diferencia es retirar la sentencia SIGNAL de bloqueo (ver DDL-DIFF.md y ddl.test.ts).
import { HOST, LAB_SCOPES } from './constants.mjs';
import { fail } from './safety.mjs';

export const SIGNAL_LINE = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'API01_UNRATIFIED_DESIGN_DO_NOT_EXECUTE';";
export const LAB_NOTE = '-- [LAB API-06A] SIGNAL de bloqueo retirada SOLO en esta copia de laboratorio; staging.sql.in no se modifica.';
export const TABLES = Object.freeze(['ps_api01_scopes', 'ps_api01_orders', 'ps_api01_events', 'ps_api01_outbox', 'ps_api01_audit']);

const lf = (text) => String(text).replace(/\r\n/g, '\n');

export function deriveLabDdl(stagingText) {
  const text = lf(stagingText);
  const first = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))[0];
  if (first !== SIGNAL_LINE) fail('La primera sentencia de staging.sql.in no es el SIGNAL de bloqueo esperado.');
  if (text.split(SIGNAL_LINE).length !== 2) fail('SIGNAL de bloqueo ausente o repetido.');
  const derived = text.replace(`${SIGNAL_LINE}\n`, `${LAB_NOTE}\n`);
  if (derived === text) fail('No se pudo derivar el DDL de laboratorio.');
  return derived;
}

/** Divide en sentencias (el DDL no usa DELIMITER, rutinas ni ';' dentro de literales: se verifica). */
export function splitStatements(sql) {
  const body = lf(sql).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  if (/DELIMITER/i.test(body)) fail('El DDL contiene DELIMITER.');
  const out = body.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
  if (out.some((s) => s.includes(';'))) fail("Hay ';' dentro de una sentencia; el divisor no es seguro.");
  return out;
}

export function labDdlStatements(stagingText) {
  const statements = splitStatements(deriveLabDdl(stagingText));
  const creates = statements.filter((s) => /^CREATE TABLE /i.test(s));
  if (statements.length !== 5 || creates.length !== 5) fail('Se esperaban exactamente 5 CREATE TABLE.');
  TABLES.forEach((table, i) => { if (!creates[i].startsWith(`CREATE TABLE ${table} (`)) fail(`Orden/nombre de tabla inesperado: ${table}`); });
  if (statements.some((s) => /\b(DROP|TRUNCATE|ALTER|DELETE|GRANT|USE|SIGNAL|CREATE (DATABASE|USER))\b/i.test(s))) fail('El DDL contiene sentencias no permitidas.');
  return statements;
}

// ---- API-09: DDL de diseño de la adaptación durable (docs/integraciones/pricesmart/api09/staging.sql.in). Misma derivación que API-01: solo se retira el SIGNAL de bloqueo.
export const ADAPT_SIGNAL_LINE = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'API09_UNRATIFIED_DESIGN_DO_NOT_EXECUTE';";
export const ADAPT_LAB_NOTE = '-- [LAB API-09] SIGNAL de bloqueo retirada SOLO en esta copia de laboratorio; api09/staging.sql.in no se modifica.';
export const ADAPT_TABLES = Object.freeze(['ps_api09_adapt_jobs', 'ps_api09_adapt_links', 'ps_api09_adapt_traces']);
export function adaptationDdlStatements(adaptationText) {
  const text = lf(adaptationText);
  const first = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))[0];
  if (first !== ADAPT_SIGNAL_LINE || text.split(ADAPT_SIGNAL_LINE).length !== 2) fail('La primera sentencia de api09/staging.sql.in no es el SIGNAL de bloqueo esperado.');
  const statements = splitStatements(text.replace(`${ADAPT_SIGNAL_LINE}\n`, `${ADAPT_LAB_NOTE}\n`));
  if (statements.length !== 3 || statements.some((s) => !/^CREATE TABLE /i.test(s))) fail('Se esperaban exactamente 3 CREATE TABLE de adaptación.');
  ADAPT_TABLES.forEach((table, i) => { if (!statements[i].startsWith(`CREATE TABLE ${table} (`)) fail(`Orden/nombre de tabla inesperado: ${table}`); });
  if (statements.some((s) => /\b(DROP|TRUNCATE|ALTER|DELETE|GRANT|USE|SIGNAL|CREATE (DATABASE|USER))\b/i.test(s))) fail('El DDL de adaptación contiene sentencias no permitidas.');
  return statements;
}

const quote = (name) => {
  if (!/^[a-z0-9_.]+$/.test(name)) fail('Identificador inválido.');
  return `\`${name}\``;
};

/** Lista CERRADA de sentencias administrativas. Es el único SQL que `SqlGate` deja pasar (por igualdad exacta). */
// ---- TMS-ENTREGA-PILOTO-1 (B12): tablas mínimas del TMS (SOLO laboratorio; claves fieles a las reales) y la migración REAL propuesta, sin modificar.
export const TMS_FIXTURE_TABLES = Object.freeze(['tms_planes_viaje', 'tms_plan_paradas', 'tms_personal', 'tms_plan_pilotos_adicionales', 'flota_viajes', 'flota_viaje_evidencias', 'auditoria']);
export const TMS_MIGRATION_TABLE = 'tms_parada_confirmaciones';
const TMS_FORBIDDEN = /\b(DROP|TRUNCATE|ALTER|DELETE|GRANT|USE|SIGNAL|UPDATE|INSERT|CREATE (DATABASE|USER))\b/i;
export function tmsFixtureStatements(fixtureText) {
  const statements = splitStatements(fixtureText);
  if (statements.length !== TMS_FIXTURE_TABLES.length || statements.some((s) => !/^CREATE TABLE /i.test(s))) fail('Se esperaban exactamente las tablas de apoyo del TMS.');
  TMS_FIXTURE_TABLES.forEach((table, i) => { if (!statements[i].startsWith(`CREATE TABLE ${table} (`)) fail(`Orden/nombre de tabla de apoyo inesperado: ${table}`); });
  if (statements.some((s) => TMS_FORBIDDEN.test(s) || /REFERENCES/i.test(s))) fail('El DDL de apoyo del TMS contiene sentencias no permitidas.');
  return statements;
}
/** La migración propuesta debe ser UNA sola sentencia CREATE TABLE IF NOT EXISTS (las comillas «ON DELETE RESTRICT» de sus claves foráneas son legítimas). */
export function tmsMigrationStatements(migrationText) {
  const statements = splitStatements(migrationText);
  if (statements.length !== 1 || !statements[0].startsWith(`CREATE TABLE IF NOT EXISTS ${TMS_MIGRATION_TABLE} (`)) fail('La migración de confirmaciones debe ser una única sentencia CREATE TABLE.');
  if (TMS_FORBIDDEN.test(statements[0].replaceAll('ON DELETE RESTRICT', ''))) fail('La migración de confirmaciones contiene sentencias no permitidas.');
  if ((statements[0].match(/ON DELETE RESTRICT/g) ?? []).length !== 2) fail('La migración debe tener exactamente dos claves foráneas RESTRICT.');
  return statements;
}

/** @param {any} m @param {string} stagingText @param {string | null} [adaptationText] @param {{ fixtureText: string, migrationText: string } | null} [tms] */
export function adminStatements(m, stagingText, adaptationText = null, tms = null) {
  const schema = quote(m.schema); const account = `${quote(m.user)}@${quote(HOST)}`;
  for (const k of ['DB_PASSWORD', 'WORKER_PASSWORD']) if (!/^sandbox:[a-z0-9-]+:[a-f0-9]{64}$/.test(m.secrets[k])) fail('Forma de contraseña inválida.');
  const worker = `${quote(m.workerUser)}@${quote(HOST)}`;
  const app = tms === null ? null : `${quote(m.appUser)}@${quote(HOST)}`;
  if (tms !== null && !/^sandbox:[a-z0-9-]+:[a-f0-9]{64}$/.test(m.secrets.APP_PASSWORD)) fail('Forma de contraseña inválida.');
  const seeds = LAB_SCOPES.map((s) => {
    if (!/^[a-z0-9-]+$/.test(s.integrationId) || !Number.isSafeInteger(s.tenantId) || !Number.isSafeInteger(s.clientId)) fail('Alcance sintético inválido.');
    return `INSERT INTO ps_api01_scopes (environment, tenant_id, client_id, integration_id) VALUES (_binary'sandbox', ${s.tenantId}, ${s.clientId}, _binary'${s.integrationId}')`;
  });
  return [
    `CREATE DATABASE ${schema} CHARACTER SET utf8mb4`,
    `USE ${schema}`,
    "CREATE TABLE novalvion_environment (id TINYINT NOT NULL PRIMARY KEY CHECK (id = 1), environment VARCHAR(16) NOT NULL CHECK (environment = 'sandbox'), sandbox_id VARCHAR(48) NOT NULL) ENGINE=InnoDB",
    `INSERT INTO novalvion_environment (id, environment, sandbox_id) VALUES (1, 'sandbox', '${m.sandboxId}')`,
    ...labDdlStatements(stagingText),
    ...(adaptationText === null ? [] : adaptationDdlStatements(adaptationText)),
    ...(tms === null ? [] : [...tmsFixtureStatements(tms.fixtureText), ...tmsMigrationStatements(tms.migrationText)]),
    ...seeds,
    `CREATE USER ${account} IDENTIFIED BY '${m.secrets.DB_PASSWORD}'`,
    `GRANT SELECT ON ${schema}.novalvion_environment TO ${account}`,
    `GRANT SELECT, INSERT ON ${schema}.ps_api01_orders TO ${account}`,
    `GRANT UPDATE (state, version, cancellation_hash, cancellation_reason, cancellation_receipt_json) ON ${schema}.ps_api01_orders TO ${account}`,
    `GRANT SELECT, INSERT ON ${schema}.ps_api01_events TO ${account}`,
    `GRANT INSERT ON ${schema}.ps_api01_outbox TO ${account}`,
    `GRANT INSERT ON ${schema}.ps_api01_audit TO ${account}`,
    // API-07: cuenta de WORKER de la outbox (separada de la de ejecución). Mínimo para el almacén: leer la cola, y actualizar SOLO las 4 columnas de lease/estado/intentos;
    // leer SOLO las columnas de eventos/órdenes que necesita el JOIN (sin payload cifrado ni recibos). Sin INSERT/DELETE, sin DDL, sin GRANT OPTION.
    `CREATE USER ${worker} IDENTIFIED BY '${m.secrets.WORKER_PASSWORD}'`,
    `GRANT SELECT ON ${schema}.novalvion_environment TO ${worker}`,
    `GRANT SELECT, UPDATE (status, attempts, next_attempt_at, lease_until) ON ${schema}.ps_api01_outbox TO ${worker}`,
    `GRANT SELECT (environment, tenant_id, client_id, integration_id, order_id, order_version, event_type, reason, correlation_id) ON ${schema}.ps_api01_events TO ${worker}`,
    `GRANT SELECT (environment, tenant_id, client_id, integration_id, id, origin_club_reference) ON ${schema}.ps_api01_orders TO ${worker}`,
    ...(adaptationText === null ? [] : [
      // API-08: lectura de la orden para la adaptación = SOLO columnas no sensibles (sin payload cifrado, hash de entrada ni recibos). Se SUMAN a las del JOIN de la outbox.
      `GRANT SELECT (external_order_id, payload_version, state, version, correlation_id, cancellation_reason, received_at) ON ${schema}.ps_api01_orders TO ${worker}`,
      // API-09: diario de adaptación. Trabajos y vínculos: SELECT, INSERT y UPDATE de columnas mutables (no de la clave, el hash ni el alcance). Bitácora: SOLO INSERT. Sin DELETE.
      `GRANT SELECT, INSERT, UPDATE (version, attempt, status, lease_until_ms, result_json) ON ${schema}.ps_api09_adapt_jobs TO ${worker}`,
      `GRANT SELECT, INSERT, UPDATE (external_order_id, origin_club_reference, request_reference, version, source_version, source_state, local_delivery_state, cancellation_requested, correlation_id, link_json) ON ${schema}.ps_api09_adapt_links TO ${worker}`,
      `GRANT INSERT ON ${schema}.ps_api09_adapt_traces TO ${worker}`,
    ]),
    ...(tms === null ? [] : [
      // TMS-ENTREGA-PILOTO-1 (B12): cuenta de APLICACIÓN del laboratorio, deliberadamente MÁS ESTRICTA que la real sobre la tabla nueva: solo SELECT e INSERT.
      // Si el código necesitara UPDATE o DELETE sobre las confirmaciones, el laboratorio fallaría. Sobre las tablas de apoyo del TMS tiene lectura/escritura (las usa la aplicación real).
      `CREATE USER ${app} IDENTIFIED BY '${m.secrets.APP_PASSWORD}'`,
      `GRANT SELECT ON ${schema}.novalvion_environment TO ${app}`,
      ...['tms_planes_viaje', 'tms_plan_paradas', 'tms_personal', 'tms_plan_pilotos_adicionales', 'flota_viajes', 'flota_viaje_evidencias'].map((t) => `GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.${t} TO ${app}`),
      `GRANT SELECT, INSERT ON ${schema}.auditoria TO ${app}`,
      `GRANT SELECT, INSERT ON ${schema}.${TMS_MIGRATION_TABLE} TO ${app}`,
    ]),
  ];
}
