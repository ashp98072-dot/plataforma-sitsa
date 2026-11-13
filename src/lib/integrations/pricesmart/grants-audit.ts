// PRICESMART API-20 — AUDITORÍA DE PRIVILEGIOS MÍNIMOS de la cuenta de ejecución de MariaDB. Función PURA: recibe las líneas de `SHOW GRANTS FOR CURRENT_USER()` (que obtiene el llamador con una consulta de
// SOLO LECTURA) y las contrasta con una política cerrada «tabla → privilegios permitidos». No abre conexiones, no ejecuta SQL y NUNCA devuelve ni registra el texto de las líneas (podrían contener el hash de la
// contraseña): los hallazgos llevan solo un código, la tabla y el privilegio. Rechaza lo que un runtime no debe poder hacer: privilegios globales (salvo USAGE), alcance de esquema completo, otros esquemas, tablas
// fuera de la política, privilegios en exceso (DELETE, DROP, ALTER, CREATE, TRUNCATE, FILE, SUPER, ALL PRIVILEGES, UPDATE de tabla completa donde solo se permiten columnas…), GRANT OPTION y roles.
//
// LÍMITE OBLIGATORIO: `RUNTIME_PRIVILEGE_POLICY` (profundamente congelada) es el TECHO de seguridad y, a la vez, lo REQUERIDO. Una política propia (`options.policy`) solo puede RESTRINGIR: debe ser no vacía y cada
// tabla/privilegio/columna suyo debe estar contenido en la base; si amplía algo (otra tabla, otro privilegio, UPDATE de tabla completa, columnas ajenas…) o está mal formada, la auditoría FALLA
// (`POLICY_EXCEEDS_BASE` / `POLICY_INVALID`) aunque los grants reales coincidan con ella. La completitud (`complete`/`missing`) se mide SIEMPRE contra la base: una política propia, vacía o reducida, no puede
// producir un falso «completo».
export type PrivilegePolicy = Readonly<Record<string, readonly string[]>>;   // tabla → privilegios permitidos; columnas: 'UPDATE(col1,col2)'
export type GrantsFinding = { code: 'NO_GRANTS' | 'MALFORMED_GRANT' | 'ROLE_GRANT' | 'GLOBAL_PRIVILEGE' | 'SCHEMA_WIDE' | 'WRONG_SCHEMA' | 'UNKNOWN_TABLE' | 'EXCESS_PRIVILEGE' | 'GRANT_OPTION' | 'POLICY_INVALID' | 'POLICY_EXCEEDS_BASE'; table?: string; privilege?: string };
export type GrantsAudit = { ok: boolean; complete: boolean; findings: GrantsFinding[]; missing: { table: string; privilege: string }[] };

const deepFreeze = (p: Record<string, string[]>): PrivilegePolicy => Object.freeze(Object.fromEntries(Object.entries(p).map(([t, privs]) => [t, Object.freeze([...privs])])));
/** Política mínima del runtime PriceSmart (API-05…API-18), la misma que concede el laboratorio a la cuenta de ejecución. Inmutable en todos sus niveles. */
export const RUNTIME_PRIVILEGE_POLICY: PrivilegePolicy = deepFreeze({
  novalvion_environment: ['SELECT'],
  ps_api01_orders: ['SELECT', 'INSERT', 'UPDATE(state,version,cancellation_hash,cancellation_reason,cancellation_receipt_json)'],
  ps_api01_events: ['SELECT', 'INSERT'], ps_api01_outbox: ['INSERT'], ps_api01_audit: ['INSERT'],
  ps_api11_integrations: ['SELECT'], ps_api11_revocations: ['SELECT'], ps_api11_rate_counters: ['SELECT', 'INSERT', 'UPDATE(used)'], ps_api11_proof_claims: ['SELECT', 'INSERT'],
  ps_api18_attestation_nonces: ['SELECT', 'INSERT'], ps_api18_resource_registry: ['SELECT'],
});

