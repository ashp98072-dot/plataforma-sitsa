import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bundleModule from '../../../../../scripts/ci/pricesmart-homologation/bundle.mjs';
import { validateSandboxConfig } from '../../../../../scripts/sandbox-config.mjs';
import { RUNTIME_PRIVILEGE_POLICY, auditRoleGrants } from '../grants-audit';
import { buildAccountGrantPlan } from '../account-plans';
import { isPriceSmartHandlerInstalled, installPriceSmartHandler } from '../runtime-state';
import { fileKillSwitch, homologationGate, installHomologationRuntime, createHomologationRuntime, type HomologationDeps } from './runtime';

vi.mock('../../../sandbox-db', () => ({ isSandboxVerifiedPool: () => true }));
const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (orig) => { const real = (await orig()) as Record<string, unknown>; return { ...real, default: { ...(real.default as object), spawnSync: spawn }, spawnSync: spawn }; });
const B = bundleModule as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const repo = path.resolve(__dirname, '../../../../..');
afterEach(() => { installPriceSmartHandler(null); });

describe('API-26 paquete de aprovisionamiento: nombres, SQL y privilegios', () => {
  const bundle = B.buildBootstrap('sbx1', repo);
  it('nombres derivados: solo `sandbox_api02_homolog_*`, distinguibles del laboratorio (hexadecimal) y con cuentas distintas por rol', () => {
    expect(bundle.names).toMatchObject({ sandboxId: 'homolog-sbx1', schema: 'sandbox_api02_homolog_sbx1', appUser: 'sandbox_api02_homolog_sbx1', workerUser: 'sandbox_api02_homolog_wsbx1', monitorUser: 'sandbox_api02_homolog_msbx1' });
    for (const bad of ['', 'A', 'x'.repeat(17), 'a-b', 'a b', "a'b", '../x', 'a;b']) expect(() => B.homologNames(bad), bad).toThrow('INVALID_SANDBOX_NAME');
    expect(/^sandbox_api02_[0-9a-f]+$/.test(bundle.names.schema)).toBe(false);   // un nombre de laboratorio es sandbox_api02_<hex>: este nunca lo es
  });
  it('el SQL de revisión: crea la base SIN «IF NOT EXISTS», no contiene contraseñas ni sentencias destructivas, y las contraseñas llegan por variables de sesión', () => {
    const sql: string = B.renderBootstrapSql(bundle);
    expect(sql).toMatch(/CREATE DATABASE `sandbox_api02_homolog_sbx1`/); expect(sql).not.toMatch(/IF NOT EXISTS `sandbox/i);
    expect(sql.replaceAll('ON DELETE RESTRICT', '')).not.toMatch(/\b(DROP|TRUNCATE|ALTER|DELETE|SIGNAL)\b|WITH GRANT OPTION|ON \*\.\*|ALL PRIVILEGES|IDENTIFIED BY '(?!, QUOTE\(@ps_)/i)   // la única forma admitida: la contraseña sale de QUOTE(@variable de sesión);   // las FK `ON DELETE RESTRICT` del diseño son restricciones, no sentencias
    for (const v of ['@ps_app_pw', '@ps_worker_pw', '@ps_monitor_pw']) expect(sql).toContain(v);
    expect(sql).toContain("'sandbox', 'homolog-sbx1'");   // fila de entorno: la base se identifica como sandbox y con su identificador
    expect(sql).toMatch(/CHECK \(environment = 'sandbox'\)/);
  });
  it('todas las cuentas son @127.0.0.1 y ningún privilegio es global, de esquema completo, DELETE, DDL ni GRANT OPTION', () => {
    for (const role of ['app', 'worker', 'monitor']) for (const g of bundle.grants[role] as string[]) {
      expect(g, g).toMatch(/@`127\.0\.0\.1`$/); expect(g, g).toMatch(/^GRANT [A-Z, ()`_a-z0-9]+ ON `sandbox_api02_homolog_sbx1`\.`[a-z0-9_]+` TO /); expect(g, g).not.toMatch(/DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT OPTION|ALL|FILE|SUPER|\*/);
    }
  });
  it('deriva: la parte PriceSmart del rol `app` coincide EXACTAMENTE con RUNTIME_PRIVILEGE_POLICY (la misma que audita API-20/21), y el plan por rol de API-21 produce las mismas sentencias', () => {
    const policyTables = Object.keys(RUNTIME_PRIVILEGE_POLICY);
    for (const t of policyTables) expect([...B.ROLE_POLICY.app[t]].sort(), t).toEqual([...RUNTIME_PRIVILEGE_POLICY[t]].sort());
    const mine = (bundle.grants.app as string[]).filter((g) => policyTables.some((t) => g.includes(`.\`${t}\` `))).map((g) => g.replace(/@`127\.0\.0\.1`$/, '')).sort();
    const reference = buildAccountGrantPlan('runtime', { schema: bundle.names.schema, user: bundle.names.appUser, host: '127.0.0.1' }).map((g) => g.replace(/@`127\.0\.0\.1`$/, '')).sort();
    expect(mine).toEqual(reference);
  });
  it('lo que concede el paquete pasa la auditoría de privilegios mínimos del runtime (SHOW GRANTS simulado) y las otras cuentas no tienen nada del runtime', () => {
    const toShow = (grants: string[], user: string) => grants.map((g) => g.replace(/ TO .*$/, ` TO \`${user}\`@\`127.0.0.1\``));
    const onlyPolicy = (bundle.grants.app as string[]).filter((g) => Object.keys(RUNTIME_PRIVILEGE_POLICY).some((t) => g.includes(`.\`${t}\` `)));
    const audit = auditRoleGrants('runtime', [...toShow(onlyPolicy, bundle.names.appUser), `GRANT USAGE ON *.* TO \`${bundle.names.appUser}\`@\`127.0.0.1\``], { schema: bundle.names.schema });
    expect(audit).toMatchObject({ ok: true, complete: true, findings: [] });
    expect(bundle.grants.worker.join('\n')).not.toMatch(/ps_api11|ps_api12|ps_api13|tms_/); expect(bundle.grants.monitor.join('\n')).not.toMatch(/INSERT|UPDATE/);
  });
});

