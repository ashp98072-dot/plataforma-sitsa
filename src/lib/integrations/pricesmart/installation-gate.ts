import { ALL_PORTS, type PortName } from './port-conformance';
import { redeemAttestation, verifyAttestation, type Attestation, type AttestationFailure, type AttestationTarget, type CompositionDescriptor, type NonceStore, type ResourceIdentityAuthority, type TrustedAuthorities } from './conformance-attestation';
import { assertDisjointTrust } from './registry-identity-authority';
import type { TrustedClock } from './security-contracts';

// PRICESMART API-18 — compuerta de ELEGIBILIDAD de instalación. Decide, sin instalar nada, si una composición administrativa podría pasar a instalarse: composición COMPLETA (los seis puertos),
// identidades verificadas hoy por una autoridad confiable, atestación vigente, conforme y completa, y confianza de laboratorio SEPARADA de la de producción. NO instala handlers, NO enciende
// endpoints, NO toca readiness ni runtime (siguen 503 DISABLED / ready=false): «elegible» es una condición necesaria, nunca una autorización. No define ni ratifica D02/D06/D08/D09/D12.
//
// Confianza: el material de confianza de AMBOS destinos (`trust.lab` y `trust.production`: identificador → material de verificación) debe venir de la configuración administrativa confiable y se
// valida SIEMPRE, para cualquier destino, antes de cualquier decisión: las dos partes presentes y no vacías, identificadores válidos y distintos entre sí, material de verificación válido y NO
// idéntico entre destinos (`assertDisjointTrust`). Al verificar solo se confía en la parte del destino pedido; una autoridad del otro destino jamás se acepta. Omitir o vaciar parámetros nunca
// produce una decisión favorable. La confianza se copia una sola vez al empezar (una lectura inestable no puede cambiar entre la validación y el uso).
export type InstallRejection = AttestationFailure | 'INCOMPLETE_COMPOSITION' | 'TRUST_CONFIG_INVALID' | 'CLOCK_UNAVAILABLE' | 'INVALID_INPUT';
export type InstallDecision = { eligible: true; target: AttestationTarget; consumedNonce: boolean } | { eligible: false; reason: InstallRejection; missing?: PortName[] };
export type InstallationTrust = { lab: TrustedAuthorities; production: TrustedAuthorities };

export type InstallationInput = {
  composition: CompositionDescriptor; attestation: Attestation; target: AttestationTarget; key: Uint8Array; clock: TrustedClock;
  /** Autoridad de identidad (p. ej. la respaldada por el registro). */
  authority: ResourceIdentityAuthority;
  /** Material de confianza de ambos destinos, procedente de la configuración administrativa confiable. Es obligatorio y se valida siempre. */
  trust: InstallationTrust;
};
const missingPorts = (c: CompositionDescriptor) => ALL_PORTS.filter(p => { const d = c?.[p]; return !d || typeof d.instance !== 'object' || d.instance === null; });
/** Copia superficial de cada mapa: id → clave (copia de bytes). Lanza si no es un objeto simple. */
function snapshot(t: unknown): TrustedAuthorities {
  if (typeof t !== 'object' || t === null || Array.isArray(t)) throw new Error('UNAVAILABLE');
  const out: Record<string, Uint8Array> = Object.create(null);
  for (const id of Object.keys(t)) { const k = (t as Record<string, unknown>)[id]; if (!(k instanceof Uint8Array)) throw new Error('UNAVAILABLE'); out[id] = Uint8Array.from(k); }
  return out;
}
function trustFor(i: InstallationInput): { trusted: TrustedAuthorities } | null {
  try {
    if (typeof i.trust !== 'object' || i.trust === null) return null;
    const lab = snapshot((i.trust as InstallationTrust).lab); const production = snapshot((i.trust as InstallationTrust).production);
    assertDisjointTrust({ lab, production });   // lanza si falta una parte, está vacía, repite ids/claves o los datos son inválidos
    return { trusted: i.target === 'LAB' ? lab : production };
  } catch { return null; }
}
function nowOf(i: InstallationInput): number | null { try { const t = i.clock.nowMs(); return Number.isSafeInteger(t) && t > 0 ? t : null; } catch { return null; } }

type Ready = { decision: InstallDecision } | { trusted: TrustedAuthorities; nowMs: number };
function prepare(i: InstallationInput): Ready {
  if (!i || (i.target !== 'LAB' && i.target !== 'PRODUCTION') || typeof i.clock?.nowMs !== 'function' || typeof i.authority?.identify !== 'function' || !i.composition) return { decision: { eligible: false, reason: 'INVALID_INPUT' } };
  const t = trustFor(i); if (!t) return { decision: { eligible: false, reason: 'TRUST_CONFIG_INVALID' } };
  const missing = missingPorts(i.composition); if (missing.length) return { decision: { eligible: false, reason: 'INCOMPLETE_COMPOSITION', missing } };
  const nowMs = nowOf(i); if (nowMs === null) return { decision: { eligible: false, reason: 'CLOCK_UNAVAILABLE' } };
  return { trusted: t.trusted, nowMs };
}

/** Revisión sin efectos (no consume el nonce): sirve para diagnóstico previo. */
export async function checkInstallationEligibility(input: InstallationInput): Promise<InstallDecision> {
  const r = prepare(input); if ('decision' in r) return r.decision;
  const v = await verifyAttestation(input.attestation, { key: input.key, expectedTarget: input.target, composition: input.composition, nowMs: r.nowMs, identity: { authority: input.authority, trusted: r.trusted }, requireConformant: true });
  return v.ok ? { eligible: true, target: input.target, consumedNonce: false } : { eligible: false, reason: v.reason };
}
/** Decisión final: igual que la revisión pero CONSUME el nonce de forma durable (canje estricto). Aun siendo elegible, no instala nada. */
export async function redeemInstallationEligibility(input: InstallationInput & { nonces: NonceStore }): Promise<InstallDecision> {
  const r = prepare(input); if ('decision' in r) return r.decision;
  const v = await redeemAttestation(input.attestation, { key: input.key, expectedTarget: input.target, composition: input.composition, nowMs: r.nowMs, identity: { authority: input.authority, trusted: r.trusted }, nonces: input.nonces });
  return v.ok ? { eligible: true, target: input.target, consumedNonce: true } : { eligible: false, reason: v.reason };
}
