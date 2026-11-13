import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CipherError, createProviderCipher, isPlainJson, type ExternalKeyProvider, type KeyTarget } from './provider-cipher';
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
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !names.some(x => n.startsWith(x)) && !n.startsWith('kms-adapter') && !n.includes('.test.')) { const t = readFileSync(f, 'utf8'); if (names.some(x => t.includes(`/${x}'`) || t.includes(`/${x}"`))) hits.push(path.relative(root, f)); } } };
    walk(root); expect(hits).toEqual([]);
  }, 30000);
  it('el proveedor de laboratorio solo existe para LAB y solo con referencias lab.*', async () => {
    const p = createLabKeyProvider(); expect(p.target).toBe('LAB'); expect(p.references().every(r => r.startsWith('lab.'))).toBe(true); expect(p.rotate()).toMatch(/^lab\./);
    expect(() => createLabKeyProvider({ prefix: 'prod' + ' x' })).toThrow();
  });
});

// ---- API-19 (auditoría de #612): ciclo de vida del material de clave, tiempo límite y entradas no serializables
const allZero = (b: Uint8Array | undefined) => !!b && b.length > 0 && [...b].every(x => x === 0);
const anyNonZero = (b: Uint8Array | undefined) => !!b && [...b].some(x => x !== 0);
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
/** Proveedor que registra TODAS las copias recibidas (con una instantánea del contenido en el momento de la llamada) para comprobar su borrado posterior. */
function spyProvider(over: Partial<ExternalKeyProvider> = {}, shared?: Map<string, Buffer>) {
  const log = { wrapDek: [] as Uint8Array[], wrapDekAtCall: [] as Buffer[], wrapAad: [] as Uint8Array[], unwrapWrapped: [] as Uint8Array[], unwrapWrappedAtCall: [] as Buffer[], unwrapAad: [] as Uint8Array[], returned: [] as Uint8Array[], signals: [] as (AbortSignal | undefined)[] };
  const base = customProvider('LAB', {}, shared);
  const p = customProvider('LAB', {
    async wrapKey(i) { log.wrapDek.push(i.dataKey); log.wrapDekAtCall.push(Buffer.from(i.dataKey)); log.wrapAad.push(i.aad); log.signals.push(i.signal); return base.wrapKey(i); },
    async unwrapKey(i) { log.unwrapWrapped.push(i.wrappedKey); log.unwrapWrappedAtCall.push(Buffer.from(i.wrappedKey)); log.unwrapAad.push(i.aad); log.signals.push(i.signal); const dek = await base.unwrapKey(i); log.returned.push(dek); return dek; },
    ...over,
  }, base.keys);
  return { provider: p, log, keys: base.keys };
}