describe('API-26 barreras del ejecutor', () => {
  const ok = { host: '127.0.0.1', port: 3306, ack: B.HOMOLOG_ACK, env: {}, secrets: { app: 'a'.repeat(32), worker: 'b'.repeat(32), monitor: 'c'.repeat(32) } };
  it('solo loopback, con ACK explícito, sin marcadores de producción ni variables del laboratorio, con secretos fuertes y distintos', () => {
    expect(B.assertApplyTarget(ok)).toBe(true);
    const no = (patch: Record<string, unknown>, msg: string) => expect(() => B.assertApplyTarget({ ...ok, ...patch }), msg).toThrow(msg);
    for (const host of ['db.ejemplo.com', '10.0.0.5', 'localhost', '0.0.0.0', '', undefined, 'srv1234.hstgr.io']) no({ host }, 'TARGET_NOT_LOOPBACK');
    for (const port of [0, 80, 99999, 3306.5, '3306']) no({ port }, 'INVALID_PORT');
    for (const ack of [undefined, '', 'si', B.HOMOLOG_DESTROY_ACK]) no({ ack }, 'ACK_MISSING');
    for (const env of [{ NOVALVION_ENV: 'production' }, { NODE_ENV: 'production' }, { PRICESMART_RUNTIME_ENVIRONMENT: 'production' }]) no({ env }, 'PRODUCTION_MARKERS_PRESENT');
    for (const env of [{ PRICESMART_LAB_DEMO: 'x' }, { PRICESMART_LAB_KEY: 'k' }]) no({ env }, 'LAB_COMPOSITION_FLAGS_PRESENT');
    no({ secrets: { ...ok.secrets, worker: ok.secrets.app } }, 'WEAK_OR_REUSED_SECRETS'); no({ secrets: { ...ok.secrets, app: 'corta' } }, 'WEAK_OR_REUSED_SECRETS'); no({ secrets: { ...ok.secrets, app: 'a b'.repeat(12) } }, 'WEAK_OR_REUSED_SECRETS');
  });
  it('la baja solo nombra `sandbox_api02_homolog_*` y sus tres cuentas', () => {
    const d: string[] = B.destroyStatements('sbx1'); expect(d).toHaveLength(4);
    for (const s of d) expect(s).toMatch(/`sandbox_api02_homolog_[wm]?sbx1`/); expect(d.at(-1)).toBe('DROP DATABASE IF EXISTS `sandbox_api02_homolog_sbx1`');
    expect(() => B.destroyStatements('../x')).toThrow();
  });
  it('lista de archivos del TMS: esquema base primero, migraciones ordenadas y la de confirmaciones al final', () => {
    const files: string[] = B.tmsSchemaFiles(repo); expect(files[0]).toBe('sql/schema.sql'); expect(files.at(-1)).toBe('sql/migrate-2026-11-tms-parada-confirmaciones.sql'); expect(new Set(files).size).toBe(files.length);
  });
});

describe('API-26 revocación, alta de integración y monitoreo', () => {
  it('revocar: solo referencias válidas (sin SQL libre) y con parámetros enlazados', () => {
    const r = B.revokeStatement({ issuer: 'iss', subject: 'sub', credentialReference: 'cred-1' }); expect(r.sql).toMatch(/^INSERT INTO ps_api11_revocations/); expect(r.params).toHaveLength(4);
    for (const bad of [undefined, {}, { issuer: "x'; DROP", subject: 's', credentialReference: 'c' }, { issuer: '', subject: 's', credentialReference: 'c' }, { issuer: 'a b', subject: 's', credentialReference: 'c' }]) expect(() => B.revokeStatement(bad)).toThrow('INVALID_CREDENTIAL_REFERENCE');
  });
  it('alta de integración: todo lo aporta el operador, alcances cerrados, clubes obligatorios y vigencia acotada', () => {
    const base = { issuer: 'iss', subject: 'sub', credentialReference: 'cred', tenantId: 1, clientId: 1, integrationId: 'ps', allowedClubs: ['CLUB-A'], scopes: ['orders:read'], validFromMs: 1_700_000_000_000, validUntilMs: 1_700_000_000_000 + 86_400_000 };
    expect(B.registerIntegrationStatement(base).sql).toMatch(/_binary'sandbox'/);
    const no = (patch: Record<string, unknown>, msg: string) => expect(() => B.registerIntegrationStatement({ ...base, ...patch }), msg).toThrow(msg);
    no({ scopes: ['orders:delete'] }, 'INVALID_SCOPES'); no({ scopes: [] }, 'INVALID_SCOPES'); no({ allowedClubs: [] }, 'INVALID_CLUBS'); no({ tenantId: 0 }, 'INVALID_SCOPE');
    no({ validUntilMs: base.validFromMs }, 'INVALID_VALIDITY'); no({ validUntilMs: base.validFromMs + 500 * 86_400_000 }, 'INVALID_VALIDITY'); no({ issuer: undefined }, 'INVALID_CREDENTIAL_REFERENCE');
    expect(() => B.registerIntegrationStatement(undefined)).toThrow();
  });
  it('monitoreo: solo SELECT sobre columnas de la política `monitor` y reglas de alerta que apuntan a consultas existentes', () => {
    for (const [id, sql] of Object.entries<string>(B.MONITORING_QUERIES)) { expect(sql, id).toMatch(/^SELECT /); expect(sql, id).not.toMatch(/INSERT|UPDATE|DELETE|DROP|SLEEP|;/i); }
    for (const rule of B.ALERT_RULES as { query: string }[]) expect(Object.keys(B.MONITORING_QUERIES)).toContain(rule.query);
  });
});

