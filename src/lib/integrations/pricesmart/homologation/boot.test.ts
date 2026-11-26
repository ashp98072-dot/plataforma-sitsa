import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootHomologationRuntime, clearHomologationBootMemo, type BootIO, type BootPools } from './boot';
import { REVIEWED_ADAPTERS, resolveHomologationProviders, syntheticProvidersDecision, SYNTHETIC_PROVIDERS_ACK, type HomologationProviders } from './providers';
import { isPriceSmartHandlerInstalled, installPriceSmartHandler } from '../runtime-state';
import { ENABLE_ACK } from '../runtime-config';

// PRICESMART — arranque real del runtime de homologación: DISABLED por defecto, falla cerrado y NO se activa sin proveedores revisados, decisiones ratificadas, ACK del operador, interruptor en ON y sondas.
const KEY = 'a'.repeat(64);
const schema = 'sandbox_api02_homolog_rt1'; const workerUser = 'sandbox_api02_homolog_rt1_w';
const env = (over: Record<string, string | undefined> = {}) => ({
  NODE_ENV: 'development', NOVALVION_ENV: 'sandbox', SANDBOX_ID: 'homolog-testrt1', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_NAME: schema, DB_USER: 'sandbox_api02_homolog_rt1_a',
  PRICESMART_DB_SCHEMA: schema, PRICESMART_DB_RUNTIME_USER: 'sandbox_api02_homolog_rt1_a', PRICESMART_RUNTIME_ENVIRONMENT: 'sandbox', PRICESMART_ORIGIN_CLUB: 'QA-CLUB',
  PS_HOMOLOG_WORKER_USER: workerUser, PS_HOMOLOG_WORKER_PASSWORD: 'x'.repeat(24), PS_HOMOLOG_KILLSWITCH_FILE: '/tmp/ps-test/killswitch',
  PRICESMART_RUNTIME_MODE: 'ENABLED', PRICESMART_RUNTIME_ACK: ENABLE_ACK, PRICESMART_RATIFIED_DECISIONS: 'D02,D06,D08,D09,D12',
  PS_HOMOLOG_SYNTHETIC_PROVIDERS: SYNTHETIC_PROVIDERS_ACK, PS_HOMOLOG_SYNTHETIC_KEY: KEY, ...over });
const providers = (): HomologationProviders => ({ evidence: { extract: async () => null }, verifier: { verify: async () => null } as never, cipher: { seal: async () => ({ ciphertext: Buffer.alloc(0), keyReference: 'k' }), open: async () => ({}) }, contract: {} as never });
function io(over: Partial<BootIO> = {}, install?: BootIO['install']) {
  const closed = vi.fn(async () => undefined); const shutdown: (() => Promise<void>)[] = []; const stop = vi.fn();
  const pools: BootPools = { pool: {} as never, workerPool: {} as never, close: closed };
  const base: BootIO = {
    createPools: vi.fn(async () => pools), resolveProviders: vi.fn(async () => ({ ok: true as const, source: 'REVIEWED_ADAPTER' as const, providers: providers() })),
    install: vi.fn(install ?? (async () => ({ ready: true, mode: 'ENABLED' as const, blockers: [], consumerStarted: true, stopConsumer: stop }))), onShutdown: (fn) => { shutdown.push(fn); }, ...over };
  return { base, closed, shutdown, stop };
}
beforeEach(() => { clearHomologationBootMemo(); installPriceSmartHandler(null); });
afterEach(() => { clearHomologationBootMemo(); installPriceSmartHandler(null); });