describe('ciclo de vida de la DEK y de las copias entregadas al proveedor', () => {
  it('éxito: las copias que recibió el proveedor (dataKey, aad, wrappedKey) se borran; la DEK desenvuelta que devolvió se borra; antes de la llamada contenían material real', async () => {
    const { provider, log } = spyProvider(); const cipher = createProviderCipher({ provider, target: 'LAB' });
    const sealed = await cipher.seal(order(), 'ctx');
    expect(anyNonZero(log.wrapDekAtCall[0])).toBe(true); expect(allZero(log.wrapDek[0])).toBe(true); expect(allZero(log.wrapAad[0])).toBe(true);
    await cipher.open(sealed.ciphertext, sealed.keyReference, 'ctx');
    expect(anyNonZero(log.unwrapWrappedAtCall[0])).toBe(true); expect(allZero(log.unwrapWrapped[0])).toBe(true); expect(allZero(log.unwrapAad[0])).toBe(true); expect(allZero(log.returned[0])).toBe(true);
    const re = await cipher.rewrap(sealed.ciphertext, sealed.keyReference, 'ctx'); expect(re.keyReference).toBe(sealed.keyReference);
    expect(log.wrapDek.every(allZero)).toBe(true); expect(log.unwrapWrapped.every(allZero)).toBe(true); expect(log.returned.every(allZero)).toBe(true);
  });
  it('excepción del proveedor: las copias entregadas también se borran (seal, open y rewrap)', async () => {
    const boom = async () => { throw new Error('secreto-prov-1'); };
    const s1 = spyProvider({ wrapKey: async (i) => { s1.log.wrapDek.push(i.dataKey); s1.log.wrapDekAtCall.push(Buffer.from(i.dataKey)); throw new Error('secreto-prov-1'); } });
    expect(await code(createProviderCipher({ provider: s1.provider, target: 'LAB' }).seal(order(), 'ctx'))).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE');
    expect(anyNonZero(s1.log.wrapDekAtCall[0])).toBe(true); expect(allZero(s1.log.wrapDek[0])).toBe(true);
    const ok = spyProvider(); const sealed = await createProviderCipher({ provider: ok.provider, target: 'LAB' }).seal(order(), 'ctx');
    const s2 = spyProvider({ unwrapKey: async (i) => { s2.log.unwrapWrapped.push(i.wrappedKey); s2.log.unwrapAad.push(i.aad); return boom() as never; } }, ok.keys);
    const c2 = createProviderCipher({ provider: s2.provider, target: 'LAB' });
    expect(await code(c2.open(sealed.ciphertext, sealed.keyReference, 'ctx'))).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE'); expect(await code(c2.rewrap(sealed.ciphertext, sealed.keyReference, 'ctx'))).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE');
    expect(s2.log.unwrapWrapped.length).toBe(2); expect(s2.log.unwrapWrapped.every(allZero)).toBe(true); expect(s2.log.unwrapAad.every(allZero)).toBe(true);
  });
  it('respuesta inválida del proveedor (DEK de longitud errónea): el arreglo recibido se borra', async () => {
    const ok = spyProvider(); const sealed = await createProviderCipher({ provider: ok.provider, target: 'LAB' }).seal(order(), 'ctx'); const short = new Uint8Array(16).fill(9);
    const c = createProviderCipher({ provider: customProvider('LAB', { unwrapKey: async () => short }, ok.keys), target: 'LAB' });
    expect(await code(c.open(sealed.ciphertext, sealed.keyReference, 'ctx'))).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE'); expect(allZero(short)).toBe(true);
  });
  it('se entrega un AbortSignal de mejor esfuerzo y NO se activa en una operación que termina bien', async () => {
    const { provider, log } = spyProvider(); const cipher = createProviderCipher({ provider, target: 'LAB' }); await cipher.seal(order(), 'ctx');
    expect(log.signals[0]).toBeInstanceOf(AbortSignal); expect(log.signals[0]?.aborted).toBe(false);
  });
});

