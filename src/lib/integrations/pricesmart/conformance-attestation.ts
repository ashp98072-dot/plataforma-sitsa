import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ALL_PORTS, runPortConformance, type ConformancePorts, type PortName } from './port-conformance';

// PRICESMART API-17 — ATESTACIÓN de conformidad. Convierte el resultado de `runPortConformance` (API-16) en una afirmación firmada, acotada en el tiempo y vinculada a la composición realmente evaluada.
// Es una herramienta: nada en la aplicación la invoca, no lee el entorno, no abre conexiones, no instala handlers y NO modifica el estado de readiness (API-15): una atestación válida es un
// insumo que una composición administrativa futura podrá exigir; por sí sola no declara ningún puerto OK ni `ready=true`. No define ni ratifica D02/D06/D08/D09/D12.
//
// Garantías: (1) vínculo a identidad+versión+huella de código de cada puerto evaluado y a la composición completa; (2) vigencia corta y un nonce de un solo uso (`redeem`); (3) el destino
// (LAB / PRODUCTION) va firmado y la clave se deriva por destino: una atestación de laboratorio nunca verifica como de producción; (4) en destino PRODUCTION los puertos que ESCRIBEN o
// CONSUMEN estado (contador, replay) no se ejecutan sobre una instancia viva: solo sobre una copia aislada declarada como tal.
export type AttestationTarget = 'LAB' | 'PRODUCTION';
export const MAX_ATTESTATION_TTL_MS = 15 * 60_000;
export const CLOCK_SKEW_MS = 5_000;
/** Puertos cuya conformidad se prueba escribiendo/consumiendo estado: jamás se ejecutan sobre una instancia viva de producción. */
export const MUTATING_PORTS: readonly PortName[] = ['counter', 'replay'];

export type PortDescriptor = {
  /** Instancia real que se evaluará. */
  instance: object;
  /** Identidad de la implementación (p. ej. «mariadb-counter») y su versión: declaradas por la composición y firmadas junto con la huella de código. */
  implementationId: string; version: string;
  /** `LIVE` = recurso real; `ISOLATED_COPY` = instancia aislada creada solo para la prueba (sin datos ni cuentas compartidas con el recurso real). */
  subject: 'LIVE' | 'ISOLATED_COPY';
};
export type CompositionDescriptor = Partial<Record<PortName, PortDescriptor>>;

