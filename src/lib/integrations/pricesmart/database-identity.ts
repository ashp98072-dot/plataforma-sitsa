// PRICESMART API-20 — SEPARACIÓN de identidades MariaDB de producción frente a las de laboratorio (sandbox). Función PURA de validación sobre descriptores (host, puerto, esquema y TRES cuentas distintas:
// ejecución, escritura del registro administrativo y migración/DDL). NO se conecta, NO guarda ni recibe contraseñas y no cambia los guardas existentes de sandbox (los puertos de API-11 siguen exigiendo
// `sandbox_api02_*`; relajarlos es una decisión pendiente y explícita). Los resultados citan códigos y nombres de campo, nunca valores.
export type DbIdentity = { host: string; port: number; schema: string; runtimeUser: string; registryWriterUser: string; migrationUser: string };
export type SeparationIssue = { code: string; field?: string };
const LAB_NAME = /^sandbox_api02_[a-z0-9_]+$/;
const NAME = /^[A-Za-z0-9_]{1,64}$/;
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const FORBIDDEN_USERS = new Set(['root', 'admin', 'administrator', 'mysql', 'mariadb', 'sys', 'sa', 'postgres', 'dba']);
const USER_FIELDS = ['runtimeUser', 'registryWriterUser', 'migrationUser'] as const;

function basic(id: DbIdentity | undefined, side: 'lab' | 'production', issues: SeparationIssue[]): id is DbIdentity {
  if (typeof id !== 'object' || id === null) { issues.push({ code: 'MISSING_IDENTITY', field: side }); return false; }
  let ok = true; const bad = (field: string) => { issues.push({ code: 'INVALID_FIELD', field: `${side}.${field}` }); ok = false; };
  if (typeof id.host !== 'string' || !HOST.test(id.host)) bad('host');
  if (!Number.isInteger(id.port) || id.port < 1 || id.port > 65535) bad('port');
  if (typeof id.schema !== 'string' || !NAME.test(id.schema)) bad('schema');
  for (const f of USER_FIELDS) if (typeof id[f] !== 'string' || !NAME.test(id[f])) bad(f);
  return ok;
}

/** Valida ambos descriptores y su separación. `ok` solo si no hay ningún hallazgo. */
export function validateDatabaseSeparation(input: { lab?: DbIdentity; production?: DbIdentity }): { ok: boolean; issues: SeparationIssue[] } {
  const issues: SeparationIssue[] = []; const { lab, production } = input ?? {};
  const labOk = basic(lab, 'lab', issues); const prodOk = basic(production, 'production', issues);
  if (labOk) {
    if (lab.host !== '127.0.0.1') issues.push({ code: 'LAB_NOT_LOOPBACK', field: 'lab.host' });
    for (const f of ['schema', ...USER_FIELDS] as const) if (!LAB_NAME.test(lab[f])) issues.push({ code: 'LAB_NAME_PATTERN', field: `lab.${f}` });
  }
  if (prodOk) {
    for (const f of ['schema', ...USER_FIELDS] as const) if (LAB_NAME.test(production[f]) || /sandbox/i.test(production[f])) issues.push({ code: 'PRODUCTION_USES_LAB_NAME', field: `production.${f}` });
    for (const f of USER_FIELDS) if (FORBIDDEN_USERS.has(production[f].toLowerCase())) issues.push({ code: 'PRIVILEGED_ACCOUNT_NAME', field: `production.${f}` });
    const users = USER_FIELDS.map(f => production[f].toLowerCase());
    if (new Set(users).size !== users.length) issues.push({ code: 'ACCOUNTS_NOT_DISTINCT', field: 'production' });   // ejecución ≠ escritura del registro ≠ migración
  }
  if (labOk && prodOk) {
    const labUsers = new Set(USER_FIELDS.map(f => lab[f].toLowerCase()));
    if (USER_FIELDS.some(f => labUsers.has(production[f].toLowerCase()))) issues.push({ code: 'ACCOUNT_SHARED_WITH_LAB', field: 'production' });
    if (production.schema.toLowerCase() === lab.schema.toLowerCase()) issues.push({ code: 'SCHEMA_SHARED_WITH_LAB', field: 'production.schema' });
    if (production.host.toLowerCase() === lab.host.toLowerCase() && production.port === lab.port) issues.push({ code: 'ENDPOINT_SHARED_WITH_LAB', field: 'production' });
  }
  return { ok: issues.length === 0, issues };
}
