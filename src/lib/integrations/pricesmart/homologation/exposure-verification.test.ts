import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as B from '../../../../../scripts/ci/pricesmart-homologation/bundle.mjs';
import * as P from '../../../../../scripts/ci/pricesmart-homologation/provision.mjs';

// PRICESMART sandbox (preparación final) — plantilla de MariaDB y verificación LOCAL previa a la exposición (solo lectura, sin red). Que todo pase NO autoriza exponer: eso exige la aprobación humana (evaluateSandboxExposure, D02, KMS).
const names = B.homologNames('r9');
const nginx: string = B.renderNginx({ publicHostname: 'sandbox.ejemplo.com', certPath: '/etc/ssl/ps/fullchain.pem', keyPath: '/etc/ssl/ps/privkey.pem', allowlist: ['203.0.113.0/24'] });
const systemd: string = B.renderSystemd({});
const mariadb: string = B.renderMariaDbConfig({});
const hex = 'a'.repeat(64);
const envText = (over: Record<string, string> = {}, drop: string[] = []) => {
  const base: Record<string, string> = { NOVALVION_ENV: 'sandbox', SANDBOX_ID: names.sandboxId, DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_NAME: names.schema, DB_USER: names.appUser,
    DB_PASSWORD: `sandbox:${names.sandboxId}:${hex}`, AUTH_SECRET: `sandbox:${names.sandboxId}:${'b'.repeat(64)}`, PORTAL_CREDENTIALS_KEY: `sandbox:${names.sandboxId}:${'c'.repeat(64)}`,
    PRICESMART_RUNTIME_MODE: 'DISABLED', PRICESMART_RUNTIME_ENVIRONMENT: 'sandbox', ...over };
  return Object.entries(base).filter(([k]) => !drop.includes(k)).map(([k, v]) => `${k}=${v}`).join('\n');
};
const good = { nginx, systemd, mariadb, expectedHostname: 'sandbox.ejemplo.com', env: { text: envText(), mode: 0o600, insideRepo: false }, killswitch: { exists: true, text: 'OFF' },
  tls: { certNotAfter: Date.now() + 90 * 864e5, certNames: ['sandbox.ejemplo.com'], keyMode: 0o600 } };
const failing = (input: Record<string, unknown>) => (B.evaluateExposureArtifacts(input) as { checks: { id: string; ok: boolean }[] }).checks.filter((c) => !c.ok).map((c) => c.id);

