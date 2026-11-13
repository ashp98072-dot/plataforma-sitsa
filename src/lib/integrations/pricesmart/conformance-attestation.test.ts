import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PayloadCipher } from './mariadb-repository';
import type { AtomicCounterPort, AtomicReplayPort, EvidenceVerifier, IntegrationCatalog, TrustedClock } from './security-contracts';
import { MAX_ATTESTATION_TTL_MS, createMemoryNonceStore, issueAttestation, portFingerprint, redeemAttestation, verifyAttestation, type Attestation, type CompositionDescriptor } from './conformance-attestation';
import { buildReadinessDiagnostic } from './readiness-diagnostic';

// ---- implementaciones de referencia en memoria (solo pruebas); los contadores registran cuántas veces se usan para comprobar que NO se tocan en producción viva
const KEY = randomBytes(32); const T0 = 1_800_000_000_000;
function makeCipher(tag = 'a'): PayloadCipher {
  const key = randomBytes(32);
  return {
    async seal(input, context) { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(context)); const body = Buffer.concat([c.update(JSON.stringify(input), 'utf8'), c.final()]); return { ciphertext: Buffer.concat([iv, c.getAuthTag(), body]), keyReference: `k-${tag}` }; },
    async open(buf, keyReference, context) { if (keyReference !== `k-${tag}`) throw new Error('x'); const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12)); d.setAAD(Buffer.from(context)); d.setAuthTag(buf.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')); },
  };
}
class Counter implements AtomicCounterPort {
  calls = 0; private m = new Map<string, { used: number; resetAtMs: number }>();
  async consume({ identityKey, limit, windowMs, nowMs }: Parameters<AtomicCounterPort['consume']>[0]) {
    this.calls++; let w = this.m.get(identityKey); if (!w || nowMs >= w.resetAtMs) w = { used: 0, resetAtMs: nowMs + windowMs };
    const allowed = w.used < limit; if (allowed) w = { ...w, used: w.used + 1 }; this.m.set(identityKey, w);
    return { allowed, used: w.used, resetAtMs: w.resetAtMs, assurance: 'DISTRIBUTED_ATOMIC' as const };
  }
}
class Replay implements AtomicReplayPort {
  calls = 0; private m = new Map<string, string>();
  async claim({ identityKey, proofId, bindingDigest }: Parameters<AtomicReplayPort['claim']>[0]) {
    this.calls++; const k = `${identityKey}|${proofId}`; const seen = this.m.get(k);
    if (seen === undefined) { this.m.set(k, bindingDigest); return { status: 'CLAIMED' as const, assurance: 'DURABLE_ATOMIC' as const }; }
    return { status: seen === bindingDigest ? ('REUSED' as const) : ('COLLISION' as const), assurance: 'DURABLE_ATOMIC' as const };
  }
}
const clock = (): TrustedClock => { let last = 0; return { nowMs: () => (last = Math.max(last, Date.now())) }; };
const catalog = (): IntegrationCatalog => ({ findByCredential: async () => [] });
const verifier = (): EvidenceVerifier => ({ verify: async () => null });
const composition = (over: Partial<Record<string, unknown>> = {}, subject: 'LIVE' | 'ISOLATED_COPY' = 'ISOLATED_COPY') => {
  const counter = new Counter(); const replay = new Replay();
  const c: CompositionDescriptor = {
    cipher: { instance: makeCipher(), implementationId: 'cipher-ref', version: '1.0.0', subject: 'LIVE' },
    clock: { instance: clock(), implementationId: 'clock-ref', version: '1.0.0', subject: 'LIVE' },
    counter: { instance: counter, implementationId: 'counter-ref', version: '1.0.0', subject },
    replay: { instance: replay, implementationId: 'replay-ref', version: '1.0.0', subject },
    catalog: { instance: catalog(), implementationId: 'catalog-ref', version: '1.0.0', subject: 'LIVE' },
    verifier: { instance: verifier(), implementationId: 'verifier-ref', version: '1.0.0', subject: 'LIVE' },
    ...over,
  } as CompositionDescriptor;
  return { c, counter, replay };
};
const issue = (c: CompositionDescriptor, target: 'LAB' | 'PRODUCTION' = 'LAB', ttlMs = 60_000, nowMs = T0) => issueAttestation({ composition: c, target, key: KEY, nowMs, ttlMs });
const verify = (a: Attestation, c: CompositionDescriptor, over: Partial<Parameters<typeof verifyAttestation>[1]> = {}) => verifyAttestation(a, { key: KEY, expectedTarget: 'LAB', composition: c, nowMs: T0 + 1000, ...over });
const reason = (v: ReturnType<typeof verify>) => (v.ok ? 'OK' : v.reason);
const resign = (payload: string, target: 'LAB' | 'PRODUCTION', key: Uint8Array = KEY) => createHmac('sha256', createHmac('sha256', key).update(`pricesmart-api17-attestation-v1:${target}`).digest()).update(payload).digest('hex');

