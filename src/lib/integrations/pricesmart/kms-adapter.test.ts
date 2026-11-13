import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KmsAdapterError, createKmsKeyProvider, parseKmsConfig, type KmsClient, type KmsConfig } from './kms-adapter';
import { CipherError, createProviderCipher } from './provider-cipher';
import { createLabKmsClient } from './lab-demo/lab-kms-client';
import { runPortConformance } from './port-conformance';

const env = (over: Record<string, string | undefined> = {}) => ({ PRICESMART_KMS_TARGET: 'LAB', PRICESMART_KMS_CURRENT_ALIAS: 'lab.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1', ...over });
const config = (over: Record<string, string | undefined> = {}): KmsConfig => { const r = parseKmsConfig(env(over)); if (!r.ok) throw new Error(`config inválida: ${r.issues.join(';')}`); return r.config; };
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof CipherError ? `${e.code}` : e instanceof KmsAdapterError ? `KMS:${e.code}` : `RAW:${(e as Error).message}`; } };
const order = () => ({ externalOrderId: 'K-1', marca: 'valor' }) as never;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
function setup(over: Record<string, string | undefined> = {}, wrap?: (c: ReturnType<typeof createLabKmsClient>) => KmsClient) {
  const lab = createLabKmsClient(['lab.k1', 'lab.k2']); const client = wrap ? wrap(lab) : lab; const cfg = config({ PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1,lab.k2', ...over });
  const provider = createKmsKeyProvider({ client, config: cfg }); return { lab, client, cfg, provider, cipher: createProviderCipher({ provider, target: 'LAB', timeoutMs: 1000 }) };
}

describe('configuración KMS segura', () => {
  it('válida con valores por defecto acotados; el resultado está congelado', () => {
    const r = parseKmsConfig(env()); expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.config).toMatchObject({ target: 'LAB', currentAlias: 'lab.k1', maxConcurrent: 8, maxRetries: 1, retryBackoffMs: 50, callTimeoutMs: 5000 }); expect(Object.isFrozen(r.config) && Object.isFrozen(r.config.allowedAliases)).toBe(true);
  });
  it('rechaza destino, alias y límites inválidos, citando solo nombres de variables', () => {
    const bad: Record<string, string | undefined>[] = [{ PRICESMART_KMS_TARGET: undefined }, { PRICESMART_KMS_TARGET: 'STAGING' }, { PRICESMART_KMS_CURRENT_ALIAS: 'sin-prefijo' }, { PRICESMART_KMS_CURRENT_ALIAS: 'prod.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'prod.k1' },
      { PRICESMART_KMS_ALLOWED_ALIASES: '' }, { PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1,lab.k1' }, { PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1,prod.k2' }, { PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k2' },
      { PRICESMART_KMS_MAX_CONCURRENT: '0' }, { PRICESMART_KMS_MAX_CONCURRENT: '65' }, { PRICESMART_KMS_MAX_RETRIES: '4' }, { PRICESMART_KMS_CALL_TIMEOUT_MS: '10' }, { PRICESMART_KMS_CALL_TIMEOUT_MS: 'abc' }, { PRICESMART_KMS_RETRY_BACKOFF_MS: '-1' }];
    for (const over of bad) { const r = parseKmsConfig(env(over)); expect(r.ok, JSON.stringify(over)).toBe(false); if (!r.ok) expect(r.issues.every(i => /^PRICESMART_KMS_[A-Z_]+:/.test(i))).toBe(true); }
  });
  it('un destino PRODUCTION exige alias prod.* y rechaza lab.*; LAB rechaza prod.*', () => {
    expect(parseKmsConfig({ PRICESMART_KMS_TARGET: 'PRODUCTION', PRICESMART_KMS_CURRENT_ALIAS: 'prod.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'prod.k1' }).ok).toBe(true);
    expect(parseKmsConfig({ PRICESMART_KMS_TARGET: 'PRODUCTION', PRICESMART_KMS_CURRENT_ALIAS: 'lab.k1', PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1' }).ok).toBe(false);
  });
  it('NUNCA acepta credenciales: variables con aspecto de secreto o desconocidas invalidan la configuración, sin eco de su valor', () => {
    for (const name of ['PRICESMART_KMS_SECRET', 'PRICESMART_KMS_ACCESS_KEY', 'PRICESMART_KMS_API_KEY', 'PRICESMART_KMS_TOKEN', 'PRICESMART_KMS_PASSWORD', 'PRICESMART_KMS_PRIVATE_KEY', 'PRICESMART_KMS_CLIENT_CERT', 'PRICESMART_KMS_ENDPOINT', 'PRICESMART_KMS_OTRA']) {
      const r = parseKmsConfig(env({ [name]: 'valor-secreto-xyz' })); expect(r.ok, name).toBe(false); if (!r.ok) { expect(JSON.stringify(r.issues)).not.toContain('valor-secreto-xyz'); expect(r.issues.join()).toContain(name); }
    }
  });
});

describe('proveedor KMS sobre el cifrado de API-19', () => {
  it('ida y vuelta, rotación y re-envoltura con el cifrador; supera la conformidad; el contexto de cifrado del KMS liga el AAD', async () => {
    const { cipher, lab } = setup(); const o = order(); const s = await cipher.seal(o, 'ctx'); expect(s.keyReference).toBe('lab.k1');
    expect(await cipher.open(s.ciphertext, s.keyReference, 'ctx')).toEqual(o);
    expect((await runPortConformance({ cipher }, { required: ['cipher'] })).conformant).toBe(true);
    // el KMS rechaza un contexto distinto (la DEK envuelta está ligada al AAD)
    const wrapped = s.ciphertext.subarray(3, 3 + s.ciphertext.readUInt16BE(1));
    await expect(lab.decrypt({ alias: 'lab.k1', ciphertext: Uint8Array.from(wrapped), context: 'otro' })).rejects.toThrow();
  });
  it('rotación: el alias vigente cambia, el anterior sigue abriendo mientras esté permitido y deja de abrir al retirarlo de la lista', async () => {
    const lab = createLabKmsClient(['lab.k1', 'lab.k2']);
    const oldCfg = config({ PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1,lab.k2' }); const oldCipher = createProviderCipher({ provider: createKmsKeyProvider({ client: lab, config: oldCfg }), target: 'LAB' });
    const old = await oldCipher.seal(order(), 'ctx'); expect(old.keyReference).toBe('lab.k1');
    const newCfg = config({ PRICESMART_KMS_CURRENT_ALIAS: 'lab.k2', PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k1,lab.k2' }); const rotated = createProviderCipher({ provider: createKmsKeyProvider({ client: lab, config: newCfg }), target: 'LAB' });
    expect((await rotated.seal(order(), 'ctx')).keyReference).toBe('lab.k2'); expect(await rotated.open(old.ciphertext, 'lab.k1', 'ctx')).toBeTruthy();
    const re = await rotated.rewrap(old.ciphertext, 'lab.k1', 'ctx'); expect(re.keyReference).toBe('lab.k2');
    const retired = createProviderCipher({ provider: createKmsKeyProvider({ client: lab, config: config({ PRICESMART_KMS_CURRENT_ALIAS: 'lab.k2', PRICESMART_KMS_ALLOWED_ALIASES: 'lab.k2' }) }), target: 'LAB' });
    expect(await code(retired.open(old.ciphertext, 'lab.k1', 'ctx'))).toBe('PROVIDER_UNAVAILABLE'); expect(await retired.open(re.ciphertext, 'lab.k2', 'ctx')).toBeTruthy();
  });
  it('un alias fuera de la lista cerrada se rechaza antes de llamar al cliente', async () => {
    let calls = 0; const { provider } = setup({}, c => ({ ...c, encrypt: async i => { calls++; return c.encrypt(i); }, decrypt: async i => { calls++; return c.decrypt(i); } }));
    const input = { dataKey: new Uint8Array(32).fill(1), aad: new Uint8Array([1]) };
    for (const keyReference of ['lab.zz', 'prod.k1', '', 'lab.k1 ']) await expect(provider.wrapKey({ keyReference, ...input })).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await expect(provider.unwrapKey({ keyReference: 'lab.zz', wrappedKey: new Uint8Array(40), aad: new Uint8Array([1]) })).rejects.toMatchObject({ code: 'NOT_ALLOWED' }); expect(calls).toBe(0);
  });
  it('valida entradas y respuestas del cliente: DEK de longitud errónea, envoltorios vacíos o desmesurados, tipos erróneos', async () => {
    const badOut = (v: unknown) => setup({}, c => ({ ...c, encrypt: async () => v as never, decrypt: async () => v as never }));
    const a = { keyReference: 'lab.k1', aad: new Uint8Array([1]) };
    await expect(setup().provider.wrapKey({ ...a, dataKey: new Uint8Array(16) })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    for (const v of [new Uint8Array(0), new Uint8Array(5000), 'texto', null, undefined]) await expect(badOut(v).provider.wrapKey({ ...a, dataKey: new Uint8Array(32).fill(1) })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    for (const v of [new Uint8Array(16), new Uint8Array(64), 'texto', null]) await expect(badOut(v).provider.unwrapKey({ ...a, wrappedKey: new Uint8Array(40).fill(1) })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('los errores del proveedor jamás se propagan: código genérico, sin mensajes', async () => {
    const { cipher } = setup({}, c => ({ ...c, encrypt: async () => { throw new Error('secreto-kms-555'); } }));
    const r = await code(cipher.seal(order(), 'ctx')); expect(r).toBe('PROVIDER_UNAVAILABLE'); expect(r).not.toContain('secreto');
    const { provider } = setup({}, c => ({ ...c, encrypt: async () => { throw Object.assign(new Error('secreto-kms-555'), { retryable: false }); } }));
    const e = await provider.wrapKey({ keyReference: 'lab.k1', dataKey: new Uint8Array(32).fill(1), aad: new Uint8Array([1]) }).catch((x: Error) => x); expect((e as Error).message).toBe('UNAVAILABLE'); expect(String((e as Error).stack)).not.toContain('secreto');
  });
});

describe('mamparo de concurrencia y reintentos acotados', () => {
  const wrapArgs = () => ({ keyReference: 'lab.k1', dataKey: new Uint8Array(32).fill(1), aad: new Uint8Array([1]) });
  it('con maxConcurrent=2 y 10 llamadas simultáneas, solo 2 entran: el resto recibe BUSY de inmediato (sin cola) y el contador vuelve a 0', async () => {
    let active = 0; let peak = 0;
    const { provider } = setup({ PRICESMART_KMS_MAX_CONCURRENT: '2' }, c => ({ ...c, encrypt: async i => { active++; peak = Math.max(peak, active); await sleep(60); active--; return c.encrypt(i); } }));
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => provider.wrapKey(wrapArgs())));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2); expect(results.filter(r => r.status === 'rejected' && (r.reason as KmsAdapterError).code === 'BUSY')).toHaveLength(8);
    expect(peak).toBe(2); expect(provider.inFlight()).toBe(0);
    expect((await Promise.allSettled([provider.wrapKey(wrapArgs()), provider.wrapKey(wrapArgs())])).every(r => r.status === 'fulfilled')).toBe(true);   // se libera la capacidad
  });
  it('el mamparo se libera aunque el cliente falle o se cuelgue hasta el tiempo límite del cifrador', async () => {
    const { cipher, provider } = setup({ PRICESMART_KMS_MAX_CONCURRENT: '1' }, c => ({ ...c, encrypt: async () => { throw new Error('x'); } }));
    for (let i = 0; i < 5; i++) expect(await code(cipher.seal(order(), 'ctx'))).toBe('PROVIDER_UNAVAILABLE'); expect(provider.inFlight()).toBe(0);
  });
  it('solo se reintenta un error marcado como transitorio, hasta el máximo; los demás fallan al primer intento', async () => {
    let n = 0; const flaky = (retryable: unknown, failures: number) => setup({ PRICESMART_KMS_MAX_RETRIES: '2', PRICESMART_KMS_RETRY_BACKOFF_MS: '0' }, c => ({ ...c, encrypt: async i => { n++; if (n <= failures) throw Object.assign(new Error('x'), { retryable }); return c.encrypt(i); } }));
    n = 0; await flaky(true, 2).provider.wrapKey(wrapArgs()); expect(n).toBe(3);   // 2 fallos transitorios + éxito
    n = 0; await expect(flaky(true, 99).provider.wrapKey(wrapArgs())).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(n).toBe(3);   // acotado: 1 + 2 reintentos
    for (const r of [false, undefined, 'true', 1]) { n = 0; await expect(flaky(r, 99).provider.wrapKey(wrapArgs())).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(n, String(r)).toBe(1); }
  });
  it('no se reintenta si el llamador abortó o si el material sensible ya fue borrado', async () => {
    let n = 0; const ctl = new AbortController();
    const mk = () => setup({ PRICESMART_KMS_MAX_RETRIES: '3', PRICESMART_KMS_RETRY_BACKOFF_MS: '5' }, c => ({ ...c, encrypt: async () => { n++; throw Object.assign(new Error('x'), { retryable: true }); } }));
    const a = mk().provider; const p = a.wrapKey({ ...wrapArgs(), signal: ctl.signal }); await sleep(2); ctl.abort(); await expect(p).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(n).toBeLessThan(4);
    n = 0; const key = new Uint8Array(32).fill(1); const b = mk().provider; const q = b.wrapKey({ keyReference: 'lab.k1', dataKey: key, aad: new Uint8Array([1]) });
    await sleep(0); key.fill(0); await expect(q).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(n).toBeLessThanOrEqual(2);   // tras borrar la DEK, ningún reintento la reenvía
    const aborted = new AbortController(); aborted.abort(); n = 0; await expect(mk().provider.wrapKey({ ...wrapArgs(), signal: aborted.signal })).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(n).toBe(0);
  });
});

describe('salud de solo lectura', () => {
  it('true solo si el cliente la ofrece y responde true a tiempo; false si falta, falla, responde otra cosa o se cuelga', async () => {
    expect(await setup().provider.health()).toBe(true);
    for (const health of [undefined, async () => false, async () => { throw new Error('x'); }, async () => 'si' as never]) expect(await setup({}, c => ({ ...c, health } as KmsClient)).provider.health()).toBe(false);
    const hung = setup({ PRICESMART_KMS_CALL_TIMEOUT_MS: '100' }, c => ({ ...c, health: () => new Promise<boolean>(() => {}) })); const t0 = Date.now(); expect(await hung.provider.health()).toBe(false); expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('el puerto de salud no usa claves: encrypt/decrypt no se invocan', async () => {
    let n = 0; const { provider } = setup({}, c => ({ ...c, encrypt: async i => { n++; return c.encrypt(i); }, decrypt: async i => { n++; return c.decrypt(i); } })); await provider.health(); expect(n).toBe(0);
  });
});

describe('separación y aislamiento', () => {
  it('el proveedor declara su destino y el cifrador no se construye con un destino distinto', () => {
    const lab = createKmsKeyProvider({ client: createLabKmsClient(['lab.k1']), config: config() }); expect(lab.target).toBe('LAB');
    expect(() => createProviderCipher({ provider: lab, target: 'PRODUCTION' })).toThrow();
    expect(() => createKmsKeyProvider({ client: {} as never, config: config() })).toThrow(); expect(() => createLabKmsClient(['prod.k1'])).toThrow();
  });
  const strip = (f: string) => readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '');
  it('los módulos no leen el entorno, no usan red/archivos/base de datos, no contienen claves literales y no instalan handlers', () => {
    for (const f of ['kms-adapter.ts', 'lab-demo/lab-kms-client.ts']) { const t = strip(f); expect(t, f).not.toMatch(/process\.env|\bfetch\s*\(|from\s+['"](?:mysql2|@\/lib\/(?:db|tms)|node:(?:net|tls|http|https|fs|child_process))|sandbox-db/); expect(t, f).not.toContain(['install', 'PriceSmartHandler'].join('')); expect(t, f).not.toMatch(/from '\.\.?\/runtime/); expect(t, f).not.toMatch(/['"][A-Fa-f0-9]{32,}['"]/); }
  });
  it('ninguna ruta ni módulo de la aplicación los importa', () => {
    const root = path.resolve(__dirname, '../../..'); const hits: string[] = []; const names = ['kms-adapter', 'lab-kms-client'];
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !names.some(x => n.startsWith(x)) && !n.includes('.test.') && !['production-preflight.ts'].includes(n)) { const t = readFileSync(f, 'utf8'); if (names.some(x => t.includes(`/${x}'`) || t.includes(`/${x}"`))) hits.push(path.relative(root, f)); } } };
    walk(root); expect(hits).toEqual([]);
  }, 30000);
});
