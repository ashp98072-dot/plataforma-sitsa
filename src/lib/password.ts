import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

// scrypt con keylen=64 → hash hex de 128 caracteres (cabe en usuarios.password_hash VARCHAR(128)).
const SCRYPT_KEYLEN = 64;
// salt de 32 bytes → 64 caracteres hex (cabe en usuarios.salt VARCHAR(64)).
const SCRYPT_SALT_BYTES = 32;

/**
 * Hash "moderno" de contraseñas (scrypt). Se usa para altas de usuario,
 * cambios de contraseña y para re-hashear cuentas antiguas al iniciar sesión.
 */
export function hashPassword(
  password: string,
  salt?: string,
): { salt: string; passwordHash: string } {
  const saltFinal = salt ?? randomBytes(SCRYPT_SALT_BYTES).toString("hex");
  const passwordHash = scryptSync(password, saltFinal, SCRYPT_KEYLEN).toString(
    "hex",
  );
  return { salt: saltFinal, passwordHash };
}

/**
 * Esquema legado: sha256(salt + password) de una sola pasada. Ya no se usa
 * para generar contraseñas nuevas, solo para poder verificar cuentas creadas
 * antes de migrar a scrypt.
 */
function hashPasswordLegacySha256(password: string, salt: string): string {
  return createHash("sha256")
    .update(salt + password, "utf8")
    .digest("hex");
}

/** sha256 hex = 64 caracteres; scrypt (keylen 64) hex = 128 caracteres. */
function esHashLegado(passwordHash: string): boolean {
  return passwordHash.length <= 64;
}

export function verifyPassword(
  password: string,
  salt: string,
  passwordHash: string,
): boolean {
  const calculated = esHashLegado(passwordHash)
    ? hashPasswordLegacySha256(password, salt)
    : hashPassword(password, salt).passwordHash;
  try {
    const a = Buffer.from(calculated, "utf8");
    const b = Buffer.from(passwordHash, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * True si el hash guardado todavía usa el esquema antiguo (sha256) y
 * conviene regenerarlo con scrypt la próxima vez que el usuario inicie
 * sesión correctamente.
 */
export function necesitaRehash(passwordHash: string): boolean {
  return esHashLegado(passwordHash);
}