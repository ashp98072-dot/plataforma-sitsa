import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AmbienteFel } from "./tipos";

/**
 * Cifrado de secretos FEL (AES-256-GCM). Clave DEDICADA `FEL_CREDENTIALS_KEY`: a diferencia de las credenciales de portal,
 * NO hay respaldo con AUTH_SECRET (un secreto fiscal no debe quedar atado a la clave de sesiones). El AAD liga el
 * secreto a (empresa, entidad, ambiente): un secreto TEST no descifra como PROD ni como otra empresa.
 *
 * Los mensajes de error son FIJOS: nunca incluyen la clave, el valor ni el texto de la excepción de crypto.
 */

const VERSION = "f1";
export const VARIABLE_CLAVE_FEL = "FEL_CREDENTIALS_KEY";

export class ErrorConfigFel extends Error {
  readonly codigo = "ERROR_CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "ErrorConfigFel";
  }
}

export type AmbitoSecretoFel = { empresaId: number; entidadId: number; ambiente: AmbienteFel };

function clave(): Buffer {
  const valor = process.env[VARIABLE_CLAVE_FEL]?.trim();
  if (!valor || valor.length < 32) {
    throw new ErrorConfigFel(`Falta la variable ${VARIABLE_CLAVE_FEL} (mínimo 32 caracteres): no se pueden usar credenciales FEL.`);
  }
  return createHash("sha256").update(valor, "utf8").digest();
}

const aad = (a: AmbitoSecretoFel) => Buffer.from(`fel|${a.empresaId}|${a.entidadId}|${a.ambiente}`, "utf8");

export function cifrarSecretoFel(valor: string, ambito: AmbitoSecretoFel): string {
  const llave = clave();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", llave, iv);
  cipher.setAAD(aad(ambito));
  const contenido = Buffer.concat([cipher.update(valor, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), contenido.toString("base64")].join(".");
}

export function descifrarSecretoFel(valor: string, ambito: AmbitoSecretoFel): string {
  const llave = clave();
  const [version, iv64, tag64, contenido64] = valor.split(".");
  if (version !== VERSION || !iv64 || !tag64 || !contenido64) {
    throw new ErrorConfigFel("El secreto FEL guardado tiene un formato inválido.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", llave, Buffer.from(iv64, "base64"));
    decipher.setAAD(aad(ambito));
    decipher.setAuthTag(Buffer.from(tag64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(contenido64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new ErrorConfigFel("No se pudo descifrar el secreto FEL (clave o ambiente distintos).");
  }
}