describe('API-26 plantillas de proxy, servicio y entorno', () => {
  const nginxOpts = { publicHostname: 'sandbox.ejemplo.com', certPath: '/etc/ssl/ps/fullchain.pem', keyPath: '/etc/ssl/ps/privkey.pem', allowlist: ['203.0.113.0/24'] };
  it('proxy: HTTPS + HSTS, allowlist obligatoria con `deny all`, 8 KiB, límite de tasa, SOLO las tres rutas con su método, lo demás 404 y cabecera de laboratorio eliminada', () => {
    const conf: string = B.renderNginx(nginxOpts);
    expect(conf).toContain('listen 443 ssl'); expect(conf).toContain('Strict-Transport-Security'); expect(conf).toContain('client_max_body_size 8k'); expect(conf).toContain('allow 203.0.113.0/24;'); expect(conf).toContain('deny all;');
    expect(conf.match(/^\s+location /gm)).toHaveLength(4); expect(conf).toContain('location / { return 404; }'); expect(conf).toContain('limit_req zone=ps_sandbox');
    expect(conf).toContain('limit_except POST { deny all; }'); expect(conf).toContain('limit_except GET { deny all; }'); expect(conf).toMatch(/proxy_pass http:\/\/127\.0\.0\.1:3100;/);
    expect(conf).not.toMatch(/proxy_pass http:\/\/(?!127\.0\.0\.1)/); expect(B.NGINX_PROXY_INCLUDE).toContain('proxy_set_header x-lab-evidence "";');
  });
  it('proxy: rechaza hostnames/rutas/allowlists inválidas o abiertas (0.0.0.0/0) y límites fuera de rango', () => {
    const no = (patch: Record<string, unknown>, msg: string) => expect(() => B.renderNginx({ ...nginxOpts, ...patch }), msg).toThrow(msg);
    for (const publicHostname of ['localhost', 'a;b.com', 'x y.com', '', undefined]) no({ publicHostname }, 'INVALID_HOSTNAME');
    for (const certPath of ['rel/cert.pem', '/etc/a b', '/etc/x;y']) no({ certPath }, 'INVALID_TLS_PATH');
    for (const allowlist of [[], undefined, ['0.0.0.0/0'], ['::/0'], ['0.0.0.0/8'], ['300.1.1.1'], ['a;b'], ['1.1.1.1/33']]) no({ allowlist }, 'INVALID_ALLOWLIST');
    no({ appPort: 80 }, 'INVALID_LIMITS'); no({ ratePerSecond: 0 }, 'INVALID_LIMITS'); no({ burst: 9999 }, 'INVALID_LIMITS');
    expect(() => B.renderNginx(undefined)).toThrow();
  });
  it('servicio systemd: loopback, usuario sin privilegios, secretos en un EnvironmentFile fuera del repositorio y endurecimiento', () => {
    const unit: string = B.renderSystemd({}); expect(unit).toContain('--hostname 127.0.0.1'); expect(unit).toContain('EnvironmentFile=/etc/pricesmart-sandbox/runtime.env'); expect(unit).toContain('NoNewPrivileges=true'); expect(unit).toContain('ProtectSystem=strict');
    for (const bad of [{ root: 'rel' }, { user: 'Root' }, { appPort: 22 }, { envFile: '/etc/a;b' }]) expect(() => B.renderSystemd(bad)).toThrow('INVALID_SYSTEMD_OPTIONS');
  });
  it('plantilla de entorno: runtime APAGADO por omisión, sin decisiones ratificadas, sin variables del laboratorio y SIN valores secretos', () => {
    const env: string = B.renderEnvTemplate(bundleModule.homologNames('sbx1')); expect(env).toContain('PRICESMART_RUNTIME_MODE=DISABLED'); expect(env).toContain('PRICESMART_RATIFIED_DECISIONS=\n'.trimEnd());
    expect(env).not.toMatch(/PRICESMART_LAB|x-lab-evidence|HMAC/i); expect(env).not.toMatch(/sandbox:homolog-sbx1:[0-9a-f]{64}/); expect(env).toContain('DB_HOST=127.0.0.1'); expect(env).toContain('NOVALVION_ENV=sandbox');
  });
  it('el manifiesto y los secretos generados SON aceptados por `validateSandboxConfig` (la guarda vigente, sin relajar) y los mismos secretos duplicados o cambiados la rompen', () => {
    const names = B.homologNames('sbx1'); const secrets = B.generateSandboxSecrets(names); const root = mkdtempSync(path.join(os.tmpdir(), 'ps-homolog-')); const cwd = mkdtempSync(path.join(os.tmpdir(), 'ps-homolog-cwd-'));
    mkdirSync(path.join(root, 'uploads')); writeFileSync(path.join(root, 'isolation.json'), JSON.stringify(B.buildIsolationManifest(names, secrets, { dbPort: 3310 })));
    const env = { NOVALVION_ENV: 'sandbox', SANDBOX_ID: names.sandboxId, SANDBOX_ROOT: root, NEXT_TELEMETRY_DISABLED: '1', DB_HOST: '127.0.0.1', DB_PORT: '3310', DB_NAME: names.schema, DB_USER: names.appUser, ...secrets,
      CB2_PUBLIC_ORIGIN: 'https://localhost', EMPRESA_DOMINIOS: '{"localhost":"kt-monaco"}', UPLOAD_DIR: path.join(root, 'uploads') };
    expect(validateSandboxConfig(env, cwd)).toMatchObject({ id: 'homolog-sbx1' });
    expect(() => validateSandboxConfig({ ...env, DB_HOST: 'db.ejemplo.com' }, cwd)).toThrow(); expect(() => validateSandboxConfig({ ...env, AUTH_SECRET: env.DB_PASSWORD }, cwd)).toThrow();
    expect(() => validateSandboxConfig({ ...env, DB_PASSWORD: `sandbox:${names.sandboxId}:${'0'.repeat(64)}` }, cwd)).toThrow();   // no coincide con el hash del manifiesto
    expect(new Set(Object.values(secrets)).size).toBe(3); for (const v of Object.values<string>(secrets)) expect(v).toMatch(/^sandbox:homolog-sbx1:[0-9a-f]{64}$/);
  });
});

