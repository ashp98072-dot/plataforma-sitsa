// PRICESMART-API-11 — DDL y semillas del laboratorio B (puertos de seguridad M2M + endpoints). PURO. Reutiliza sin modificar el DDL de API-01/API-09 del laboratorio API-06A.
// Todo el contenido es SINTÉTICO: referencias opacas de laboratorio, sin secretos ni claves.
import { adminStatements, splitStatements } from '../pricesmart-api06a/ddl.mjs';
import { fail } from '../pricesmart-api06a/safety.mjs';
import crypto from 'node:crypto';

export const SEC_SIGNAL = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'API11_UNRATIFIED_DESIGN_DO_NOT_EXECUTE';";
export const SEC_TABLES = Object.freeze(['ps_api11_integrations', 'ps_api11_revocations', 'ps_api11_rate_counters', 'ps_api11_proof_claims']);
const lf = (t) => String(t).replace(/\r\n/g, '\n');
export const sha256Lf = (t) => crypto.createHash('sha256').update(lf(t), 'utf8').digest('hex');

export function securityDdlStatements(text) {
  const t = lf(text);
  const first = t.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))[0];
  if (first !== SEC_SIGNAL || t.split(SEC_SIGNAL).length !== 2) fail('La primera sentencia de api11/staging-security.sql.in no es el SIGNAL de bloqueo esperado.');
  const st = splitStatements(t.replace(`${SEC_SIGNAL}\n`, '-- [LAB API-11] SIGNAL de bloqueo retirada SOLO en la copia de laboratorio.\n'));
  if (st.length !== 4 || st.some((s) => !/^CREATE TABLE /i.test(s))) fail('Se esperaban exactamente 4 CREATE TABLE de seguridad.');
  SEC_TABLES.forEach((tb, i) => { if (!st[i].startsWith(`CREATE TABLE ${tb} (`)) fail(`Orden/nombre inesperado: ${tb}`); });
  if (st.some((s) => /\b(DROP|TRUNCATE|ALTER|DELETE|GRANT|USE|SIGNAL|CREATE (DATABASE|USER))\b/i.test(s))) fail('El DDL de seguridad contiene sentencias no permitidas.');
  return st;
}

// API-18 — almacén de nonces de atestación y registro de identidad de recursos. Estructura separada de API-11; el laboratorio solo siembra filas con destino LAB.
export const ATT_SIGNAL = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'API18_UNRATIFIED_DESIGN_DO_NOT_EXECUTE';";
export const ATT_TABLES = Object.freeze(['ps_api18_attestation_nonces', 'ps_api18_resource_registry']);
export function attestationDdlStatements(text) {
  const t = lf(text);
  const first = t.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))[0];
  if (first !== ATT_SIGNAL || t.split(ATT_SIGNAL).length !== 2) fail('La primera sentencia de api18/staging-attestation.sql.in no es el SIGNAL de bloqueo esperado.');
  const st = splitStatements(t.replace(`${ATT_SIGNAL}\n`, '-- [LAB API-18] SIGNAL de bloqueo retirada SOLO en la copia de laboratorio.\n'));
  if (st.length !== 2 || st.some((x) => !/^CREATE TABLE /i.test(x))) fail('Se esperaban exactamente 2 CREATE TABLE de atestación.');
  ATT_TABLES.forEach((tb, i) => { if (!st[i].startsWith(`CREATE TABLE ${tb} (`)) fail(`Orden/nombre inesperado: ${tb}`); });
  if (st.some((x) => /\b(DROP|TRUNCATE|ALTER|DELETE|GRANT|USE|SIGNAL|CREATE (DATABASE|USER))\b/i.test(x))) fail('El DDL de atestación contiene sentencias no permitidas.');
  return st;
}
/** Registro de laboratorio: SOLO destino LAB. Lo escribe la cuenta administrativa del arnés; el runtime no tiene INSERT sobre esta tabla. */
export const LAB_REGISTRY = Object.freeze([
  ['counter', 'lab-counter-iso', 'ISOLATED_COPY'], ['replay', 'lab-replay-iso', 'ISOLATED_COPY'], ['counter', 'lab-counter-live', 'LIVE'], ['clock', 'lab-clock', 'LIVE'], ['catalog', 'lab-catalog', 'LIVE'], ['cipher', 'lab-cipher', 'LIVE'], ['verifier', 'lab-verifier', 'LIVE'],
]);
export function attestationSeedStatements() {
  return LAB_REGISTRY.map(([port, id, subject]) => { if (!/^[a-z0-9-]+$/.test(id)) fail('Identificador de registro inválido.'); return `INSERT INTO ps_api18_resource_registry (target, port, resource_id, subject, status) VALUES ('LAB', '${port}', _binary'${id}', '${subject}', 'ACTIVE')`; });
}

