import { randomBytes } from 'node:crypto';
import type { PayloadCipher } from './mariadb-repository';
import { DEFAULT_ENVIRONMENT, isEnvironment, type Environment } from './environment';
import type { AtomicCounterPort, AtomicReplayPort, EvidenceVerifier, IntegrationCatalog, TrustedClock } from './security-contracts';

// PRICESMART API-16 — suite de CONFORMIDAD de puertos. Verifica COMPORTAMIENTO observable de las implementaciones que una composición productiva deberá aportar, sin definir ni suponer ninguna
// decisión de PriceSmart (no hay mecanismo de autenticación, contrato de orden, endpoints ni certificados aquí). Es una herramienta: nada en la aplicación la invoca, no lee el entorno, no abre
// conexiones por sí misma (solo usa los puertos que se le entregan) y su informe contiene únicamente identificadores de comprobación y booleanos: nunca valores, claves ni mensajes de error.
// Se ejecuta con datos sintéticos y claves/identidades aleatorias por ejecución. Una implementación que declare assurance SIMULATED, o que falle cualquier comprobación, NO es conforme.
export type PortName = 'cipher' | 'clock' | 'counter' | 'replay' | 'catalog' | 'verifier';
export type ConformanceResult = { port: PortName; id: string; pass: boolean };
export type ConformanceReport = { conformant: boolean; results: ConformanceResult[]; missing: PortName[] };
export type ConformancePorts = Partial<{ cipher: PayloadCipher; clock: TrustedClock; counter: AtomicCounterPort; replay: AtomicReplayPort; catalog: IntegrationCatalog; verifier: EvidenceVerifier }>;
export const ALL_PORTS: readonly PortName[] = ['cipher', 'clock', 'counter', 'replay', 'catalog', 'verifier'];

type Check = [id: string, run: () => Promise<boolean>];
const rid = () => randomBytes(8).toString('hex');
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };
/** Orden sintético mínimo con la forma de OrderInput (la validación real vive en el contrato; el cifrado solo debe preservar el valor). */
const syntheticOrder = () => ({ externalOrderId: `CONF-${rid()}`, marca: `valor-${rid()}` }) as never;

