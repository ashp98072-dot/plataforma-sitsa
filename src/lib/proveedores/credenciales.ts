import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getAuthSecretBytes } from "@/lib/auth-secret";

const VERSION = "v1";

function clave(): Buffer {
  const dedicada = process.env.PORTAL_CREDENTIALS_KEY?.trim();
  // Compatibilidad: una clave dedicada válida conserva exactamente la misma
  // derivación usada por credenciales ya guardadas. Para instalaciones que no
  // necesitan otra variable, AUTH_SECRET funciona como material maestro.
  if (dedicada && dedicada.length >= 32) {
    return createHash("sha256").update(dedicada, "utf8").digest();
  }
  return createHash("sha256").update(getAuthSecretBytes()).digest();
}

export function cifrarCredencial(valor: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", clave(), iv);
  const contenido = Buffer.concat([
    cipher.update(valor, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), contenido.toString("base64")].join(".");
}

export function descifrarCredencial(valor: string): string {
  const [version, iv64, tag64, contenido64] = valor.split(".");
  if (version !== VERSION || !iv64 || !tag64 || !contenido64) {
    throw new Error("Formato de credencial cifrada inválido.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    clave(),
    Buffer.from(iv64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(contenido64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