const FROM = 1700000000000; const FAR = 4102444800000;   // 2023-11-14 → 2100-01-01 (ms)
/** Integraciones de laboratorio (referencias opacas ficticias). */
export const LAB_INTEGRATIONS = Object.freeze([
  { key: 'a', tenant: 1, client: 1, integ: 'qa-integration', club: ['QA-CLUB'], scopes: ['orders:create', 'orders:read', 'orders:cancel'], from: FROM, until: FAR },
  { key: 'b', tenant: 2, client: 1, integ: 'qa-integration', club: ['QA-CLUB'], scopes: ['orders:create', 'orders:read', 'orders:cancel'], from: FROM, until: FAR },
  { key: 'ro', tenant: 1, client: 2, integ: 'qa-integration', club: ['QA-CLUB'], scopes: ['orders:read'], from: FROM, until: FAR },
  { key: 'rev', tenant: 1, client: 1, integ: 'qa-other', club: ['QA-CLUB'], scopes: ['orders:create', 'orders:read', 'orders:cancel'], from: FROM, until: FAR },
  { key: 'exp', tenant: 1, client: 1, integ: 'qa-other', club: ['QA-CLUB'], scopes: ['orders:create'], from: FROM, until: FROM + 1000 },
]);
export const issuerOf = () => 'lab-issuer';
export const subjectOf = (k) => `lab-subject-${k}`;
export const credOf = (k) => `lab-cred-${k}-1`;

export function securitySeedStatements() {
  const q = (s) => { if (!/^[a-z0-9._-]+$/i.test(s)) fail('Referencia de laboratorio inválida.'); return `_binary'${s}'`; };
  const seeds = LAB_INTEGRATIONS.map((i) => `INSERT INTO ps_api11_integrations (issuer, subject, credential_reference, environment, tenant_id, client_id, integration_id, revision, status, valid_from_ms, valid_until_ms, credential_valid_from_ms, credential_valid_until_ms, rotated_at_ms, allowed_clubs_json, scopes_json) VALUES (${q(issuerOf())}, ${q(subjectOf(i.key))}, ${q(credOf(i.key))}, _binary'sandbox', ${i.tenant}, ${i.client}, ${q(i.integ)}, 1, 'ACTIVE', ${i.from}, ${i.until}, ${i.from}, ${i.until}, ${i.from}, '${JSON.stringify(i.club)}', '${JSON.stringify(i.scopes)}')`);
  seeds.push(`INSERT INTO ps_api11_revocations (issuer, subject, credential_reference, revision, revoked_at_ms) VALUES (${q(issuerOf())}, ${q(subjectOf('rev'))}, ${q(credOf('rev'))}, 0, ${FROM + 5})`);
  return seeds;
}

/** @returns {{setup: string[], after: string[]}} setup = API-01/API-09 + seguridad + semillas + cuentas; after = privilegios sobre las tablas de seguridad. */
export function adminStatementsApi11(m, { stagingText, adaptationText, securityText, attestationText }) {
  const base = adminStatements(m, stagingText, adaptationText, null);
  const sec = securityDdlStatements(securityText);
  const user = `\`${m.user}\`@\`127.0.0.1\``; const schema = `\`${m.schema}\``;
  // Se insertan las tablas de seguridad y semillas antes de CREATE USER (la tabla ps_api01_scopes ya existe y está sembrada en `base`).
  const idx = base.findIndex((s) => s.startsWith('CREATE USER'));
  const att = attestationText ? attestationDdlStatements(attestationText) : [];
  const setup = [...base.slice(0, idx), ...sec, ...securitySeedStatements(), ...att, ...(att.length ? attestationSeedStatements() : []), ...base.slice(idx)];
  const after = [
    // Mínimo para los puertos: el runtime SOLO lee catálogo y revocaciones; cuota: leer/insertar/incrementar `used`; reclamos: leer/insertar. Sin DELETE, sin DDL.
    `GRANT SELECT ON ${schema}.ps_api11_integrations TO ${user}`,
    `GRANT SELECT ON ${schema}.ps_api11_revocations TO ${user}`,
    `GRANT SELECT, INSERT, UPDATE (used) ON ${schema}.ps_api11_rate_counters TO ${user}`,
    `GRANT SELECT, INSERT ON ${schema}.ps_api11_proof_claims TO ${user}`,
    ...(attestationText ? [
      // API-18: nonces de un solo uso → SELECT+INSERT (sin UPDATE/DELETE); registro de identidad → SOLO lectura (lo escribe la cuenta administrativa).
      `GRANT SELECT, INSERT ON ${schema}.ps_api18_attestation_nonces TO ${user}`,
      `GRANT SELECT ON ${schema}.ps_api18_resource_registry TO ${user}`,
    ] : []),
  ];
  return { setup, after };
}