const ident = '`((?:[^`]|``)+)`';
const OBJECT_RE = new RegExp(`^(\\*\\.\\*|${ident}\\.\\*|${ident}\\.${ident})$`);
type Parsed = { priv: string; columns?: string[] };
/** Divide una lista de privilegios por comas de primer nivel (las comas dentro de paréntesis pertenecen a una lista de columnas). */
function splitPrivileges(list: string): Parsed[] | null {
  const out: Parsed[] = []; let depth = 0; let cur = '';
  const flush = () => {
    const t = cur.trim(); cur = ''; if (!t) return false;
    const m = /^([A-Z][A-Z ]*?)\s*(?:\(([^)]*)\))?$/i.exec(t); if (!m) return false;
    const columns = m[2] === undefined ? undefined : m[2].split(',').map(c => c.trim().replace(/^`|`$/g, '').toLowerCase()).filter(Boolean);
    if (m[2] !== undefined && (!columns || columns.length === 0)) return false;
    out.push({ priv: m[1].toUpperCase().replace(/\s+/g, ' '), columns }); return true;
  };
  for (const ch of list) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { if (!flush()) return null; } else cur += ch; }
  return flush() && depth === 0 ? out : null;
}
// Gramática de una especificación: PRIVILEGIO o PRIVILEGIO(col,col). Cualquier privilegio sintácticamente válido (p. ej. DELETE, DROP) se ANALIZA y, si no está en la base, es POLICY_EXCEEDS_BASE;
// solo lo que no cumple la gramática (minúsculas, signos, paréntesis vacíos…) es POLICY_INVALID.
const SPEC_RE = /^([A-Z][A-Z ]{0,30}?)(?:\(([a-z0-9_]+(?:,[a-z0-9_]+)*)\))?$/;
const specOf = (spec: string): Parsed | null => { const m = SPEC_RE.exec(spec); return m ? { priv: m[1].trim(), columns: m[2] === undefined ? undefined : m[2].split(',') } : null; };
const policyEntry = (spec: string): Parsed => specOf(spec) as Parsed;   // solo se usa con especificaciones ya validadas (base o política propia verificada)

/** Valida una política propia y la devuelve como copia congelada. Falla si no es una restricción estricta de la base. */
function resolvePolicy(custom: unknown): { ok: true; policy: PrivilegePolicy } | { ok: false; code: 'POLICY_INVALID' | 'POLICY_EXCEEDS_BASE' } {
  if (custom === undefined) return { ok: true, policy: RUNTIME_PRIVILEGE_POLICY };
  try {
    if (typeof custom !== 'object' || custom === null || Array.isArray(custom)) return { ok: false, code: 'POLICY_INVALID' };
    const tables = Object.keys(custom); if (tables.length === 0 || tables.length > 64) return { ok: false, code: 'POLICY_INVALID' };
    const copy: Record<string, string[]> = {};
    for (const table of tables) {
      const raw = (custom as Record<string, unknown>)[table];
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > 16 || raw.some(s => typeof s !== 'string' || specOf(s) === null)) return { ok: false, code: 'POLICY_INVALID' };
      if (!Object.prototype.hasOwnProperty.call(RUNTIME_PRIVILEGE_POLICY, table)) return { ok: false, code: 'POLICY_EXCEEDS_BASE' };   // tabla fuera de la base
      const base = RUNTIME_PRIVILEGE_POLICY[table].map(policyEntry);
      for (const s of raw as string[]) {
        const e = policyEntry(s);
        const within = base.some(b => b.priv === e.priv && (b.columns === undefined || (e.columns !== undefined && e.columns.every(c => b.columns?.includes(c)))));
        if (!within) return { ok: false, code: 'POLICY_EXCEEDS_BASE' };   // privilegio, tabla completa o columnas por encima del techo
      }
      copy[table] = [...(raw as string[])];
    }
    return { ok: true, policy: deepFreeze(copy) };
  } catch { return { ok: false, code: 'POLICY_INVALID' }; }   // getters hostiles, proxies, etc.
}