describe('emisión y verificación', () => {
  it('una composición conforme y completa produce una atestación válida, ligada a identidad, versión y huella de cada puerto', async () => {
    const { c } = composition(); const { attestation, claims } = await issue(c);
    expect(claims.conformant && claims.complete).toBe(true); expect(claims.skipped).toEqual([]); expect(claims.evaluated).toHaveLength(6);
    expect(claims.ports.map(p => [p.port, p.implementationId, p.version])).toEqual(expect.arrayContaining([['cipher', 'cipher-ref', '1.0.0'], ['counter', 'counter-ref', '1.0.0']]));
    expect(claims.ports.every(p => /^[a-f0-9]{64}$/.test(p.fingerprint))).toBe(true);
    const v = verify(attestation, c); expect(v.ok).toBe(true);
  });
  it('un puerto no conforme produce una atestación auténtica pero NO conforme: la verificación estricta la rechaza', async () => {
    const bad = { findByCredential: async () => [{}] } as IntegrationCatalog;
    const { c } = composition({ catalog: { instance: bad, implementationId: 'catalog-bad', version: '1', subject: 'LIVE' } });
    const { attestation, claims } = await issue(c); expect(claims.conformant).toBe(false);
    expect(reason(verify(attestation, c))).toBe('NOT_CONFORMANT'); expect(verify(attestation, c, { requireConformant: false }).ok).toBe(true);
  });
  it('rechaza parámetros inválidos al emitir (clave corta, TTL excesivo, identidad inválida)', async () => {
    const { c } = composition();
    await expect(issueAttestation({ composition: c, target: 'LAB', key: randomBytes(8), nowMs: T0, ttlMs: 60_000 })).rejects.toThrow();
    await expect(issue(c, 'LAB', MAX_ATTESTATION_TTL_MS + 1)).rejects.toThrow(); await expect(issue(c, 'LAB', 10)).rejects.toThrow();
    const bad = composition({ cipher: { instance: makeCipher(), implementationId: 'con espacios', version: '1', subject: 'LIVE' } }).c; await expect(issue(bad)).rejects.toThrow();
  });
  it('ni el resultado ni los errores contienen claves ni secretos', async () => {
    const { c } = composition({ clock: { instance: { nowMs: () => { throw new Error('secreto-token-999'); } }, implementationId: 'c', version: '1', subject: 'LIVE' } });
    const { attestation, claims } = await issue(c); expect(claims.conformant).toBe(false);
    const text = JSON.stringify([attestation, claims]); expect(text).not.toContain('secreto'); expect(text).not.toContain(KEY.toString('hex'));
    expect(JSON.stringify(verify(attestation, c))).not.toContain('secreto');
  });
});

