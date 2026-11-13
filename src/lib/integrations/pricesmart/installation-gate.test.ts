import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PayloadCipher } from './mariadb-repository';
import type { AtomicCounterPort, AtomicReplayPort, EvidenceVerifier, IntegrationCatalog, TrustedClock } from './security-contracts';
import { createInProcessIdentityAuthority, createMemoryNonceStore, issueAttestation, type CompositionDescriptor, type NonceStore, type ResourceSubject } from './conformance-attestation';
import { assertDisjointTrust, createRegistryIdentityAuthority, type ResourceRegistry } from './registry-identity-authority';
import { checkInstallationEligibility, redeemInstallationEligibility, type InstallationInput } from './installation-gate';
import { describeMariaDbComposition } from './mariadb-composition';
import { buildReadinessDiagnostic } from './readiness-diagnostic';
import { isPriceSmartHandlerInstalled } from './runtime-state';
import type { PortName } from './port-conformance';

// ---- puertos de referencia en memoria (solo pruebas)
const KEY = randomBytes(32); const AUTH_KEY = randomBytes(32); const NOW = 1_800_000_000_000;
function cipher(): PayloadCipher {
  const key = randomBytes(32);
  return {
    async seal(input, context) { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(context)); const body = Buffer.concat([c.update(JSON.stringify(input), 'utf8'), c.final()]); return { ciphertext: Buffer.concat([iv, c.getAuthTag(), body]), keyReference: 'k' }; },
    async open(buf, ref, context) { if (ref !== 'k') throw new Error('x'); const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12)); d.setAAD(Buffer.from(context)); d.setAuthTag(buf.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')); },
  };
}
class Counter implements AtomicCounterPort {
  private m = new Map<string, { used: number; resetAtMs: number }>();
  async consume({ identityKey, limit, windowMs, nowMs }: Parameters<AtomicCounterPort['consume']>[0]) {
    let w = this.m.get(identityKey); if (!w || nowMs >= w.resetAtMs) w = { used: 0, resetAtMs: nowMs + windowMs };
    const allowed = w.used < limit; if (allowed) w = { ...w, used: w.used + 1 }; this.m.set(identityKey, w);
    return { allowed, used: w.used, resetAtMs: w.resetAtMs, assurance: 'DISTRIBUTED_ATOMIC' as const };
  }
}
class Replay implements AtomicReplayPort {
  private m = new Map<string, string>();
  async claim({ identityKey, proofId, bindingDigest }: Parameters<AtomicReplayPort['claim']>[0]) {
    const k = `${identityKey}|${proofId}`; const seen = this.m.get(k);
    if (seen === undefined) { this.m.set(k, bindingDigest); return { status: 'CLAIMED' as const, assurance: 'DURABLE_ATOMIC' as const }; }
    return { status: seen === bindingDigest ? ('REUSED' as const) : ('COLLISION' as const), assurance: 'DURABLE_ATOMIC' as const };
  }
}
const clock = (): TrustedClock => { let last = 0; return { nowMs: () => (last = Math.max(last, Date.now())) }; };
const catalog = (): IntegrationCatalog => ({ findByCredential: async () => [] });
const verifier = (): EvidenceVerifier => ({ verify: async () => null });
const MUT: PortName[] = ['counter', 'replay'];