describe('arranque: apagado por defecto', () => {
  it('sin modo, vacío o DISABLED: no resuelve proveedores, no abre conexiones, no instala nada', async () => {
    for (const mode of [undefined, '', 'DISABLED']) {
      clearHomologationBootMemo(); const x = io();
      const r = await bootHomologationRuntime(env({ PRICESMART_RUNTIME_MODE: mode }), x.base);
      expect(r).toMatchObject({ state: 'DISABLED', mode: 'DISABLED', consumerStarted: false, providers: 'NONE' }); expect(r.blockers[0].code).toBe('MODE_DISABLED');
      expect(x.base.resolveProviders).not.toHaveBeenCalled(); expect(x.base.createPools).not.toHaveBeenCalled(); expect(x.base.install).not.toHaveBeenCalled(); expect(isPriceSmartHandlerInstalled()).toBe(false);
    }
  });
  it('un modo inválido no activa nada (cierra)', async () => {
    const x = io({ install: (async () => ({ ready: false, mode: 'DISABLED', blockers: [{ code: 'CONFIG_INVALID', detail: 'x' }], consumerStarted: false })) as never });
    const r = await bootHomologationRuntime(env({ PRICESMART_RUNTIME_MODE: 'TURBO' }), x.base); expect(r.state).toBe('CLOSED'); expect(isPriceSmartHandlerInstalled()).toBe(false);
  });
});

describe('arranque: falla cerrado ante cualquier requisito ausente', () => {
  it('la compuerta del proceso: no sandbox, id que no es homolog, base/cuenta fuera del patrón, base no loopback, variables de laboratorio', async () => {
    const cases: [Record<string, string | undefined>, string][] = [[{ NOVALVION_ENV: undefined }, 'NOT_SANDBOX'], [{ SANDBOX_ID: 'lab-1' }, 'SANDBOX_ID_NOT_HOMOLOG'], [{ DB_HOST: 'srv1.hstgr.io' }, 'DB_NOT_LOOPBACK'],
      [{ DB_NAME: 'u611730801_Plataforma', PRICESMART_DB_SCHEMA: 'u611730801_Plataforma' }, 'DB_NAMES_MISMATCH'], [{ PRICESMART_RUNTIME_ENVIRONMENT: 'production' }, 'RUNTIME_ENVIRONMENT_NOT_SANDBOX'], [{ PRICESMART_LAB_KEY: 'k' }, 'LAB_VARIABLES_PRESENT']];
    for (const [over, reason] of cases) { clearHomologationBootMemo(); const x = io(); const r = await bootHomologationRuntime(env(over), x.base);
      expect(r, reason).toMatchObject({ state: 'CLOSED', blockers: [{ code: 'HOMOLOGATION_GATE', detail: reason }] }); expect(x.base.createPools, reason).not.toHaveBeenCalled(); expect(isPriceSmartHandlerInstalled()).toBe(false); }
  });
  it('sin cuenta de worker o sin ruta de interruptor no abre conexiones', async () => {
    for (const [over, code] of [[{ PS_HOMOLOG_WORKER_USER: undefined }, 'WORKER_ACCOUNT_MISSING'], [{ PS_HOMOLOG_WORKER_PASSWORD: '' }, 'WORKER_ACCOUNT_MISSING'], [{ PS_HOMOLOG_KILLSWITCH_FILE: undefined }, 'KILLSWITCH_MISSING'], [{ PS_HOMOLOG_KILLSWITCH_FILE: 'relativa/ks' }, 'KILLSWITCH_MISSING'], [{ PS_HOMOLOG_KILLSWITCH_FILE: '/a b;c' }, 'KILLSWITCH_MISSING']] as const) {
      clearHomologationBootMemo(); const x = io(); const r = await bootHomologationRuntime(env(over), x.base); expect(r.blockers[0].code, code).toBe(code); expect(x.base.createPools).not.toHaveBeenCalled(); expect(x.base.resolveProviders).not.toHaveBeenCalled();
    }
  });
  it('sin proveedores revisados (verificador D02, KMS, contrato D06) el runtime NO se activa aunque todo lo demás esté declarado, y no se abre ninguna conexión', async () => {
    const x = io({ resolveProviders: (e) => resolveHomologationProviders(e) });
    const r = await bootHomologationRuntime(env({ PS_HOMOLOG_SYNTHETIC_PROVIDERS: undefined, PS_HOMOLOG_SYNTHETIC_KEY: undefined }), x.base);
    expect(r).toMatchObject({ state: 'CLOSED', consumerStarted: false, providers: 'NONE', blockers: [{ code: 'PROVIDERS_NOT_AVAILABLE' }] }); expect(REVIEWED_ADAPTERS).toHaveLength(0);
    expect(x.base.createPools).not.toHaveBeenCalled(); expect(x.base.install).not.toHaveBeenCalled(); expect(isPriceSmartHandlerInstalled()).toBe(false);
  });
  it('sin decisiones ratificadas, sin ACK o con el interruptor/sondas en contra: no se instala, el pool del worker se cierra y el consumidor no arranca', async () => {
    const blocked = (code: string) => async () => ({ ready: false, mode: 'ENABLED' as const, blockers: [{ code, detail: 'x' }], consumerStarted: false });
    for (const code of ['DECISION_PENDING', 'CONFIG_INVALID', 'PROBE_FAILED', 'PORT_MISSING']) {
      clearHomologationBootMemo(); const x = io({}, blocked(code)); const r = await bootHomologationRuntime(env(), x.base);
      expect(r, code).toMatchObject({ state: 'CLOSED', consumerStarted: false, blockers: [{ code }] }); expect(x.closed, code).toHaveBeenCalledTimes(1); expect(isPriceSmartHandlerInstalled(), code).toBe(false);
    }
  });
  it('una excepción en la composición deja todo cerrado y cierra lo abierto; el informe no contiene mensajes ni valores', async () => {
    const x = io({}, async () => { throw new Error('secreto-xyz fallo interno'); }); const r = await bootHomologationRuntime(env(), x.base);
    expect(r).toMatchObject({ state: 'CLOSED', blockers: [{ code: 'BOOT_FAILED' }] }); expect(JSON.stringify(r)).not.toMatch(/secreto-xyz|fallo interno/); expect(x.closed).toHaveBeenCalledTimes(1); expect(isPriceSmartHandlerInstalled()).toBe(false);
    clearHomologationBootMemo(); const y = io({ createPools: async () => { throw new Error('db caída'); } }); expect((await bootHomologationRuntime(env(), y.base)).blockers[0].code).toBe('BOOT_FAILED');
  });
});

