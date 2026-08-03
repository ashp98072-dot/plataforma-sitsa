import { createHash, randomBytes, timingSafeEqual } from "crypto";

export function hashPassword(
  password: string,
  salt?: string,
): { salt: string; passwordHash: string } {
  const saltFinal = salt ?? randomBytes(16).toString("hex");
  const passwordHash = createHash("sha256")
    .update(saltFinal + password, "utf8")
    .digest("hex");
  return { salt: saltFinal, passwordHash };
}

export function verifyPassword(
  password: string,
  salt: string,
  passwordHash: string,
): boolean {
  const { passwordHash: calculated } = hashPassword(password, salt);
  try {
    const a = Buffer.from(calculated, "utf8");
    const b = Buffer.from(passwordHash, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