/** Registro en memoria que imita el registro administrativo: lo escribe el «administrador» (la prueba), el runtime solo lo lee. */
function registryFor(rows: Record<string, { subject: ResourceSubject; status: 'ACTIVE' | 'RETIRED' }>): ResourceRegistry & { lookups: number } {
  const r = { lookups: 0, async lookup({ target, port, resourceId }: { target: string; port: string; resourceId: string }) { r.lookups++; return rows[`${target}|${port}|${resourceId}`] ?? null; } };
  return r as never;
}
function registered(target: 'LAB' | 'PRODUCTION', subject: ResourceSubject = 'ISOLATED_COPY') {
  const rows: Record<string, { subject: ResourceSubject; status: 'ACTIVE' | 'RETIRED' }> = {};
  for (const p of ['cipher', 'clock', 'counter', 'replay', 'catalog', 'verifier']) rows[`${target}|${p}|${p}-res`] = { subject: MUT.includes(p as PortName) ? subject : 'LIVE', status: 'ACTIVE' };
  return rows;
}
function setup(target: 'LAB' | 'PRODUCTION' = 'LAB', over: { subject?: ResourceSubject; omit?: PortName[]; authorityId?: string } = {}) {
  const instances: Record<PortName, object> = { cipher: cipher(), clock: clock(), counter: new Counter(), replay: new Replay(), catalog: catalog(), verifier: verifier() };
  const registry = registryFor(registered(target, over.subject));
  const authorityId = over.authorityId ?? (target === 'LAB' ? 'auth-lab' : 'auth-prod');
  const authority = createRegistryIdentityAuthority({ authorityId, target, registry, keys: { getKey: async () => AUTH_KEY } });
  const composition: CompositionDescriptor = {};
  for (const [port, instance] of Object.entries(instances) as [PortName, object][]) {
    if (over.omit?.includes(port)) continue;
    composition[port] = { instance, implementationId: `${port}-ref`, version: '1.0.0' }; authority.enroll(instance, port, `${port}-res`);
  }
  const identity = { authority, trusted: { [authorityId]: AUTH_KEY } };
  const other = { [target === 'LAB' ? 'auth-prod-x' : 'auth-lab-x']: randomBytes(32) };
  const trust = target === 'LAB' ? { lab: { [authorityId]: AUTH_KEY }, production: other } : { lab: other, production: { [authorityId]: AUTH_KEY } };
  return { composition, authority, identity, registry, instances, authorityId, trust };
}
const clockAt = (t: number | (() => number)): TrustedClock => ({ nowMs: typeof t === 'function' ? t : () => t });
async function attested(s: ReturnType<typeof setup>, target: 'LAB' | 'PRODUCTION', ttlMs = 60_000, at = NOW) {
  return (await issueAttestation({ composition: s.composition, target, key: KEY, nowMs: at, ttlMs, identity: s.identity })).attestation;
}
const input = (s: ReturnType<typeof setup>, attestation: Awaited<ReturnType<typeof attested>>, target: 'LAB' | 'PRODUCTION', over: Partial<InstallationInput> = {}): InstallationInput => ({
  composition: s.composition, attestation, target, key: KEY, authority: s.authority, trust: s.trust, clock: clockAt(NOW + 1000), ...over });

