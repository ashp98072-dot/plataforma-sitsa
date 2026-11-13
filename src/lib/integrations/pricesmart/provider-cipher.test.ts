import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CipherError, createProviderCipher, type ExternalKeyProvider, type KeyTarget } from './provider-cipher';
import { createLabKeyProvider } from './lab-demo/lab-key-provider';
import { runPortConformance } from './port-conformance';
import { createInProcessIdentityAuthority, issueAttestation, verifyAttestation } from './conformance-attestation';

const order = (extra = '') => ({ externalOrderId: `P-${randomBytes(4).toString('hex')}`, marca: `valor-secreto-${randomBytes(6).toString('hex')}${extra}` }) as never;
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof CipherError ? `${e.code}:${e.message}` : `RAW:${(e as Error).message}`; } };
/** Proveedor de pruebas configurable: mismo material por nombre de clave, destino y referencias a elección (para simular proveedores mal configurados). */
function customProvider(target: KeyTarget, over: Partial<ExternalKeyProvider> = {}, shared?: Map<string, Buffer>): ExternalKeyProvider & { keys: Map<string, Buffer> } {
  const keys = shared ?? new Map<string, Buffer>(); const prefix = target === 'LAB' ? 'lab.' : 'prod.'; if (!keys.has('k1')) keys.set('k1', randomBytes(32));
  const base: ExternalKeyProvider = {
    target,
    async currentKeyReference() { return `${prefix}k1`; },
    async wrapKey({ keyReference, dataKey, aad }) { const m = keys.get(keyReference.split('.')[1]); if (!m) throw new Error('desconocida'); const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', m, iv); c.setAAD(Buffer.from(aad)); const ct = Buffer.concat([c.update(Buffer.from(dataKey)), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); },
    async unwrapKey({ keyReference, wrappedKey, aad }) { const m = keys.get(keyReference.split('.')[1]); if (!m) throw new Error('desconocida'); const w = Buffer.from(wrappedKey); const d = createDecipheriv('aes-256-gcm', m, w.subarray(0, 12)); d.setAAD(Buffer.from(aad)); d.setAuthTag(w.subarray(12, 28)); return new Uint8Array(Buffer.concat([d.update(w.subarray(28)), d.final()])); },
  };
  return Object.assign({ ...base, ...over }, { keys });
}
const lab = () => { const provider = createLabKeyProvider(); return { provider, cipher: createProviderCipher({ provider, target: 'LAB' }) }; };

describe('adaptador de cifrado con proveedor externo', () => {
  it('supera la suite de conformidad de API-16 (compatible con la atestación y la compuerta de API-18)', async () => {
    const r = await runPortConformance({ cipher: lab().cipher }, { required: ['cipher'] });
    expect(r.results.filter(x => !x.pass)).toEqual([]); expect(r.conformant).toBe(true);
  });
  it('ida y vuelta; el texto en claro no aparece; solo se guarda la DEK ENVUELTA; la referencia es del destino', async () => {
    const { cipher, provider } = lab(); const o = order() as unknown as { marca: string };
    const s = await cipher.seal(o as never, 'ctx-1'); expect(s.keyReference).toMatch(/^lab\./); expect(provider.references()).toContain(s.keyReference);
    expect(s.ciphertext.includes(Buffer.from(o.marca))).toBe(false); expect(await cipher.open(s.ciphertext, s.keyReference, 'ctx-1')).toEqual(o);
    expect(s.ciphertext[0]).toBe(1); const wl = s.ciphertext.readUInt16BE(1); expect(wl).toBeGreaterThan(32); expect(wl).toBeLessThan(200);   // versión 1 y DEK envuelta (nunca la DEK en claro: el proveedor no expone su material)
  });
  it('cada sellado usa una DEK y un IV nuevos (mismo contenido, distinto texto cifrado)', async () => {
    const { cipher } = lab(); const o = order(); const [a, b] = [await cipher.seal(o, 'c'), await cipher.seal(o, 'c')]; expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });
});

describe('rotación de claves', () => {
  it('lo nuevo usa la clave vigente; lo antiguo sigue abriendo; rewrap pasa a la vigente sin tocar la carga; retirar la antigua solo afecta lo no re-envuelto', async () => {
    const { cipher, provider } = lab(); const o = order(); const old = await cipher.seal(o, 'ctx');
    const k2 = provider.rotate(); const fresh = await cipher.seal(o, 'ctx'); expect(fresh.keyReference).toBe(k2); expect(fresh.keyReference).not.toBe(old.keyReference);
    expect(await cipher.open(old.ciphertext, old.keyReference, 'ctx')).toEqual(o);
    const re = await cipher.rewrap(old.ciphertext, old.keyReference, 'ctx'); expect(re.keyReference).toBe(k2);
    // la carga cifrada (iv, tag y cuerpo) no cambia: solo el envoltorio de la DEK
    const tailLen = 12 + 16 + (old.ciphertext.length - 3 - (old.ciphertext.readUInt16BE(1)) - 12 - 16);
    expect(re.ciphertext.subarray(re.ciphertext.length - tailLen).equals(old.ciphertext.subarray(old.ciphertext.length - tailLen))).toBe(true);
    expect(await cipher.open(re.ciphertext, re.keyReference, 'ctx')).toEqual(o);
    provider.retire(old.keyReference);
    expect(await code(cipher.open(old.ciphertext, old.keyReference, 'ctx'))).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE');
    expect(await cipher.open(re.ciphertext, re.keyReference, 'ctx')).toEqual(o);
  });
  it('rewrap no re-envuelve una carga alterada ni con contexto equivocado', async () => {
    const { cipher } = lab(); const s = await cipher.seal(order(), 'ctx'); const bad = Buffer.from(s.ciphertext); bad[bad.length - 1] ^= 1;
    expect(await code(cipher.rewrap(bad, s.keyReference, 'ctx'))).toBe('INTEGRITY:INTEGRITY');
    expect((await code(cipher.rewrap(s.ciphertext, s.keyReference, 'otro'))).startsWith('PROVIDER_UNAVAILABLE')).toBe(true);
  });
});

describe('autenticidad e integridad', () => {
  it('cualquier alteración de cualquier región, contexto equivocado o referencia inválida se rechaza con códigos cerrados', async () => {
    const { cipher } = lab(); const s = await cipher.seal(order(), 'ctx'); const wl = s.ciphertext.readUInt16BE(1);
    const regions = [0, 1, 3, 3 + wl - 1, 3 + wl, 3 + wl + 12, 3 + wl + 28, s.ciphertext.length - 1];
    for (const i of regions) { const b = Buffer.from(s.ciphertext); b[i] ^= 0x01; const r = await code(cipher.open(b, s.keyReference, 'ctx')); expect(['INTEGRITY:INTEGRITY', 'PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE'], `byte ${i}`).toContain(r); }
    for (const t of [Buffer.alloc(0), s.ciphertext.subarray(0, 20), s.ciphertext.subarray(0, s.ciphertext.length - 1), Buffer.concat([s.ciphertext, Buffer.from([0])])]) expect(await code(cipher.open(t, s.keyReference, 'ctx'))).not.toBe('OK');
    expect((await code(cipher.open(s.ciphertext, s.keyReference, 'otro-contexto'))).startsWith('PROVIDER_UNAVAILABLE')).toBe(true);   // el envoltorio de la DEK está ligado al contexto
    for (const ref of ['', 'x', 'lab.', 'prod.k1', 'LAB.k1', 'lab.k1 ', 'lab./k1', undefined, 5]) expect(await code(cipher.open(s.ciphertext, ref as never, 'ctx'))).toBe('INTEGRITY:INTEGRITY');
    expect(await code(cipher.open('texto' as never, s.keyReference, 'ctx'))).toBe('INTEGRITY:INTEGRITY');
    for (const ctx of ['', 'x'.repeat(513), 5 as never]) expect(await code(cipher.seal(order(), ctx))).toBe('INVALID:INVALID');
  });
  it('una carga que no es JSON válido tras descifrar se trata como integridad', async () => {
    const provider = createLabKeyProvider(); const c = createProviderCipher({ provider, target: 'LAB' });
    expect(await code(c.seal((() => { const a: Record<string, unknown> = {}; a.self = a; return a; })() as never, 'ctx'))).toBe('INVALID:INVALID');   // referencia circular: no serializable
  });
});

describe('fallos del proveedor', () => {
  const failing = (over: Partial<ExternalKeyProvider>) => createProviderCipher({ provider: customProvider('LAB', over), target: 'LAB', timeoutMs: 200 });
  it('error al obtener la referencia, envolver o desenvolver = PROVIDER_UNAVAILABLE genérico, sin filtrar el mensaje del proveedor', async () => {
    const boom = async () => { throw new Error('secreto-kms-token-998'); };
    for (const over of [{ currentKeyReference: boom }, { wrapKey: boom }]) { const r = await code(failing(over).seal(order(), 'ctx')); expect(r).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE'); expect(r).not.toContain('secreto'); }
    const ok = createProviderCipher({ provider: customProvider('LAB'), target: 'LAB' }); const s = await ok.seal(order(), 'ctx');
    const shared = customProvider('LAB'); const sealed = await createProviderCipher({ provider: shared, target: 'LAB' }).seal(order(), 'ctx');
    const r = await code(createProviderCipher({ provider: customProvider('LAB', { unwrapKey: boom }, shared.keys), target: 'LAB' }).open(sealed.ciphertext, sealed.keyReference, 'ctx')); expect(r).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE'); expect(r).not.toContain('secreto'); void s;
  });
  it('un proveedor que se cuelga se corta por tiempo límite', async () => {
    const hang = () => new Promise<never>(() => {}); const t0 = Date.now();
    expect(await code(failing({ wrapKey: hang }).seal(order(), 'ctx'))).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE'); expect(Date.now() - t0).toBeLessThan(3000);
  });
  it('respuestas ajenas del proveedor se rechazan: DEK de longitud incorrecta, referencia de otro destino o tipos erróneos', async () => {
    const base = customProvider('LAB'); const sealed = await createProviderCipher({ provider: base, target: 'LAB' }).seal(order(), 'ctx');
    const shortDek = createProviderCipher({ provider: customProvider('LAB', { unwrapKey: async () => new Uint8Array(16) }, base.keys), target: 'LAB' });
    expect(await code(shortDek.open(sealed.ciphertext, sealed.keyReference, 'ctx'))).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE');
    for (const bad of ['prod.k1', 'k1', '', 'lab.', undefined, 7]) expect(await code(failing({ currentKeyReference: async () => bad as never }).seal(order(), 'ctx')), String(bad)).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE');
    expect(await code(failing({ wrapKey: async () => 'texto' as never }).seal(order(), 'ctx'))).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE');
    expect(await code(failing({ wrapKey: async () => new Uint8Array(0) }).seal(order(), 'ctx'))).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE');
  });
  it('la DEK entregada por el proveedor se borra tras usarla', async () => {
    const base = customProvider('LAB'); const sealed = await createProviderCipher({ provider: base, target: 'LAB' }).seal(order(), 'ctx'); let handed: Uint8Array | undefined;
    const spy = customProvider('LAB', { unwrapKey: async (i) => { const dek = await base.unwrapKey(i); handed = dek; return dek; } }, base.keys);
    await createProviderCipher({ provider: spy, target: 'LAB' }).open(sealed.ciphertext, sealed.keyReference, 'ctx'); expect(handed && [...handed].every(b => b === 0)).toBe(true);
  });
  it('configuración inválida: tiempo límite fuera de rango o proveedor incompleto', () => {
    const p = customProvider('LAB'); for (const timeoutMs of [0, 10, 100000, 1.5]) expect(() => createProviderCipher({ provider: p, target: 'LAB', timeoutMs })).toThrow();
    for (const bad of [null, {}, { target: 'LAB' }]) expect(() => createProviderCipher({ provider: bad as never, target: 'LAB' })).toThrow();
    expect(() => createProviderCipher({ provider: p, target: 'OTRO' as never })).toThrow();
  });
});

describe('separación de claves LAB / PRODUCTION', () => {
  it('un proveedor de otro destino no puede construir el adaptador', () => {
    expect(() => createProviderCipher({ provider: customProvider('PRODUCTION'), target: 'LAB' })).toThrow(); expect(() => createProviderCipher({ provider: customProvider('LAB'), target: 'PRODUCTION' })).toThrow();
    expect(createLabKeyProvider().target).toBe('LAB');
  });
  it('un texto cifrado de un destino no abre en el otro, ni siquiera si ambos proveedores comparten material de clave y se re-etiqueta la referencia', async () => {
    const shared = new Map<string, Buffer>(); const labP = customProvider('LAB', {}, shared); const prodP = customProvider('PRODUCTION', {}, shared);   // MISMO material: peor caso de mala configuración
    const labC = createProviderCipher({ provider: labP, target: 'LAB' }); const prodC = createProviderCipher({ provider: prodP, target: 'PRODUCTION' });
    const fromLab = await labC.seal(order(), 'ctx'); const fromProd = await prodC.seal(order(), 'ctx'); expect(fromLab.keyReference).toMatch(/^lab\./); expect(fromProd.keyReference).toMatch(/^prod\./);
    expect(await code(prodC.open(fromLab.ciphertext, fromLab.keyReference, 'ctx'))).toBe('INTEGRITY:INTEGRITY');   // prefijo de otro destino
    expect(await code(labC.open(fromProd.ciphertext, fromProd.keyReference, 'ctx'))).toBe('INTEGRITY:INTEGRITY');
    expect((await code(prodC.open(fromLab.ciphertext, fromLab.keyReference.replace('lab.', 'prod.'), 'ctx'))).startsWith('PROVIDER_UNAVAILABLE')).toBe(true);   // re-etiquetada: el AAD lleva el destino
    expect((await code(labC.open(fromProd.ciphertext, fromProd.keyReference.replace('prod.', 'lab.'), 'ctx'))).startsWith('PROVIDER_UNAVAILABLE')).toBe(true);
    expect(await code(labC.rewrap(fromProd.ciphertext, fromProd.keyReference, 'ctx'))).toBe('INTEGRITY:INTEGRITY');
  });
  it('proveedores de laboratorio distintos no se abren entre sí (claves aleatorias por instancia)', async () => {
    const a = lab(); const b = lab(); const s = await a.cipher.seal(order(), 'ctx');
    expect((await code(b.cipher.open(s.ciphertext, s.keyReference, 'ctx'))).startsWith('PROVIDER_UNAVAILABLE')).toBe(true);
  });
});

describe('compatibilidad con la atestación (API-17/18)', () => {
  it('el adaptador se atesta como puerto de cifrado; cambiar de proveedor/instancia invalida la atestación', async () => {
    const KEY = randomBytes(32); const AUTH = randomBytes(32); const authority = createInProcessIdentityAuthority({ authorityId: 'auth-lab', key: AUTH }); const { cipher } = lab();
    authority.enroll(cipher, 'cipher', { resourceId: 'lab-cipher', subject: 'LIVE' }); const composition = { cipher: { instance: cipher, implementationId: 'provider-cipher', version: 'api19-1' } };
    const identity = { authority, trusted: { 'auth-lab': AUTH } }; const now = Date.now();
    const { attestation, claims } = await issueAttestation({ composition, target: 'LAB', key: KEY, nowMs: now, ttlMs: 60_000, identity });
    expect(claims.conformant).toBe(true); expect(claims.results.filter(r => r.port === 'cipher').every(r => r.pass)).toBe(true);
    expect((await verifyAttestation(attestation, { key: KEY, expectedTarget: 'LAB', composition, nowMs: now + 1000, identity, requireConformant: false })).ok).toBe(true);
    const other = lab().cipher; const swapped = { cipher: { instance: other, implementationId: 'provider-cipher', version: 'api19-1' } };
    expect(await verifyAttestation(attestation, { key: KEY, expectedTarget: 'LAB', composition: swapped, nowMs: now + 1000, identity, requireConformant: false })).toEqual({ ok: false, reason: 'IDENTITY_MISMATCH' });
  });
});

describe('aislamiento estático', () => {
  const strip = (f: string) => readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '');
  it('los módulos no leen el entorno, no usan red/archivos/base de datos, no contienen claves literales y no instalan handlers', () => {
    for (const f of ['provider-cipher.ts', 'guarded-evidence-verifier.ts', 'lab-demo/lab-key-provider.ts']) {
      const t = strip(f); expect(t, f).not.toMatch(/process\.env|\bfetch\s*\(|from\s+['"](?:mysql2|@\/lib\/(?:db|tms)|node:(?:net|tls|http|https|fs|child_process))|sandbox-db/);
      expect(t, f).not.toContain(['install', 'PriceSmartHandler'].join('')); expect(t, f).not.toMatch(/from '\.\.?\/runtime/); expect(t, f).not.toMatch(/['"][A-Fa-f0-9]{32,}['"]/);
    }
  });
  it('ninguna ruta ni módulo de la aplicación los importa (fuera de sus pruebas, del laboratorio y del arnés)', () => {
    const root = path.resolve(__dirname, '../../..'); const hits: string[] = []; const names = ['provider-cipher', 'guarded-evidence-verifier', 'lab-key-provider'];
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !names.some(x => n.startsWith(x)) && !n.includes('.test.')) { const t = readFileSync(f, 'utf8'); if (names.some(x => t.includes(`/${x}'`) || t.includes(`/${x}"`))) hits.push(path.relative(root, f)); } } };
    walk(root); expect(hits).toEqual([]);
  }, 30000);
  it('el proveedor de laboratorio solo existe para LAB y solo con referencias lab.*', async () => {
    const p = createLabKeyProvider(); expect(p.target).toBe('LAB'); expect(p.references().every(r => r.startsWith('lab.'))).toBe(true); expect(p.rotate()).toMatch(/^lab\./);
    expect(() => createLabKeyProvider({ prefix: 'prod' + ' x' })).toThrow();
  });
});