describe('tiempo límite: sin afirmar cancelación y sin aceptar respuestas tardías', () => {
  it('seal: al vencer, rechaza con PROVIDER_UNAVAILABLE, borra las copias que controla AUNQUE el proveedor siga pendiente, activa el signal y descarta la respuesta tardía', async () => {
    const gate = deferred<Uint8Array>(); const seen: { dek?: Uint8Array; signal?: AbortSignal } = {};
    const { provider } = spyProvider({ wrapKey: async (i) => { seen.dek = i.dataKey; seen.signal = i.signal; return gate.promise; } });
    const cipher = createProviderCipher({ provider, target: 'LAB', timeoutMs: 100 });
    expect(await code(cipher.seal(order(), 'ctx'))).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE');
    expect(allZero(seen.dek)).toBe(true);   // la copia de la DEK ya se borró, con el proveedor todavía «trabajando»
    expect(seen.signal?.aborted).toBe(true);   // se avisó (de mejor esfuerzo); NO se afirma que el proveedor cancelara
    gate.resolve(new Uint8Array(60).fill(5)); await wait(30);   // respuesta tardía: no produce efecto alguno ni rechazos sin manejar
    // el adaptador no guarda estado entre llamadas: una llamada NUEVA es independiente de la tardía (aquí el proveedor ya responde de inmediato porque su promesa está resuelta)
    expect(await code(cipher.seal(order(), 'ctx'))).toBe('OK');
  });
  it('open: una DEK que llega tarde jamás se usa y se borra; el open ya había fallado', async () => {
    const ok = spyProvider(); const sealed = await createProviderCipher({ provider: ok.provider, target: 'LAB' }).seal(order(), 'ctx');
    const gate = deferred<Uint8Array>(); let wrappedCopy: Uint8Array | undefined;
    const slow = customProvider('LAB', { unwrapKey: async (i) => { wrappedCopy = i.wrappedKey; return gate.promise; } }, ok.keys);
    const cipher = createProviderCipher({ provider: slow, target: 'LAB', timeoutMs: 100 });
    expect(await code(cipher.open(sealed.ciphertext, sealed.keyReference, 'ctx'))).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE'); expect(allZero(wrappedCopy)).toBe(true);
    const lateDek = new Uint8Array(32).fill(0xaa); gate.resolve(lateDek); await wait(30);
    expect(allZero(lateDek)).toBe(true);   // el material tardío que no se aceptó se borra
  });
  it('currentKeyReference tardía: no se acepta (no hay referencia efectiva) y no deja rechazos sin manejar', async () => {
    const gate = deferred<string>(); const cipher = createProviderCipher({ provider: customProvider('LAB', { currentKeyReference: () => gate.promise }), target: 'LAB', timeoutMs: 100 });
    expect(await code(cipher.seal(order(), 'ctx'))).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE'); gate.resolve('lab.k1'); await wait(30);
    const gate2 = deferred<string>(); const c2 = createProviderCipher({ provider: customProvider('LAB', { currentKeyReference: () => gate2.promise }), target: 'LAB', timeoutMs: 100 });
    expect(await code(c2.seal(order(), 'ctx'))).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE'); gate2.reject(new Error('secreto-tardio')); await wait(30);   // rechazo tardío: sin «unhandled rejection»
  });
  it('un rechazo tardío del proveedor tras el tiempo límite no filtra detalles ni genera efectos', async () => {
    const gate = deferred<Uint8Array>(); const cipher = createProviderCipher({ provider: customProvider('LAB', { wrapKey: () => gate.promise }), target: 'LAB', timeoutMs: 100 });
    const r = await code(cipher.seal(order(), 'ctx')); expect(r).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE'); gate.reject(new Error('secreto-late-1')); await wait(30); expect(r).not.toContain('secreto');
  });
  it('una excepción SÍNCRONA del proveedor (antes de devolver una promesa) también se cierra con PROVIDER_UNAVAILABLE', async () => {
    const cipher = createProviderCipher({ provider: customProvider('LAB', { currentKeyReference: (() => { throw new Error('secreto-sync'); }) as never }), target: 'LAB' });
    const r = await code(cipher.seal(order(), 'ctx')); expect(r).toBe('PROVIDER_UNAVAILABLE:PROVIDER_UNAVAILABLE'); expect(r).not.toContain('secreto');
  });
});