const idText = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const claimsSchema = z.object({
  v: z.literal(1), target: z.enum(['LAB', 'PRODUCTION']), compositionId: z.string().regex(/^[a-f0-9]{64}$/),
  ports: z.array(z.object({ port: z.enum(ALL_PORTS as [PortName, ...PortName[]]), implementationId: idText, version: idText, subject: z.enum(['LIVE', 'ISOLATED_COPY']), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(6),
  evaluated: z.array(z.enum(ALL_PORTS as [PortName, ...PortName[]])).max(6), skipped: z.array(z.enum(ALL_PORTS as [PortName, ...PortName[]])).max(6),
  conformant: z.boolean(), complete: z.boolean(),
  results: z.array(z.object({ port: z.enum(ALL_PORTS as [PortName, ...PortName[]]), id: z.string().max(64), pass: z.boolean() }).strict()).max(64),
  issuedAtMs: z.number().int().positive(), expiresAtMs: z.number().int().positive(), nonce: z.string().regex(/^[a-f0-9]{32}$/),
}).strict();
export type AttestationClaims = z.infer<typeof claimsSchema>;
export type Attestation = { payload: string; signature: string };
export type AttestationFailure = 'MALFORMED' | 'BAD_SIGNATURE' | 'WRONG_TARGET' | 'EXPIRED' | 'NOT_YET_VALID' | 'TTL_TOO_LONG' | 'COMPOSITION_MISMATCH' | 'NOT_CONFORMANT' | 'REPLAYED' | 'UNAVAILABLE';
export type Verification = { ok: true; claims: AttestationClaims } | { ok: false; reason: AttestationFailure };
export interface NonceStore { consume(nonce: string, expiresAtMs: number): Promise<'FRESH' | 'USED'> }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Clave derivada por destino y por propósito: la misma clave maestra no puede firmar para ambos destinos. */
const deriveKey = (master: Uint8Array, target: AttestationTarget) => {
  if (!(master instanceof Uint8Array) || master.length < 32) throw new Error('UNAVAILABLE');
  return createHmac('sha256', master).update(`pricesmart-api17-attestation-v1:${target}`).digest();
};
const sign = (key: Buffer, payload: string) => createHmac('sha256', key).update(payload).digest('hex');

/** Huella del código realmente cargado de un puerto: nombre y fuente de cada método (propios y de la cadena de prototipos, salvo Object). Cambiar la implementación cambia la huella. */
export function portFingerprint(instance: object, implementationId: string, version: string): string {
  const seen = new Map<string, string>(); let o: object | null = instance;
  while (o && o !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(o)) {
      if (name === 'constructor' || seen.has(name)) continue;
      const d = Object.getOwnPropertyDescriptor(o, name); const fn = d?.value ?? d?.get;
      seen.set(name, typeof fn === 'function' ? Function.prototype.toString.call(fn) : `[${typeof d?.value}]`);
    }
    o = Object.getPrototypeOf(o);
  }
  return sha(JSON.stringify([implementationId, version, [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : 1))]));
}
function describe(composition: CompositionDescriptor) {
  return ALL_PORTS.filter(p => composition[p]).map(port => {
    const d = composition[port] as PortDescriptor;
    return { port, implementationId: d.implementationId, version: d.version, subject: d.subject, fingerprint: portFingerprint(d.instance, d.implementationId, d.version) };
  });
}
const compositionIdOf = (target: AttestationTarget, ports: ReturnType<typeof describe>) => sha(JSON.stringify([target, ports]));

/** Emite una atestación. En PRODUCTION, los puertos mutantes con `subject: 'LIVE'` NO se ejecutan (quedan en `skipped`) y la atestación resulta incompleta. */
export async function issueAttestation(input: { composition: CompositionDescriptor; target: AttestationTarget; key: Uint8Array; nowMs: number; ttlMs: number }): Promise<{ attestation: Attestation; claims: AttestationClaims }> {
  const { composition, target, nowMs, ttlMs } = input;
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 || !Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > MAX_ATTESTATION_TTL_MS) throw new Error('UNAVAILABLE');
  const key = deriveKey(input.key, target);
  for (const p of ALL_PORTS) { const d = composition[p]; if (d && (typeof d.instance !== 'object' || d.instance === null || !idText.safeParse(d.implementationId).success || !idText.safeParse(d.version).success)) throw new Error('UNAVAILABLE'); }
  const described = describe(composition);
  const skipped: PortName[] = []; const runnable: ConformancePorts = {};
  for (const d of described) {
    if (target === 'PRODUCTION' && MUTATING_PORTS.includes(d.port) && d.subject !== 'ISOLATED_COPY') { skipped.push(d.port); continue; }   // regla de seguridad: no escribir/consumir sobre un recurso vivo
    (runnable as Record<string, unknown>)[d.port] = (composition[d.port] as PortDescriptor).instance;
  }
  const evaluated = ALL_PORTS.filter(p => runnable[p]);
  const report = await runPortConformance(runnable, { required: evaluated });
  const claims: AttestationClaims = claimsSchema.parse({
    v: 1, target, compositionId: compositionIdOf(target, described), ports: described, evaluated, skipped,
    conformant: evaluated.length > 0 && report.conformant, complete: skipped.length === 0 && evaluated.length === ALL_PORTS.length,
    results: report.results, issuedAtMs: nowMs, expiresAtMs: nowMs + ttlMs, nonce: randomBytes(16).toString('hex'),
  });
  const payload = JSON.stringify(claims);
  return { attestation: { payload, signature: sign(key, payload) }, claims };
}

