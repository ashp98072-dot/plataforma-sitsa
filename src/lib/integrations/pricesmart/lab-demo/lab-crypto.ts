import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PayloadCipher } from '../mariadb-repository';

// PRICESMART API-12 — criptografía SOLO de laboratorio. La clave llega por entorno (PRICESMART_LAB_KEY, generada por el arnés local en cada ejecución); NUNCA se escribe en el repositorio.
// No es el mecanismo M2M definitivo (D02 pendiente) ni un cifrado de producción (sin KMS, sin rotación).
export const LAB_EVIDENCE_HEADER = 'x-lab-evidence';
export const LAB_ISSUER = 'lab-issuer';
export const labSubject = (k: string) => `lab-subject-${k}`;
export const labCredential = (k: string) => `lab-cred-${k}-1`;

export function labCipher(labKey: string): PayloadCipher {
  if (labKey.length < 32) throw new Error('clave de laboratorio insuficiente');
  const key = createHash('sha256').update(`ps-api12-lab-cipher-v1:${labKey}`).digest();
  return {
    async seal(input, context) {
      const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(context));
      const body = Buffer.concat([c.update(JSON.stringify(input), 'utf8'), c.final()]);
      return { ciphertext: Buffer.concat([iv, c.getAuthTag(), body]), keyReference: 'lab-key-1' };
    },
    async open(buf, keyReference, context) {
      if (keyReference !== 'lab-key-1') throw new Error('clave desconocida');
      const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12)); d.setAAD(Buffer.from(context)); d.setAuthTag(buf.subarray(12, 28));
      return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
    },
  };
}

const mac = (labKey: string, payload: string) => createHmac('sha256', labKey).update(`api12-lab:${payload}`).digest();
/** Extrae la evidencia opaca del encabezado de laboratorio (sin analizar nada más). */
export function labEvidencePort() {
  return { async extract({ headers }: { headers: readonly (readonly [string, string])[] }): Promise<Uint8Array | null> {
    const value = headers.find(([name]) => name === LAB_EVIDENCE_HEADER)?.[1];
    return value === undefined ? null : new TextEncoder().encode(value);
  } };
}
/** Verifica la firma HMAC de laboratorio y devuelve la aserción; la prueba de solicitud (digest ligado a método/cuerpo) la valida el núcleo M2M. */
export function labVerifier(labKey: string, now: () => number = Date.now) {
  return { async verify(evidence: Uint8Array): Promise<unknown | null> {
    const [payload, sig] = new TextDecoder().decode(evidence).split('.'); if (!payload || !sig || !/^[0-9a-f]{64}$/.test(sig)) return null;
    const expected = mac(labKey, payload); const got = Buffer.from(sig, 'hex'); if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
    let parsed: { k?: unknown; proof?: unknown };
    try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
    if (typeof parsed.k !== 'string' || !/^[a-z0-9-]{1,24}$/.test(parsed.k)) return null;
    const t = now();
    return { environment: 'sandbox', issuer: LAB_ISSUER, subject: labSubject(parsed.k), credentialReference: labCredential(parsed.k), validFromMs: t - 60000, validUntilMs: t + 600000,
      scopes: ['orders:create', 'orders:read', 'orders:cancel'], requestProof: parsed.proof };
  } };
}
