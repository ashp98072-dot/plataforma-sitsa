import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ALL_PORTS, runPortConformance, type ConformancePorts, type PortName } from './port-conformance';

// PRICESMART API-17 — ATESTACIÓN de conformidad. Convierte el resultado de `runPortConformance` (API-16) en una afirmación firmada, acotada en el tiempo y vinculada a la composición realmente evaluada.
// Es una herramienta: nada en la aplicación la invoca, no lee el entorno, no abre conexiones, no instala handlers y NO modifica el estado de readiness (API-15): una atestación válida es un
// insumo que una composición administrativa futura podrá exigir; por sí sola no declara ningún puerto OK ni `ready=true`. No define ni ratifica D02/D06/D08/D09/D12.
//
// Garantías: (1) vínculo a la identidad de cada puerto evaluado en DOS planos distintos y nunca confundidos: el CÓDIGO (huella de los métodos; dos instancias con el mismo código tienen la misma huella)
// y el RECURSO/INSTANCIA (identidad aportada por una AUTORIDAD de identidad confiable, independiente de la composición, que firma por puerto y por desafío fresco el `resourceId`, el sujeto y la huella
// de código de ESE objeto; la composición no puede inventarla ni elegirla); (2) vigencia corta y un nonce de un solo uso (`redeem`); (3) el destino (LAB / PRODUCTION) va firmado y la clave se deriva
// por destino; (4) en PRODUCTION los puertos que ESCRIBEN o CONSUMEN estado (contador, replay) no se ejecutan sobre una instancia viva: solo si la AUTORIDAD declara el sujeto `ISOLATED_COPY`.
// Límite explícito: este módulo NO comprueba por sí mismo que una copia esté aislada ni que un `resourceId` corresponda al recurso físico; confía en la autoridad y registra su afirmación firmada.
// Las claims nunca contienen claves, contraseñas ni cadenas de conexión: el `resourceId` es un identificador opaco y no secreto (p. ej. etiqueta o resumen público), validado por formato.
export type AttestationTarget = 'LAB' | 'PRODUCTION';
export const MAX_ATTESTATION_TTL_MS = 15 * 60_000;
export const CLOCK_SKEW_MS = 5_000;
/** Puertos cuya conformidad se prueba escribiendo/consumiendo estado: jamás se ejecutan sobre una instancia viva de producción. */
export const MUTATING_PORTS: readonly PortName[] = ['counter', 'replay'];

export type PortDescriptor = {
  /** Instancia real que se evaluará. */
  instance: object;
  /** Nombre y versión de la implementación (p. ej. «mariadb-counter»): los declara la composición; se firman junto con la huella de código, pero NO prueban la identidad del recurso. */
  implementationId: string; version: string;
};
export type ResourceSubject = 'LIVE' | 'ISOLATED_COPY';
/** Afirmación de la autoridad sobre UN objeto concreto. `subject` lo fija la autoridad al inscribir el recurso (no la composición). */
export type IdentityStatement = { authorityId: string; resourceId: string; subject: ResourceSubject; proof: string };
export interface ResourceIdentityAuthority {
  /** Devuelve la identidad del objeto recibido, firmada y ligada al desafío, al destino, al puerto y a la huella de código; `null` si la autoridad no conoce ese objeto. */
  identify(input: { port: PortName; instance: object; target: AttestationTarget; challenge: string; codeFingerprint: string }): Promise<IdentityStatement | null>;
}
/** Material de verificación de las autoridades confiables (por `authorityId`), aportado por quien emite/verifica, NO por la composición evaluada. */
export type TrustedAuthorities = Readonly<Record<string, Uint8Array>>;
export type IdentityTrust = { authority: ResourceIdentityAuthority; trusted: TrustedAuthorities };
export type CompositionDescriptor = Partial<Record<PortName, PortDescriptor>>;

