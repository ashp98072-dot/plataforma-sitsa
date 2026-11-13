import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUNTIME_PRIVILEGE_POLICY, auditGrants } from './grants-audit';
import { accountMatches, parseAccount, validateDatabaseSeparation, type DbIdentity } from './database-identity';

const S = 'prod_pricesmart'; const U = '`runtime_ps`@`localhost`'; const HASH = '*A1B2C3D4E5F60718293A4B5C6D7E8F9012345678';
const line = (privs: string, table: string, tail = '') => `GRANT ${privs} ON \`${S}\`.\`${table}\` TO ${U}${tail}`;
/** Salida típica de SHOW GRANTS de la cuenta de ejecución con la política mínima. */
const good = (): string[] => [
  `GRANT USAGE ON *.* TO ${U} IDENTIFIED BY PASSWORD '${HASH}'`,
  line('SELECT', 'novalvion_environment'),
  line('SELECT, INSERT, UPDATE (`state`, `version`, `cancellation_hash`, `cancellation_reason`, `cancellation_receipt_json`)', 'ps_api01_orders'),
  line('SELECT, INSERT', 'ps_api01_events'), line('INSERT', 'ps_api01_outbox'), line('INSERT', 'ps_api01_audit'),
  line('SELECT', 'ps_api11_integrations'), line('SELECT', 'ps_api11_revocations'), line('SELECT, INSERT, UPDATE (`used`)', 'ps_api11_rate_counters'), line('SELECT, INSERT', 'ps_api11_proof_claims'),
  line('SELECT, INSERT', 'ps_api18_attestation_nonces'), line('SELECT', 'ps_api18_resource_registry'),
];
const audit = (lines: string[], over: Record<string, unknown> = {}) => auditGrants(lines, { schema: S, ...over });
const codes = (a: ReturnType<typeof auditGrants>) => a.findings.map(f => f.code);

