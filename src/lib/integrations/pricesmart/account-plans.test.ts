import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAccountGrantPlan } from './account-plans';
import { MIGRATION_SCHEMA_PRIVILEGES, REGISTRY_WRITER_POLICY, RUNTIME_PRIVILEGE_POLICY, auditGrants, auditRoleGrants, type AccountRole } from './grants-audit';

const S = 'prod_pricesmart'; const input = (over: Partial<{ schema: string; user: string; host: string }> = {}) => ({ schema: S, user: 'ps_account', host: 'localhost', ...over });
const roles: AccountRole[] = ['runtime', 'registryWriter', 'migration'];
const lines = (role: AccountRole) => buildAccountGrantPlan(role, input());
const codes = (a: ReturnType<typeof auditRoleGrants>) => a.findings.map(f => f.code);
const acct = '`ps_account`@`localhost`';

describe('plan de privilegios por cuenta (solo texto para revisión)', () => {
  it('cada rol produce sentencias GRANT mínimas y la auditoría de ese mismo rol las acepta como completas (lo que se concede es lo que se verifica)', () => {
    for (const role of roles) { const plan = lines(role); expect(plan.length, role).toBeGreaterThan(0); const a = auditRoleGrants(role, plan, { schema: S }); expect(a, role).toEqual({ ok: true, complete: true, findings: [], missing: [] }); }
  });
  it('los planes son DISTINTOS y los privilegios no se pueden intercambiar: cada rol falla la auditoría de los otros', () => {
    for (const given of roles) for (const audited of roles) {
      if (given === audited) continue; const a = auditRoleGrants(audited, lines(given), { schema: S });
      expect(a.ok && a.complete, `${given} auditado como ${audited}`).toBe(false);
    }
    expect(new Set(roles.map(r => lines(r).join('\n'))).size).toBe(3);
  });
  it('la cuenta de ejecución no escribe el registro ni hace DDL; la del registro solo toca el registro; la de migración no tiene ningún privilegio de datos', () => {
    const runtime = lines('runtime').join('\n'); expect(runtime).toMatch(/ps_api18_resource_registry` TO/); expect(lines('runtime').find(l => l.includes('ps_api18_resource_registry'))).toMatch(/^GRANT SELECT ON/);
    expect(runtime).not.toMatch(/\b(DELETE|DROP|ALTER|CREATE|TRUNCATE|INDEX|REFERENCES|GRANT OPTION)\b/);
    const reg = lines('registryWriter'); expect(reg.every(l => l.includes('`ps_api18_resource_registry`'))).toBe(true); expect(reg.join('\n')).not.toMatch(/\b(DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/); expect(reg.join('\n')).toContain('UPDATE (`status`)');
    const mig = lines('migration').join('\n'); expect(mig).toBe(`GRANT CREATE, ALTER, INDEX, REFERENCES ON \`${S}\`.* TO ${acct}`); expect(mig).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/);
  });
  it('NUNCA emite contraseñas, IDENTIFIED BY, WITH GRANT OPTION, privilegios globales ni sentencias que no sean GRANT', () => {
    for (const role of roles) for (const l of lines(role)) { expect(l, l).toMatch(/^GRANT [A-Z, ()`a-z_]+ ON `prod_pricesmart`\.(\*|`[a-z0-9_]+`) TO `ps_account`@`localhost`$/); expect(l).not.toMatch(/IDENTIFIED|PASSWORD|WITH GRANT OPTION|\*\.\*|CREATE USER|ALTER USER|SET PASSWORD/i); }
  });
  it('rechaza esquema, usuario y host inválidos o con comodines y roles desconocidos (sin generar nada)', () => {
    for (const role of roles) {
      for (const over of [{ schema: 'a-b' }, { schema: '' }, { schema: 'x`; DROP' }, { user: '' }, { user: "x' OR 1" }, { user: 'a@b' }, { host: '%' }, { host: '10.0.%' }, { host: 'db_1' }, { host: '' }, { host: 'a b' }, { host: "h'" }])
        expect(() => buildAccountGrantPlan(role, input(over)), `${role} ${JSON.stringify(over)}`).toThrow('INVALID_ACCOUNT');
    }
    expect(() => buildAccountGrantPlan('otro' as never, input())).toThrow(); expect(() => buildAccountGrantPlan('runtime', undefined as never)).toThrow();
  });
  it('el plan de ejecución coincide exactamente con la política base; no se puede alterar la base para ampliar el plan', () => {
    const plan = lines('runtime'); expect(auditGrants(plan, { schema: S })).toMatchObject({ ok: true, complete: true });
    expect(() => { (RUNTIME_PRIVILEGE_POLICY.ps_api11_proof_claims as unknown as string[]).push('DELETE'); }).toThrow(); expect(() => { (REGISTRY_WRITER_POLICY.ps_api18_resource_registry as unknown as string[]).push('DELETE'); }).toThrow();
    expect(() => { (MIGRATION_SCHEMA_PRIVILEGES as unknown as string[]).push('DROP'); }).toThrow();
  });
});

describe('auditoría por rol: techo y requerido propios', () => {
  const U = acct; const reg = (p: string, t = 'ps_api18_resource_registry') => `GRANT ${p} ON \`${S}\`.\`${t}\` TO ${U}`; const schemaWide = (p: string) => `GRANT ${p} ON \`${S}\`.* TO ${U}`;
  it('cuenta del registro: se rechazan DELETE, UPDATE de tabla completa o de otras columnas, otras tablas, esquema completo y privilegios globales', () => {
    const ok = lines('registryWriter');
    for (const [extra, code] of [[reg('DELETE'), 'EXCESS_PRIVILEGE'], [reg('UPDATE'), 'EXCESS_PRIVILEGE'], [reg('UPDATE (`subject`)'), 'EXCESS_PRIVILEGE'], [reg('SELECT', 'ps_api18_attestation_nonces'), 'UNKNOWN_TABLE'], [reg('INSERT', 'ps_api01_orders'), 'UNKNOWN_TABLE'],
      [schemaWide('SELECT'), 'SCHEMA_WIDE'], [`GRANT ALL PRIVILEGES ON *.* TO ${U}`, 'GLOBAL_PRIVILEGE'], [reg('SELECT', 'otra') .replace(S, 'otra_db'), 'WRONG_SCHEMA'], [`${reg('SELECT')} WITH GRANT OPTION`, 'GRANT_OPTION']] as const)
      expect(codes(auditRoleGrants('registryWriter', [...ok, extra], { schema: S })), extra).toContain(code);
    expect(auditRoleGrants('registryWriter', ok.slice(0, 1), { schema: S }).complete).toBe(false);
  });
  it('cuenta de migración: cualquier privilegio de datos, DROP/TRUNCATE, global o a nivel de tabla se rechaza; el DDL aditivo a nivel de esquema se acepta y es requerido', () => {
    const ok = lines('migration');
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALL PRIVILEGES', 'EXECUTE', 'TRIGGER', 'LOCK TABLES']) expect(codes(auditRoleGrants('migration', [...ok, schemaWide(priv)], { schema: S })), priv).toContain('SCHEMA_WIDE');
    expect(codes(auditRoleGrants('migration', [...ok, reg('SELECT')], { schema: S }))).toContain('UNKNOWN_TABLE');
    expect(codes(auditRoleGrants('migration', [...ok, `GRANT CREATE ON *.* TO ${U}`], { schema: S }))).toContain('GLOBAL_PRIVILEGE'); expect(codes(auditRoleGrants('migration', [...ok, schemaWide('CREATE (`a`)')], { schema: S }))).toContain('SCHEMA_WIDE');
    const partial = auditRoleGrants('migration', [schemaWide('CREATE, ALTER')], { schema: S }); expect(partial.ok).toBe(true); expect(partial.complete).toBe(false); expect(partial.missing.map(m => m.privilege).sort()).toEqual(['INDEX', 'REFERENCES']);
  });
  it('rol desconocido o líneas ausentes: nunca un resultado favorable; los hallazgos no incluyen texto de las líneas', () => {
    expect(auditRoleGrants('otro' as never, lines('runtime'), { schema: S }).ok).toBe(false);
    for (const role of roles) { expect(auditRoleGrants(role, [], { schema: S }).ok).toBe(false); expect(auditRoleGrants(role, undefined as never, { schema: S }).ok).toBe(false); }
    const bad = auditRoleGrants('migration', [`GRANT ALL PRIVILEGES ON *.* TO ${U} IDENTIFIED BY PASSWORD '*HASHSECRETO'`], { schema: S }); expect(JSON.stringify(bad)).not.toMatch(/HASHSECRETO|ps_account|localhost/);
  });
  it('la auditoría de ejecución sigue siendo la de API-20 (política base obligatoria): una política propia que amplía el techo se rechaza', () => {
    const lax = { ...Object.fromEntries(Object.entries(RUNTIME_PRIVILEGE_POLICY).map(([t, p]) => [t, [...p]])), ps_api11_proof_claims: ['SELECT', 'INSERT', 'DELETE'] };
    expect(auditGrants([...lines('runtime'), reg('DELETE', 'ps_api11_proof_claims')], { schema: S, policy: lax })).toMatchObject({ ok: false, findings: [{ code: 'POLICY_EXCEEDS_BASE' }] });
  });
  it('los módulos son puros: sin base de datos, red ni entorno', () => {
    for (const f of ['account-plans.ts', 'grants-audit.ts']) expect(readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '')).not.toMatch(/process\.env|\bfetch\s*\(|from\s+['"](?:mysql2|node:|@\/)/);
  });
});