export function auditGrants(lines: readonly string[], options: { schema: string; policy?: PrivilegePolicy }): GrantsAudit {
  const resolved = resolvePolicy(options?.policy);
  if (!resolved.ok) return { ok: false, complete: false, findings: [{ code: resolved.code }], missing: [] };   // una política inadmisible nunca da un resultado favorable
  const allowedPolicy = resolved.policy; const findings: GrantsFinding[] = [];
  const granted = new Map<string, Parsed[]>();   // tabla → privilegios concedidos (acumulados de todas las líneas)
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, complete: false, findings: [{ code: 'NO_GRANTS' }], missing: [] };
  for (const raw of lines) {
    const line = typeof raw === 'string' ? raw.trim() : '';
    const m = /^GRANT\s+([\s\S]+?)\s+ON\s+(\S+)\s+TO\s+([\s\S]+)$/i.exec(line);
    if (!m) { findings.push({ code: /^GRANT\s+[^\s]+(?:\s*,\s*[^\s]+)*\s+TO\s+/i.test(line) ? 'ROLE_GRANT' : 'MALFORMED_GRANT' }); continue; }
    const [, privList, object, rest] = m;
    const withGrantOption = /\bWITH\s+GRANT\s+OPTION\b/i.test(rest);
    const privs = splitPrivileges(privList); const obj = OBJECT_RE.exec(object);
    if (!privs || !obj) { findings.push({ code: 'MALFORMED_GRANT' }); continue; }
    if (withGrantOption || privs.some(p => p.priv === 'GRANT OPTION')) findings.push({ code: 'GRANT_OPTION' });
    if (obj[1] === '*.*') {   // global: solo USAGE (sin privilegios)
      for (const p of privs) if (p.priv !== 'USAGE') findings.push({ code: 'GLOBAL_PRIVILEGE', privilege: p.priv });
      continue;
    }
    const schema = (obj[2] ?? obj[3]).replace(/``/g, '`');
    if (schema !== options.schema) { findings.push({ code: 'WRONG_SCHEMA' }); continue; }
    if (obj[2] !== undefined) { for (const p of privs) if (p.priv !== 'USAGE') findings.push({ code: 'SCHEMA_WIDE', privilege: p.priv }); continue; }
    const table = obj[4].replace(/``/g, '`');
    if (!Object.prototype.hasOwnProperty.call(allowedPolicy, table)) { findings.push({ code: 'UNKNOWN_TABLE', table }); continue; }
    granted.set(table, [...(granted.get(table) ?? []), ...privs.filter(p => p.priv !== 'USAGE')]);
  }
  // Exceso: contra la política efectiva (la base o una restricción verificada de ella).
  for (const [table, privs] of granted) {
    const allowed = allowedPolicy[table].map(policyEntry);
    for (const p of privs) {
      const hit = allowed.filter(a => a.priv === p.priv);
      const ok = hit.some(a => (a.columns === undefined) || (p.columns !== undefined && p.columns.every(c => a.columns?.includes(c))));
      if (!ok) findings.push({ code: 'EXCESS_PRIVILEGE', table, privilege: p.columns ? `${p.priv}(${p.columns.join(',')})` : p.priv });
    }
  }
  // Completitud: SIEMPRE contra la base obligatoria (una política propia no puede reducir lo requerido).
  const missing: { table: string; privilege: string }[] = [];
  for (const table of Object.keys(RUNTIME_PRIVILEGE_POLICY)) for (const spec of RUNTIME_PRIVILEGE_POLICY[table]) {
    const a = policyEntry(spec); const have = granted.get(table) ?? [];
    const covered = a.columns === undefined ? have.some(p => p.priv === a.priv && p.columns === undefined) : have.some(p => p.priv === a.priv && (p.columns === undefined || a.columns?.every(c => p.columns?.includes(c))));
    if (!covered) missing.push({ table, privilege: spec });
  }
  return { ok: findings.length === 0, complete: missing.length === 0, findings, missing };
}
