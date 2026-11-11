import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PayloadCipher } from "../../../src/lib/integrations/pricesmart/mariadb-repository";

/**
 * Cifrador SOLO de laboratorio (datos sintéticos). La clave se DERIVA de un secreto estable del run (AUTH_SECRET del manifiesto) y no se genera al azar por proceso:
 * las fases de B7 (preparar la caída → verificar tras el reinicio) se ejecutan en procesos de Vitest distintos y deben poder leer lo que otro proceso cifró.
 * (Ejecución 3: con una clave aleatoria por proceso, B7.2 no podía descifrar la orden confirmada y devolvía UNAVAILABLE.)
 */
export function makeLabCipher(secret: string | undefined): PayloadCipher {
  if (!secret || secret.length < 16) throw new Error("API-06A: se requiere un secreto estable (AUTH_SECRET del run) para el cifrador de laboratorio.");
  const key = createHash("sha256").update(`ps06a-lab-cipher-v1:${secret}`).digest();
  return {
    async seal(input, context) {
      const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", key, iv); c.setAAD(Buffer.from(context));
      const body = Buffer.concat([c.update(JSON.stringify(input), "utf8"), c.final()]);
      return { ciphertext: Buffer.concat([iv, c.getAuthTag(), body]), keyReference: "lab-key-1" };
    },
    async open(buf, keyReference, context) {
      if (keyReference !== "lab-key-1") throw new Error("clave desconocida");
      const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12)); d.setAAD(Buffer.from(context)); d.setAuthTag(buf.subarray(12, 28));
      return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
    },
  };
}
