// PRICESMART API-20 — SEPARACIÓN de identidades MariaDB de producción frente a las de laboratorio (sandbox). Función PURA de validación sobre descriptores (host de conexión, puerto, esquema y TRES cuentas
// distintas: ejecución, escritura del registro administrativo y migración/DDL, cada una con su `usuario@host`). NO se conecta, NO guarda ni recibe contraseñas y no cambia los guardas existentes de sandbox (los
// puertos de API-11 siguen exigiendo `sandbox_api02_*`; relajarlos es una decisión pendiente y explícita). Los resultados citan códigos y nombres de campo, nunca valores.
//
// IDENTIDAD COMPLETA DE CUENTA: en MariaDB una cuenta es `usuario@host` (el host puede ser un patrón con comodines) y `CURRENT_USER()` devuelve la cuenta EFECTIVA con la que se autenticó la sesión. Dos
// cuentas con el mismo usuario y distinto host son cuentas diferentes (con privilegios diferentes). Por eso la sesión se compara contra usuario Y host exactos (`parseAccount`/`accountMatches`), un
// resultado mal formado o con comodines no coincide con nada, y en producción NO se admiten cuentas con host comodín (`%`, `_`).
export type DbIdentity = {
  host: string; port: number; schema: string;
  runtimeUser: string; registryWriterUser: string; migrationUser: string;
  /** Parte `host` de cada cuenta (como la define MariaDB, p. ej. `localhost` o `10.0.0.5`); en producción debe ser exacta (sin comodines). */
  runtimeHost: string; registryWriterHost: string; migrationHost: string;
};
export type SeparationIssue = { code: string; field?: string };
const LAB_NAME = /^sandbox_api02_[a-z0-9_]+$/;
const NAME = /^[A-Za-z0-9_]{1,64}$/;
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const ACCOUNT_HOST = /^[A-Za-z0-9%][A-Za-z0-9._:%-]{0,254}$/;   // admite patrones (con %) al PARSEAR; la política de producción los rechaza
const FORBIDDEN_USERS = new Set(['root', 'admin', 'administrator', 'mysql', 'mariadb', 'sys', 'sa', 'postgres', 'dba']);
const USER_FIELDS = ['runtimeUser', 'registryWriterUser', 'migrationUser'] as const;
const HOST_FIELDS = ['runtimeHost', 'registryWriterHost', 'migrationHost'] as const;
const hasWildcard = (h: string) => /[%_]/.test(h);

/** Separa `usuario@host` de `CURRENT_USER()`. Exige EXACTAMENTE un `@`, usuario y host no vacíos y con el formato válido; todo lo demás es `null`. */
export function parseAccount(account: unknown): { user: string; host: string } | null {
  if (typeof account !== 'string' || account.length === 0 || account.length > 330) return null;
  const parts = account.split('@'); if (parts.length !== 2) return null;
  const [user, host] = parts; if (!NAME.test(user) || !ACCOUNT_HOST.test(host)) return null;
  return { user, host };
}
/** ¿La cuenta efectiva coincide EXACTAMENTE con la esperada? Usuario sensible a mayúsculas; host sin distinción de mayúsculas; los comodines no coinciden con nada que no sea el mismo patrón literal. */
export function accountMatches(account: unknown, expected: { user: string; host: string }): boolean {
  const a = parseAccount(account); if (!a || !NAME.test(expected?.user ?? '') || !ACCOUNT_HOST.test(expected?.host ?? '')) return false;
  return a.user === expected.user && a.host.toLowerCase() === expected.host.toLowerCase();
}

function basic(id: DbIdentity | undefined, side: 'lab' | 'production', issues: SeparationIssue[]): id is DbIdentity {
  if (typeof id !== 'object' || id === null) { issues.push({ code: 'MISSING_IDENTITY', field: side }); return false; }
  let ok = true; const bad = (field: string) => { issues.push({ code: 'INVALID_FIELD', field: `${side}.${field}` }); ok = false; };
  if (typeof id.host !== 'string' || !HOST.test(id.host)) bad('host');
  if (!Number.isInteger(id.port) || id.port < 1 || id.port > 65535) bad('port');
  if (typeof id.schema !== 'string' || !NAME.test(id.schema)) bad('schema');
  for (const f of USER_FIELDS) if (typeof id[f] !== 'string' || !NAME.test(id[f])) bad(f);
  for (const f of HOST_FIELDS) if (typeof id[f] !== 'string' || !ACCOUNT_HOST.test(id[f])) bad(f);
  return ok;
}

/** Valida ambos descriptores y su separación. `ok` solo si no hay ningún hallazgo. */
export function validateDatabaseSeparation(input: { lab?: DbIdentity; production?: DbIdentity }): { ok: boolean; issues: SeparationIssue[] } {
  const issues: SeparationIssue[] = []; const { lab, production } = input ?? {};
  const labOk = basic(lab, 'lab', issues); const prodOk = basic(production, 'production', issues);
  if (labOk) {
    if (lab.host !== '127.0.0.1') issues.push({ code: 'LAB_NOT_LOOPBACK', field: 'lab.host' });
    for (const f of ['schema', ...USER_FIELDS] as const) if (!LAB_NAME.test(lab[f])) issues.push({ code: 'LAB_NAME_PATTERN', field: `lab.${f}` });
    for (const f of HOST_FIELDS) if (lab[f] !== '127.0.0.1') issues.push({ code: 'LAB_ACCOUNT_HOST', field: `lab.${f}` });   // las cuentas del laboratorio se crean @127.0.0.1
  }
  if (prodOk) {
    for (const f of ['schema', ...USER_FIELDS] as const) if (LAB_NAME.test(production[f]) || /sandbox/i.test(production[f])) issues.push({ code: 'PRODUCTION_USES_LAB_NAME', field: `production.${f}` });
    for (const f of USER_FIELDS) if (FORBIDDEN_USERS.has(production[f].toLowerCase())) issues.push({ code: 'PRIVILEGED_ACCOUNT_NAME', field: `production.${f}` });
    for (const f of HOST_FIELDS) if (hasWildcard(production[f])) issues.push({ code: 'WILDCARD_ACCOUNT_HOST', field: `production.${f}` });   // una cuenta con host comodín puede coincidir con orígenes inesperados
    const users = USER_FIELDS.map(f => production[f].toLowerCase());
    if (new Set(users).size !== users.length) issues.push({ code: 'ACCOUNTS_NOT_DISTINCT', field: 'production' });   // ejecución ≠ escritura del registro ≠ migración, aunque difieran solo en el host
    const full = USER_FIELDS.map((u, i) => `${production[u].toLowerCase()}@${production[HOST_FIELDS[i]].toLowerCase()}`);
    if (new Set(full).size !== full.length) issues.push({ code: 'ACCOUNTS_NOT_DISTINCT', field: 'production' });
  }
  if (labOk && prodOk) {
    const labUsers = new Set(USER_FIELDS.map(f => lab[f].toLowerCase()));
    if (USER_FIELDS.some(f => labUsers.has(production[f].toLowerCase()))) issues.push({ code: 'ACCOUNT_SHARED_WITH_LAB', field: 'production' });   // mismo usuario aunque cambie el host: ambiguo, se rechaza
    if (production.schema.toLowerCase() === lab.schema.toLowerCase()) issues.push({ code: 'SCHEMA_SHARED_WITH_LAB', field: 'production.schema' });
    if (production.host.toLowerCase() === lab.host.toLowerCase() && production.port === lab.port) issues.push({ code: 'ENDPOINT_SHARED_WITH_LAB', field: 'production' });
  }
  return { ok: issues.length === 0, issues };
}