describe('API-26 runtime de homologación: compuerta, interruptor e instalación controlada', () => {
  const env = { NOVALVION_ENV: 'sandbox', SANDBOX_ID: 'homolog-sbx1', DB_HOST: '127.0.0.1', DB_NAME: 'sandbox_api02_homolog_sbx1', DB_USER: 'sandbox_api02_homolog_sbx1', PRICESMART_DB_SCHEMA: 'sandbox_api02_homolog_sbx1', PRICESMART_DB_RUNTIME_USER: 'sandbox_api02_homolog_sbx1', PRICESMART_RUNTIME_ENVIRONMENT: 'sandbox' };
  it('la compuerta de proceso exige sandbox homolog, base loopback con nombres homolog coherentes y ninguna variable del laboratorio', () => {
    expect(homologationGate(env)).toEqual({ ok: true });
    const bad = (patch: Record<string, string | undefined>) => expect(homologationGate({ ...env, ...patch }).ok, JSON.stringify(patch)).toBe(false);
    bad({ NOVALVION_ENV: 'production' }); bad({ NOVALVION_ENV: undefined }); bad({ SANDBOX_ID: 'lab-123456' }); bad({ SANDBOX_ID: 'homolog-' }); bad({ DB_HOST: 'db.ejemplo.com' }); bad({ DB_NAME: 'sandbox_api02_0123abcd' }); bad({ DB_USER: 'root' });
    bad({ PRICESMART_DB_SCHEMA: 'sandbox_api02_homolog_otro' }); bad({ PRICESMART_RUNTIME_ENVIRONMENT: 'production' }); bad({ PRICESMART_LAB_DEMO: 'SINTETICO-LOCAL-SIN-PRODUCCION' }); bad({ PRICESMART_LAB_KEY: 'k'.repeat(40) });
  });
  it('interruptor de emergencia por archivo: solo `ON` enciende; ausente, ilegible o con cualquier otro contenido apaga (cierra)', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ps-kill-')); const f = path.join(dir, 'killswitch'); const sw = fileKillSwitch(f);
    expect(sw()).toBe(true);   // ausente ⇒ apagado
    writeFileSync(f, 'ON\n'); expect(sw()).toBe(false); writeFileSync(f, 'on'); expect(sw()).toBe(true); writeFileSync(f, 'OFF'); expect(sw()).toBe(true); writeFileSync(f, ''); expect(sw()).toBe(true);
    expect(fileKillSwitch(dir)()).toBe(true);   // un directorio no es legible como archivo ⇒ apagado
  });
  const stubPool = () => ({ execute: async () => [[{ environment: 'sandbox', sandbox_id: 'homolog-sbx1', n: 0 }]], getConnection: async () => { throw new Error('sin base'); } }) as never;
  const deps = (over: Partial<HomologationDeps> = {}): HomologationDeps => ({ pool: stubPool(), workerPool: stubPool(), schema: 'sandbox_api02_homolog_sbx1', runtimeUser: 'sandbox_api02_homolog_sbx1', workerUser: 'sandbox_api02_homolog_wsbx1',
    evidence: { extract: async () => null }, verifier: { verify: async () => null }, cipher: { seal: async () => ({ ciphertext: Buffer.alloc(0), keyReference: 'k' }), open: async () => ({}) } as never,
    contract: { orderSchema: { parse: (x: unknown) => x } as never, canonicalInput: () => [] } as never, killSwitch: () => true, ...over });
  it('sin modo ENABLED o con decisiones sin ratificar NO instala el handler (503 DISABLED), no arranca el consumidor y nunca incluye valores en el informe', async () => {
    for (const extra of [{}, { PRICESMART_RUNTIME_MODE: 'DISABLED' }, { PRICESMART_RUNTIME_MODE: 'READ_ONLY', PRICESMART_ORIGIN_CLUB: 'C1' }, { PRICESMART_RUNTIME_MODE: 'ENABLED', PRICESMART_ORIGIN_CLUB: 'C1', PRICESMART_RUNTIME_ACK: 'CONFIRMO-ACTIVAR-PRICESMART-SANDBOX' }]) {
      const r = await installHomologationRuntime({ ...env, ...extra }, deps()); expect(r.ready).toBe(false); expect(r.consumerStarted).toBe(false); expect(isPriceSmartHandlerInstalled()).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(/sandbox_api02_homolog|CONFIRMO/);
    }
  });
  it('fuera de la compuerta (producción, laboratorio, nombres ajenos) bloquea con HOMOLOGATION_GATE sin tocar nada', async () => {
    for (const patch of [{ NOVALVION_ENV: 'production' }, { PRICESMART_LAB_DEMO: 'SINTETICO-LOCAL-SIN-PRODUCCION' }, { DB_NAME: 'sandbox_api02_abc123' }]) {
      const r = await installHomologationRuntime({ ...env, ...patch }, deps()); expect(r.blockers[0]).toMatchObject({ code: 'HOMOLOGATION_GATE' }); expect(isPriceSmartHandlerInstalled()).toBe(false);
    }
  });
  it('nombres fuera del patrón sandbox_api02_* hacen fallar la construcción (COMPOSITION_FAILED); la exigencia `homolog` la aplica la compuerta de proceso', async () => {
    expect(() => createHomologationRuntime(deps({ runtimeUser: 'root' }))).toThrow('INVALID_HOMOLOGATION_NAMES'); expect(() => createHomologationRuntime(deps({ workerUser: 'sandbox_api02_homolog_sbx1' }))).toThrow();   // el worker no puede ser la cuenta de la aplicación
    const r = await installHomologationRuntime({ ...env, PRICESMART_RUNTIME_MODE: 'DISABLED' }, deps({ schema: 'otro' })); expect(r.blockers[0].code).toBe('COMPOSITION_FAILED'); expect(isPriceSmartHandlerInstalled()).toBe(false);
  });
});

describe('API-26 aislamiento estático', () => {
  const src = path.resolve(__dirname, '../../../..');
  const strip = (t: string) => t.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  it('el runtime de homologación NO importa el verificador/cifrado de laboratorio ni su compuerta; de lab-demo solo toma la vinculación al TMS; no lee process.env ni la variable de laboratorio', () => {
    const t = strip(readFileSync(path.join(__dirname, 'runtime.ts'), 'utf8'));
    const labImports = [...t.matchAll(/from '\.\.\/lab-demo\/([a-z-]+)'/g)].map((m) => m[1]).sort(); expect(labImports).toEqual(['link-retry', 'outbox-link-handler', 'tms-link']);
    expect(t).not.toMatch(/lab-crypto|lab-key-provider|lab-kms-client|lab-demo\/(composition|gate|autoinstall)|x-lab-evidence|PRICESMART_LAB_DEMO|labVerifier|labCipher|process\.env/);
  });
  it('NADA invoca hoy el runtime de homologación (ni rutas ni otros módulos): solo sus pruebas', () => {
    const hits: string[] = [];
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !n.includes('.test.') && f !== path.join(__dirname, 'runtime.ts') && /homologation\/runtime|installHomologationRuntime|createHomologationRuntime/.test(readFileSync(f, 'utf8'))) hits.push(path.relative(src, f)); } };
    walk(src); expect(hits).toEqual([]);
  }, 30000);
  it('el paquete de aprovisionamiento no menciona el verificador HMAC de laboratorio y su ejecutor solo se conecta a loopback', () => {
    const t = strip(readFileSync(path.join(repo, 'scripts/ci/pricesmart-homologation/bundle.mjs'), 'utf8'));
    expect(t.match(/x-lab-evidence/g)).toHaveLength(1); expect(t).toMatch(/proxy_set_header x-lab-evidence "";/);   // única mención: el proxy ELIMINA la cabecera de laboratorio
    expect(t).not.toMatch(/labVerifier|lab-crypto|createHmac/); expect(t).toContain("host !== '127.0.0.1' && host !== '::1'");
  });
});

// ---- Conexión SIMULADA guionizada: responde al preflight y a los marcadores como lo haría la base, registra TODAS las sentencias y permite inyectar fallos de DDL por patrón.
type Steps = Record<string, string | undefined>;
function scripted(opts: { exists?: boolean; marker?: boolean; sandboxId?: string; steps?: Steps; failOn?: (sql: string) => { code: string; message?: string } | null } = {}) {
  const exists = opts.exists ?? true; const marker = opts.marker ?? true; const steps: Steps = { ...(opts.steps ?? { bootstrap: 'COMPLETE' }) }; const sql: string[] = []; const marks: Array<[string, string, string | null]> = [];
  const conn = {
    sql, marks, steps,
    async query(statement: string, params: unknown[] = []) {
      if (/FROM information_schema\.SCHEMATA/.test(statement)) return [[{ n: exists ? 1 : 0 }]];
      if (/FROM information_schema\.TABLES/.test(statement)) return [[{ n: marker ? 1 : 0 }]];
      if (/FROM `[^`]+`\.novalvion_environment/.test(statement)) return [[{ sandbox_id: opts.sandboxId ?? 'homolog-sbx1' }]];
      if (/SELECT step, state FROM/.test(statement)) return [Object.entries(steps).map(([step, state]) => ({ step, state }))];
      if (/INSERT INTO `[^`]+`\.`ps_homolog_provisioning`/.test(statement)) { const [step, state, detail] = params as [string, string, string | null]; steps[step] = state; marks.push([step, state, detail]); return [[]]; }
      sql.push(statement);
      const failure = opts.failOn?.(statement); if (failure) throw Object.assign(new Error(failure.message ?? 'fallo'), { code: failure.code });
      return [[]];
    },
  };
  return conn;
}
const brokenRepo = () => { const r = mkdtempSync(path.join(os.tmpdir(), 'ps-broken-')); mkdirSync(path.join(r, 'sql')); writeFileSync(path.join(r, 'sql', 'broken.sql'), 'CREATE TABLE ok_t (id INT);\nCREATE TABLE bad_t (a INT, FOREIGN KEY (a) REFERENCES no_existe(id));\nCREATE TABLE tabla_con_secreto (a INT);\n'); return r; };
const failSyntax = (statement: string) => (/bad_t/.test(statement) ? { code: 'ER_PARSE_ERROR', message: 'You have an error in your SQL syntax password=secreto-xyz' } : null);
const failBad = (statement: string) => (/bad_t/.test(statement) ? { code: 'ER_CANT_CREATE_TABLE', message: 'Can\'t create table (errno: 150) password=secreto-xyz' } : null);
const secretsOf = (names: unknown) => ({ app: B.generateSandboxSecrets(names).DB_PASSWORD, worker: 'w'.repeat(32), monitor: 'm'.repeat(32) });

