import type { CompositionDescriptor, PortDescriptor } from './conformance-attestation';
import { ALL_PORTS, type PortName } from './port-conformance';
import type { mariaDbSecurityPorts } from './security-mariadb';

// PRICESMART API-18 — descriptor de composición a partir de los puertos REALES ya existentes (API-11): contador, replay, catálogo y reloj respaldados por MariaDB. Es una función PURA: no crea el
// pool, no abre conexiones y no instala nada; recibe los puertos ya construidos por la composición administrativa. Los puertos que todavía NO existen se reportan en `missing` en lugar de fingirse:
// el CIFRADO de cargas (requiere gestión de claves/KMS: decisión de infraestructura) y el VERIFICADOR de evidencia (depende de D02, PENDIENTE). Hasta que alguien aporte esos dos, la composición
// queda incompleta y la compuerta de instalación la rechaza (`INCOMPLETE_COMPOSITION`).
export const MARIADB_PORT_VERSION = 'api11-1';
export function describeMariaDbComposition(security: Pick<ReturnType<typeof mariaDbSecurityPorts>, 'counter' | 'replay' | 'catalog' | 'clock'>, extras: { cipher?: PortDescriptor; verifier?: PortDescriptor } = {}): { composition: CompositionDescriptor; missing: PortName[] } {
  const composition: CompositionDescriptor = {
    counter: { instance: security.counter, implementationId: 'mariadb-counter', version: MARIADB_PORT_VERSION },
    replay: { instance: security.replay, implementationId: 'mariadb-replay', version: MARIADB_PORT_VERSION },
    catalog: { instance: security.catalog, implementationId: 'mariadb-catalog', version: MARIADB_PORT_VERSION },
    clock: { instance: security.clock, implementationId: 'mariadb-clock', version: MARIADB_PORT_VERSION },
    ...(extras.cipher ? { cipher: extras.cipher } : {}), ...(extras.verifier ? { verifier: extras.verifier } : {}),
  };
  return { composition, missing: ALL_PORTS.filter(p => !composition[p]) };
}