describe('autoridad respaldada por registro (no es la de laboratorio)', () => {
  it('el sujeto y la existencia salen del registro: la composición no puede elegirlos; un recurso no registrado o retirado no se atesta', async () => {
    const s = setup('PRODUCTION', { subject: 'LIVE' }); const a = await issueAttestation({ composition: s.composition, target: 'PRODUCTION', key: KEY, nowMs: NOW, ttlMs: 60_000, identity: s.identity });
    expect(a.claims.skipped).toEqual(['counter', 'replay']);   // el registro dice LIVE → no se ejecutan en producción
    const retired = setup('PRODUCTION'); (retired.registry as unknown as { lookup: unknown }).lookup = async () => ({ subject: 'LIVE', status: 'RETIRED' });
    await expect(issueAttestation({ composition: retired.composition, target: 'PRODUCTION', key: KEY, nowMs: NOW, ttlMs: 60_000, identity: retired.identity })).rejects.toThrow();
    const none = setup('PRODUCTION'); (none.registry as unknown as { lookup: unknown }).lookup = async () => null;
    await expect(issueAttestation({ composition: none.composition, target: 'PRODUCTION', key: KEY, nowMs: NOW, ttlMs: 60_000, identity: none.identity })).rejects.toThrow();
  });
  it('una autoridad de un destino no responde por el otro, y el enlace objeto→recurso es inmutable', async () => {
    const s = setup('LAB'); const counter = s.instances.counter;
    expect(await s.authority.identify({ port: 'counter', instance: counter, target: 'PRODUCTION', challenge: 'c', codeFingerprint: 'f' })).toBeNull();
    expect(() => s.authority.enroll(counter, 'counter', 'otro-recurso')).toThrow();
    const lookupsBefore = s.registry.lookups; await s.authority.identify({ port: 'counter', instance: counter, target: 'PRODUCTION', challenge: 'c', codeFingerprint: 'f' }); expect(s.registry.lookups).toBe(lookupsBefore);
  });
  it('un fallo del registro o de la clave (o una clave corta) = identidad no verificable, sin filtrar detalles', async () => {
    for (const make of [() => ({ lookup: async () => { throw new Error('secreto-registro-1'); } }), () => registryFor(registered('LAB'))]) {
      const keys = make().lookup.toString().includes('secreto') ? { getKey: async () => AUTH_KEY } : { getKey: async () => { throw new Error('secreto-kms-2'); } };
      const authority = createRegistryIdentityAuthority({ authorityId: 'auth-lab', target: 'LAB', registry: make() as never, keys }); const inst = {}; authority.enroll(inst, 'clock', 'clock-res');
      expect(await authority.identify({ port: 'clock', instance: inst, target: 'LAB', challenge: 'c'.repeat(32), codeFingerprint: 'f'.repeat(64) })).toBeNull();
    }
    const short = createRegistryIdentityAuthority({ authorityId: 'auth-lab', target: 'LAB', registry: registryFor(registered('LAB')), keys: { getKey: async () => randomBytes(8) } }); const inst = {}; short.enroll(inst, 'clock', 'clock-res');
    expect(await short.identify({ port: 'clock', instance: inst, target: 'LAB', challenge: 'c', codeFingerprint: 'f' })).toBeNull();
  });
  it('valida su configuración y exige confianza disjunta entre laboratorio y producción', () => {
    expect(() => createRegistryIdentityAuthority({ authorityId: 'con espacios', target: 'LAB', registry: registryFor({}), keys: { getKey: async () => AUTH_KEY } })).toThrow();
    expect(() => createRegistryIdentityAuthority({ authorityId: 'a', target: 'X' as never, registry: registryFor({}), keys: { getKey: async () => AUTH_KEY } })).toThrow();
    const [a, b] = [randomBytes(32), randomBytes(32)];
    expect(() => assertDisjointTrust({ lab: { l: a }, production: { p: b } })).not.toThrow();
    expect(() => assertDisjointTrust({ lab: { x: a }, production: { x: b } })).toThrow();   // mismo identificador
    expect(() => assertDisjointTrust({ lab: { l: a }, production: { p: a } })).toThrow();   // misma clave
    expect(() => assertDisjointTrust({ lab: {}, production: { p: b } })).toThrow();
  });
});