describe('API-26 segunda parte del aprovisionamiento (esquema de ejecución): privilegios temporales SIEMPRE revocados', () => {
  const bundle = B.buildBootstrap('sbx1', repo); const secrets = B.generateSandboxSecrets(bundle.names);
  const root = () => { const r = mkdtempSync(path.join(os.tmpdir(), 'ps-fin-')); mkdirSync(path.join(r, 'uploads')); writeFileSync(path.join(r, 'isolation.json'), '{}'); return r; };
  const opts = (extra: Record<string, unknown> = {}) => ({ repo, sandboxRoot: root(), sandboxSecrets: secrets, dbPort: 3310, ...extra });
  const grantIdx = (sql: string[]) => sql.findIndex((x) => /^GRANT ALL PRIVILEGES ON `sandbox_api02_homolog_sbx1`\.\* TO /.test(x)); const revokeIdx = (sql: string[]) => sql.findIndex((x) => /^REVOKE ALL PRIVILEGES ON `sandbox_api02_homolog_sbx1`\.\* FROM /.test(x));
  const ensuredGranted = (sql: string[]) => sql.some((x) => /^GRANT/.test(x) && /`tms_plan_paradas`|`tms_parada_confirmaciones`/.test(x));
  it('éxito: concede, ejecuta con el entorno del sandbox (loopback, homolog, manifiesto), REVOCA, completa las migraciones y SOLO entonces aplica los privilegios finales y marca COMPLETE', async () => {
    spawn.mockReset(); spawn.mockReturnValue({ status: 0, stdout: 'ok', stderr: '' }); const c = scripted();
    const r = await B.finalizeBundle(c, bundle, opts()); expect(r.runtimeSchemaStep.exit).toBe(0); expect(r.ensuredGrants).toBeGreaterThan(0);
    expect(grantIdx(c.sql)).toBeGreaterThanOrEqual(0); expect(revokeIdx(c.sql)).toBeGreaterThan(grantIdx(c.sql));
    expect(c.sql.findIndex((x) => /^GRANT SELECT.*`tms_parada_confirmaciones`/.test(x))).toBeGreaterThan(revokeIdx(c.sql));   // los privilegios restantes se conceden DESPUÉS de revocar los temporales
    expect(c.marks.map((m) => m.slice(0, 2).join(':'))).toEqual(['finalize:STARTED', 'finalize:COMPLETE']);
    const env = spawn.mock.calls[0][2].env as Record<string, string>;
    expect(env).toMatchObject({ NOVALVION_ENV: 'sandbox', SANDBOX_ID: 'homolog-sbx1', DB_HOST: '127.0.0.1', DB_PORT: '3310', DB_NAME: 'sandbox_api02_homolog_sbx1', DB_USER: 'sandbox_api02_homolog_sbx1', NODE_ENV: 'test' });
    expect(Object.keys(env).some((k) => k.startsWith('PRICESMART_LAB_'))).toBe(false);
  });
  it('fallo del paso (salida ≠ 0) o excepción al lanzarlo: se REVOCAN los privilegios temporales, NO se aplican los finales, NO se marca COMPLETE y se deja FAILED', async () => {
    for (const mode of ['exit', 'throw']) {
      spawn.mockReset(); if (mode === 'exit') spawn.mockReturnValue({ status: 1, stdout: '', stderr: 'boom' }); else spawn.mockImplementation(() => { throw new Error('no se pudo lanzar'); });
      const c = scripted(); await expect(B.finalizeBundle(c, bundle, opts()), mode).rejects.toThrow(/RUNTIME_SCHEMA_STEP_FAILED|no se pudo lanzar/);
      expect(grantIdx(c.sql), mode).toBeGreaterThanOrEqual(0); expect(revokeIdx(c.sql), mode).toBeGreaterThan(grantIdx(c.sql)); expect(ensuredGranted(c.sql), mode).toBe(false);
      expect(c.marks.at(-1)?.slice(0, 2), mode).toEqual(['finalize', 'FAILED']); expect(c.steps.finalize).toBe('FAILED');
    }
  });
  it('FALLO DE DDL en `finalize`: una migración/confirmación que no se puede aplicar → TMS_SCHEMA_INCOMPLETE con diagnóstico seguro, privilegios temporales ya revocados, SIN privilegios finales y SIN COMPLETE', async () => {
    for (const phases of [{ base: [], migrations: ['sql/broken.sql'], confirmations: [] }, { base: [], migrations: [], confirmations: ['sql/broken.sql'] }, { base: ['sql/broken.sql'], migrations: [], confirmations: [] }]) {
      const c = scripted({ failOn: failBad }); const r = brokenRepo();
      const error = await B.finalizeBundle(c, bundle, opts({ repo: r, phases, runtimeSchemaStep: async () => ({ exit: 0, tail: '' }) })).catch((e: Error) => e) as Error & { code: string; diagnostic: { phase: string; files: { pendingAtEnd: number; failures: { statement: string; code: string }[] }[] } };
      expect(error.code).toBe('TMS_SCHEMA_INCOMPLETE'); expect(error.diagnostic.files[0].pendingAtEnd).toBe(1); expect(error.diagnostic.files[0].failures[0]).toEqual({ statement: expect.stringMatching(/^CREATE TABLE bad_t/), code: 'ER_CANT_CREATE_TABLE' });
      expect(JSON.stringify(error.diagnostic)).not.toMatch(/secreto-xyz|password|IDENTIFIED|ps_app_pw|sandbox:homolog/i);   // ni el mensaje del servidor ni secretos
      expect(revokeIdx(c.sql)).toBeGreaterThan(grantIdx(c.sql)); expect(ensuredGranted(c.sql)).toBe(false); expect(c.steps.finalize).toBe('FAILED'); expect(c.marks.some((m) => m[1] === 'COMPLETE')).toBe(false);
    }
  });
  it('las migraciones se aplican en DOS rondas: lo que depende de otra sentencia se resuelve en la 2.ª; lo que sigue fallando tras la 2.ª BLOQUEA los privilegios finales', async () => {
    let calls = 0; const dependent = scripted({ failOn: (q) => (/bad_t/.test(q) && ++calls <= 2 ? { code: 'ER_NO_SUCH_TABLE' } : null) });   // falla en las pasadas 1–2 de la 1.ª ronda y luego se resuelve
    const ok = await B.finalizeBundle(dependent, bundle, opts({ repo: brokenRepo(), phases: { base: [], migrations: ['sql/broken.sql'], confirmations: [] }, runtimeSchemaStep: async () => ({ exit: 0, tail: '' }) })); expect(ok.ensuredGrants).toBeGreaterThan(0);
    const persistent = scripted({ failOn: failBad }); await expect(B.finalizeBundle(persistent, bundle, opts({ repo: brokenRepo(), phases: { base: [], migrations: ['sql/broken.sql'], confirmations: [] }, runtimeSchemaStep: async () => ({ exit: 0, tail: '' }) }))).rejects.toMatchObject({ code: 'TMS_SCHEMA_INCOMPLETE' });
    expect(ensuredGranted(persistent.sql)).toBe(false);
  });
  it('`finalize` solo sobre un sandbox con bootstrap COMPLETO (APPLIED o FINALIZE_FAILED): ausente, parcial, completo o ajeno → STATE_NOT_APPLIED sin ejecutar NINGUNA sentencia ni el paso hijo', async () => {
    spawn.mockReset();
    const cases: Array<[string, ReturnType<typeof scripted>]> = [['ABSENT', scripted({ exists: false })], ['BOOTSTRAP_PARTIAL', scripted({ steps: { bootstrap: 'FAILED' } })], ['BOOTSTRAP_PARTIAL', scripted({ steps: { bootstrap: 'STARTED' } })],
      ['COMPLETE', scripted({ steps: { bootstrap: 'COMPLETE', finalize: 'COMPLETE' } })], ['FOREIGN', scripted({ marker: false })], ['FOREIGN', scripted({ sandboxId: 'homolog-otro' })]];
    for (const [state, c] of cases) { await expect(B.finalizeBundle(c, bundle, opts()), state).rejects.toMatchObject({ code: 'STATE_NOT_APPLIED', diagnostic: { state } }); expect(c.sql, state).toEqual([]); expect(c.marks, state).toEqual([]); }
    expect(spawn).not.toHaveBeenCalled();
    for (const steps of [{ bootstrap: 'COMPLETE' }, { bootstrap: 'COMPLETE', finalize: 'FAILED' }, { bootstrap: 'COMPLETE', finalize: 'STARTED' }]) { spawn.mockReturnValue({ status: 0, stdout: '', stderr: '' }); await expect(B.finalizeBundle(scripted({ steps }), bundle, opts())).resolves.toBeDefined(); }   // reintento permitido
  });
  it('AISLAMIENTO de `finalize`: TODA sentencia que ejecuta nombra únicamente la base y la cuenta del sandbox (nada global, nada de otras bases o cuentas, nada destructivo) y el proceso hijo recibe un entorno mínimo sin credenciales ajenas', async () => {
    spawn.mockReset(); spawn.mockReturnValue({ status: 0, stdout: '', stderr: '' }); const c = scripted();
    // Las sentencias de las MIGRACIONES del proyecto (SQL propio, sin calificar, sobre la base en uso) se comprueban APARTE contra los archivos reales; aquí solo las de aprovisionamiento.
    const phases = B.tmsSchemaPhases(repo); const crossDatabase = /\b(CREATE|DROP|ALTER) +(DATABASE|SCHEMA|USER)\b|\bGRANT\b|\bREVOKE\b|\bmysql\s*\.|SET +PASSWORD|FLUSH +PRIVILEGES|LOAD +DATA|INTO +(OUTFILE|DUMPFILE)|SHUTDOWN/i;
    for (const file of [...phases.base, ...phases.migrations, ...phases.confirmations]) for (const stmt of readFileSync(path.join(repo, file), 'utf8').split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n').split(/;\s*(?:\r?\n|$)/)) expect(stmt, file).not.toMatch(crossDatabase);
    const saved = { PS_HOMOLOG_ADMIN_USER: process.env.PS_HOMOLOG_ADMIN_USER, PS_HOMOLOG_ADMIN_PASSWORD: process.env.PS_HOMOLOG_ADMIN_PASSWORD, DB_PASSWORD: process.env.DB_PASSWORD, PRICESMART_LAB_KEY: process.env.PRICESMART_LAB_KEY };
    process.env.PS_HOMOLOG_ADMIN_USER = 'root'; process.env.PS_HOMOLOG_ADMIN_PASSWORD = 'admin-secreto-xyz'; process.env.DB_PASSWORD = 'otra-base-secreta'; process.env.PRICESMART_LAB_KEY = 'k'.repeat(40);
    try {
      await B.finalizeBundle(c, bundle, opts());   // con las migraciones REALES del proyecto
      expect(c.sql.filter((x) => /^USE\b/i.test(x))).toEqual(['USE `sandbox_api02_homolog_sbx1`']);   // los `USE <base de producción>` de los archivos del proyecto NUNCA se envían
      c.sql.splice(0, c.sql.length, ...c.sql.filter((x) => /^(GRANT|REVOKE|USE)\b/.test(x)));   // el resto (DDL propio del proyecto) se revisó arriba contra los archivos
      const own = /`sandbox_api02_homolog_(?:w|m)?sbx1`/;
      for (const sql of c.sql) {
        expect(sql.replaceAll('ON DELETE RESTRICT', ''), sql).not.toMatch(/\*\.\*|\bmysql\b|information_schema|performance_schema|\bsys\b|\bDROP\b|\bTRUNCATE\b|\bDELETE\b|GRANT OPTION|CREATE USER|CREATE DATABASE|SET PASSWORD|FLUSH|SHUTDOWN|LOAD_FILE|INTO OUTFILE/i);
        if (/^(GRANT|REVOKE|USE)\b/.test(sql)) expect(sql, sql).toMatch(/`sandbox_api02_homolog_sbx1`/);   // siempre la base del sandbox
        if (/^(GRANT|REVOKE)\b/.test(sql)) expect(sql, sql).toMatch(own);   // siempre una cuenta del sandbox
      }
      const spawned = spawn.mock.calls[0][2].env as Record<string, string>;
      expect(Object.keys(spawned).sort()).toEqual(['DB_HOST', 'DB_NAME', 'DB_PASSWORD', 'DB_PORT', 'DB_USER', 'AUTH_SECRET', 'CB2_PUBLIC_ORIGIN', 'EMPRESA_DOMINIOS', 'NEXT_TELEMETRY_DISABLED', 'NODE_ENV', 'NOVALVION_ENV', 'PATH', 'PORTAL_CREDENTIALS_KEY', 'SANDBOX_ID', 'SANDBOX_ROOT', 'TEMP', 'TMP', 'UPLOAD_DIR', ...(process.platform === 'win32' ? ['SystemRoot', 'WINDIR'] : [])].sort());
      expect(spawned.DB_PASSWORD).toBe(secrets.DB_PASSWORD); expect(JSON.stringify(spawned)).not.toMatch(/admin-secreto-xyz|otra-base-secreta|PRICESMART_LAB/);   // ni la credencial administrativa ni la de otra base
    } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  });
  it('sin manifiesto de aislamiento no se concede nada', async () => {
    const c = scripted(); await expect(B.finalizeBundle(c, bundle, { ...opts(), sandboxRoot: mkdtempSync(path.join(os.tmpdir(), 'ps-fin-')) })).rejects.toThrow('MANIFEST_MISSING'); expect(c.sql).toEqual([]);
  });
});

describe('API-26 apply FALLA CERRADO ante un esquema parcial (instalación parcial ≠ instalación completa)', () => {
  const bundle = B.buildBootstrap('sbx1', repo); const secrets = secretsOf(bundle.names);
  const dangerous = (sql: string[]) => sql.filter((x) => /^(PREPARE|EXECUTE)|^SET @ps_\w+ = (?!NULL)|CREATE USER|^GRANT/.test(x));   // `SET @ps_… = NULL` (limpieza de variables) es inocuo
  it('esquema del TMS PARCIAL (una sentencia pendiente): rechaza con TMS_SCHEMA_INCOMPLETE y diagnóstico seguro; NO ejecuta el DDL de PriceSmart, ni cuentas, ni contraseñas, ni privilegios; deja el marcador en FAILED', async () => {
    const c = scripted({ exists: false, failOn: failSyntax }); const error = await B.executeBundle(c, bundle, secrets, { tms: { repo: brokenRepo(), files: ['sql/broken.sql'] } }).catch((e: Error) => e) as Error & { code: string; diagnostic: { files: { file: string; applied: number; pendingAtEnd: number; failures: { statement: string; code: string }[] }[] } };
    expect(error).toBeInstanceOf(Error); expect(error.code).toBe('TMS_SCHEMA_INCOMPLETE'); expect(error.diagnostic.files).toEqual([{ file: 'sql/broken.sql', applied: 2, alreadyApplied: 0, skippedUse: 0, knownNonSql: 0, pendingAtEnd: 1, deferred: 0, blocking: 1, failures: [{ statement: expect.stringMatching(/^CREATE TABLE bad_t \(a INT/), code: 'ER_PARSE_ERROR' }] }]);
    expect(dangerous(c.sql)).toEqual([]); expect(c.sql.some((x) => /^CREATE TABLE ps_api/.test(x))).toBe(false); expect(c.steps.bootstrap).toBe('FAILED'); expect(c.marks.at(-1)).toEqual(['bootstrap', 'FAILED', 'TMS_SCHEMA_INCOMPLETE']);
    expect(JSON.stringify(error.diagnostic)).not.toMatch(/secreto-xyz|password|IDENTIFIED|@ps_/i);
  });
  it('una sentencia que falla por DEPENDENCIA de una fase posterior se DIFIERE en `apply` (queda informada, el estado es APPLIED y complete=false), pero NO se acepta en `finalize` (exige 0 pendientes)', async () => {
    const c = scripted({ exists: false, failOn: failBad }); const r = await B.executeBundle(c, bundle, secrets, { tms: { repo: brokenRepo(), files: ['sql/broken.sql'] } });
    expect(r).toMatchObject({ state: 'APPLIED', complete: false, tmsSchema: [{ pendingAtEnd: 1, deferred: 1, blocking: 0 }] });
    expect(() => B.assertSchemaComplete([{ pendingAtEnd: 1, deferred: 1, blocking: 0 }] as never, 'base')).toThrow(/TMS_SCHEMA_INCOMPLETE/);
  });
  it('fallo de DDL de PriceSmart a mitad del paquete: se relanza el error original, NO se crean cuentas ni privilegios, marcador FAILED (instalación PARCIAL, sin reversión del DDL ya ejecutado)', async () => {
    let n = 0; const c = scripted({ exists: false, failOn: (q) => (/^CREATE TABLE ps_api/.test(q) && ++n === 3 ? { code: 'ER_FK_CANNOT_OPEN_PARENT' } : null) });
    await expect(B.executeBundle(c, bundle, secrets)).rejects.toMatchObject({ code: 'ER_FK_CANNOT_OPEN_PARENT' });
    expect(dangerous(c.sql)).toEqual([]); expect(c.sql.filter((x) => /^CREATE TABLE ps_api/.test(x)).length).toBe(3);   // las 2 primeras tablas YA existen: la instalación quedó parcial
    expect(c.marks.at(-1)).toEqual(['bootstrap', 'FAILED', 'ER_FK_CANNOT_OPEN_PARENT']); expect(c.marks.some((m) => m[1] === 'COMPLETE')).toBe(false);
  });
  it('éxito: solo tras esquema completo, DDL, cuentas y privilegios se marca COMPLETE el bootstrap; el estado informado es APPLIED (no «completo»: falta finalize)', async () => {
    const c = scripted({ exists: false }); const r = await B.executeBundle(c, bundle, secrets); expect(r.state).toBe('APPLIED'); expect(c.marks.map((m) => m.slice(0, 2).join(':'))).toEqual(['bootstrap:STARTED', 'bootstrap:COMPLETE']);
    expect(c.sql.findIndex((x) => /^CREATE USER|^PREPARE/.test(x))).toBeGreaterThan(c.sql.findIndex((x) => /^CREATE TABLE ps_api13_link_attempts/.test(x)));
  });
  it('`apply` solo sobre un sandbox AUSENTE: parcial, aplicado, completo o ajeno → STATE_NOT_ABSENT sin ejecutar nada (jamás se escribe en una base que no es de este sandbox)', async () => {
    const cases: Array<[string, ReturnType<typeof scripted>]> = [['BOOTSTRAP_PARTIAL', scripted({ steps: { bootstrap: 'FAILED' } })], ['APPLIED', scripted()], ['FINALIZE_FAILED', scripted({ steps: { bootstrap: 'COMPLETE', finalize: 'FAILED' } })],
      ['COMPLETE', scripted({ steps: { bootstrap: 'COMPLETE', finalize: 'COMPLETE' } })], ['FOREIGN', scripted({ marker: false })], ['FOREIGN', scripted({ sandboxId: 'homolog-ajeno' })]];
    for (const [state, c] of cases) { await expect(B.executeBundle(c, bundle, secrets, { tms: { repo, files: B.tmsSchemaPhases(repo).base } }), state).rejects.toMatchObject({ code: 'STATE_NOT_ABSENT', diagnostic: { state } }); expect(c.sql, state).toEqual([]); expect(c.marks, state).toEqual([]); }
  });
  it('preflight: ABSENT / BOOTSTRAP_PARTIAL / APPLIED / FINALIZE_FAILED / COMPLETE / FOREIGN según los marcadores reales (lectura únicamente)', async () => {
    const names = bundle.names; const st = async (c: ReturnType<typeof scripted>) => (await B.preflightProvision(c, names)).state;
    expect(await st(scripted({ exists: false }))).toBe('ABSENT'); expect(await st(scripted({ steps: {} }))).toBe('BOOTSTRAP_PARTIAL'); expect(await st(scripted({ steps: { bootstrap: 'STARTED' } }))).toBe('BOOTSTRAP_PARTIAL');
    expect(await st(scripted({ steps: { bootstrap: 'COMPLETE' } }))).toBe('APPLIED'); expect(await st(scripted({ steps: { bootstrap: 'COMPLETE', finalize: 'STARTED' } }))).toBe('FINALIZE_FAILED');
    expect(await st(scripted({ steps: { bootstrap: 'COMPLETE', finalize: 'COMPLETE' } }))).toBe('COMPLETE'); expect(await st(scripted({ marker: false }))).toBe('FOREIGN'); expect(await st(scripted({ sandboxId: 'homolog-otro' }))).toBe('FOREIGN');
    const c = scripted(); await B.preflightProvision(c, names); expect(c.sql).toEqual([]); expect(c.marks).toEqual([]);   // no escribe nada
  });
  it('«ya aplicado» (objeto existente) cuenta como aplicado; cualquier otro error deja la sentencia PENDIENTE; el diagnóstico solo lleva comienzo de la sentencia del diseño y CÓDIGO (nunca el mensaje)', async () => {
    const r = brokenRepo(); const dup = scripted({ failOn: (q) => (/ok_t|bad_t|tabla_con_secreto/.test(q) ? { code: 'ER_DUP_FIELDNAME', message: 'Duplicate column password=abc' } : null) });
    const done = await B.applySchemaFiles(dup, r, ['sql/broken.sql']); expect(done[0]).toMatchObject({ pendingAtEnd: 0, alreadyApplied: 3, applied: 0 }); expect(() => B.assertSchemaComplete(done, 'x')).not.toThrow();
    const other = scripted({ failOn: (q) => (/tabla_con_secreto/.test(q) ? { code: 'ER_ACCESS_DENIED_ERROR', message: 'Access denied for user root password=abc' } : null) });
    const report = await B.applySchemaFiles(other, r, ['sql/broken.sql']); expect(report[0].pendingAtEnd).toBe(1); expect(() => B.assertSchemaComplete(report, 'x')).toThrow('TMS_SCHEMA_INCOMPLETE');
    expect(JSON.stringify(report)).not.toMatch(/password=abc|Access denied/); expect(report[0].failures[0]).toEqual({ statement: 'CREATE TABLE tabla_con_secreto (a INT)', code: 'ER_ACCESS_DENIED_ERROR' });
  });
  it('recuperación segura: `destroy` solo nombra el sandbox (4 sentencias, sus 3 cuentas y su base) y deja el estado ABSENT; un `apply` limpio posterior vuelve a ser posible', async () => {
    const d: string[] = B.destroyStatements('sbx1'); expect(d).toHaveLength(4); for (const x of d) expect(x).toMatch(/^DROP (USER|DATABASE) IF EXISTS `sandbox_api02_homolog_[wm]?sbx1`/);
    const c = scripted({ exists: false }); await expect(B.executeBundle(c, bundle, secrets)).resolves.toMatchObject({ state: 'APPLIED' });
  });
  it('el runtime NO se activa con un aprovisionamiento incompleto: la sonda `provisioning` exige bootstrap y finalize COMPLETE (y nada más)', async () => {
    const mk = (rows: Array<{ step: string; state: string }>) => createHomologationRuntime({ pool: { execute: async () => [rows] } as never, workerPool: { execute: async () => [[{ n: 0 }]] } as never, schema: 'sandbox_api02_homolog_sbx1', runtimeUser: 'sandbox_api02_homolog_sbx1', workerUser: 'sandbox_api02_homolog_wsbx1',
      evidence: { extract: async () => null }, verifier: { verify: async () => null }, cipher: { seal: async () => ({ ciphertext: Buffer.alloc(0), keyReference: 'k' }), open: async () => ({}) } as never, contract: { orderSchema: { parse: (x: unknown) => x } as never, canonicalInput: () => [] } as never, killSwitch: () => true }).ports.probes!.provisioning();
    expect(await mk([{ step: 'bootstrap', state: 'COMPLETE' }, { step: 'finalize', state: 'COMPLETE' }])).toBe(true);
    for (const rows of [[], [{ step: 'bootstrap', state: 'COMPLETE' }], [{ step: 'bootstrap', state: 'COMPLETE' }, { step: 'finalize', state: 'FAILED' }], [{ step: 'bootstrap', state: 'STARTED' }, { step: 'finalize', state: 'COMPLETE' }], [{ step: 'bootstrap', state: 'COMPLETE' }, { step: 'finalize', state: 'STARTED' }]]) expect(await mk(rows), JSON.stringify(rows)).toBe(false);
  });
});

describe('API-26 `USE` de los archivos del proyecto', () => {
  it('un `USE <base de producción>` en un archivo SQL se OMITE (no se envía, no cuenta como pendiente), y el resto del archivo se aplica en la base del sandbox', async () => {
    const r = mkdtempSync(path.join(os.tmpdir(), 'ps-use-')); mkdirSync(path.join(r, 'sql')); writeFileSync(path.join(r, 'sql', 'u.sql'), 'USE u611730801_Plataforma;\nCREATE TABLE t1 (id INT);\nuse otra_base;\nCREATE TABLE t2 (id INT);\n');
    const c = scripted(); const report = await B.applySchemaFiles(c, r, ['sql/u.sql']);
    expect(report[0]).toMatchObject({ applied: 2, skippedUse: 2, pendingAtEnd: 0 }); expect(c.sql).toEqual(['CREATE TABLE t1 (id INT)', 'CREATE TABLE t2 (id INT)']); expect(() => B.assertSchemaComplete(report, 'x')).not.toThrow();
  });
});
