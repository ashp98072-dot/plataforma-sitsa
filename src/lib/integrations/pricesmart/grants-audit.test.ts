import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUNTIME_PRIVILEGE_POLICY, auditGrants } from './grants-audit';
import { validateDatabaseSeparation, type DbIdentity } from './database-identity';

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
  it('una política propia más estricta se respeta; el SELECT de columnas cabe dentro de un SELECT de tabla permitido', () => {
    expect(audit([line('SELECT (`a`, `b`)', 'tabla')], { policy: { tabla: ['SELECT'] } })).toMatchObject({ ok: true, complete: false });   // columnas ⊆ tabla; falta el SELECT completo
    expect(audit([line('SELECT', 'tabla'), line('INSERT', 'tabla')], { policy: { tabla: ['SELECT'] } }).ok).toBe(false);
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
  const lab = (): DbIdentity => ({ host: '127.0.0.1', port: 3307, schema: 'sandbox_api02_x', runtimeUser: 'sandbox_api02_run', registryWriterUser: 'sandbox_api02_reg', migrationUser: 'sandbox_api02_mig' });
  const prod = (): DbIdentity => ({ host: 'db.interno.example', port: 3306, schema: 'prod_pricesmart', runtimeUser: 'ps_runtime', registryWriterUser: 'ps_registry', migrationUser: 'ps_migrator' });
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
