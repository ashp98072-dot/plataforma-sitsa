import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function clave(): Buffer {
  const secret = process.env.PORTAL_CREDENTIALS_KEY?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "PORTAL_CREDENTIALS_KEY debe configurarse con al menos 32 caracteres.",
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
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
