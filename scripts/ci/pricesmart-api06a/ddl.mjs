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

const quote = (name) => {
  if (!/^[a-z0-9_.]+$/.test(name)) fail('Identificador inválido.');
  return `\`${name}\``;
};

/** Lista CERRADA de sentencias administrativas. Es el único SQL que `SqlGate` deja pasar (por igualdad exacta). */
export function adminStatements(m, stagingText) {
  const schema = quote(m.schema); const account = `${quote(m.user)}@${quote(HOST)}`;
  if (!/^sandbox:[a-z0-9-]+:[a-f0-9]{64}$/.test(m.secrets.DB_PASSWORD)) fail('Forma de contraseña inválida.');
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
    ...seeds,
    `CREATE USER ${account} IDENTIFIED BY '${m.secrets.DB_PASSWORD}'`,
    `GRANT SELECT ON ${schema}.novalvion_environment TO ${account}`,
    `GRANT SELECT, INSERT ON ${schema}.ps_api01_orders TO ${account}`,
    `GRANT UPDATE (state, version, cancellation_hash, cancellation_reason, cancellation_receipt_json) ON ${schema}.ps_api01_orders TO ${account}`,
    `GRANT SELECT, INSERT ON ${schema}.ps_api01_events TO ${account}`,
    `GRANT INSERT ON ${schema}.ps_api01_outbox TO ${account}`,
    `GRANT INSERT ON ${schema}.ps_api01_audit TO ${account}`,
  ];
}