describe('arranque: instalación y apagado seguro', () => {
  it('con todo declarado instala UNA vez, informa el origen de los proveedores y registra el apagado (detiene el consumidor y cierra el pool); un segundo arranque devuelve el mismo informe sin duplicar', async () => {
    const x = io(); const e = env();
    const r = await bootHomologationRuntime(e, x.base); expect(r).toMatchObject({ state: 'INSTALLED', mode: 'ENABLED', consumerStarted: true, providers: 'REVIEWED_ADAPTER', blockers: [] });
    expect(await bootHomologationRuntime(e, x.base)).toBe(r); expect(x.base.install).toHaveBeenCalledTimes(1); expect(x.base.createPools).toHaveBeenCalledTimes(1);
    const deps = vi.mocked(x.base.install).mock.calls[0][1]; expect(deps).toMatchObject({ schema, runtimeUser: e.DB_USER, workerUser }); expect(deps.workerUser).not.toBe(deps.runtimeUser);
    expect(x.shutdown).toHaveLength(1); await x.shutdown[0](); expect(x.stop).toHaveBeenCalledTimes(1); expect(x.closed).toHaveBeenCalledTimes(1); expect(isPriceSmartHandlerInstalled()).toBe(false);
  });
  it('el arranque nunca expone credenciales en el informe', async () => { const r = await bootHomologationRuntime(env(), io().base); expect(JSON.stringify(r)).not.toMatch(/x{24}|a{64}|PASSWORD|SYNTHETIC_KEY/); });
});