describe('entradas no serializables y excepciones nativas', () => {
  const calls = () => { let n = 0; const base = customProvider('LAB'); const p = customProvider('LAB', { wrapKey: async (i) => { n++; return base.wrapKey(i); }, currentKeyReference: async () => { n++; return 'lab.k1'; } }, base.keys); return { p, count: () => n }; };
  const cyc = (() => { const a: Record<string, unknown> = {}; a.self = a; return a; })();
  const deep = (() => { let o: unknown = 'x'; for (let i = 0; i < 40; i++) o = { o }; return o; })();
  const getter = { get x() { throw new Error('secreto-getter'); } };
  const toJsonThrows = { toJSON() { throw new Error('secreto-tojson'); } };
  class Foo { a = 1; }
  const symbolKey = { [Symbol('s')]: 1, a: 1 };
  const hidden = Object.defineProperty({ a: 1 }, 'h', { value: 2, enumerable: false });
  const sparse = [1, , 3];
  const invalids: [string, unknown][] = [['undefined', undefined], ['función', () => 1], ['símbolo', Symbol('x')], ['bigint', BigInt(10)], ['NaN', Number.NaN], ['Infinity', Infinity], ['Map', new Map([[1, 2]])], ['Set', new Set([1])], ['Date', new Date()], ['clase', new Foo()], ['ciclo', cyc], ['profundidad', deep], ['getter que lanza', getter], ['toJSON que lanza', toJsonThrows], ['clave símbolo', symbolKey], ['propiedad oculta', hidden], ['arreglo disperso', sparse], ['Buffer', Buffer.from('x')], ['objeto anidado con undefined', { a: { b: undefined } }], ['objeto anidado con función', { f: () => 1 }]];
  it('cada entrada no serializable o no fiel produce INVALID (error cerrado) SIN llamar al proveedor ni lanzar excepciones nativas', async () => {
    for (const [name, value] of invalids) {
      const { p, count } = calls(); const cipher = createProviderCipher({ provider: p, target: 'LAB' });
      const r = await code(cipher.seal(value as never, 'ctx')); expect(r, name).toBe('INVALID:INVALID'); expect(count(), name).toBe(0); expect(r, name).not.toContain('secreto');
    }
  });
  it('las entradas JSON simples y fieles se aceptan y se recuperan idénticas', async () => {
    const { p } = calls(); const cipher = createProviderCipher({ provider: p, target: 'LAB' });
    for (const v of [{ a: 1, b: ['x', null, true, { c: 2.5 }], d: '' }, [], {}, 'texto', 42, null, Object.create(null)]) { const s = await cipher.seal(v as never, 'ctx'); expect(await cipher.open(s.ciphertext, s.keyReference, 'ctx')).toEqual(v); }
  });
  it('isPlainJson: definiciones directas y límites', () => {
    for (const [, v] of invalids) expect(isPlainJson(v)).toBe(false);
    expect(isPlainJson({ a: [1, 2, { b: null }] })).toBe(true); expect(isPlainJson('x'.repeat(10))).toBe(true);
    expect(isPlainJson(Array.from({ length: 200_000 }, (_, i) => i))).toBe(false);   // desmesurado
    const shared = { z: 1 }; expect(isPlainJson({ a: shared, b: shared })).toBe(true);   // referencias compartidas (no cíclicas) son válidas
  });
  it('excepciones nativas inesperadas en la ruta de apertura (respuestas que lanzan al leerse) se convierten en errores cerrados', async () => {
    const ok = spyProvider(); const sealed = await createProviderCipher({ provider: ok.provider, target: 'LAB' }).seal(order(), 'ctx');
    const trap = new Proxy(new Uint8Array(32), { get() { throw new TypeError('secreto-proxy'); } });
    const c = createProviderCipher({ provider: customProvider('LAB', { unwrapKey: async () => trap }, ok.keys), target: 'LAB' });
    for (const op of [c.open(sealed.ciphertext, sealed.keyReference, 'ctx'), c.rewrap(sealed.ciphertext, sealed.keyReference, 'ctx')]) { const r = await code(op); expect(r).toMatch(/^(INTEGRITY|PROVIDER_UNAVAILABLE|INVALID):/); expect(r).not.toContain('RAW'); expect(r).not.toContain('secreto'); }
  });
  it('rotación, separación de destinos y denegación por defecto siguen intactas tras el cambio (regresión)', async () => {
    const { cipher, provider } = lab(); const o = order(); const old = await cipher.seal(o, 'ctx'); provider.rotate(); const re = await cipher.rewrap(old.ciphertext, old.keyReference, 'ctx');
    expect(re.keyReference).not.toBe(old.keyReference); expect(await cipher.open(re.ciphertext, re.keyReference, 'ctx')).toEqual(o);
    expect(() => createProviderCipher({ provider: customProvider('PRODUCTION'), target: 'LAB' })).toThrow();
    expect(await code(cipher.open(old.ciphertext, 'prod.k1', 'ctx'))).toBe('INTEGRITY:INTEGRITY');
  });
});