describe('caducidad', () => {
  it('vigente hasta expiresAt; vencida después; emitida en el futuro es rechazada', async () => {
    const { c } = composition(); const { attestation } = await issue(c, 'LAB', 60_000);
    expect(reason(verify(attestation, c, { nowMs: T0 + 59_999 }))).toBe('OK');
    expect(reason(verify(attestation, c, { nowMs: T0 + 60_000 }))).toBe('EXPIRED'); expect(reason(verify(attestation, c, { nowMs: T0 + 3_600_000 }))).toBe('EXPIRED');
    expect(reason(verify(attestation, c, { nowMs: T0 - 60_000 }))).toBe('NOT_YET_VALID'); expect(reason(verify(attestation, c, { nowMs: T0 - 1000 }))).toBe('OK');   // tolerancia de desfase
  });
  it('una atestación firmada con TTL mayor al máximo (aunque la firma sea válida) se rechaza', async () => {
    const { c } = composition(); const { claims } = await issue(c);
    const payload = JSON.stringify({ ...claims, expiresAtMs: claims.issuedAtMs + MAX_ATTESTATION_TTL_MS + 1 });
    expect(reason(verify({ payload, signature: resign(payload, 'LAB') }, c))).toBe('TTL_TOO_LONG');
  });
});

describe('manipulación', () => {
  it('cualquier alteración del contenido, de la firma o de su formato se rechaza', async () => {
    const { c } = composition(); const { attestation, claims } = await issue(c, 'LAB');
    const flip = (s: string) => s.slice(0, -1) + (s.endsWith('0') ? '1' : '0');
    expect(reason(verify({ ...attestation, signature: flip(attestation.signature) }, c))).toBe('BAD_SIGNATURE');
    expect(reason(verify({ ...attestation, payload: attestation.payload.replace('"conformant":true', '"conformant":false') }, c))).toBe('BAD_SIGNATURE');
    expect(reason(verify({ ...attestation, payload: attestation.payload + ' ' }, c))).toBe('BAD_SIGNATURE');
    expect(reason(verify({ payload: attestation.payload, signature: 'zz' }, c))).toBe('MALFORMED'); expect(reason(verify({ payload: 5, signature: 5 } as never, c))).toBe('MALFORMED');
    expect(reason(verify(null as never, c))).toBe('MALFORMED');
    // marcar como completo/conforme un resultado que no lo era, con firma recalculada con OTRA clave
    const forged = JSON.stringify({ ...claims, conformant: true, complete: true, results: [] });
    expect(reason(verify({ payload: forged, signature: resign(forged, 'LAB', randomBytes(32)) }, c))).toBe('BAD_SIGNATURE');
    // campos adicionales (firma válida, esquema estricto) → MALFORMED
    const extra = JSON.stringify({ ...claims, extra: 1 }); expect(reason(verify({ payload: extra, signature: resign(extra, 'LAB') }, c))).toBe('MALFORMED');
  });
});

describe('reutilización', () => {
  it('redeem consume el nonce: la segunda presentación es REPLAYED; verify no lo consume', async () => {
    const { c } = composition(); const { attestation } = await issue(c); const nonces = createMemoryNonceStore();
    expect(verify(attestation, c).ok && verify(attestation, c).ok).toBe(true);
    const args = { key: KEY, expectedTarget: 'LAB' as const, composition: c, nowMs: Date.now() };
    const one = issueAttestation({ composition: c, target: 'LAB', key: KEY, nowMs: Date.now(), ttlMs: 60_000 });
    const a = (await one).attestation;
    expect((await redeemAttestation(a, { ...args, nonces })).ok).toBe(true);
    expect(reason(await redeemAttestation(a, { ...args, nonces }) as never)).toBe('REPLAYED');
  });
  it('un nonce que se canjea no sirve de otra emisión; cada emisión tiene nonce propio', async () => {
    const { c } = composition(); const [x, y] = [await issue(c), await issue(c)]; expect(x.claims.nonce).not.toBe(y.claims.nonce);
  });
  it('un almacén de nonces que falla produce UNAVAILABLE (cierra)', async () => {
    const { c } = composition(); const a = (await issueAttestation({ composition: c, target: 'LAB', key: KEY, nowMs: Date.now(), ttlMs: 60_000 })).attestation;
    const r = await redeemAttestation(a, { key: KEY, expectedTarget: 'LAB', composition: c, nowMs: Date.now(), nonces: { consume: async () => { throw new Error('x'); } } }); expect(reason(r)).toBe('UNAVAILABLE');
  });
});

