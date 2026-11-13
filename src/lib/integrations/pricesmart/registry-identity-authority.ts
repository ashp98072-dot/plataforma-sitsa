import { signIdentityProof, type AttestationTarget, type ResourceIdentityAuthority, type ResourceSubject } from './conformance-attestation';
import type { PortName } from './port-conformance';

// PRICESMART API-18 — autoridad de identidad de recursos RESPALDADA POR UN REGISTRO ADMINISTRATIVO. No es la autoridad de laboratorio (`createInProcessIdentityAuthority`), que decide por sí misma
// el recurso y el sujeto: aquí la existencia, el estado y el SUJETO (LIVE / ISOLATED_COPY) de cada recurso salen de un registro que escribe una cuenta administrativa distinta de la que ejecuta el
// runtime (el runtime solo lo LEE), y la firma usa una clave que entrega un proveedor externo inyectado (KMS/HSM en el futuro; nunca el entorno ni el repositorio). Lo único que hace el código
// de arranque confiable es ENLAZAR un objeto concreto con un `resourceId` ya registrado (`enroll`, inmutable): el código evaluado no puede elegir su identidad ni su sujeto.
// Límite honesto: la fiabilidad real depende de la separación de privilegios del registro y de la custodia de la clave, que son infraestructura/decisiones pendientes; este módulo no las puede garantizar.
export interface ResourceRegistry {
  lookup(input: { target: AttestationTarget; port: PortName; resourceId: string }): Promise<{ subject: ResourceSubject; status: 'ACTIVE' | 'RETIRED' } | null>;
}
export interface SigningKeyProvider { getKey(): Promise<Uint8Array> }
const ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function createRegistryIdentityAuthority(config: { authorityId: string; target: AttestationTarget; registry: ResourceRegistry; keys: SigningKeyProvider }): ResourceIdentityAuthority & { enroll(instance: object, port: PortName, resourceId: string): void } {
  if (!ID.test(config.authorityId) || (config.target !== 'LAB' && config.target !== 'PRODUCTION') || typeof config.registry?.lookup !== 'function' || typeof config.keys?.getKey !== 'function') throw new Error('UNAVAILABLE');
  const bound = new WeakMap<object, Map<PortName, string>>();
  return {
    enroll(instance, port, resourceId) {
      if (typeof instance !== 'object' || instance === null || !ID.test(resourceId)) throw new Error('UNAVAILABLE');
      const m = bound.get(instance) ?? new Map<PortName, string>();
      if (m.has(port)) throw new Error('UNAVAILABLE');   // el enlace es inmutable: no se puede reasignar la identidad de un objeto
      m.set(port, resourceId); bound.set(instance, m);
    },
    async identify({ port, instance, target, challenge, codeFingerprint }) {
      if (target !== config.target) return null;   // una autoridad de un destino no habla por el otro
      const resourceId = bound.get(instance)?.get(port); if (!resourceId) return null;
      try {
        const entry = await config.registry.lookup({ target, port, resourceId });
        if (!entry || entry.status !== 'ACTIVE') return null;   // no registrado o retirado
        const key = await config.keys.getKey(); if (!(key instanceof Uint8Array) || key.length < 32) return null;
        return { authorityId: config.authorityId, resourceId, subject: entry.subject, proof: signIdentityProof(key, { authorityId: config.authorityId, port, target, resourceId, subject: entry.subject, challenge, codeFingerprint }) };
      } catch { return null; }   // cualquier fallo (registro, clave) = identidad no verificable; sin detalles
    },
  };
}

/** Las autoridades de laboratorio y de producción no pueden compartir identificador ni material de verificación. Lanza si hay solapamiento. */
export function assertDisjointTrust(trust: { lab: Readonly<Record<string, Uint8Array>>; production: Readonly<Record<string, Uint8Array>> }): void {
  const lab = Object.keys(trust.lab); const prod = Object.keys(trust.production);
  if (lab.length === 0 || prod.length === 0 || lab.some(id => prod.includes(id))) throw new Error('UNAVAILABLE');
  for (const l of lab) for (const p of prod) if (Buffer.from(trust.lab[l]).equals(Buffer.from(trust.production[p]))) throw new Error('UNAVAILABLE');   // ni la misma clave
}