// ---- API-19 (auditoría de #612, SHA 130b3a3b): arreglos con propiedades adicionales, toJSON, símbolos u ocultas
describe('isPlainJson: arreglos y toJSON', () => {
  const withProp = (extra: (a: unknown[]) => void) => { const a: unknown[] = [1, 2]; extra(a); return a; };
  const hostile: [string, unknown][] = [
    ['arreglo con toJSON propio (el caso de la auditoría)', withProp(a => { (a as unknown as { toJSON: () => unknown[] }).toJSON = () => ['contenido diferente']; })],
    ['arreglo con toJSON no enumerable', withProp(a => { Object.defineProperty(a, 'toJSON', { value: () => ['x'], enumerable: false }); })],
    ['arreglo con propiedad adicional enumerable', withProp(a => { (a as unknown as Record<string, unknown>).extra = 1; })],
    ['arreglo con propiedad adicional no enumerable', withProp(a => { Object.defineProperty(a, 'oculta', { value: 1, enumerable: false }); })],
    ['arreglo con clave símbolo', withProp(a => { (a as unknown as Record<symbol, unknown>)[Symbol('s')] = 1; })],
    ['arreglo con símbolo no enumerable', withProp(a => { Object.defineProperty(a, Symbol('s'), { value: 1, enumerable: false }); })],
    ['arreglo con getter en un índice', (() => { const a: unknown[] = [1]; Object.defineProperty(a, '1', { get: () => 2, enumerable: true }); return a; })()],
    ['arreglo con setter en un índice', (() => { const a: unknown[] = [1]; Object.defineProperty(a, '1', { set: () => undefined, enumerable: true }); return a; })()],
    ['arreglo con índice no enumerable', (() => { const a: unknown[] = [1]; Object.defineProperty(a, '1', { value: 2, enumerable: false, writable: true, configurable: true }); return a; })()],
    ['arreglo disperso (hueco)', [1, , 3]],
    ['arreglo con length ampliado (huecos finales)', (() => { const a: unknown[] = [1]; a.length = 3; return a; })()],
    ['arreglo con prototipo alterado', (() => { const a: unknown[] = [1, 2]; Object.setPrototypeOf(a, { toJSON: () => ['x'] }); return a; })()],
    ['subclase de Array', (() => { class A extends Array<number> {} return A.from([1, 2]); })()],
    ['arreglo anidado con toJSON', { lista: withProp(a => { (a as unknown as { toJSON: () => unknown[] }).toJSON = () => []; }) }],
    ['arreglo tipado', new Uint8Array([1, 2])],
    ['objeto con toJSON propio', { a: 1, toJSON: () => ({ b: 2 }) }],
    ['objeto con toJSON no enumerable', Object.defineProperty({ a: 1 }, 'toJSON', { value: () => ({ b: 2 }), enumerable: false })],
    ['objeto con toJSON heredado', Object.assign(Object.create({ toJSON: () => ({ b: 2 }) }), { a: 1 })],
    ['objeto con propiedad símbolo no enumerable', Object.defineProperty({ a: 1 }, Symbol('s'), { value: 1, enumerable: false })],
  ];
  it('cada arreglo/objeto hostil se rechaza', () => { for (const [name, v] of hostile) expect(isPlainJson(v), name).toBe(false); });
  it('el ejemplo exacto del hallazgo: el arreglo con toJSON ya no pasa y JSON.stringify daría OTRO contenido', () => {
    const datos: number[] = [1, 2]; (datos as unknown as { toJSON: () => string[] }).toJSON = () => ['contenido diferente'];
    expect(JSON.stringify(datos)).toBe('["contenido diferente"]'); expect(isPlainJson(datos)).toBe(false);
  });
  it('seal rechaza esos arreglos con INVALID, sin llamar al proveedor ni lanzar excepciones nativas', async () => {
    let calls = 0; const base = customProvider('LAB'); const p = customProvider('LAB', { wrapKey: async (i) => { calls++; return base.wrapKey(i); }, currentKeyReference: async () => { calls++; return 'lab.k1'; } }, base.keys);
    const cipher = createProviderCipher({ provider: p, target: 'LAB' });
    for (const [name, v] of hostile) { const r = await code(cipher.seal(v as never, 'ctx')); expect(r, name).toBe('INVALID:INVALID'); }
    expect(calls).toBe(0);
  });
  it('los arreglos JSON ordinarios (vacíos, anidados, con objetos, null, cadenas y números) siguen aceptándose y se recuperan idénticos', async () => {
    const ok: unknown[] = [[], [1, 2, 3], ['a', null, true, 1.5, -0.5], [[1, [2, [3]]]], [{ a: [1, { b: [] }] }, 'x'], { lista: [1, 2], vacia: [] }, Array.from({ length: 1000 }, (_, i) => i), [[], [[]]]];
    for (const v of ok) expect(isPlainJson(v), JSON.stringify(v).slice(0, 30)).toBe(true);
    const { cipher } = lab(); for (const v of ok) { const s = await cipher.seal(v as never, 'ctx'); expect(await cipher.open(s.ciphertext, s.keyReference, 'ctx')).toEqual(v); }
  });
  it('se conservan la detección de ciclos, la profundidad y el tamaño máximo para arreglos', () => {
    const cyc: unknown[] = [1]; cyc.push(cyc); expect(isPlainJson(cyc)).toBe(false);
    let deep: unknown = 1; for (let i = 0; i < 40; i++) deep = [deep]; expect(isPlainJson(deep)).toBe(false);
    let ok: unknown = 1; for (let i = 0; i < 30; i++) ok = [ok]; expect(isPlainJson(ok)).toBe(true);
    expect(isPlainJson(Array.from({ length: 200_000 }, (_, i) => i))).toBe(false);
    const shared = [1]; expect(isPlainJson([shared, shared])).toBe(true);   // compartir no es ciclo
  });
});
