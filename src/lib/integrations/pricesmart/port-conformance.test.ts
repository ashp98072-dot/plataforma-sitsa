import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PayloadCipher } from './mariadb-repository';
import type { AtomicCounterPort, AtomicReplayPort, EvidenceVerifier, IntegrationCatalog, TrustedClock } from './security-contracts';
import { labCipher } from './lab-demo/lab-crypto';
import { ALL_PORTS, runPortConformance, type ConformancePorts } from './port-conformance';

// Implementaciones de REFERENCIA en memoria, solo para probar la suite (un único proceso JS hace atómicas las secciones síncronas). No son candidatas a producción.
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function refCipher(): PayloadCipher {
  const key = randomBytes(32);
  return {
    async seal(input, context) { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(context)); const body = Buffer.concat([c.update(JSON.stringify(input), 'utf8'), c.final()]); return { ciphertext: Buffer.concat([iv, c.getAuthTag(), body]), keyReference: 'ref-key-1' }; },
    async open(buf, keyReference, context) { if (keyReference !== 'ref-key-1') throw new Error('x'); const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12)); d.setAAD(Buffer.from(context)); d.setAuthTag(buf.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')); },
  };
}
const refClock = (): TrustedClock => { let last = 0; return { nowMs: () => (last = Math.max(last, Date.now())) }; };
function refCounter(over: { gap?: boolean; assurance?: 'DISTRIBUTED_ATOMIC' | 'SIMULATED'; shareIdentity?: boolean } = {}): AtomicCounterPort {
  const m = new Map<string, { used: number; resetAtMs: number }>();
  return { async consume({ identityKey, limit, windowMs, nowMs }) {
    const key = over.shareIdentity ? 'unica' : identityKey;
    let w = m.get(key); if (over.gap) await tick();   // lee ANTES de la espera y escribe después: no atómico
    if (!w || nowMs >= w.resetAtMs) w = { used: 0, resetAtMs: nowMs + windowMs };
    const allowed = w.used < limit; if (allowed) w = { ...w, used: w.used + 1 }; m.set(key, w);
    return { allowed, used: w.used, resetAtMs: w.resetAtMs, assurance: over.assurance ?? 'DISTRIBUTED_ATOMIC' };
  } };
}
function refReplay(over: { gap?: boolean; noCollision?: boolean; assurance?: 'DURABLE_ATOMIC' | 'SIMULATED'; global?: boolean } = {}): AtomicReplayPort {
  const m = new Map<string, string>();
  return { async claim({ identityKey, proofId, bindingDigest }) {
    const k = `${over.global ? '' : identityKey}|${proofId}`; const seen = m.get(k); if (over.gap) await tick();
    const assurance = over.assurance ?? 'DURABLE_ATOMIC';
    if (seen === undefined) { m.set(k, bindingDigest); return { status: 'CLAIMED', assurance }; }
    return { status: seen === bindingDigest || over.noCollision ? 'REUSED' : 'COLLISION', assurance };
  } };
}
const refCatalog = (): IntegrationCatalog => ({ findByCredential: async () => [] });
const refVerifier = (): EvidenceVerifier => ({ verify: async () => null });
const reference = (): ConformancePorts => ({ cipher: refCipher(), clock: refClock(), counter: refCounter(), replay: refReplay(), catalog: refCatalog(), verifier: refVerifier() });
const failed = (r: Awaited<ReturnType<typeof runPortConformance>>) => r.results.filter(x => !x.pass).map(x => `${x.port}:${x.id}`);

describe('runPortConformance — implementaciones conformes', () => {
  it('la referencia en memoria pasa todas las comprobaciones de los seis puertos', async () => {
    const r = await runPortConformance(reference());
    expect(failed(r)).toEqual([]); expect(r.conformant).toBe(true); expect(r.missing).toEqual([]);
    expect([...new Set(r.results.map(x => x.port))].sort()).toEqual([...ALL_PORTS].sort());
  });
  it('el cifrado de laboratorio existente (API-12) es conforme como cifrado', async () => {
    const r = await runPortConformance({ cipher: labCipher(randomBytes(32).toString('hex')) }, { required: ['cipher'] });
    expect(failed(r)).toEqual([]); expect(r.conformant).toBe(true);
  });
});