describe('plantilla de MariaDB del sandbox', () => {
  it('solo loopback, sin resolución de nombres, sin LOAD DATA LOCAL, sin opciones inseguras; entradas inválidas se rechazan', () => {
    expect(mariadb).toMatch(/^bind-address=127\.0\.0\.1$/m); expect(mariadb).toMatch(/^skip-name-resolve$/m); expect(mariadb).toMatch(/^local-infile=0$/m);
    expect(mariadb.replace(/#.*$/gm, '')).not.toMatch(/skip-grant-tables|0\.0\.0\.0|skip-networking/);
    for (const bad of [{ dbPort: 80 }, { dataDir: 'rel' }, { dataDir: '/a;b' }, { maxConnections: 5 }, { maxConnections: 99999 }]) expect(() => B.renderMariaDbConfig(bad)).toThrow('INVALID_MARIADB_OPTIONS');
  });
});

describe('verificación previa a la exposición (local, sin red)', () => {
  it('los artefactos generados por el propio aprovisionador pasan todas las comprobaciones, y el informe NUNCA autoriza la exposición', () => {
    const r = B.evaluateExposureArtifacts(good) as { ok: boolean; authorizesExposure: boolean; checks: { id: string; ok: boolean }[] };
    expect(failing(good)).toEqual([]); expect(r.ok).toBe(true); expect(r.authorizesExposure).toBe(false); expect((r as unknown as { aviso: string }).aviso).toMatch(/NO AUTORIZA EXPONER/); expect(r.checks.length).toBeGreaterThanOrEqual(25);
  });
  it('detecta proxy inseguro: TLS antiguo, sin allowlist, allow all, ruta extra, proxy a un host no loopback, sin límites', () => {
    expect(failing({ ...good, nginx: nginx.replace('TLSv1.2 TLSv1.3', 'TLSv1 TLSv1.1 TLSv1.2') })).toContain('NGINX_TLS_ONLY_12_13');
    expect(failing({ ...good, nginx: nginx.replace(/\n\s+allow [^\n]+;/g, '').replace(/\n\s+deny all;/, '') })).toContain('NGINX_ALLOWLIST_AND_DENY_ALL');
    expect(failing({ ...good, nginx: nginx.replace('allow 203.0.113.0/24;', 'allow 0.0.0.0/0;') })).toContain('NGINX_ALLOWLIST_AND_DENY_ALL');
    expect(failing({ ...good, nginx: nginx.replace('location / { return 404; }', 'location /admin { proxy_pass http://127.0.0.1:3100; }\n  location / { return 404; }') })).toContain('NGINX_ONLY_THREE_ROUTES_REST_404');
    expect(failing({ ...good, nginx: nginx.replace(/proxy_pass http:\/\/127\.0\.0\.1:3100;/, 'proxy_pass http://10.0.0.5:3100;') })).toContain('NGINX_PROXY_LOOPBACK_ONLY');
    expect(failing({ ...good, nginx: nginx.replace(/limit_req zone=[^\n]+/g, '') })).toContain('NGINX_BODY_AND_RATE_LIMITS');
    expect(failing({ ...good, expectedHostname: 'otro.ejemplo.com' })).toContain('NGINX_HOSTNAME_MATCHES');
    expect(failing({ ...good, nginx: '' })).toContain('NGINX_PRESENT');
  });
  it('detecta servicio y base de datos inseguros: root, 0.0.0.0, sin endurecimiento, secretos en el unit, acceso remoto', () => {
    expect(failing({ ...good, systemd: systemd.replace(/^User=.*$/m, 'User=root') })).toContain('SYSTEMD_NOT_ROOT');
    expect(failing({ ...good, systemd: systemd.replace('--hostname 127.0.0.1', '--hostname 0.0.0.0') })).toContain('SYSTEMD_LISTENS_ON_LOOPBACK');
    expect(failing({ ...good, systemd: systemd.replace('NoNewPrivileges=true', '') })).toContain('SYSTEMD_HARDENING');
    expect(failing({ ...good, systemd: `${systemd}\nEnvironment=DB_PASSWORD=sandbox:x:y` })).toContain('SYSTEMD_SECRETS_FROM_ENVIRONMENT_FILE');
    expect(failing({ ...good, mariadb: mariadb.replace('bind-address=127.0.0.1', 'bind-address=0.0.0.0') })).toContain('MARIADB_BIND_LOOPBACK');
    expect(failing({ ...good, mariadb: `${mariadb}\nskip-grant-tables` })).toContain('MARIADB_NO_UNSAFE_OPTIONS');
  });
  it('detecta un archivo de entorno inseguro: permisos, dentro del repositorio, marcadores sin reemplazar, producción/laboratorio, proxies, secretos con otro formato, modo ENABLED, decisiones declaradas', () => {
    const env = (text: string, extra: Record<string, unknown> = {}) => failing({ ...good, env: { ...good.env, text, ...extra } });
    expect(env(envText(), { mode: 0o644 })).toContain('ENV_FILE_PERMISSIONS_0600'); expect(env(envText(), { insideRepo: true })).toContain('ENV_FILE_OUTSIDE_REPOSITORY');
    expect(env(envText({ DB_PASSWORD: '<generada>' }))).toEqual(expect.arrayContaining(['ENV_NO_PLACEHOLDERS_LEFT', 'ENV_SECRETS_SANDBOX_FORMAT']));
    expect(env(envText({ NOVALVION_ENV: 'production' }))).toContain('ENV_DECLARES_SANDBOX'); expect(env(envText({ DB_NAME: 'u611730801_Plataforma' }))).toContain('ENV_DECLARES_SANDBOX');
    expect(env(envText({ DB_HOST: 'srv1.hstgr.io' }))).toContain('ENV_DB_LOOPBACK_AND_SANDBOX_USER'); expect(env(envText({ DB_USER: 'u611730801_app' }))).toContain('ENV_DB_LOOPBACK_AND_SANDBOX_USER');
    for (const flag of ['PRICESMART_LAB_KEY=x', 'PRICESMART_LAB_DEMO=1', 'HTTPS_PROXY=http://p:1', 'FEL_CREDENTIALS_KEY=k', 'PS_HOMOLOG_SYNTHETIC_PROVIDERS=SINTETICO-LOCAL-SIN-PRODUCCION', 'PS_HOMOLOG_SYNTHETIC_KEY=' + 'a'.repeat(64)]) expect(env(`${envText()}\n${flag}`), flag).toContain('ENV_NO_PRODUCTION_OR_LAB_FLAGS');
    expect(env(envText({ AUTH_SECRET: 'cualquiera' }))).toContain('ENV_SECRETS_SANDBOX_FORMAT');
    expect(env(envText({ PRICESMART_RUNTIME_MODE: 'ENABLED' }))).toContain('RUNTIME_STARTS_DISABLED_OR_READ_ONLY'); expect(env(envText({ PRICESMART_RUNTIME_MODE: 'READ_ONLY' }))).not.toContain('RUNTIME_STARTS_DISABLED_OR_READ_ONLY');
    expect(env(`${envText()}\nPRICESMART_RATIFIED_DECISIONS=D01,D02`)).toContain('RUNTIME_NO_RATIFIED_DECISIONS_DECLARED');
  });
  it('kill switch: debe existir y no estar en ON; TLS: certificado vigente (≥7 días), que cubra el nombre y llave no legible por otros', () => {
    expect(failing({ ...good, killswitch: { exists: false, text: '' } })).toContain('KILLSWITCH_PRESENT_AND_OFF'); expect(failing({ ...good, killswitch: { exists: true, text: 'ON\n' } })).toContain('KILLSWITCH_PRESENT_AND_OFF');
    expect(failing({ ...good, tls: { ...good.tls, certNotAfter: Date.now() + 2 * 864e5 } })).toContain('TLS_CERT_NOT_EXPIRED'); expect(failing({ ...good, tls: { ...good.tls, certNames: ['otro.ejemplo.com'] } })).toContain('TLS_CERT_COVERS_HOSTNAME');
    expect(failing({ ...good, tls: { ...good.tls, certNames: ['*.ejemplo.com'] } })).toEqual([]); expect(failing({ ...good, tls: { ...good.tls, certNames: ['*.com'] } })).toContain('TLS_CERT_COVERS_HOSTNAME');
    expect(failing({ ...good, tls: { ...good.tls, keyMode: 0o644 } })).toContain('TLS_KEY_PERMISSIONS');
  });
});

describe('verify-exposure (CLI/aprovisionador): plan → verificación local con archivos reales', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ps-exposure-'));
  const openssl = spawnSync('openssl', ['version']).status === 0;
  // Los permisos POSIX (0600, llave no legible por otros) no existen en Windows: allí `fs.chmod` no los aplica y la comprobación no es significativa. El CI Linux la ejecuta siempre.
  it.skipIf(!openssl || process.platform === 'win32')('el plan escribe la plantilla de MariaDB y la verificación pasa con entorno 0600 fuera del repositorio, kill switch en OFF y certificado válido; falla con permisos abiertos o kill switch ON', async () => {
    const out = path.join(tmp, 'plan'); await P.plan({ n: 'r9', out, hostname: 'sandbox.ejemplo.com', cert: '/etc/ssl/ps/fullchain.pem', key: '/etc/ssl/ps/privkey.pem', allow: '203.0.113.0/24' });
    const certDir = path.join(tmp, 'tls'); mkdirSync(certDir); const cert = path.join(certDir, 'c.pem'); const key = path.join(certDir, 'k.pem');
    expect(spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '90', '-subj', '/CN=sandbox.ejemplo.com', '-addext', 'subjectAltName=DNS:sandbox.ejemplo.com'], { stdio: 'ignore' }).status).toBe(0);
    chmodSync(key, 0o600); const envFile = path.join(tmp, 'runtime.env'); writeFileSync(envFile, envText(), { mode: 0o600 }); chmodSync(envFile, 0o600); const ks = path.join(tmp, 'killswitch'); writeFileSync(ks, 'OFF\n');
    const args = { dir: out, 'env-file': envFile, killswitch: ks, cert, key, hostname: 'sandbox.ejemplo.com' };
    const ok = await P.verifyExposure(args) as { ok: boolean; authorizesExposure: boolean; checks: { id: string; ok: boolean }[] }; expect(ok.checks.filter((c) => !c.ok)).toEqual([]); expect(ok.ok).toBe(true); expect(ok.authorizesExposure).toBe(false); expect((ok as unknown as { aviso: string }).aviso).toBe(B.EXPOSURE_NOTICE); expect(B.EXPOSURE_NOTICE).toMatch(/NO AUTORIZA EXPONER EL SANDBOX/);
    chmodSync(envFile, 0o644); writeFileSync(ks, 'ON'); process.exitCode = 0;
    const bad = await P.verifyExposure(args) as { ok: boolean; checks: { id: string; ok: boolean }[] }; expect(bad.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(expect.arrayContaining(['ENV_FILE_PERMISSIONS_0600', 'KILLSWITCH_PRESENT_AND_OFF'])); expect(process.exitCode).toBe(1); process.exitCode = 0;
  });
});
