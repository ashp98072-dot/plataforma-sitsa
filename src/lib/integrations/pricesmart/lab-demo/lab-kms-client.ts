import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KmsClient } from '../kms-adapter';

// PRICESMART API-20 — cliente KMS de LABORATORIO en memoria, solo para pruebas y el laboratorio local. Claves maestras aleatorias por ejecución y por alias (nunca en repositorio, entorno ni base de datos); solo
// acepta alias `lab.*`. No es un KMS real ni un sustituto: un cliente de producción es infraestructura pendiente y debe autenticarse por sí mismo.
export type LabKmsClient = KmsClient & { retireAlias(alias: string): void; readonly aliases: () => string[] };
export function createLabKmsClient(aliases: readonly string[]): LabKmsClient {
  if (aliases.length === 0 || aliases.some(a => !/^lab\.[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/.test(a))) throw new Error('UNAVAILABLE');
  const keys = new Map(aliases.map(a => [a, randomBytes(32)] as const));
  const master = (alias: string) => { const k = keys.get(alias); if (!k) throw new Error('alias desconocido'); return k; };
  return {
    async encrypt({ alias, plaintext, context }) {
      const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', master(alias), iv); c.setAAD(Buffer.from(context));
      const ct = Buffer.concat([c.update(Buffer.from(plaintext)), c.final()]); return new Uint8Array(Buffer.concat([iv, c.getAuthTag(), ct]));
    },
    async decrypt({ alias, ciphertext, context }) {
      const w = Buffer.from(ciphertext); if (w.length < 28) throw new Error('inválido');
      const d = createDecipheriv('aes-256-gcm', master(alias), w.subarray(0, 12)); d.setAAD(Buffer.from(context)); d.setAuthTag(w.subarray(12, 28));
      return new Uint8Array(Buffer.concat([d.update(w.subarray(28)), d.final()]));
    },
    async health() { return keys.size > 0; },
    retireAlias(alias) { keys.delete(alias); }, aliases: () => [...keys.keys()],
  };
}