describe('compuerta de instalación: rechazos', () => {
  it('composición incompleta (faltan cifrado y verificador, como hoy): INCOMPLETE_COMPOSITION con la lista de faltantes', async () => {
    const s = setup('LAB', { omit: ['cipher', 'verifier'] });
    const d = await checkInstallationEligibility({ ...input(s, { payload: '', signature: '' }, 'LAB') });
    expect(d).toEqual({ eligible: false, reason: 'INCOMPLETE_COMPOSITION', missing: ['cipher', 'verifier'] });
  });
  it('composición real de MariaDB (descriptor) sin cifrado ni verificador: incompleta y rechazada', async () => {
    const m = describeMariaDbComposition({ counter: new Counter(), replay: new Replay(), catalog: catalog(), clock: clock() });
    expect(m.missing).toEqual(['cipher', 'verifier']); expect(Object.keys(m.composition).sort()).toEqual(['catalog', 'clock', 'counter', 'replay']);
    expect(m.composition.counter?.implementationId).toBe('mariadb-counter');
    const s = setup('LAB'); const d = await checkInstallationEligibility(input(s, await attested(s, 'LAB'), 'LAB', { composition: m.composition }));
    expect(d).toMatchObject({ eligible: false, reason: 'INCOMPLETE_COMPOSITION', missing: ['cipher', 'verifier'] });
    const whole = describeMariaDbComposition({ counter: new Counter(), replay: new Replay(), catalog: catalog(), clock: clock() }, { cipher: { instance: cipher(), implementationId: 'c', version: '1' }, verifier: { instance: verifier(), implementationId: 'v', version: '1' } });
    expect(whole.missing).toEqual([]);
  });
  it('identidad no verificada: un objeto sustituido (mismo código, otra instancia) o no enlazado se rechaza', async () => {
    const s = setup('LAB'); const att = await attested(s, 'LAB');
    const swapped = { ...s.composition, cipher: { instance: cipher(), implementationId: 'cipher-ref', version: '1.0.0' } };
    expect(await checkInstallationEligibility(input(s, att, 'LAB', { composition: swapped }))).toEqual({ eligible: false, reason: 'IDENTITY_MISMATCH' });
    s.authority.enroll(swapped.cipher.instance, 'cipher', 'cipher-res');   // enlazar al mismo recurso registrado sí lo hace legítimo
    expect((await checkInstallationEligibility(input(s, att, 'LAB', { composition: swapped }))).eligible).toBe(true);
  });
  it('atestación caducada o emitida en el futuro; reloj no disponible', async () => {
    const s = setup('LAB'); const att = await attested(s, 'LAB', 60_000);
    expect(await checkInstallationEligibility(input(s, att, 'LAB', { clock: clockAt(NOW + 60_000) }))).toEqual({ eligible: false, reason: 'EXPIRED' });
    expect(await checkInstallationEligibility(input(s, att, 'LAB', { clock: clockAt(NOW - 3_600_000) }))).toEqual({ eligible: false, reason: 'NOT_YET_VALID' });
    for (const bad of [() => { throw new Error('x'); }, () => 0, () => Number.NaN]) expect(await checkInstallationEligibility(input(s, att, 'LAB', { clock: clockAt(bad) }))).toEqual({ eligible: false, reason: 'CLOCK_UNAVAILABLE' });
  });
  it('atestación manipulada, de otro destino o no conforme se rechaza', async () => {
    const s = setup('LAB'); const att = await attested(s, 'LAB');
    expect(await checkInstallationEligibility(input(s, { ...att, signature: '0'.repeat(64) }, 'LAB'))).toEqual({ eligible: false, reason: 'BAD_SIGNATURE' });
    expect((await checkInstallationEligibility(input(s, att, 'PRODUCTION'))).eligible).toBe(false);
    const badCatalog = setup('LAB'); const bad = { findByCredential: async () => [{}] } as IntegrationCatalog; badCatalog.composition.catalog = { instance: bad, implementationId: 'cat-bad', version: '1' }; badCatalog.authority.enroll(bad, 'catalog', 'catalog-res');
    expect(await checkInstallationEligibility(input(badCatalog, await attested(badCatalog, 'LAB'), 'LAB'))).toEqual({ eligible: false, reason: 'NOT_CONFORMANT' });
  });
  it('en PRODUCTION, una autoridad que solo es confiable para LAB no se acepta aunque la atestación sea auténtica', async () => {
    const s = setup('PRODUCTION'); const att = await attested(s, 'PRODUCTION');
    const onlyLab = { lab: { ...s.trust.lab, [s.authorityId]: AUTH_KEY }, production: { 'auth-otra': randomBytes(32) } };   // la autoridad figura como confiable solo de laboratorio
    expect(await checkInstallationEligibility(input(s, att, 'PRODUCTION', { trust: onlyLab }))).toEqual({ eligible: false, reason: 'IDENTITY_MISMATCH' });
    expect((await checkInstallationEligibility(input(s, att, 'PRODUCTION'))).eligible).toBe(true);
  });
  it('atestación incompleta (recursos vivos) o entradas inválidas: nunca elegible', async () => {
    const live = setup('PRODUCTION', { subject: 'LIVE' }); const att = await attested(live, 'PRODUCTION');
    expect(await checkInstallationEligibility(input(live, att, 'PRODUCTION'))).toEqual({ eligible: false, reason: 'NOT_CONFORMANT' });
    for (const bad of [{ target: 'X' as never }, { clock: undefined as never }, { authority: undefined as never }]) expect(await checkInstallationEligibility({ ...input(live, att, 'PRODUCTION'), ...bad })).toEqual({ eligible: false, reason: 'INVALID_INPUT' });
    expect(await checkInstallationEligibility(null as never)).toEqual({ eligible: false, reason: 'INVALID_INPUT' });
  });
});