const idText = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const portEnum = z.enum(ALL_PORTS as [PortName, ...PortName[]]);
const claimsSchema = z.object({
  v: z.literal(1), target: z.enum(['LAB', 'PRODUCTION']), compositionId: z.string().regex(/^[a-f0-9]{64}$/),
  ports: z.array(z.object({ port: portEnum, implementationId: idText, version: idText, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), authorityId: idText, resourceId: idText, subject: z.enum(['LIVE', 'ISOLATED_COPY']) }).strict()).max(6),
  evaluated: z.array(portEnum).max(6), skipped: z.array(portEnum).max(6),
  conformant: z.boolean(), complete: z.boolean(),
  results: z.array(z.object({ port: portEnum, id: z.string().max(64), pass: z.boolean() }).strict()).max(64),
  issuedAtMs: z.number().int().positive(), expiresAtMs: z.number().int().positive(), nonce: z.string().regex(/^[a-f0-9]{32}$/),
}).strict();
export type AttestationClaims = z.infer<typeof claimsSchema>;
export type Attestation = { payload: string; signature: string };
export type AttestationFailure = 'MALFORMED' | 'BAD_SIGNATURE' | 'WRONG_TARGET' | 'EXPIRED' | 'NOT_YET_VALID' | 'TTL_TOO_LONG' | 'COMPOSITION_MISMATCH' | 'IDENTITY_MISMATCH' | 'NOT_CONFORMANT' | 'REPLAYED' | 'UNAVAILABLE';
export type Verification = { ok: true; claims: AttestationClaims } | { ok: false; reason: AttestationFailure };
export interface NonceStore { consume(nonce: string, expiresAtMs: number): Promise<'FRESH' | 'USED'> }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Clave derivada por destino y por propósito: la misma clave maestra no puede firmar para ambos destinos. */
const deriveKey = (master: Uint8Array, target: AttestationTarget) => {
  if (!(master instanceof Uint8Array) || master.length < 32) throw new Error('UNAVAILABLE');
  return createHmac('sha256', master).update(`pricesmart-api17-attestation-v1:${target}`).digest();
};
const sign = (key: Buffer, payload: string) => createHmac('sha256', key).update(payload).digest('hex');

/** Huella del CÓDIGO realmente cargado de un puerto (nombre y fuente de cada método). NO identifica la instancia ni el recurso: dos instancias con el mismo código comparten huella. */
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

type ProofFields = { authorityId: string; port: PortName; target: AttestationTarget; resourceId: string; subject: ResourceSubject; challenge: string; codeFingerprint: string };
const proofOf = (key: Uint8Array, f: ProofFields) =>
  createHmac('sha256', key).update(JSON.stringify(['pricesmart-api17-resource-v1', f.authorityId, f.port, f.target, f.resourceId, f.subject, f.challenge, f.codeFingerprint])).digest('hex');
