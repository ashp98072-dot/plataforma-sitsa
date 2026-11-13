import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PayloadCipher } from './mariadb-repository';
import type { AtomicCounterPort, AtomicReplayPort, EvidenceVerifier, IntegrationCatalog, TrustedClock } from './security-contracts';
import {
  MAX_ATTESTATION_TTL_MS, createInProcessIdentityAuthority, createMemoryNonceStore, issueAttestation, portFingerprint, redeemAttestation, verifyAttestation,
  type Attestation, type CompositionDescriptor, type IdentityStatement, type NonceStore, type ResourceIdentityAuthority, type ResourceSubject,
} from './conformance-attestation';
import { buildReadinessDiagnostic } from './readiness-diagnostic';
import type { PortName } from './port-conformance';

// ---- implementaciones de referencia en memoria (solo pruebas); los contadores registran cuántas veces se usan para comprobar que NO se tocan sobre recursos vivos de producción
const KEY = randomBytes(32); const AUTH_KEY = randomBytes(32); const T0 = 1_800_000_000_000;
function makeCipher(tag = 'a'): PayloadCipher {
  const key = randomBytes(32);   // clave propia de CADA instancia: el código fuente es idéntico entre instancias
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

type Fx = { c: CompositionDescriptor; counter: Counter; replay: Replay; authority: ReturnType<typeof createInProcessIdentityAuthority>; trust: { authority: ResourceIdentityAuthority; trusted: Record<string, Uint8Array> } };
const MUT: PortName[] = ['counter', 'replay'];
/** Inscribe cada instancia en la autoridad con un resourceId no secreto; el sujeto de contador/replay lo fija la AUTORIDAD (no el descriptor). */
function fixture(subject: ResourceSubject = 'ISOLATED_COPY', over: Partial<Record<string, unknown>> = {}): Fx {
  const counter = new Counter(); const replay = new Replay(); const authority = createInProcessIdentityAuthority({ authorityId: 'auth-lab', key: AUTH_KEY });
  const c = {
    cipher: { instance: makeCipher(), implementationId: 'cipher-ref', version: '1.0.0' }, clock: { instance: clock(), implementationId: 'clock-ref', version: '1.0.0' },
    counter: { instance: counter, implementationId: 'counter-ref', version: '1.0.0' }, replay: { instance: replay, implementationId: 'replay-ref', version: '1.0.0' },
    catalog: { instance: catalog(), implementationId: 'catalog-ref', version: '1.0.0' }, verifier: { instance: verifier(), implementationId: 'verifier-ref', version: '1.0.0' }, ...over,
  } as CompositionDescriptor;
  for (const [port, d] of Object.entries(c) as [PortName, { instance: object }][]) authority.enroll(d.instance, port, { resourceId: `${port}-res-1`, subject: MUT.includes(port) ? subject : 'LIVE' });
  return { c, counter, replay, authority, trust: { authority, trusted: { 'auth-lab': AUTH_KEY } } };
}
const issue = (fx: Fx, target: 'LAB' | 'PRODUCTION' = 'LAB', ttlMs = 60_000, nowMs = T0) => issueAttestation({ composition: fx.c, target, key: KEY, nowMs, ttlMs, identity: fx.trust });
const verify = (a: Attestation, fx: Fx, over: Record<string, unknown> = {}) => verifyAttestation(a, { key: KEY, expectedTarget: 'LAB', composition: fx.c, nowMs: T0 + 1000, identity: fx.trust, ...over } as never);
const reason = (v: { ok: boolean; reason?: string }) => (v.ok ? 'OK' : v.reason);
const resign = (payload: string, target: 'LAB' | 'PRODUCTION', key: Uint8Array = KEY) => createHmac('sha256', createHmac('sha256', key).update(`pricesmart-api17-attestation-v1:${target}`).digest()).update(payload).digest('hex');
const sourcePath = (f: string) => path.join(__dirname, f);
/** Familia API-18 (composición administrativa): único código que puede importar la atestación; tampoco lo invoca la aplicación (lo vigila installation-gate.test.ts). */
const API18_FAMILY = ['attestation-mariadb', 'installation-gate', 'mariadb-composition', 'registry-identity-authority'];

describe('emisión y verificación', () => {
  it('una composición conforme, completa e identificada produce una atestación válida ligada a código, versión e identidad de recurso', async () => {
    const fx = fixture(); const { attestation, claims } = await issue(fx);
    expect(claims.conformant && claims.complete).toBe(true); expect(claims.skipped).toEqual([]); expect(claims.evaluated).toHaveLength(6);
    expect(claims.ports.map(p => [p.port, p.implementationId, p.version, p.authorityId, p.resourceId])).toEqual(expect.arrayContaining([['cipher', 'cipher-ref', '1.0.0', 'auth-lab', 'cipher-res-1'], ['counter', 'counter-ref', '1.0.0', 'auth-lab', 'counter-res-1']]));
    expect(claims.ports.every(p => /^[a-f0-9]{64}$/.test(p.fingerprint))).toBe(true);
    expect((await verify(attestation, fx)).ok).toBe(true);
  });
  it('un puerto no conforme produce una atestación auténtica pero NO conforme: la verificación estricta la rechaza', async () => {
    const bad = { findByCredential: async () => [{}] } as IntegrationCatalog;
    const fx = fixture('ISOLATED_COPY', { catalog: { instance: bad, implementationId: 'catalog-bad', version: '1' } });
    const { attestation, claims } = await issue(fx); expect(claims.conformant).toBe(false);
    expect(reason(await verify(attestation, fx))).toBe('NOT_CONFORMANT'); expect((await verify(attestation, fx, { requireConformant: false })).ok).toBe(true);
  });
  it('rechaza parámetros inválidos al emitir (clave corta, TTL excesivo, nombre inválido, sin identidad)', async () => {
    const fx = fixture();
    await expect(issueAttestation({ composition: fx.c, target: 'LAB', key: randomBytes(8), nowMs: T0, ttlMs: 60_000, identity: fx.trust })).rejects.toThrow();
    await expect(issue(fx, 'LAB', MAX_ATTESTATION_TTL_MS + 1)).rejects.toThrow(); await expect(issue(fx, 'LAB', 10)).rejects.toThrow();
    const bad = fixture('ISOLATED_COPY', { cipher: { instance: makeCipher(), implementationId: 'con espacios', version: '1' } }); await expect(issue(bad)).rejects.toThrow();
    await expect(issueAttestation({ composition: {}, target: 'LAB', key: KEY, nowMs: T0, ttlMs: 60_000, identity: fx.trust })).rejects.toThrow();
  });
  it('ni el resultado ni los errores contienen claves ni secretos', async () => {
    const fx = fixture('ISOLATED_COPY', { clock: { instance: { nowMs: () => { throw new Error('secreto-token-999'); } }, implementationId: 'c', version: '1' } });
    fx.authority.enroll((fx.c.clock as { instance: object }).instance, 'clock', { resourceId: 'clock-res-1', subject: 'LIVE' });
    const { attestation, claims } = await issue(fx); expect(claims.conformant).toBe(false);
    const text = JSON.stringify([attestation, claims, await verify(attestation, fx)]); expect(text).not.toContain('secreto');
    for (const k of [KEY, AUTH_KEY]) expect(text).not.toContain(k.toString('hex'));
  });
});

describe('identidad real del recurso (autoridad confiable)', () => {
  it('la huella cubre solo el CÓDIGO: dos cifradores con el mismo código y distinta clave comparten huella (por eso no basta)', () => {
    expect(portFingerprint(makeCipher(), 'x', '1')).toBe(portFingerprint(makeCipher(), 'x', '1'));
  });
  it('sustituir el cifrado por otro con el MISMO código pero distinta clave invalida la atestación (la autoridad no lo conoce)', async () => {
    const fx = fixture(); const { attestation } = await issue(fx);
    const other = makeCipher();   // mismo código y misma etiqueta, otra clave
    expect(portFingerprint(other, 'cipher-ref', '1.0.0')).toBe(portFingerprint((fx.c.cipher as { instance: object }).instance, 'cipher-ref', '1.0.0'));
    const swapped = { ...fx, c: { ...fx.c, cipher: { instance: other, implementationId: 'cipher-ref', version: '1.0.0' } } } as Fx;
    expect(reason(await verify(attestation, swapped))).toBe('IDENTITY_MISMATCH');
    // aunque el nuevo cifrador fuera inscrito por la autoridad con OTRO recurso, tampoco sirve
    fx.authority.enroll(other, 'cipher', { resourceId: 'cipher-res-2', subject: 'LIVE' }); expect(reason(await verify(attestation, swapped))).toBe('IDENTITY_MISMATCH');
    // y la atestación original sigue válida para la composición original
    expect((await verify(attestation, fx)).ok).toBe(true);
  });
  it('cambiar el recurso de almacenamiento conservando la misma implementación invalida la atestación', async () => {
    const fx = fixture(); const { attestation } = await issue(fx);
    const counter2 = new Counter(); fx.authority.enroll(counter2, 'counter', { resourceId: 'counter-res-2', subject: 'ISOLATED_COPY' });
    const moved = { ...fx, c: { ...fx.c, counter: { instance: counter2, implementationId: 'counter-ref', version: '1.0.0' } } } as Fx;
    expect(portFingerprint(counter2, 'counter-ref', '1.0.0')).toBe(portFingerprint(fx.counter, 'counter-ref', '1.0.0'));
    expect(reason(await verify(attestation, moved))).toBe('IDENTITY_MISMATCH');
    // el mismo recurso lógico servido por otra instancia inscrita con el MISMO resourceId es aceptado (reemplazo legítimo del mismo recurso)
    const counter3 = new Counter(); fx.authority.enroll(counter3, 'counter', { resourceId: 'counter-res-1', subject: 'ISOLATED_COPY' });
    expect((await verify(attestation, { ...fx, c: { ...fx.c, counter: { instance: counter3, implementationId: 'counter-ref', version: '1.0.0' } } } as Fx)).ok).toBe(true);
  });
  it('un recurso desconocido para la autoridad no se atesta', async () => {
    const fx = fixture(); const stranger = { ...fx, c: { ...fx.c, replay: { instance: new Replay(), implementationId: 'replay-ref', version: '1.0.0' } } } as Fx;
    await expect(issue(stranger)).rejects.toThrow();
  });
  it('una «autoridad» propia de la composición (otra clave, o no confiable) no sirve', async () => {
    const fx = fixture(); const rogueKey = randomBytes(32);
    const rogue = createInProcessIdentityAuthority({ authorityId: 'auth-lab', key: rogueKey });   // mismo id, otra clave
    for (const [port, d] of Object.entries(fx.c) as [PortName, { instance: object }][]) rogue.enroll(d.instance, port, { resourceId: `${port}-res-1`, subject: 'LIVE' });
    await expect(issueAttestation({ composition: fx.c, target: 'LAB', key: KEY, nowMs: T0, ttlMs: 60_000, identity: { authority: rogue, trusted: fx.trust.trusted } })).rejects.toThrow();
    const other = createInProcessIdentityAuthority({ authorityId: 'auth-otra', key: rogueKey });
    for (const [port, d] of Object.entries(fx.c) as [PortName, { instance: object }][]) other.enroll(d.instance, port, { resourceId: `${port}-res-1`, subject: 'LIVE' });
    await expect(issueAttestation({ composition: fx.c, target: 'LAB', key: KEY, nowMs: T0, ttlMs: 60_000, identity: { authority: other, trusted: fx.trust.trusted } })).rejects.toThrow();   // autoridad no listada como confiable
  });
  it('una afirmación de identidad vieja grabada no se puede reutilizar (el desafío es nuevo en cada operación)', async () => {
    const fx = fixture(); const { attestation } = await issue(fx); const recorded = new Map<string, IdentityStatement | null>();
    const first: ResourceIdentityAuthority = { identify: async (i) => { const r = await fx.authority.identify(i); recorded.set(i.port, r); return r; } };
    await issueAttestation({ composition: fx.c, target: 'LAB', key: KEY, nowMs: T0, ttlMs: 60_000, identity: { authority: first, trusted: fx.trust.trusted } });
    const replayer: ResourceIdentityAuthority = { identify: async (i) => recorded.get(i.port) ?? null };
    expect(reason(await verify(attestation, { ...fx, trust: { authority: replayer, trusted: fx.trust.trusted } } as Fx))).toBe('IDENTITY_MISMATCH');
  });
  it('el sujeto (LIVE / ISOLATED_COPY) lo fija la autoridad: si cambia, la atestación deja de valer; la composición no puede declararlo', async () => {
    const fx = fixture('ISOLATED_COPY'); const { attestation } = await issue(fx, 'PRODUCTION');
    fx.authority.enroll(fx.counter, 'counter', { resourceId: 'counter-res-1', subject: 'LIVE' });
    expect(reason(await verify(attestation, fx, { expectedTarget: 'PRODUCTION' }))).toBe('IDENTITY_MISMATCH');
    expect(Object.keys(fx.c.counter as object)).not.toContain('subject');
  });
  it('los identificadores de recurso deben ser opacos y sin secretos: se rechazan cadenas de conexión y credenciales', () => {
    const a = createInProcessIdentityAuthority({ authorityId: 'a', key: AUTH_KEY });
    for (const bad of ['mysql://user:pa$$@host:3306/db', 'Server=h;Password=x', 'usuario@host', 'con espacios', '', 'x'.repeat(129)]) expect(() => a.enroll({}, 'cipher', { resourceId: bad, subject: 'LIVE' })).toThrow();
    expect(() => a.enroll({}, 'cipher', { resourceId: 'kms-key-2026-01', subject: 'LIVE' })).not.toThrow();
  });
  it('la identidad es parte del id de composición', async () => {
    const [a, b] = [fixture(), fixture()]; for (const [port, d] of Object.entries(b.c) as [PortName, { instance: object }][]) b.authority.enroll(d.instance, port, { resourceId: `${port}-res-9`, subject: MUT.includes(port) ? 'ISOLATED_COPY' : 'LIVE' });
    expect((await issue(a)).claims.compositionId).not.toBe((await issue(b)).claims.compositionId);
  });
});

describe('caducidad', () => {
  it('vigente hasta expiresAt; vencida después; emitida en el futuro es rechazada', async () => {
    const fx = fixture(); const { attestation } = await issue(fx, 'LAB', 60_000);
    expect(reason(await verify(attestation, fx, { nowMs: T0 + 59_999 }))).toBe('OK');
    expect(reason(await verify(attestation, fx, { nowMs: T0 + 60_000 }))).toBe('EXPIRED'); expect(reason(await verify(attestation, fx, { nowMs: T0 + 3_600_000 }))).toBe('EXPIRED');
    expect(reason(await verify(attestation, fx, { nowMs: T0 - 60_000 }))).toBe('NOT_YET_VALID'); expect(reason(await verify(attestation, fx, { nowMs: T0 - 1000 }))).toBe('OK');
  });
  it('una atestación firmada con TTL mayor al máximo (aunque la firma sea válida) se rechaza', async () => {
    const fx = fixture(); const { claims } = await issue(fx);
    const payload = JSON.stringify({ ...claims, expiresAtMs: claims.issuedAtMs + MAX_ATTESTATION_TTL_MS + 1 });
    expect(reason(await verify({ payload, signature: resign(payload, 'LAB') }, fx))).toBe('TTL_TOO_LONG');
  });
});

describe('manipulación', () => {
  it('cualquier alteración del contenido, de la firma o de su formato se rechaza', async () => {
    const fx = fixture(); const { attestation, claims } = await issue(fx, 'LAB');
    const flip = (s: string) => s.slice(0, -1) + (s.endsWith('0') ? '1' : '0');
    expect(reason(await verify({ ...attestation, signature: flip(attestation.signature) }, fx))).toBe('BAD_SIGNATURE');
    expect(reason(await verify({ ...attestation, payload: attestation.payload.replace('"conformant":true', '"conformant":false') }, fx))).toBe('BAD_SIGNATURE');
    expect(reason(await verify({ ...attestation, payload: attestation.payload.replace('counter-res-1', 'counter-res-2') }, fx))).toBe('BAD_SIGNATURE');
    expect(reason(await verify({ ...attestation, payload: attestation.payload + ' ' }, fx))).toBe('BAD_SIGNATURE');
    expect(reason(await verify({ payload: attestation.payload, signature: 'zz' }, fx))).toBe('MALFORMED'); expect(reason(await verify({ payload: 5, signature: 5 } as never, fx))).toBe('MALFORMED');
    expect(reason(await verify(null as never, fx))).toBe('MALFORMED');
    const forged = JSON.stringify({ ...claims, conformant: true, complete: true, results: [] });
    expect(reason(await verify({ payload: forged, signature: resign(forged, 'LAB', randomBytes(32)) }, fx))).toBe('BAD_SIGNATURE');
    const extra = JSON.stringify({ ...claims, extra: 1 }); expect(reason(await verify({ payload: extra, signature: resign(extra, 'LAB') }, fx))).toBe('MALFORMED');
    // identidad de recurso falsificada con firma válida de la atestación (clave de atestación comprometida): la autoridad la contradice igualmente
    const lie = JSON.stringify({ ...claims, ports: claims.ports.map(p => (p.port === 'cipher' ? { ...p, resourceId: 'cipher-res-ajeno' } : p)) });
    expect(reason(await verify({ payload: lie, signature: resign(lie, 'LAB') }, fx))).toBe('IDENTITY_MISMATCH');
  });
});

describe('reutilización y canje estricto', () => {
  const args = (fx: Fx, nonces: NonceStore, extra: Record<string, unknown> = {}) => ({ key: KEY, expectedTarget: 'LAB' as const, composition: fx.c, nowMs: Date.now(), identity: fx.trust, nonces, ...extra });
  const issueNow = (fx: Fx, target: 'LAB' | 'PRODUCTION' = 'LAB') => issueAttestation({ composition: fx.c, target, key: KEY, nowMs: Date.now(), ttlMs: 60_000, identity: fx.trust });
  it('redeem consume el nonce: la segunda presentación es REPLAYED; verify no lo consume', async () => {
    const fx = fixture(); const { attestation } = await issueNow(fx); const nonces = createMemoryNonceStore();
    expect((await verify(attestation, fx, { nowMs: Date.now() })).ok && (await verify(attestation, fx, { nowMs: Date.now() })).ok).toBe(true);
    expect((await redeemAttestation(attestation, args(fx, nonces))).ok).toBe(true);
    expect(reason(await redeemAttestation(attestation, args(fx, nonces)))).toBe('REPLAYED');
  });
  it('cada emisión tiene nonce propio; un almacén de nonces que falla produce UNAVAILABLE (cierra)', async () => {
    const fx = fixture(); const [x, y] = [await issue(fx), await issue(fx)]; expect(x.claims.nonce).not.toBe(y.claims.nonce);
    const { attestation } = await issueNow(fx);
    expect(reason(await redeemAttestation(attestation, args(fx, { consume: async () => { throw new Error('x'); } })))).toBe('UNAVAILABLE');
  });
  it('el canje NUNCA acepta una atestación incompleta, aunque el consumidor intente desactivar la validación', async () => {
    const fx = fixture('LIVE'); const { attestation, claims } = await issueNow(fx, 'PRODUCTION');   // contador y replay vivos → no se ejecutan → incompleta
    expect(claims.complete).toBe(false); let consumed = 0; const spy: NonceStore = { consume: async () => { consumed++; return 'FRESH'; } };
    for (const extra of [{}, { requireConformant: false }, { requireConformant: undefined }, { requireConformant: 0 }]) {
      expect(reason(await redeemAttestation(attestation, args(fx, spy, { expectedTarget: 'PRODUCTION', ...extra })))).toBe('NOT_CONFORMANT');
    }
    expect(consumed).toBe(0);   // y el nonce no se consume
    expect((await verify(attestation, fx, { expectedTarget: 'PRODUCTION', requireConformant: false, nowMs: Date.now() })).ok).toBe(true);   // solo la verificación de inspección puede mirarla
  });
  it('el canje NUNCA acepta una atestación no conforme, ni siquiera con requireConformant:false', async () => {
    const bad = { findByCredential: async () => [{}] } as IntegrationCatalog;
    const fx = fixture('ISOLATED_COPY', { catalog: { instance: bad, implementationId: 'catalog-bad', version: '1' } });
    const { attestation, claims } = await issueNow(fx); expect(claims.conformant).toBe(false); let consumed = 0; const spy: NonceStore = { consume: async () => { consumed++; return 'FRESH'; } };
    for (const extra of [{}, { requireConformant: false }]) expect(reason(await redeemAttestation(attestation, args(fx, spy, extra)))).toBe('NOT_CONFORMANT');
    expect(consumed).toBe(0);
  });
  it('el canje exige además identidad vigente, vigencia, destino y composición', async () => {
    const fx = fixture(); const { attestation } = await issueNow(fx); const nonces = createMemoryNonceStore();
    const other = makeCipher(); fx.authority.enroll(other, 'cipher', { resourceId: 'cipher-res-7', subject: 'LIVE' });
    expect(reason(await redeemAttestation(attestation, args({ ...fx, c: { ...fx.c, cipher: { instance: other, implementationId: 'cipher-ref', version: '1.0.0' } } } as Fx, nonces)))).toBe('IDENTITY_MISMATCH');
    expect(reason(await redeemAttestation(attestation, args(fx, nonces, { nowMs: Date.now() + 3_600_000 })))).toBe('EXPIRED');
    expect(reason(await redeemAttestation(attestation, args(fx, nonces, { expectedTarget: 'PRODUCTION' })))).toBe('WRONG_TARGET');
    expect((await redeemAttestation(attestation, args(fx, nonces))).ok).toBe(true);   // tras los rechazos el nonce seguía intacto
  });
  it('la firma de tipos no ofrece requireConformant en el canje', () => {
    const src = readFileSync(sourcePath('conformance-attestation.ts'), 'utf8'); const i = src.indexOf('export async function redeemAttestation');
    const redeemSig = src.slice(i, i + 220);
    expect(redeemSig).toContain('VerifyInput & { nonces: NonceStore }'); expect(redeemSig).not.toContain('requireConformant');
  });
});

describe('cambio de composición', () => {
  it('cambiar versión, nombre, código, ranura o quitar un puerto invalida la atestación', async () => {
    const fx = fixture(); const { attestation } = await issue(fx);
    const mk = (patch: Partial<Record<string, unknown>>) => ({ ...fx, c: { ...fx.c, ...patch } }) as Fx;
    const d = (name: 'cipher' | 'counter') => fx.c[name] as NonNullable<CompositionDescriptor['cipher']>;
    expect(reason(await verify(attestation, mk({ cipher: { ...d('cipher'), version: '1.0.1' } })))).toBe('COMPOSITION_MISMATCH');
    expect(reason(await verify(attestation, mk({ cipher: { ...d('cipher'), implementationId: 'otro' } })))).toBe('COMPOSITION_MISMATCH');
    const patched = d('cipher').instance as PayloadCipher; const original = patched.seal.bind(patched); const saved = patched.seal;
    patched.seal = async (i, ctx) => original(i, `${ctx}!`);
    expect(reason(await verify(attestation, fx))).toBe('COMPOSITION_MISMATCH');   // el MISMO objeto con un método alterado: cambia el código
    patched.seal = saved; expect((await verify(attestation, fx)).ok).toBe(true);
    expect(reason(await verify(attestation, mk({ cipher: { ...d('counter') } })))).toBe('COMPOSITION_MISMATCH');
    const { clock: _omit, ...rest } = fx.c; void _omit; expect(reason(await verify(attestation, { ...fx, c: rest } as Fx))).toBe('COMPOSITION_MISMATCH');
  });
  it('una atestación de otra composición (auténtica y vigente) no sirve para ésta', async () => {
    const [a, b] = [fixture(), fixture('ISOLATED_COPY', { cipher: { instance: makeCipher('b'), implementationId: 'cipher-otro', version: '2' } })];
    expect(reason(await verify((await issue(a)).attestation, b))).toBe('COMPOSITION_MISMATCH');
  });
});

describe('separación laboratorio / producción', () => {
  it('una atestación de laboratorio nunca verifica como de producción (ni con la misma clave) y viceversa', async () => {
    const fx = fixture(); const lab = (await issue(fx, 'LAB')).attestation; const prod = (await issue(fx, 'PRODUCTION')).attestation;
    expect(reason(await verify(lab, fx, { expectedTarget: 'PRODUCTION' }))).toBe('WRONG_TARGET'); expect(reason(await verify(prod, fx, { expectedTarget: 'LAB' }))).toBe('WRONG_TARGET');
    expect(reason(await verify({ ...lab, payload: lab.payload.replace('"target":"LAB"', '"target":"PRODUCTION"') }, fx, { expectedTarget: 'PRODUCTION' }))).toBe('BAD_SIGNATURE');
    expect((await issue(fx, 'LAB')).claims.compositionId).not.toBe((await issue(fx, 'PRODUCTION')).claims.compositionId);
  });
  it('en PRODUCTION no se ejecutan contador ni replay cuando la autoridad los declara LIVE; la atestación es incompleta', async () => {
    const fx = fixture('LIVE'); const { attestation, claims } = await issue(fx, 'PRODUCTION');
    expect(fx.counter.calls).toBe(0); expect(fx.replay.calls).toBe(0); expect(claims.skipped).toEqual(['counter', 'replay']); expect(claims.evaluated).not.toContain('counter');
    expect(claims.complete).toBe(false); expect(reason(await verify(attestation, fx, { expectedTarget: 'PRODUCTION' }))).toBe('NOT_CONFORMANT');
  });
  it('en PRODUCTION con sujeto ISOLATED_COPY (afirmado por la autoridad, no comprobado por este módulo) sí se ejecutan y es completa', async () => {
    const fx = fixture('ISOLATED_COPY'); const { attestation, claims } = await issue(fx, 'PRODUCTION');
    expect(fx.counter.calls).toBeGreaterThan(0); expect(fx.replay.calls).toBeGreaterThan(0); expect(claims.complete && claims.conformant).toBe(true);
    expect(claims.ports.filter(p => p.subject === 'ISOLATED_COPY').map(p => p.port)).toEqual(['counter', 'replay']); expect((await verify(attestation, fx, { expectedTarget: 'PRODUCTION' })).ok).toBe(true);
  });
  it('en LAB todos los puertos se ejecutan, también los inscritos como LIVE del laboratorio', async () => {
    const fx = fixture('LIVE'); const { claims } = await issue(fx, 'LAB'); expect(fx.counter.calls).toBeGreaterThan(0); expect(claims.complete).toBe(true);
  });
  it('el contenido de un destino no puede reinterpretarse como del otro (derivación de clave por destino)', async () => {
    const fx = fixture(); const lab = (await issue(fx, 'LAB')).attestation;
    expect(reason(await verify({ payload: lab.payload.replace('"LAB"', '"PRODUCTION"'), signature: lab.signature }, fx, { expectedTarget: 'PRODUCTION' }))).toBe('BAD_SIGNATURE');
  });
});

describe('sin efecto sobre readiness ni sobre el runtime', () => {
  it('existir una atestación válida no cambia el diagnóstico: ready=false y ningún puerto OK', async () => {
    await issue(fixture(), 'PRODUCTION');
    for (const handlerInstalled of [false, true]) {
      const r = buildReadinessDiagnostic({ PRICESMART_RUNTIME_MODE: 'ENABLED' }, { handlerInstalled, labActive: false });
      expect(r.ready).toBe(false); expect(r.checks.some(x => x.id.startsWith('PORT:') && x.status === 'OK')).toBe(false); expect(r.blockers).toContain('PRODUCTION_COMPOSITION_NOT_IMPLEMENTED');
    }
  });
  const here = (f: string) => readFileSync(sourcePath(f), 'utf8').replace(/\/\/.*$/gm, '');
  it('el módulo no instala handlers, no lee el entorno y no usa red, archivos, base de datos ni TMS', () => {
    const s = here('conformance-attestation.ts');
    expect(s).not.toMatch(/process\.env|\bfetch\s*\(|from\s+['"](?:mysql2|@\/lib\/(?:db|tms)|node:(?:net|tls|http|https|fs|child_process))|sandbox-db/);
    expect(s).not.toContain(['install', 'PriceSmartHandler'].join('')); expect(s).not.toMatch(/from '\.\/runtime/); expect(s).not.toMatch(/readiness-diagnostic/);
  });
  it('ni el diagnóstico ni el runtime importan la atestación, y ningún código de la app (fuera del módulo y sus pruebas) la usa', () => {
    for (const f of ['readiness-diagnostic.ts', 'runtime.ts', 'runtime-state.ts', ['runtime', 'assembly.ts'].join('-'), 'runtime-config.ts']) expect(here(f)).not.toContain('conformance-attestation');
    const root = path.resolve(__dirname, '../../..'); const hits: string[] = []; const needle = ['conformance', 'attestation'].join('-');
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !n.startsWith(needle) && !n.startsWith('port-conformance') && !n.includes('.test.') && !API18_FAMILY.some(x => n.startsWith(x)) && readFileSync(f, 'utf8').includes(needle)) hits.push(path.relative(root, f)); } };
    walk(root); expect(hits).toEqual([]);
  }, 30000);
});
