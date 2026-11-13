import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ExternalKeyProvider } from '../provider-cipher';

// PRICESMART API-19 — proveedor de claves de LABORATORIO en memoria. SOLO para pruebas y el laboratorio local: las claves maestras se generan al azar en cada ejecución, viven únicamente en la memoria del
// proceso (nunca en el repositorio, el entorno ni la base de datos) y desaparecen con él. Solo existe para el destino LAB (referencias `lab.*`): no puede construirse para PRODUCTION. No es un KMS ni
// un sustituto de uno; un proveedor real de producción es infraestructura pendiente.
export type LabKeyProvider = ExternalKeyProvider & { rotate(): string; retire(keyReference: string): void; readonly references: () => string[] };

export function createLabKeyProvider(options: { prefix?: string } = {}): LabKeyProvider {
  const label = options.prefix ?? 'k';
  if (!/^[A-Za-z0-9]{1,16}$/.test(label)) throw new Error('UNAVAILABLE');
  const keys = new Map<string, Buffer>(); let counter = 0; let current = '';
  const rotate = () => { current = `lab.${label}${++counter}`; keys.set(current, randomBytes(32)); return current; };
  rotate();
  const master = (ref: string) => { const k = keys.get(ref); if (!k) throw new Error('clave desconocida o retirada'); return k; };
  return {
    target: 'LAB',
    async currentKeyReference() { return current; },
    async wrapKey({ keyReference, dataKey, aad }) {
      const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', master(keyReference), iv); c.setAAD(Buffer.from(aad));
      const ct = Buffer.concat([c.update(Buffer.from(dataKey)), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]);
    },
    async unwrapKey({ keyReference, wrappedKey, aad }) {
      const w = Buffer.from(wrappedKey); if (w.length < 28) throw new Error('envoltorio inválido');
      const d = createDecipheriv('aes-256-gcm', master(keyReference), w.subarray(0, 12)); d.setAAD(Buffer.from(aad)); d.setAuthTag(w.subarray(12, 28));
      return new Uint8Array(Buffer.concat([d.update(w.subarray(28)), d.final()]));
    },
    rotate, retire(ref) { keys.delete(ref); }, references: () => [...keys.keys()],
  };
}