/** Comprueba la afirmación de la autoridad con SU material de verificación (nunca con lo que traiga la composición). */
function checkStatement(st: IdentityStatement | null, f: { port: PortName; target: AttestationTarget; challenge: string; codeFingerprint: string }, trusted: TrustedAuthorities): st is IdentityStatement {
  if (!st || !idText.safeParse(st.authorityId).success || !idText.safeParse(st.resourceId).success || (st.subject !== 'LIVE' && st.subject !== 'ISOLATED_COPY') || !/^[a-f0-9]{64}$/.test(st.proof ?? '')) return false;
  const key = Object.prototype.hasOwnProperty.call(trusted, st.authorityId) ? trusted[st.authorityId] : undefined;
  if (!(key instanceof Uint8Array) || key.length < 32) return false;
  const expected = Buffer.from(proofOf(key, { ...f, authorityId: st.authorityId, resourceId: st.resourceId, subject: st.subject }), 'hex'); const got = Buffer.from(st.proof, 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}
async function describe(composition: CompositionDescriptor, target: AttestationTarget, identity: IdentityTrust) {
  const out = [];
  for (const port of ALL_PORTS.filter(p => composition[p])) {
    const d = composition[port] as PortDescriptor; const fingerprint = portFingerprint(d.instance, d.implementationId, d.version);
    const challenge = randomBytes(16).toString('hex');   // desafío fresco por puerto y por operación: una afirmación vieja no se puede reutilizar
    let st: IdentityStatement | null = null;
    try { st = await identity.authority.identify({ port, instance: d.instance, target, challenge, codeFingerprint: fingerprint }); } catch { st = null; }
    const ok = checkStatement(st, { port, target, challenge, codeFingerprint: fingerprint }, identity.trusted);
    out.push({ port, implementationId: d.implementationId, version: d.version, fingerprint, identified: ok && st ? { authorityId: st.authorityId, resourceId: st.resourceId, subject: st.subject } : null });
  }
  return out;
}
type Described = Awaited<ReturnType<typeof describe>>;
const staticPart = (d: Described) => d.map(({ port, implementationId, version, fingerprint }) => ({ port, implementationId, version, fingerprint }));
const idPart = (d: Described) => d.map(x => [x.port, x.identified?.authorityId ?? null, x.identified?.resourceId ?? null, x.identified?.subject ?? null]);
const compositionIdOf = (target: AttestationTarget, d: Described) => sha(JSON.stringify([target, staticPart(d), idPart(d)]));

/** Emite una atestación. Todo puerto debe estar identificado por la autoridad (si no, no se emite). En PRODUCTION, los puertos mutantes cuyo sujeto (fijado por la autoridad) no sea `ISOLATED_COPY` NO se ejecutan. */
export async function issueAttestation(input: { composition: CompositionDescriptor; target: AttestationTarget; key: Uint8Array; nowMs: number; ttlMs: number; identity: IdentityTrust }): Promise<{ attestation: Attestation; claims: AttestationClaims }> {
  const { composition, target, nowMs, ttlMs } = input;
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 || !Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > MAX_ATTESTATION_TTL_MS) throw new Error('UNAVAILABLE');
  const key = deriveKey(input.key, target);
  for (const p of ALL_PORTS) { const d = composition[p]; if (d && (typeof d.instance !== 'object' || d.instance === null || !idText.safeParse(d.implementationId).success || !idText.safeParse(d.version).success)) throw new Error('UNAVAILABLE'); }
  const described = await describe(composition, target, input.identity);
  if (described.length === 0 || described.some(d => d.identified === null)) throw new Error('UNAVAILABLE');   // un recurso sin identidad de la autoridad no se atesta
  const skipped: PortName[] = []; const runnable: ConformancePorts = {};
  for (const d of described) {
    if (target === 'PRODUCTION' && MUTATING_PORTS.includes(d.port) && d.identified?.subject !== 'ISOLATED_COPY') { skipped.push(d.port); continue; }   // no escribir/consumir sobre un recurso vivo
    (runnable as Record<string, unknown>)[d.port] = (composition[d.port] as PortDescriptor).instance;
  }
  const evaluated = ALL_PORTS.filter(p => runnable[p]);
  const report = await runPortConformance(runnable, { required: evaluated });
  const claims: AttestationClaims = claimsSchema.parse({
    v: 1, target, compositionId: compositionIdOf(target, described),
    ports: described.map(d => ({ port: d.port, implementationId: d.implementationId, version: d.version, fingerprint: d.fingerprint, ...(d.identified as NonNullable<typeof d.identified>) })),
    evaluated, skipped, conformant: evaluated.length > 0 && report.conformant, complete: skipped.length === 0 && evaluated.length === ALL_PORTS.length,
    results: report.results, issuedAtMs: nowMs, expiresAtMs: nowMs + ttlMs, nonce: randomBytes(16).toString('hex'),
  });
  const payload = JSON.stringify(claims);
  return { attestation: { payload, signature: sign(key, payload) }, claims };
}

type VerifyInput = { key: Uint8Array; expectedTarget: AttestationTarget; composition: CompositionDescriptor; nowMs: number; identity: IdentityTrust };
/** Verifica autenticidad, destino, vigencia, que el CÓDIGO presentado sea el evaluado y que la autoridad reconozca hoy, con un desafío nuevo, cada objeto presentado con la misma identidad de recurso y sujeto.
 *  No consume el nonce y no cambia ningún estado. `requireConformant` (por omisión true) solo existe aquí, para inspección; el canje nunca lo admite. */