describe('cambio de composición', () => {
  it('cambiar la instancia, la versión, la identidad, el código o el slot invalida la atestación', async () => {
    const { c } = composition(); const { attestation } = await issue(c);
    const mk = (patch: Partial<Record<string, unknown>>) => ({ ...c, ...patch }) as CompositionDescriptor;
    const d = (name: 'cipher' | 'counter') => c[name] as NonNullable<CompositionDescriptor['cipher']>;
    // misma implementación, otra versión declarada
    expect(reason(verify(attestation, mk({ cipher: { ...d('cipher'), version: '1.0.1' } })))).toBe('COMPOSITION_MISMATCH');
    // otra identidad declarada
    expect(reason(verify(attestation, mk({ cipher: { ...d('cipher'), implementationId: 'otro' } })))).toBe('COMPOSITION_MISMATCH');
    // código distinto con la misma identidad/versión declaradas (el método fue alterado)
    const patched = makeCipher(); const original = patched.seal; patched.seal = async (i, ctx) => original(i, `${ctx}!`);
    expect(reason(verify(attestation, mk({ cipher: { ...d('cipher'), instance: patched } })))).toBe('COMPOSITION_MISMATCH');
    // puerto de otra clase intercambiado de ranura
    expect(reason(verify(attestation, mk({ cipher: { ...d('counter') } })))).toBe('COMPOSITION_MISMATCH');
    // puerto quitado o agregado
    const { clock: _omit, ...rest } = c; void _omit; expect(reason(verify(attestation, rest as CompositionDescriptor))).toBe('COMPOSITION_MISMATCH');
    // cambiar `subject` también cambia la composición
    expect(reason(verify(attestation, mk({ counter: { ...d('counter'), subject: 'LIVE' } })))).toBe('COMPOSITION_MISMATCH');
  });
  it('la huella depende del código real y es estable entre instancias del mismo tipo', () => {
    expect(portFingerprint(new Counter(), 'x', '1')).toBe(portFingerprint(new Counter(), 'x', '1'));
    expect(portFingerprint(new Counter(), 'x', '1')).not.toBe(portFingerprint(new Replay(), 'x', '1'));
    expect(portFingerprint(new Counter(), 'x', '1')).not.toBe(portFingerprint(new Counter(), 'x', '2'));
  });
  it('una atestación de otra composición (aunque sea auténtica y vigente) no sirve para ésta', async () => {
    const [a, b] = [composition(), composition({ cipher: { instance: makeCipher('b'), implementationId: 'cipher-otro', version: '2', subject: 'LIVE' } })];
    const att = (await issue(a.c)).attestation; expect(reason(verify(att, b.c))).toBe('COMPOSITION_MISMATCH');
  });
});