describe('compuerta de instalación: canje durable', () => {
  it('elegible: la revisión no consume el nonce; el canje lo consume una sola vez (la segunda vez, REPLAYED)', async () => {
    const s = setup('LAB'); const att = await attested(s, 'LAB', 60_000, Date.now()); const nonces = createMemoryNonceStore(); const now = Date.now() + 1000;
    const base = input(s, att, 'LAB', { clock: clockAt(now) });
    expect(await checkInstallationEligibility(base)).toEqual({ eligible: true, target: 'LAB', consumedNonce: false });
    expect(await checkInstallationEligibility(base)).toMatchObject({ eligible: true });
    expect(await redeemInstallationEligibility({ ...base, nonces })).toEqual({ eligible: true, target: 'LAB', consumedNonce: true });
    expect(await redeemInstallationEligibility({ ...base, nonces })).toEqual({ eligible: false, reason: 'REPLAYED' });
  });
  it('un rechazo previo (incompleta, identidad, caducada) no consume el nonce', async () => {
    const s = setup('LAB'); const att = await attested(s, 'LAB', 60_000, Date.now()); let consumed = 0; const spy: NonceStore = { consume: async () => { consumed++; return 'FRESH'; } };
    const base = input(s, att, 'LAB', { clock: clockAt(Date.now() + 1000) });
    await redeemInstallationEligibility({ ...base, nonces: spy, clock: clockAt(Date.now() + 3_600_000) });
    await redeemInstallationEligibility({ ...base, nonces: spy, composition: { ...s.composition, cipher: undefined } });
    await redeemInstallationEligibility({ ...base, nonces: spy, composition: { ...s.composition, cipher: { instance: cipher(), implementationId: 'cipher-ref', version: '1.0.0' } } });
    expect(consumed).toBe(0);
  });
  it('un almacén de nonces caído cierra (UNAVAILABLE) y no hay elegibilidad', async () => {
    const s = setup('LAB'); const att = await attested(s, 'LAB', 60_000, Date.now());
    expect(await redeemInstallationEligibility({ ...input(s, att, 'LAB', { clock: clockAt(Date.now() + 1000) }), nonces: { consume: async () => { throw new Error('secreto-db-3'); } } })).toEqual({ eligible: false, reason: 'UNAVAILABLE' });
  });
});

describe('sin efecto sobre readiness ni runtime', () => {
  it('ser elegible no instala nada ni cambia el diagnóstico: ready=false, ningún puerto OK, sin handler', async () => {
    const s = setup('PRODUCTION'); const att = await attested(s, 'PRODUCTION', 60_000, Date.now());
    const d = await redeemInstallationEligibility({ ...input(s, att, 'PRODUCTION', { clock: clockAt(Date.now() + 1000) }), nonces: createMemoryNonceStore() }); expect(d.eligible).toBe(true);
    expect(isPriceSmartHandlerInstalled()).toBe(false);
    const r = buildReadinessDiagnostic({ PRICESMART_RUNTIME_MODE: 'ENABLED' }, { handlerInstalled: false, labActive: false });
    expect(r.ready).toBe(false); expect(r.checks.some(c => c.id.startsWith('PORT:') && c.status === 'OK')).toBe(false); expect(r.blockers).toContain('PRODUCTION_COMPOSITION_NOT_IMPLEMENTED');
  });
  const strip = (f: string) => readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '');
  it('los módulos nuevos no instalan handlers, no leen el entorno y no los importan el runtime, el diagnóstico ni la aplicación', () => {
    const mods = ['installation-gate.ts', 'registry-identity-authority.ts', 'mariadb-composition.ts', 'attestation-mariadb.ts'];
    for (const f of mods) { const t = strip(f); expect(t, f).not.toMatch(/process\.env|\bfetch\s*\(/); expect(t, f).not.toContain(['install', 'PriceSmartHandler'].join('')); expect(t, f).not.toMatch(/from '\.\/runtime/); expect(t, f).not.toMatch(/readiness-diagnostic/); }
    const names = mods.map(f => f.replace(/\.ts$/, '')); const root = path.resolve(__dirname, '../../..'); const hits: string[] = [];
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !names.some(x => n.startsWith(x)) && !n.startsWith('conformance-attestation') && !n.startsWith('installation-gate') && !n.startsWith('production-preflight')) { const t = readFileSync(f, 'utf8'); if (names.some(x => t.includes(`/${x}'`) || t.includes(`/${x}"`) || t.includes(`./${x}`))) hits.push(path.relative(root, f)); } } };
    walk(root); expect(hits).toEqual([]);
  }, 30000);
  it('el gate usa solo la atestación estricta y no ofrece relajar la conformidad', () => {
    const t = strip('installation-gate.ts'); expect(t).toContain('requireConformant: true'); expect(t).not.toMatch(/requireConformant:\s*false/);
  });
  it('autoridades distintas: la de registro no reutiliza la de laboratorio', () => {
    const lab = createInProcessIdentityAuthority({ authorityId: 'auth-lab', key: AUTH_KEY }); const reg = createRegistryIdentityAuthority({ authorityId: 'auth-prod', target: 'PRODUCTION', registry: registryFor({}), keys: { getKey: async () => AUTH_KEY } });
    expect(Object.keys(reg).sort()).toEqual(['enroll', 'identify']); expect(reg.enroll.toString()).not.toBe(lab.enroll.toString());
  });
});