export async function verifyAttestation(attestation: Attestation, input: VerifyInput & { requireConformant?: boolean }): Promise<Verification> {
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
    const described = await describe(input.composition, parsed.target, input.identity);
    const claimedStatic = parsed.ports.map(({ port, implementationId, version, fingerprint }) => ({ port, implementationId, version, fingerprint }));
    if (JSON.stringify(staticPart(described)) !== JSON.stringify(claimedStatic)) return { ok: false, reason: 'COMPOSITION_MISMATCH' };
    const claimedIds = parsed.ports.map(p => [p.port, p.authorityId, p.resourceId, p.subject]);
    if (described.some(d => d.identified === null) || JSON.stringify(idPart(described)) !== JSON.stringify(claimedIds) || compositionIdOf(parsed.target, described) !== parsed.compositionId) return { ok: false, reason: 'IDENTITY_MISMATCH' };
    if (input.requireConformant !== false && !(parsed.conformant && parsed.complete)) return { ok: false, reason: 'NOT_CONFORMANT' };
    return { ok: true, claims: parsed };
  } catch { return { ok: false, reason: 'UNAVAILABLE' }; }
}

/** Verifica y consume el nonce (un solo uso). CANJE ESTRICTO: siempre exige atestación auténtica, vigente, con la identidad vigente, COMPLETA y CONFORME; no hay forma de relajarlo (cualquier `requireConformant` recibido se ignora). */
export async function redeemAttestation(attestation: Attestation, input: VerifyInput & { nonces: NonceStore }): Promise<Verification> {
  const { nonces } = input;
  const v = await verifyAttestation(attestation, { key: input.key, expectedTarget: input.expectedTarget, composition: input.composition, nowMs: input.nowMs, identity: input.identity, requireConformant: true });
  if (!v.ok) return v;
  if (!(v.claims.conformant && v.claims.complete)) return { ok: false, reason: 'NOT_CONFORMANT' };   // defensa en profundidad
  try { return (await nonces.consume(v.claims.nonce, v.claims.expiresAtMs)) === 'FRESH' ? v : { ok: false, reason: 'REPLAYED' }; } catch { return { ok: false, reason: 'UNAVAILABLE' }; }
}

/** Almacén de nonces en memoria del proceso: sirve para pruebas y laboratorio. Una composición productiva necesita uno durable y compartido (decisión pendiente). */
export function createMemoryNonceStore(): NonceStore {
  const used = new Map<string, number>();
  return { async consume(nonce, expiresAtMs) { const now = Date.now(); for (const [n, e] of used) if (e <= now) used.delete(n); if (used.has(nonce)) return 'USED'; used.set(nonce, expiresAtMs); return 'FRESH'; } };
}
/** Autoridad de identidad de REFERENCIA para pruebas y laboratorio: inscribe objetos concretos (por referencia) con un `resourceId` y un sujeto, y firma con su propia clave. En producción la autoridad
 *  debe ser un componente confiable externo a la composición evaluada (la inscripción la hace el arranque confiable, no el código que se evalúa). */
export function createInProcessIdentityAuthority(config: { authorityId: string; key: Uint8Array }): ResourceIdentityAuthority & { enroll(instance: object, port: PortName, info: { resourceId: string; subject: ResourceSubject }): void } {
  if (!idText.safeParse(config.authorityId).success || !(config.key instanceof Uint8Array) || config.key.length < 32) throw new Error('UNAVAILABLE');
  const enrolled = new WeakMap<object, Map<PortName, { resourceId: string; subject: ResourceSubject }>>(); const key = Uint8Array.from(config.key);
  return {
    enroll(instance, port, info) {
      if (!idText.safeParse(info.resourceId).success || (info.subject !== 'LIVE' && info.subject !== 'ISOLATED_COPY')) throw new Error('UNAVAILABLE');
      const m = enrolled.get(instance) ?? new Map(); m.set(port, { resourceId: info.resourceId, subject: info.subject }); enrolled.set(instance, m);
    },
    async identify({ port, instance, target, challenge, codeFingerprint }) {
      const e = enrolled.get(instance)?.get(port); if (!e) return null;   // objeto desconocido para la autoridad (aunque tenga el mismo código)
      return { authorityId: config.authorityId, resourceId: e.resourceId, subject: e.subject, proof: proofOf(key, { authorityId: config.authorityId, port, target, resourceId: e.resourceId, subject: e.subject, challenge, codeFingerprint }) };
    },
  };
}