describe('separación laboratorio / producción', () => {
  it('una atestación de laboratorio nunca verifica como de producción (ni con la misma clave) y viceversa', async () => {
    const { c } = composition(); const lab = (await issue(c, 'LAB')).attestation; const prod = (await issue(c, 'PRODUCTION')).attestation;
    expect(reason(verify(lab, c, { expectedTarget: 'PRODUCTION' }))).toBe('WRONG_TARGET'); expect(reason(verify(prod, c, { expectedTarget: 'LAB' }))).toBe('WRONG_TARGET');
    // cambiar el destino dentro del contenido invalida la firma
    expect(reason(verify({ ...lab, payload: lab.payload.replace('"target":"LAB"', '"target":"PRODUCTION"') }, c, { expectedTarget: 'PRODUCTION' }))).toBe('BAD_SIGNATURE');
    // el id de composición incluye el destino
    expect((await issue(c, 'LAB')).claims.compositionId).not.toBe((await issue(c, 'PRODUCTION')).claims.compositionId);
  });
  it('en PRODUCTION no se ejecutan contador ni replay sobre instancias vivas; la atestación es incompleta y no verifica', async () => {
    const { c, counter, replay } = composition({}, 'LIVE'); const { attestation, claims } = await issue(c, 'PRODUCTION');
    expect(counter.calls).toBe(0); expect(replay.calls).toBe(0); expect(claims.skipped).toEqual(['counter', 'replay']); expect(claims.evaluated).not.toContain('counter');
    expect(claims.complete).toBe(false); expect(reason(verify(attestation, c, { expectedTarget: 'PRODUCTION' }))).toBe('NOT_CONFORMANT');
  });
  it('en PRODUCTION con copia aislada sí se ejecutan y la atestación es completa; el id registra el sujeto', async () => {
    const { c, counter, replay } = composition({}, 'ISOLATED_COPY'); const { attestation, claims } = await issue(c, 'PRODUCTION');
    expect(counter.calls).toBeGreaterThan(0); expect(replay.calls).toBeGreaterThan(0); expect(claims.complete && claims.conformant).toBe(true);
    expect(claims.ports.filter(p => p.subject === 'ISOLATED_COPY').map(p => p.port)).toEqual(['counter', 'replay']); expect(verify(attestation, c, { expectedTarget: 'PRODUCTION' }).ok).toBe(true);
  });
  it('en LAB todos los puertos se ejecutan, también sobre instancias «LIVE» del laboratorio', async () => {
    const { c, counter } = composition({}, 'LIVE'); const { claims } = await issue(c, 'LAB'); expect(counter.calls).toBeGreaterThan(0); expect(claims.complete).toBe(true);
  });
  it('un fallo de la clave de un destino no compromete al otro (derivación por destino)', async () => {
    const { c } = composition(); const lab = (await issue(c, 'LAB')).attestation;
    const asProd = { payload: lab.payload.replace('"LAB"', '"PRODUCTION"'), signature: lab.signature };
    expect(reason(verify(asProd, c, { expectedTarget: 'PRODUCTION' }))).toBe('BAD_SIGNATURE');
  });
});

describe('sin efecto sobre readiness ni sobre el runtime', () => {
  it('existir una atestación válida no cambia el diagnóstico: ready=false y ningún puerto OK', async () => {
    const { c } = composition(); const { attestation } = await issue(c, 'PRODUCTION'); void attestation;
    for (const handlerInstalled of [false, true]) {
      const r = buildReadinessDiagnostic({ PRICESMART_RUNTIME_MODE: 'ENABLED' }, { handlerInstalled, labActive: false });
      expect(r.ready).toBe(false); expect(r.checks.some(x => x.id.startsWith('PORT:') && x.status === 'OK')).toBe(false); expect(r.blockers).toContain('PRODUCTION_COMPOSITION_NOT_IMPLEMENTED');
    }
  });
  const here = (f: string) => readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '');
  it('el módulo no instala handlers, no lee el entorno y no usa red, archivos, base de datos ni TMS', () => {
    const s = here('conformance-attestation.ts');
    expect(s).not.toMatch(/process\.env|\bfetch\s*\(|from\s+['"](?:mysql2|@\/lib\/(?:db|tms)|node:(?:net|tls|http|https|fs|child_process))|sandbox-db/);
    expect(s).not.toContain(['install', 'PriceSmartHandler'].join('')); expect(s).not.toMatch(/from '\.\/runtime/); expect(s).not.toMatch(/readiness-diagnostic/);
  });
  it('ni el diagnóstico ni el runtime importan la atestación, y ningún código de la app (fuera del módulo y sus pruebas) la usa', () => {
    for (const f of ['readiness-diagnostic.ts', 'runtime.ts', 'runtime-state.ts', ['runtime', 'assembly.ts'].join('-'), 'runtime-config.ts']) expect(here(f)).not.toContain('conformance-attestation');
    const root = path.resolve(__dirname, '../../..'); const hits: string[] = []; const needle = ['conformance', 'attestation'].join('-');
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !n.startsWith(needle) && !n.startsWith('port-conformance') && readFileSync(f, 'utf8').includes(needle)) hits.push(path.relative(root, f)); } };
    walk(root); expect(hits).toEqual([]);
  });
});