describe('separación real de confianza LAB / PRODUCTION (corrección bloqueante)', () => {
  const K = () => randomBytes(32); const strip = (f: string) => readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '');
  const valid = () => ({ lab: { 'auth-lab': AUTH_KEY, 'auth-lab-2': K() }, production: { 'auth-prod': K() } });
  const decide = async (target: 'LAB' | 'PRODUCTION', trust: unknown, over: Partial<InstallationInput> = {}) => {
    const s = setup(target); const att = await attested(s, target, 60_000, Date.now());
    const base = input(s, att, target, { clock: clockAt(Date.now() + 1000), trust: trust as never, ...over });
    return { check: await checkInstallationEligibility(base), redeem: await redeemInstallationEligibility({ ...base, nonces: createMemoryNonceStore() }) };
  };
  it('control: con confianza completa y separada la composición es elegible en ambos destinos', async () => {
    for (const target of ['LAB', 'PRODUCTION'] as const) { const s = setup(target); expect((await checkInstallationEligibility(input(s, await attested(s, target, 60_000, Date.now()), target, { clock: clockAt(Date.now() + 1000) }))).eligible).toBe(true); }
  });
  it('omitir la confianza (undefined, null, objeto vacío, tipos erróneos) nunca produce una decisión favorable', async () => {
    for (const target of ['LAB', 'PRODUCTION'] as const) for (const trust of [undefined, null, {}, [], 'x', 5, { lab: {} }, { production: {} }]) {
      const r = await decide(target, trust); for (const d of [r.check, r.redeem]) expect(d, `${target} ${JSON.stringify(trust)}`).toEqual({ eligible: false, reason: 'TRUST_CONFIG_INVALID' });
    }
  });
  it('listas vacías o sin la parte de LAB o la de PRODUCTION se rechazan en cualquier destino', async () => {
    const v = valid();
    for (const target of ['LAB', 'PRODUCTION'] as const) for (const trust of [{ lab: {}, production: v.production }, { lab: v.lab, production: {} }, { lab: {}, production: {} }, { lab: v.lab }, { production: v.production }, { lab: null, production: v.production }, { lab: v.lab, production: [] }])
      expect((await decide(target, trust)).check, `${target}`).toEqual({ eligible: false, reason: 'TRUST_CONFIG_INVALID' });
  });
  it('identificadores repetidos entre LAB y PRODUCTION se rechazan', async () => {
    const k1 = K(); const k2 = K();
    for (const target of ['LAB', 'PRODUCTION'] as const) expect((await decide(target, { lab: { 'auth-x': k1 }, production: { 'auth-x': k2 } })).check).toEqual({ eligible: false, reason: 'TRUST_CONFIG_INVALID' });
  });
  it('claves idénticas aunque los identificadores sean distintos se rechazan (entre destinos y dentro de un mismo destino)', async () => {
    const k = K();
    for (const target of ['LAB', 'PRODUCTION'] as const) {
      expect((await decide(target, { lab: { 'auth-a': k }, production: { 'auth-b': Uint8Array.from(k) } })).check).toEqual({ eligible: false, reason: 'TRUST_CONFIG_INVALID' });
      expect((await decide(target, { lab: { 'auth-a': k, 'auth-c': Uint8Array.from(k) }, production: { 'auth-b': K() } })).check).toEqual({ eligible: false, reason: 'TRUST_CONFIG_INVALID' });
    }
  });
  it('material inválido (clave corta, no bytes, identificador inválido o peligroso) se rechaza', async () => {
    const v = valid();
    for (const bad of [{ lab: { 'auth-lab': randomBytes(8) }, production: v.production }, { lab: { 'auth-lab': 'texto' }, production: v.production }, { lab: { 'con espacios': K() }, production: v.production }, { lab: v.lab, production: { '': K() } }, { lab: { '__proto__': K() }, production: v.production }])
      expect((await decide('PRODUCTION', bad)).check, JSON.stringify(Object.keys(bad.lab))).toEqual({ eligible: false, reason: 'TRUST_CONFIG_INVALID' });
  });
  it('la validación ocurre antes que cualquier otra y el rechazo no consume el nonce', async () => {
    const s = setup('PRODUCTION'); const att = await attested(s, 'PRODUCTION', 60_000, Date.now()); let consumed = 0; const spy: NonceStore = { consume: async () => { consumed++; return 'FRESH'; } };
    const incompleteAndBadTrust = { ...input(s, att, 'PRODUCTION', { clock: clockAt(Date.now() + 1000), trust: { lab: {}, production: {} } as never }), composition: {} };
    expect(await redeemInstallationEligibility({ ...incompleteAndBadTrust, nonces: spy })).toEqual({ eligible: false, reason: 'TRUST_CONFIG_INVALID' }); expect(consumed).toBe(0);
  });
  it('una confianza que cambia entre lecturas no engaña a la compuerta (se copia una sola vez)', async () => {
    const s = setup('PRODUCTION'); const att = await attested(s, 'PRODUCTION', 60_000, Date.now()); let reads = 0;
    const flaky = { get lab() { reads++; return reads === 1 ? { 'auth-lab-x': K() } : { [s.authorityId]: AUTH_KEY }; }, get production() { return { [s.authorityId]: AUTH_KEY }; } };
    const d = await checkInstallationEligibility(input(s, att, 'PRODUCTION', { clock: clockAt(Date.now() + 1000), trust: flaky as never }));
    expect(reads).toBe(1);   // una sola lectura de cada parte
    expect(d.eligible).toBe(true);   // la copia validada es la que se usa
  });
  it('el parámetro retirado (labAuthorityIds) ya no existe: el código no depende de listas de ids aportadas por el llamador', () => {
    expect(strip('installation-gate.ts')).not.toContain('labAuthorityIds'); expect(strip('installation-gate.ts')).toContain('assertDisjointTrust(');
  });
  it('assertDisjointTrust rechaza directamente cada intento de omisión o solapamiento', () => {
    const [a, b] = [K(), K()];
    expect(() => assertDisjointTrust({ lab: { l: a }, production: { p: b } })).not.toThrow();
    for (const bad of [null, undefined, {}, { lab: { l: a } }, { production: { p: b } }, { lab: {}, production: { p: b } }, { lab: { l: a }, production: {} }, { lab: { x: a }, production: { x: b } }, { lab: { l: a }, production: { p: a } }, { lab: { l: a, m: a }, production: { p: b } }, { lab: { l: new Uint8Array(4) }, production: { p: b } }, { lab: { 'a b': a }, production: { p: b } }])
      expect(() => assertDisjointTrust(bad as never), JSON.stringify(bad && Object.keys(bad))).toThrow();
  });
});