describe('runPortConformance — mutantes: cada defecto debe ser detectado', () => {
  it('puertos ausentes: no conforme y se listan', async () => {
    const r = await runPortConformance({ cipher: refCipher() }); expect(r.conformant).toBe(false); expect(r.missing).toEqual(['clock', 'counter', 'replay', 'catalog', 'verifier']);
    const none = await runPortConformance({}, { required: [] }); expect(none.conformant).toBe(false);   // sin comprobaciones no hay evidencia
  });
  it('cifrado que ignora el contexto, que no autentica o que no aleatoriza', async () => {
    const base = refCipher();
    const noContext: PayloadCipher = { seal: (i) => base.seal(i, 'fijo'), open: (b, k) => base.open(b, k, 'fijo') };
    expect(failed(await runPortConformance({ cipher: noContext }, { required: ['cipher'] }))).toContain('cipher:context-bound');
    const plain: PayloadCipher = { async seal(i) { return { ciphertext: Buffer.from(JSON.stringify(i)), keyReference: 'k' }; }, async open(b) { return JSON.parse(b.toString()); } };
    const f = failed(await runPortConformance({ cipher: plain }, { required: ['cipher'] })); expect(f).toEqual(expect.arrayContaining(['cipher:no-plaintext', 'cipher:context-bound', 'cipher:tamper-detected', 'cipher:randomized']));
    const anyKey: PayloadCipher = { seal: base.seal, open: (b, _k, c) => base.open(b, 'ref-key-1', c) };
    expect(failed(await runPortConformance({ cipher: anyKey }, { required: ['cipher'] }))).toContain('cipher:unknown-key-rejected');
  });
  it('reloj que retrocede, no entero o implausible', async () => {
    let n = 1_800_000_000_000; const back: TrustedClock = { nowMs: () => (n -= 1) };
    expect(failed(await runPortConformance({ clock: back }, { required: ['clock'] }))).toContain('clock:monotonic');
    expect(failed(await runPortConformance({ clock: { nowMs: () => 1.5 } }, { required: ['clock'] }))).toContain('clock:integer-plausible');
    expect(failed(await runPortConformance({ clock: { nowMs: () => 5 } }, { required: ['clock'] }))).toContain('clock:integer-plausible');
  });
  it('contador no atómico, con identidades compartidas o con assurance SIMULATED', async () => {
    expect(failed(await runPortConformance({ counter: refCounter({ gap: true }) }, { required: ['counter'] }))).toContain('counter:concurrent-exact-limit');
    expect(failed(await runPortConformance({ counter: refCounter({ shareIdentity: true }) }, { required: ['counter'] }))).toContain('counter:identities-independent');
    const sim = await runPortConformance({ counter: refCounter({ assurance: 'SIMULATED' }) }, { required: ['counter'] }); expect(failed(sim)).toContain('counter:assurance-distributed-atomic'); expect(sim.conformant).toBe(false);
  });
  it('replay que no detecta colisión, no aísla identidades, no es atómico o es SIMULATED', async () => {
    expect(failed(await runPortConformance({ replay: refReplay({ noCollision: true }) }, { required: ['replay'] }))).toContain('replay:collision-detected');
    expect(failed(await runPortConformance({ replay: refReplay({ global: true }) }, { required: ['replay'] }))).toContain('replay:identity-scoped');
    expect(failed(await runPortConformance({ replay: refReplay({ gap: true }) }, { required: ['replay'] }))).toContain('replay:concurrent-single-claim');
    expect((await runPortConformance({ replay: refReplay({ assurance: 'SIMULATED' }) }, { required: ['replay'] })).conformant).toBe(false);
  });
  it('catálogo que devuelve coincidencias para credenciales desconocidas; verificador que acepta basura', async () => {
    expect(failed(await runPortConformance({ catalog: { findByCredential: async () => [{}] } }, { required: ['catalog'] }))).toContain('catalog:unknown-credential-empty');
    expect(failed(await runPortConformance({ catalog: { findByCredential: async () => { throw new Error('x'); } } }, { required: ['catalog'] }))).toContain('catalog:unknown-credential-empty');
    const accepts: EvidenceVerifier = { verify: async () => ({ ok: true }) };
    expect(failed(await runPortConformance({ verifier: accepts }, { required: ['verifier'] }))).toEqual(['verifier:empty-denied', 'verifier:random-denied', 'verifier:oversized-denied']);
    expect((await runPortConformance({ verifier: { verify: async () => { throw new Error('rechazo'); } } }, { required: ['verifier'] })).conformant).toBe(true);   // lanzar equivale a denegar
  });
});

describe('seguridad de la suite', () => {
  it('un puerto que lanza errores con secretos no los filtra al informe', async () => {
    const leaky: TrustedClock = { nowMs: () => { throw new Error('secreto-token-777'); } };
    const r = await runPortConformance({ clock: leaky }, { required: ['clock'] }); expect(r.conformant).toBe(false); expect(JSON.stringify(r)).not.toContain('secreto');
  });
  it('el informe solo contiene identificadores y booleanos', async () => {
    const r = await runPortConformance(reference());
    for (const x of r.results) expect(Object.keys(x).sort()).toEqual(['id', 'pass', 'port']);
    expect(Object.keys(r).sort()).toEqual(['conformant', 'missing', 'results']);
  });
  const src = readFileSync(path.join(__dirname, 'port-conformance.ts'), 'utf8').replace(/\/\/.*$/gm, '');
  it('el módulo no lee el entorno, no usa red, archivos, base de datos ni TMS', () => {
    expect(src).not.toMatch(/process\.env|\bfetch\s*\(|from\s+['"](?:mysql2|@\/lib\/(?:db|tms)|node:(?:net|tls|http|https|fs|child_process))|sandbox-db/);
    expect(src).not.toMatch(/runtime|installPriceSmartHandler/);
  });
  it('ningún código de la aplicación (fuera de este módulo, de su única consumidora —la atestación de API-17, que tampoco se invoca— y sus pruebas) lo invoca: producción sigue cerrada', () => {
    const root = path.resolve(__dirname, '../../..'); const hits: string[] = [];
    const needle = ['port', 'conformance'].join('-');
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !n.startsWith(needle) && n !== 'conformance-attestation.ts' && !n.startsWith('conformance-attestation.') && !['attestation-mariadb', 'installation-gate', 'mariadb-composition', 'registry-identity-authority'].some(x => n.startsWith(x)) && readFileSync(f, 'utf8').includes(needle)) hits.push(path.relative(root, f)); } };
    walk(root); expect(hits).toEqual([]);
  });
});