function cipherChecks(c: PayloadCipher): Check[] {
  return [
    ['round-trip', async () => { const o = syntheticOrder(); const s = await c.seal(o, 'ctx-a'); return Buffer.isBuffer(s.ciphertext) && s.ciphertext.length > 0 && typeof s.keyReference === 'string' && s.keyReference.length > 0
      && JSON.stringify(await c.open(s.ciphertext, s.keyReference, 'ctx-a')) === JSON.stringify(o); }],
    ['no-plaintext', async () => { const o = syntheticOrder() as unknown as { marca: string }; const s = await c.seal(o as never, 'ctx-a'); return !s.ciphertext.includes(Buffer.from(o.marca)); }],
    ['context-bound', async () => { const s = await c.seal(syntheticOrder(), 'ctx-a'); return rejects(() => c.open(s.ciphertext, s.keyReference, 'ctx-b')); }],
    ['tamper-detected', async () => { const s = await c.seal(syntheticOrder(), 'ctx-a'); const bad = Buffer.from(s.ciphertext); bad[bad.length - 1] ^= 0x01; const bad2 = Buffer.from(s.ciphertext); bad2[Math.floor(bad2.length / 2)] ^= 0x01;
      return (await rejects(() => c.open(bad, s.keyReference, 'ctx-a'))) && (await rejects(() => c.open(bad2, s.keyReference, 'ctx-a'))); }],
    ['randomized', async () => { const o = syntheticOrder(); const [a, b] = [await c.seal(o, 'ctx-a'), await c.seal(o, 'ctx-a')]; return !a.ciphertext.equals(b.ciphertext); }],
    ['unknown-key-rejected', async () => { const s = await c.seal(syntheticOrder(), 'ctx-a'); return rejects(() => c.open(s.ciphertext, `desconocida-${rid()}`, 'ctx-a')); }],
    ['truncated-rejected', async () => { const s = await c.seal(syntheticOrder(), 'ctx-a'); return (await rejects(() => c.open(Buffer.alloc(0), s.keyReference, 'ctx-a'))) && (await rejects(() => c.open(s.ciphertext.subarray(0, 8), s.keyReference, 'ctx-a'))); }],
  ];
}
function clockChecks(c: TrustedClock): Check[] {
  return [
    ['integer-plausible', async () => { const t = c.nowMs(); return Number.isSafeInteger(t) && t > 1_577_836_800_000; }],
    ['monotonic', async () => { let last = c.nowMs(); for (let i = 0; i < 50; i++) { const t = c.nowMs(); if (!Number.isSafeInteger(t) || t < last) return false; last = t; } return true; }],
  ];
}
function counterChecks(c: AtomicCounterPort): Check[] {
  const call = (identityKey: string, nowMs: number, limit = 2, windowMs = 60_000) => c.consume({ identityKey, limit, windowMs, nowMs });
  const base = Date.now();
  return [
    ['limit-enforced', async () => { const k = `conf-${rid()}`; const [a, b, d] = [await call(k, base), await call(k, base), await call(k, base)];
      return a.allowed && a.used === 1 && b.allowed && b.used === 2 && !d.allowed && a.resetAtMs > base; }],
    ['identities-independent', async () => { const [k1, k2] = [`conf-${rid()}`, `conf-${rid()}`]; await call(k1, base); await call(k1, base); await call(k1, base); return (await call(k2, base)).allowed; }],
    ['window-resets', async () => { const k = `conf-${rid()}`; await call(k, base); await call(k, base); const later = await call(k, base + 60_001); return later.allowed && later.used === 1; }],
    ['assurance-distributed-atomic', async () => (await call(`conf-${rid()}`, base)).assurance === 'DISTRIBUTED_ATOMIC'],
    ['concurrent-exact-limit', async () => { const k = `conf-${rid()}`; const rs = await Promise.all(Array.from({ length: 12 }, () => call(k, base, 3))); return rs.filter(r => r.allowed).length === 3; }],
  ];
}
function replayChecks(r: AtomicReplayPort): Check[] {
  const now = Date.now();
  const claim = (identityKey: string, proofId: string, bindingDigest: string) => r.claim({ identityKey, proofId, bindingDigest, retainUntilMs: now + 600_000, nowMs: now });
  const digest = () => randomBytes(32).toString('hex');
  return [
    ['claim-then-reuse', async () => { const [k, p, d] = [`conf-${rid()}`, rid(), digest()]; return (await claim(k, p, d)).status === 'CLAIMED' && (await claim(k, p, d)).status === 'REUSED'; }],
    ['collision-detected', async () => { const [k, p] = [`conf-${rid()}`, rid()]; await claim(k, p, digest()); return (await claim(k, p, digest())).status === 'COLLISION'; }],
    ['identity-scoped', async () => { const [p, d] = [rid(), digest()]; await claim(`conf-${rid()}`, p, d); return (await claim(`conf-${rid()}`, p, d)).status === 'CLAIMED'; }],
    ['assurance-durable-atomic', async () => (await claim(`conf-${rid()}`, rid(), digest())).assurance === 'DURABLE_ATOMIC'],
    ['concurrent-single-claim', async () => { const [k, p, d] = [`conf-${rid()}`, rid(), digest()]; const rs = await Promise.all(Array.from({ length: 12 }, () => claim(k, p, d)));
      return rs.filter(x => x.status === 'CLAIMED').length === 1 && rs.every(x => x.status === 'CLAIMED' || x.status === 'REUSED'); }],
  ];
}
function catalogChecks(c: IntegrationCatalog): Check[] {
  return [['unknown-credential-empty', async () => { const found = await c.findByCredential({ issuer: `conf-${rid()}`, subject: `conf-${rid()}`, credentialReference: `conf-${rid()}` }); return Array.isArray(found) && found.length === 0; }]];
}
function verifierChecks(v: EvidenceVerifier, environment: Environment): Check[] {
  const denies = async (bytes: Uint8Array) => { try { return (await v.verify(bytes, { environment })) == null; } catch { return true; } };   // rechazar (null o excepción) es denegar
  return [
    ['empty-denied', () => denies(new Uint8Array(0))],
    ['random-denied', () => denies(randomBytes(64))],
    ['oversized-denied', () => denies(randomBytes(65536))],
  ];
}

/** Ejecuta las comprobaciones de los puertos entregados. Un puerto ausente figura en `missing` y hace no conforme al conjunto cuando se lo pide en `required`. */
export async function runPortConformance(ports: ConformancePorts, options: { required?: readonly PortName[]; /** API-22: entorno con el que se prueba el verificador (por omisión `sandbox`). */ environment?: Environment } = {}): Promise<ConformanceReport> {
  const environment = options.environment === undefined ? DEFAULT_ENVIRONMENT : options.environment;
  if (!isEnvironment(environment)) throw new Error('UNAVAILABLE');
  const plan: [PortName, Check[]][] = [];
  if (ports.cipher) plan.push(['cipher', cipherChecks(ports.cipher)]);
  if (ports.clock) plan.push(['clock', clockChecks(ports.clock)]);
  if (ports.counter) plan.push(['counter', counterChecks(ports.counter)]);
  if (ports.replay) plan.push(['replay', replayChecks(ports.replay)]);
  if (ports.catalog) plan.push(['catalog', catalogChecks(ports.catalog)]);
  if (ports.verifier) plan.push(['verifier', verifierChecks(ports.verifier, environment)]);
  const results: ConformanceResult[] = [];
  for (const [port, checks] of plan) for (const [id, run] of checks) {
    let pass = false;
    try { pass = (await run()) === true; } catch { pass = false; }   // cualquier excepción inesperada = no conforme; el mensaje nunca se registra
    results.push({ port, id, pass });
  }
  const required = options.required ?? ALL_PORTS;
  const missing = required.filter(p => !ports[p]);
  return { conformant: missing.length === 0 && results.length > 0 && results.every(r => r.pass), results, missing: [...missing] };
}
