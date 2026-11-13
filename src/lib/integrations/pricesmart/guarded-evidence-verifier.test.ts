import { describe, expect, it } from 'vitest';
import type { EvidenceVerifier } from './security-contracts';
import { denyAllEvidenceVerifier, guardEvidenceVerifier } from './guarded-evidence-verifier';
import { runPortConformance } from './port-conformance';

const assertion = (over: Record<string, unknown> = {}) => ({ environment: 'sandbox', issuer: 'issuer-x', subject: 'subject-x', credentialReference: 'cred-x', validFromMs: 1000, validUntilMs: 2000, scopes: ['orders:read'], requestProof: null, ...over });
const ev = (n = 16) => new Uint8Array(n).fill(7);
const inner = (fn: (e: Uint8Array) => unknown): EvidenceVerifier & { calls: number } => { const v = { calls: 0, async verify(e: Uint8Array) { v.calls++; return fn(e); } }; return v; };
const ctx = { environment: 'sandbox' as const };

describe('verificador que deniega todo (estado seguro hasta D02)', () => {
  it('deniega cualquier evidencia y supera las comprobaciones negativas de conformidad', async () => {
    for (const e of [new Uint8Array(0), ev(), ev(65536)]) expect(await denyAllEvidenceVerifier.verify(e, ctx)).toBeNull();
    const r = await runPortConformance({ verifier: denyAllEvidenceVerifier }, { required: ['verifier'] }); expect(r.conformant).toBe(true);
    expect(Object.isFrozen(denyAllEvidenceVerifier)).toBe(true);
  });
  it('sin verificador interior, la envoltura equivale a denegar todo', async () => {
    for (const none of [null, undefined, {} as never]) expect(guardEvidenceVerifier(none)).toBe(denyAllEvidenceVerifier);
  });
});

describe('envoltura de cierre por defecto', () => {
  it('entrega solo aserciones válidas, como copia congelada; el interior no puede alterar los bytes del llamador', async () => {
    const e = ev(); const i = inner((bytes) => { bytes.fill(0); return assertion(); }); const g = guardEvidenceVerifier(i);
    const out = (await g.verify(e, ctx)) as Record<string, unknown>; expect(out).toMatchObject({ issuer: 'issuer-x', scopes: ['orders:read'] });
    expect(Object.isFrozen(out)).toBe(true); expect([...e].every(b => b === 7)).toBe(true);
  });
  it('rechaza resultados que no cumplen el esquema estricto: campos extra, entorno distinto, alcances inválidos, tipos, null o basura', async () => {
    for (const bad of [assertion({ extra: 1 }), assertion({ environment: 'production' }), assertion({ scopes: ['orders:delete'] }), assertion({ scopes: [] }), assertion({ validUntilMs: 500 }), { ok: true }, 'texto', 7, true, [], undefined, null]) {
      expect(await guardEvidenceVerifier(inner(() => bad)).verify(ev(), ctx), JSON.stringify(bad)).toBeNull();
    }
  });
  it('valida la entrada antes de llamar al interior: vacía, demasiado grande, no bytes o entorno distinto no se reenvían', async () => {
    const i = inner(() => assertion()); const g = guardEvidenceVerifier(i, { maxEvidenceBytes: 64 });
    for (const bad of [new Uint8Array(0), ev(65), 'x' as never, null as never, [1, 2] as never]) expect(await g.verify(bad, ctx)).toBeNull();
    expect(await g.verify(ev(), { environment: 'production' } as never)).toBeNull(); expect(await g.verify(ev(), undefined as never)).toBeNull();
    expect(i.calls).toBe(0); expect(await g.verify(ev(64), ctx)).not.toBeNull(); expect(i.calls).toBe(1);
  });
  it('nunca lanza ni filtra: excepciones del interior y verificadores colgados se convierten en «denegado»', async () => {
    const t0 = Date.now();
    expect(await guardEvidenceVerifier(inner(() => { throw new Error('secreto-ancla-123'); })).verify(ev(), ctx)).toBeNull();
    expect(await guardEvidenceVerifier({ verify: () => Promise.reject(new Error('secreto-2')) }).verify(ev(), ctx)).toBeNull();
    expect(await guardEvidenceVerifier({ verify: () => new Promise(() => {}) }, { timeoutMs: 100 }).verify(ev(), ctx)).toBeNull(); expect(Date.now() - t0).toBeLessThan(3000);
  });
  it('es compatible con las comprobaciones de conformidad: un verificador que aceptaría basura queda denegado por la envoltura', async () => {
    const reckless: EvidenceVerifier = { verify: async () => ({ ok: true }) };
    expect((await runPortConformance({ verifier: reckless }, { required: ['verifier'] })).conformant).toBe(false);
    expect((await runPortConformance({ verifier: guardEvidenceVerifier(reckless) }, { required: ['verifier'] })).conformant).toBe(true);
  });
  it('configuración inválida: límites fuera de rango', () => {
    for (const o of [{ maxEvidenceBytes: 0 }, { maxEvidenceBytes: 70000 }, { maxEvidenceBytes: 1.5 }, { timeoutMs: 10 }, { timeoutMs: 100000 }]) expect(() => guardEvidenceVerifier(inner(() => null), o)).toThrow();
  });
  it('el resultado está desacoplado del interior: mutar la aserción original después no afecta a la entregada', async () => {
    const original = assertion(); const out = (await guardEvidenceVerifier(inner(() => original)).verify(ev(), ctx)) as { subject: string };
    original.subject = 'otro'; expect(out.subject).toBe('subject-x');
  });
});