describe('proveedores: lo sintético solo existe en una prueba local', () => {
  it('se rechazan en un proceso de producción (`next start`), sin la frase, con un id que no es homolog-test*, sin clave o fuera de loopback', () => {
    const base = env();
    expect(syntheticProvidersDecision(base)).toEqual({ ok: true });
    for (const [over, reason] of [[{ NODE_ENV: 'production' }, 'PRODUCTION_PROCESS'], [{ PS_HOMOLOG_SYNTHETIC_PROVIDERS: 'si' }, 'ACK_INVALID'], [{ PS_HOMOLOG_SYNTHETIC_PROVIDERS: undefined }, 'NOT_REQUESTED'], [{ SANDBOX_ID: 'homolog-pricesmart' }, 'SANDBOX_ID_NOT_TEST'],
      [{ PS_HOMOLOG_SYNTHETIC_KEY: 'corta' }, 'KEY_INVALID'], [{ PS_HOMOLOG_SYNTHETIC_KEY: undefined }, 'KEY_INVALID'], [{ DB_HOST: '10.0.0.5' }, 'NOT_LOCAL_SANDBOX'], [{ NOVALVION_ENV: 'production' }, 'NOT_LOCAL_SANDBOX']] as const)
      expect(syntheticProvidersDecision({ ...base, ...over }), reason).toEqual({ ok: false, reason });
  });
  it('un proceso de producción con la frase y la clave presentes NO carga los proveedores sintéticos (ni siquiera importa el módulo)', async () => {
    const load = vi.fn(); const r = await resolveHomologationProviders(env({ NODE_ENV: 'production' }), { loadSynthetic: load as never });
    expect(r).toMatchObject({ ok: false, code: 'SYNTHETIC_PROVIDERS_REFUSED' }); expect(load).not.toHaveBeenCalled();
  });
  it('un adaptador revisado tiene prioridad; uno inválido o que falla cierra; sin adaptadores y sin sintéticos → PROVIDERS_NOT_AVAILABLE', async () => {
    expect(await resolveHomologationProviders(env(), { adapters: [async () => providers()] })).toMatchObject({ ok: true, source: 'REVIEWED_ADAPTER' });
    expect(await resolveHomologationProviders(env(), { adapters: [async () => ({}) as never] })).toMatchObject({ ok: false, code: 'ADAPTER_INVALID' });
    expect(await resolveHomologationProviders(env(), { adapters: [async () => { throw new Error('x'); }] })).toMatchObject({ ok: false, code: 'ADAPTER_INVALID' });
    expect(await resolveHomologationProviders(env({ PS_HOMOLOG_SYNTHETIC_PROVIDERS: undefined }), { adapters: [async () => null] })).toMatchObject({ ok: false, code: 'PROVIDERS_NOT_AVAILABLE' });
    expect(await resolveHomologationProviders(env(), { adapters: [] })).toMatchObject({ ok: true, source: 'SYNTHETIC_TEST_ONLY' });
  });
});

describe('aislamiento estático del arranque', () => {
  const strip = (t: string) => t.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const read = (f: string) => strip(readFileSync(path.join(__dirname, f), 'utf8'));
  it('boot.ts y providers.ts no importan el laboratorio de forma estática ni leen process.env; los proveedores sintéticos solo se cargan de forma diferida desde providers.ts', () => {
    for (const f of ['boot.ts', 'providers.ts']) { const t = read(f); expect(t, f).not.toMatch(/from '\.\.\/lab-demo\/(lab-crypto|composition|gate|autoinstall|lab-key-provider|lab-kms-client)'|labVerifier|labCipher|process\.env|PRICESMART_LAB_/); }
    expect(read('providers.ts')).toMatch(/import\('\.\/synthetic-providers'\)/); expect(read('providers.ts')).not.toMatch(/from '\.\/synthetic-providers'/); expect(read('boot.ts')).not.toMatch(/synthetic-providers/);
  });
  it('las plantillas del sandbox real no mencionan las variables de proveedores sintéticos', async () => {
    const B = await import('../../../../../scripts/ci/pricesmart-homologation/bundle.mjs');
    const text = [B.renderEnvTemplate(B.homologNames('r9'), {}), B.renderSystemd({}), B.renderNginx({ publicHostname: 'sandbox.ejemplo.com', certPath: '/etc/a/c.pem', keyPath: '/etc/a/k.pem', allowlist: ['203.0.113.0/24'] })].join('\n');
    expect(text).not.toMatch(/SYNTHETIC|SINTETICO-LOCAL/);
  });
});