describe('auditoría de privilegios mínimos (SHOW GRANTS)', () => {
  it('la política mínima completa pasa: sin hallazgos y completa', () => { const a = audit(good()); expect(a).toEqual({ ok: true, complete: true, findings: [], missing: [] }); });
  it('los privilegios pueden venir repartidos en varias líneas y en cualquier orden', () => {
    const l = good().filter(x => !x.includes('ps_api01_orders')); l.push(line('SELECT', 'ps_api01_orders')); l.push(line('INSERT', 'ps_api01_orders')); l.push(line('UPDATE (`version`, `state`, `cancellation_hash`, `cancellation_reason`, `cancellation_receipt_json`)', 'ps_api01_orders'));
    expect(audit(l.reverse())).toMatchObject({ ok: true, complete: true });
  });
  it('rechaza privilegios globales, de esquema completo y de otros esquemas', () => {
    expect(codes(audit([...good(), `GRANT ALL PRIVILEGES ON *.* TO ${U}`]))).toContain('GLOBAL_PRIVILEGE');
    expect(codes(audit([...good(), `GRANT SELECT ON *.* TO ${U}`]))).toContain('GLOBAL_PRIVILEGE');
    for (const p of ['FILE', 'SUPER', 'PROCESS', 'RELOAD', 'CREATE USER', 'SHUTDOWN']) expect(codes(audit([...good(), `GRANT ${p} ON *.* TO ${U}`])), p).toContain('GLOBAL_PRIVILEGE');
    expect(codes(audit([...good(), `GRANT SELECT ON \`${S}\`.* TO ${U}`]))).toContain('SCHEMA_WIDE');
    expect(codes(audit([...good(), `GRANT ALL PRIVILEGES ON \`${S}\`.* TO ${U}`]))).toContain('SCHEMA_WIDE');
    expect(codes(audit([...good(), `GRANT SELECT ON \`otra_db\`.\`t\` TO ${U}`]))).toContain('WRONG_SCHEMA');
    expect(codes(audit([...good(), `GRANT SELECT ON \`sandbox_api02_x\`.* TO ${U}`]))).toContain('WRONG_SCHEMA');
  });
  it('rechaza tablas fuera de la política y privilegios en exceso (DELETE, DROP, ALTER, CREATE, TRUNCATE-equivalente, UPDATE de tabla completa, columnas ajenas)', () => {
    expect(audit([...good(), line('SELECT', 'usuarios')]).findings).toContainEqual({ code: 'UNKNOWN_TABLE', table: 'usuarios' });
    for (const [t, p] of [['ps_api11_proof_claims', 'DELETE'], ['ps_api11_rate_counters', 'DELETE'], ['ps_api18_attestation_nonces', 'UPDATE'], ['ps_api18_attestation_nonces', 'DELETE'], ['ps_api18_resource_registry', 'INSERT'], ['ps_api18_resource_registry', 'UPDATE'],
      ['ps_api01_orders', 'DELETE'], ['ps_api01_orders', 'DROP'], ['ps_api01_orders', 'ALTER'], ['ps_api01_orders', 'CREATE'], ['ps_api01_orders', 'INDEX'], ['ps_api01_orders', 'REFERENCES'], ['ps_api01_orders', 'UPDATE'], ['ps_api11_integrations', 'INSERT'], ['ps_api11_revocations', 'UPDATE'], ['ps_api01_outbox', 'SELECT']] as const)
      expect(audit([...good(), line(p, t)]).findings, `${t} ${p}`).toContainEqual({ code: 'EXCESS_PRIVILEGE', table: t, privilege: p });
    expect(audit([...good(), line('UPDATE (`window_start_ms`)', 'ps_api11_rate_counters')]).findings).toContainEqual({ code: 'EXCESS_PRIVILEGE', table: 'ps_api11_rate_counters', privilege: 'UPDATE(window_start_ms)' });
    expect(codes(audit([...good(), line('ALL PRIVILEGES', 'ps_api11_rate_counters')]))).toContain('EXCESS_PRIVILEGE');
  });
  it('GRANT OPTION (en la línea o como privilegio) y los roles se rechazan', () => {
    expect(codes(audit([...good(), line('SELECT', 'novalvion_environment', ' WITH GRANT OPTION')]))).toContain('GRANT_OPTION');
    expect(codes(audit([...good(), line('GRANT OPTION', 'novalvion_environment')]))).toContain('GRANT_OPTION');
    expect(codes(audit([...good(), `GRANT admin_role TO ${U}`]))).toContain('ROLE_GRANT');
  });
  it('líneas mal formadas y ausencia de grants se rechazan', () => {
    for (const bad of ['', 'GRANT', 'SELECT ON x TO y', `GRANT SELECT ON ${S}.t TO ${U}`, 'GRANT SELECT () ON `a`.`b` TO u']) expect(codes(audit([...good(), bad])), bad).toEqual(expect.arrayContaining([expect.stringMatching(/MALFORMED_GRANT|ROLE_GRANT/)]));
    expect(audit([])).toMatchObject({ ok: false, findings: [{ code: 'NO_GRANTS' }] }); expect(audit(undefined as never).ok).toBe(false); expect(audit([5 as never]).ok).toBe(false);
  });
  it('privilegios faltantes: no es un riesgo pero la política no está completa', () => {
    const a = audit(good().filter(x => !x.includes('ps_api18_attestation_nonces'))); expect(a.ok).toBe(true); expect(a.complete).toBe(false); expect(a.missing).toContainEqual({ table: 'ps_api18_attestation_nonces', privilege: 'SELECT' });
    const b = audit(good().map(x => x.replace(', UPDATE (`used`)', ''))); expect(b.complete).toBe(false); expect(b.missing).toContainEqual({ table: 'ps_api11_rate_counters', privilege: 'UPDATE(used)' });
  });
  it('una política propia más estricta se respeta como techo; el SELECT de columnas cabe dentro de un SELECT de tabla permitido', () => {
    const strict = { ps_api11_integrations: ['SELECT'], ps_api18_resource_registry: ['SELECT'] };
    expect(audit([line('SELECT', 'ps_api11_integrations'), line('SELECT', 'ps_api18_resource_registry')], { policy: strict }).findings).toEqual([]);
    expect(codes(audit([line('SELECT', 'ps_api11_integrations'), line('SELECT', 'ps_api18_resource_registry'), line('SELECT', 'ps_api11_revocations')], { policy: strict }))).toContain('UNKNOWN_TABLE');   // permitido por la base pero no por la restricción
    expect(audit([line('SELECT (`a`, `b`)', 'ps_api11_integrations')], { policy: strict }).findings).toEqual([]);   // columnas ⊆ SELECT de tabla
  });
  it('los hallazgos NUNCA incluyen el texto de las líneas (hash de contraseña, cuentas ni hosts)', () => {
    const a = audit([...good(), `GRANT ALL PRIVILEGES ON *.* TO ${U} IDENTIFIED BY PASSWORD '${HASH}' WITH GRANT OPTION`]); const text = JSON.stringify(a);
    expect(a.ok).toBe(false); for (const secret of [HASH, 'runtime_ps', 'localhost', 'IDENTIFIED']) expect(text).not.toContain(secret);
  });
  it('la política exportada es la mínima de API-05…API-18 y está congelada', () => {
    expect(Object.isFrozen(RUNTIME_PRIVILEGE_POLICY)).toBe(true);
    for (const privs of Object.values(RUNTIME_PRIVILEGE_POLICY)) for (const p of privs) expect(p).toMatch(/^(SELECT|INSERT|UPDATE\([a-z_,]+\))$/);   // sin DELETE, DROP, ALTER, ni UPDATE de tabla completa
  });
  it('el módulo es puro: sin base de datos, red, entorno ni archivos', () => {
    const t = readFileSync(path.join(__dirname, 'grants-audit.ts'), 'utf8').replace(/\/\/.*$/gm, ''); expect(t).not.toMatch(/process\.env|\bfetch\s*\(|from\s+['"]/);
  });
});

describe('separación de identidades MariaDB (producción frente a sandbox)', () => {
  const lab = (): DbIdentity => ({ host: '127.0.0.1', port: 3307, schema: 'sandbox_api02_x', runtimeUser: 'sandbox_api02_run', registryWriterUser: 'sandbox_api02_reg', migrationUser: 'sandbox_api02_mig', runtimeHost: '127.0.0.1', registryWriterHost: '127.0.0.1', migrationHost: '127.0.0.1' });
  const prod = (): DbIdentity => ({ host: 'db.interno.example', port: 3306, schema: 'prod_pricesmart', runtimeUser: 'ps_runtime', registryWriterUser: 'ps_registry', migrationUser: 'ps_migrator', runtimeHost: 'localhost', registryWriterHost: 'localhost', migrationHost: 'localhost' });
  const issues = (l: Partial<DbIdentity> | null, p: Partial<DbIdentity> | null) => validateDatabaseSeparation({ lab: l === null ? undefined : { ...lab(), ...l }, production: p === null ? undefined : { ...prod(), ...p } }).issues.map(i => i.code);
  it('descriptores correctos y separados', () => { expect(validateDatabaseSeparation({ lab: lab(), production: prod() })).toEqual({ ok: true, issues: [] }); });
  it('falta de descriptores o campos inválidos', () => {
    expect(issues(null, {})).toContain('MISSING_IDENTITY'); expect(issues({}, null)).toContain('MISSING_IDENTITY'); expect(validateDatabaseSeparation(undefined as never).ok).toBe(false);
    for (const bad of [{ host: '' }, { host: 'x y' }, { port: 0 }, { port: 70000 }, { port: 1.5 }, { schema: 'con-guion' }, { runtimeUser: '' }, { registryWriterUser: 'a;b' }]) expect(issues({}, bad), JSON.stringify(bad)).toContain('INVALID_FIELD');
  });
  it('producción no puede usar nombres, cuentas, esquema ni endpoint de laboratorio', () => {
    expect(issues({}, { schema: 'sandbox_api02_x' })).toEqual(expect.arrayContaining(['PRODUCTION_USES_LAB_NAME', 'SCHEMA_SHARED_WITH_LAB']));
    expect(issues({}, { runtimeUser: 'sandbox_api02_run' })).toEqual(expect.arrayContaining(['PRODUCTION_USES_LAB_NAME', 'ACCOUNT_SHARED_WITH_LAB']));
    expect(issues({}, { schema: 'mi_sandbox_prod' })).toContain('PRODUCTION_USES_LAB_NAME');
    expect(issues({}, { host: '127.0.0.1', port: 3307 })).toContain('ENDPOINT_SHARED_WITH_LAB');
    expect(issues({}, { migrationUser: 'SANDBOX_API02_MIG' })).toEqual(expect.arrayContaining(['PRODUCTION_USES_LAB_NAME']));
    expect(issues({}, { schema: 'SANDBOX_API02_X' })).toContain('PRODUCTION_USES_LAB_NAME');
  });
  it('las tres cuentas de producción (ejecución, escritura del registro, migración) deben ser distintas y no privilegiadas', () => {
    expect(issues({}, { registryWriterUser: 'ps_runtime' })).toContain('ACCOUNTS_NOT_DISTINCT'); expect(issues({}, { migrationUser: 'PS_RUNTIME' })).toContain('ACCOUNTS_NOT_DISTINCT');
    for (const u of ['root', 'ADMIN', 'mysql', 'dba']) expect(issues({}, { runtimeUser: u }), u).toContain('PRIVILEGED_ACCOUNT_NAME');
  });
  it('el laboratorio debe ser loopback con el patrón sandbox_api02_*', () => {
    expect(issues({ host: '10.0.0.5' }, {})).toContain('LAB_NOT_LOOPBACK'); expect(issues({ schema: 'otra' }, {})).toContain('LAB_NAME_PATTERN'); expect(issues({ runtimeUser: 'otra' }, {})).toContain('LAB_NAME_PATTERN');
  });
  it('los resultados citan códigos y campos, nunca valores', () => {
    const r = validateDatabaseSeparation({ lab: lab(), production: { ...prod(), schema: 'sandbox_api02_x', runtimeUser: 'root' } }); const text = JSON.stringify(r);
    expect(r.ok).toBe(false); for (const v of ['db.interno.example', 'ps_registry', 'sandbox_api02_x']) expect(text).not.toContain(v);
  });
});

// ---- API-20 (auditoría de #614, SHA 13580ebb): la política base es un LÍMITE obligatorio
describe('la política base es un límite obligatorio (una política propia solo puede restringir)', () => {
  const dangerous = (privs: string[]) => Object.fromEntries(Object.keys(RUNTIME_PRIVILEGE_POLICY).map(t => [t, privs]));
  const withExtra = (table: string, extra: string[]) => ({ ...Object.fromEntries(Object.entries(RUNTIME_PRIVILEGE_POLICY).map(([t, p]) => [t, [...p]])), [table]: [...RUNTIME_PRIVILEGE_POLICY[table], ...extra] });
  it('una política que AUTORIZA privilegios peligrosos se rechaza aunque los grants reales coincidan con ella (el defecto de la versión anterior)', () => {
    for (const priv of ['DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'INDEX', 'ALL PRIVILEGES', 'GRANT OPTION']) {
      const policy = withExtra('ps_api11_proof_claims', [priv]); const lines = [...good(), line(priv, 'ps_api11_proof_claims')];
      const a = audit(lines, { policy }); expect(a.ok, priv).toBe(false); expect(codes(a), priv).toEqual(['POLICY_EXCEEDS_BASE']); expect(a.complete).toBe(false);
    }
    // los grants reales con DELETE coinciden con la política laxa, pero el resultado nunca es favorable
    const lax = withExtra('ps_api11_proof_claims', ['DELETE']); const a = audit([...good(), line('DELETE', 'ps_api11_proof_claims')], { policy: lax }); expect(a).toMatchObject({ ok: false, complete: false, findings: [{ code: 'POLICY_EXCEEDS_BASE' }] });
  });
  it('rechaza ampliaciones: tablas nuevas, UPDATE/INSERT donde la base no lo da, UPDATE de tabla completa, columnas ajenas, SELECT de tabla donde la base solo da columnas', () => {
    const expand: [string, Record<string, string[]>][] = [
      ['tabla fuera de la base', { ...dangerous(['SELECT']), usuarios: ['SELECT'] }], ['INSERT extra', withExtra('ps_api18_resource_registry', ['INSERT'])], ['UPDATE de tabla completa', withExtra('ps_api11_rate_counters', ['UPDATE'])],
      ['columna ajena', withExtra('ps_api11_rate_counters', ['UPDATE(window_start_ms)'])], ['más columnas en el UPDATE de órdenes', { ps_api01_orders: ['UPDATE(state,version,payload)'] }], ['UPDATE de tabla completa en órdenes', { ps_api01_orders: ['UPDATE'] }],
      ['SELECT en outbox (solo INSERT en la base)', { ps_api01_outbox: ['SELECT'] }], ['privilegio inexistente en la base', { ps_api01_audit: ['DELETE'] }]];
    for (const [name, policy] of expand) expect(codes(audit(good(), { policy: policy as never })), name).toContain('POLICY_EXCEEDS_BASE');
  });
  it('una política VACÍA o malformada no produce un falso PASS (ni de seguridad ni de completitud)', () => {
    for (const bad of [{}, [], null, 'x', 5, { ps_api11_integrations: [] }, { ps_api11_integrations: 'SELECT' }, { ps_api11_integrations: [5] }, { ps_api11_integrations: ['SELECT; DROP'] }, { ps_api11_integrations: ['SELECT()'] }, { ps_api11_integrations: ['select'] }, { ps_api11_integrations: ['UPDATE(a b)'] }]) {
      const a = audit(good(), { policy: bad as never }); expect(a.ok, JSON.stringify(bad)).toBe(false); expect(a.complete).toBe(false); expect(['POLICY_INVALID', 'POLICY_EXCEEDS_BASE']).toContain(a.findings[0]?.code);
    }
    // incluso con grants vacíos o solo USAGE y una política vacía, nunca «completo»
    expect(audit([`GRANT USAGE ON *.* TO ${U}`], { policy: {} as never })).toMatchObject({ ok: false, complete: false });
  });
  it('la completitud se mide SIEMPRE contra la base: una restricción válida no puede reducir lo requerido', () => {
    const tiny = { novalvion_environment: ['SELECT'] };   // restricción válida (⊆ base)
    const onlyEnv = audit([line('SELECT', 'novalvion_environment')], { policy: tiny });
    expect(onlyEnv.ok).toBe(true); expect(onlyEnv.complete).toBe(false); expect(onlyEnv.missing.length).toBeGreaterThan(5);   // no es «completo» aunque coincida con su política
    expect(audit(good(), { policy: tiny }).findings.some(f => f.code === 'UNKNOWN_TABLE')).toBe(true);   // y lo que la restricción no permite es exceso
    expect(audit(good(), { policy: JSON.parse(JSON.stringify(RUNTIME_PRIVILEGE_POLICY)) })).toMatchObject({ ok: true, complete: true });   // la base explícita sigue siendo válida
  });
  it('la política base es inmutable en todos sus niveles (no se puede ampliar en tiempo de ejecución)', () => {
    expect(Object.isFrozen(RUNTIME_PRIVILEGE_POLICY)).toBe(true); for (const privs of Object.values(RUNTIME_PRIVILEGE_POLICY)) expect(Object.isFrozen(privs)).toBe(true);
    const mutate = () => { (RUNTIME_PRIVILEGE_POLICY.ps_api11_proof_claims as unknown as string[]).push('DELETE'); };
    expect(mutate).toThrow(); expect(() => { (RUNTIME_PRIVILEGE_POLICY as unknown as Record<string, string[]>).extra = ['SELECT']; }).toThrow();
    expect(codes(audit([...good(), line('DELETE', 'ps_api11_proof_claims')]))).toContain('EXCESS_PRIVILEGE');
  });
  it('una política con getters o proxies hostiles se rechaza sin excepciones nativas, y mutarla después no cambia lo auditado', () => {
    const hostile = new Proxy({}, { ownKeys() { throw new Error('secreto'); } }); expect(audit(good(), { policy: hostile as never })).toMatchObject({ ok: false, findings: [{ code: 'POLICY_INVALID' }] });
    const getter = { get ps_api11_integrations() { throw new Error('secreto'); } }; expect(audit(good(), { policy: getter as never }).ok).toBe(false);
    const policy: Record<string, string[]> = { ps_api11_integrations: ['SELECT'] }; const a = audit([line('SELECT', 'ps_api11_integrations')], { policy }); policy.ps_api11_integrations.push('DELETE'); expect(a.ok).toBe(true);
    expect(JSON.stringify(audit(good(), { policy: hostile as never }))).not.toContain('secreto');
  });
});

describe('identidad de cuenta usuario@host', () => {
  it('parseAccount exige exactamente un @ con usuario y host válidos', () => {
    expect(parseAccount('ps_runtime@localhost')).toEqual({ user: 'ps_runtime', host: 'localhost' }); expect(parseAccount('u@10.0.%')).toEqual({ user: 'u', host: '10.0.%' });
    for (const bad of ['', 'sin_arroba', '@host', 'user@', 'a@b@c', 'user@ host', ' user@host', 'user@host ', 'us er@host', 'user@ho\nst', "user@'%'", 'user@`h`', 5, null, undefined, 'x'.repeat(400)]) expect(parseAccount(bad as never), String(bad)).toBeNull();
  });
  it('accountMatches compara usuario (sensible a mayúsculas) y host (exacto sin distinguir mayúsculas); otro host, comodín o mismo usuario con otro host no coinciden', () => {
    const exp = { user: 'ps_runtime', host: 'localhost' };
    expect(accountMatches('ps_runtime@localhost', exp)).toBe(true); expect(accountMatches('ps_runtime@LOCALHOST', exp)).toBe(true);
    for (const other of ['ps_runtime@%', 'ps_runtime@10.0.0.5', 'ps_runtime@127.0.0.1', 'ps_runtime@local%', 'ps_runtime@localhost.evil', 'PS_RUNTIME@localhost', 'otro@localhost', 'ps_runtime', 'ps_runtime@', '@localhost', 'ps_runtime@localhost@x', '']) expect(accountMatches(other, exp), other).toBe(false);
    expect(accountMatches('ps_runtime@%', { user: 'ps_runtime', host: '%' })).toBe(true);   // solo coincide el patrón literal esperado (y la política de producción rechaza ese patrón al validar)
    expect(accountMatches('a@b', { user: '', host: 'x' })).toBe(false); expect(accountMatches('a@b', undefined as never)).toBe(false);
  });
  const lab = (): DbIdentity => ({ host: '127.0.0.1', port: 3307, schema: 'sandbox_api02_x', runtimeUser: 'sandbox_api02_run', registryWriterUser: 'sandbox_api02_reg', migrationUser: 'sandbox_api02_mig', runtimeHost: '127.0.0.1', registryWriterHost: '127.0.0.1', migrationHost: '127.0.0.1' });
  const prod = (): DbIdentity => ({ host: 'db.interno.example', port: 3306, schema: 'prod_pricesmart', runtimeUser: 'ps_runtime', registryWriterUser: 'ps_registry', migrationUser: 'ps_migrator', runtimeHost: 'localhost', registryWriterHost: 'localhost', migrationHost: 'localhost' });
  const issues = (l: Partial<DbIdentity>, p: Partial<DbIdentity>) => validateDatabaseSeparation({ lab: { ...lab(), ...l }, production: { ...prod(), ...p } }).issues.map(i => i.code);
  it('producción rechaza hosts de cuenta con comodines (% o _), incluso parciales, y hosts inválidos', () => {
    for (const host of ['%', '10.0.%', '%.interno.example', 'db_1', 'h_%']) for (const f of ['runtimeHost', 'registryWriterHost', 'migrationHost'] as const) expect(issues({}, { [f]: host }), `${f}=${host}`).toContain('WILDCARD_ACCOUNT_HOST');
    for (const host of ['', 'a b', 'h@x', "h'x", '-x']) expect(issues({}, { runtimeHost: host })).toContain('INVALID_FIELD');
    expect(issues({}, {})).toEqual([]); expect(issues({}, { runtimeHost: '10.0.0.5' })).toEqual([]);
  });
  it('cuentas con el mismo usuario y distinto host: no se consideran separadas (ejecución/registro/migración) ni separadas del laboratorio', () => {
    expect(issues({}, { registryWriterUser: 'ps_runtime', registryWriterHost: '10.0.0.9' })).toContain('ACCOUNTS_NOT_DISTINCT');
    expect(issues({}, { migrationUser: 'PS_RUNTIME', migrationHost: 'otro.host' })).toContain('ACCOUNTS_NOT_DISTINCT');
    expect(issues({}, { runtimeUser: 'sandbox_api02_run', runtimeHost: 'localhost' })).toEqual(expect.arrayContaining(['ACCOUNT_SHARED_WITH_LAB', 'PRODUCTION_USES_LAB_NAME']));
    expect(issues({}, { registryWriterUser: 'sandbox_api02_reg' })).toContain('ACCOUNT_SHARED_WITH_LAB');
  });
  it('las cuentas del laboratorio deben ser @127.0.0.1 y el laboratorio sigue exigiendo loopback', () => {
    expect(issues({ runtimeHost: '10.0.0.5' }, {})).toContain('LAB_ACCOUNT_HOST'); expect(issues({ migrationHost: '%' }, {})).toContain('LAB_ACCOUNT_HOST'); expect(issues({ host: '10.0.0.5' }, {})).toContain('LAB_NOT_LOOPBACK');
  });
  it('los hallazgos de identidad no exponen hosts ni cuentas', () => {
    const r = validateDatabaseSeparation({ lab: lab(), production: { ...prod(), runtimeHost: '10.99.%' } }); const text = JSON.stringify(r); expect(r.ok).toBe(false);
    for (const v of ['10.99.%', 'ps_runtime', 'localhost', 'db.interno.example']) expect(text).not.toContain(v);
  });
});