/** Verifica autenticidad, destino, vigencia y que la composición presentada sea EXACTAMENTE la evaluada. No consume el nonce y no cambia ningún estado. */
export function verifyAttestation(attestation: Attestation, input: { key: Uint8Array; expectedTarget: AttestationTarget; composition: CompositionDescriptor; nowMs: number; requireConformant?: boolean }): Verification {
  try {
    if (typeof attestation?.payload !== 'string' || typeof attestation?.signature !== 'string' || attestation.payload.length > 16384 || !/^[a-f0-9]{64}$/.test(attestation.signature)) return { ok: false, reason: 'MALFORMED' };
    // 1) Firma sobre los bytes exactos, con la clave del destino ESPERADO (una atestación del otro destino no verifica).
    const expected = Buffer.from(sign(deriveKey(input.key, input.expectedTarget), attestation.payload), 'hex'); const got = Buffer.from(attestation.signature, 'hex');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      const other: AttestationTarget = input.expectedTarget === 'LAB' ? 'PRODUCTION' : 'LAB';
      const otherSig = Buffer.from(sign(deriveKey(input.key, other), attestation.payload), 'hex');
      return { ok: false, reason: got.length === otherSig.length && timingSafeEqual(got, otherSig) ? 'WRONG_TARGET' : 'BAD_SIGNATURE' };
    }
    let parsed: AttestationClaims;
    try { parsed = claimsSchema.parse(JSON.parse(attestation.payload)); } catch { return { ok: false, reason: 'MALFORMED' }; }
    if (parsed.target !== input.expectedTarget) return { ok: false, reason: 'WRONG_TARGET' };
    if (parsed.expiresAtMs - parsed.issuedAtMs > MAX_ATTESTATION_TTL_MS || parsed.expiresAtMs <= parsed.issuedAtMs) return { ok: false, reason: 'TTL_TOO_LONG' };
    if (input.nowMs + CLOCK_SKEW_MS < parsed.issuedAtMs) return { ok: false, reason: 'NOT_YET_VALID' };
    if (input.nowMs >= parsed.expiresAtMs) return { ok: false, reason: 'EXPIRED' };
    const described = describe(input.composition);
    if (compositionIdOf(parsed.target, described) !== parsed.compositionId || JSON.stringify(described) !== JSON.stringify(parsed.ports)) return { ok: false, reason: 'COMPOSITION_MISMATCH' };
    if (input.requireConformant !== false && !(parsed.conformant && parsed.complete)) return { ok: false, reason: 'NOT_CONFORMANT' };
    return { ok: true, claims: parsed };
  } catch { return { ok: false, reason: 'UNAVAILABLE' }; }
}

/** Verifica y consume el nonce (un solo uso). Usar ante una decisión de instalación, no en lecturas de diagnóstico. */
export async function redeemAttestation(attestation: Attestation, input: Parameters<typeof verifyAttestation>[1] & { nonces: NonceStore }): Promise<Verification> {
  const v = verifyAttestation(attestation, input); if (!v.ok) return v;
  try { return (await input.nonces.consume(v.claims.nonce, v.claims.expiresAtMs)) === 'FRESH' ? v : { ok: false, reason: 'REPLAYED' }; } catch { return { ok: false, reason: 'UNAVAILABLE' }; }
}
/** Almacén de nonces en memoria del proceso: sirve para pruebas y laboratorio. Una composición productiva necesita uno durable y compartido (decisión pendiente). */
export function createMemoryNonceStore(): NonceStore {
  const used = new Map<string, number>();
  return { async consume(nonce, expiresAtMs) { const now = Date.now(); for (const [n, e] of used) if (e <= now) used.delete(n); if (used.has(nonce)) return 'USED'; used.set(nonce, expiresAtMs); return 'FRESH'; } };
}
