import { ALL_PORTS, type PortName } from './port-conformance';
import { redeemAttestation, verifyAttestation, type Attestation, type AttestationFailure, type AttestationTarget, type CompositionDescriptor, type IdentityTrust, type NonceStore } from './conformance-attestation';
import type { createM2MSecurity } from './m2m-security';
import type { TrustedClock } from './security-contracts';

// PRICESMART API-18 — compuerta de ELEGIBILIDAD de instalación. Decide, sin instalar nada, si una composición administrativa podría pasar a instalarse: composición COMPLETA (los seis puertos),
// identidades verificadas hoy por una autoridad confiable, atestación vigente, conforme y completa, y recursos de laboratorio separados de los de producción. NO instala handlers, NO enciende
// endpoints, NO toca readiness ni runtime (siguen 503 DISABLED / ready=false): «elegible» es una condición necesaria, nunca una autorización. No define ni ratifica D02/D06/D08/D09/D12.
export type InstallRejection = AttestationFailure | 'INCOMPLETE_COMPOSITION' | 'AUTHORITY_NOT_SEPARATED' | 'CLOCK_UNAVAILABLE' | 'INVALID_INPUT';
export type InstallDecision = { eligible: true; target: AttestationTarget; consumedNonce: boolean } | { eligible: false; reason: InstallRejection; missing?: PortName[] };
export type { createM2MSecurity };

export type InstallationInput = {
  composition: CompositionDescriptor; attestation: Attestation; target: AttestationTarget; key: Uint8Array; identity: IdentityTrust; clock: TrustedClock;
  /** Ids de autoridades de LABORATORIO conocidas: ninguna puede figurar como confiable para PRODUCTION (ni aunque la atestación sea de laboratorio auténtica). */
  labAuthorityIds: readonly string[];
};
const complete = (c: CompositionDescriptor) => ALL_PORTS.filter(p => { const d = c?.[p]; return !d || typeof d.instance !== 'object' || d.instance === null; });

async function precheck(i: InstallationInput): Promise<InstallDecision | null> {
  if (!i || (i.target !== 'LAB' && i.target !== 'PRODUCTION') || typeof i.clock?.nowMs !== 'function' || !i.composition || !i.identity?.trusted || !Array.isArray(i.labAuthorityIds)) return { eligible: false, reason: 'INVALID_INPUT' };
  const missing = complete(i.composition); if (missing.length) return { eligible: false, reason: 'INCOMPLETE_COMPOSITION', missing };
  if (i.target === 'PRODUCTION' && Object.keys(i.identity.trusted).some(id => i.labAuthorityIds.includes(id))) return { eligible: false, reason: 'AUTHORITY_NOT_SEPARATED' };
  return null;
}
function nowOf(i: InstallationInput): number | null { try { const t = i.clock.nowMs(); return Number.isSafeInteger(t) && t > 0 ? t : null; } catch { return null; } }

/** Revisión sin efectos (no consume el nonce): sirve para diagnóstico previo. */
export async function checkInstallationEligibility(input: InstallationInput): Promise<InstallDecision> {
  const early = await precheck(input); if (early) return early;
  const nowMs = nowOf(input); if (nowMs === null) return { eligible: false, reason: 'CLOCK_UNAVAILABLE' };
  const v = await verifyAttestation(input.attestation, { key: input.key, expectedTarget: input.target, composition: input.composition, nowMs, identity: input.identity, requireConformant: true });
  return v.ok ? { eligible: true, target: input.target, consumedNonce: false } : { eligible: false, reason: v.reason };
}
/** Decisión final: igual que la revisión pero CONSUME el nonce de forma durable (canje estricto). Aun siendo elegible, no instala nada. */
export async function redeemInstallationEligibility(input: InstallationInput & { nonces: NonceStore }): Promise<InstallDecision> {
  const early = await precheck(input); if (early) return early;
  const nowMs = nowOf(input); if (nowMs === null) return { eligible: false, reason: 'CLOCK_UNAVAILABLE' };
  const v = await redeemAttestation(input.attestation, { key: input.key, expectedTarget: input.target, composition: input.composition, nowMs, identity: input.identity, nonces: input.nonces });
  return v.ok ? { eligible: true, target: input.target, consumedNonce: true } : { eligible: false, reason: v.reason };
}
