import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";

/**
 * Cookie DISTINTA de `sitsa_session` (staff). Un mismo navegador puede así
 * tener abierta a la vez una sesión de staff (/admin, /e/[slug]) y una de
 * colaborador (/portal) sin que una pise a la otra.
 */
export const COLABORADOR_SESSION_COOKIE = "sitsa_colab_session";
const SESSION_HOURS = 12;

export type ColaboradorSessionPayload = {
  empleadoId: number;
  empresaId: number;
  empresaSlug?: string | null;
  nombre?: string;
  debeCambiarPassword?: boolean;
};

// Mismo secreto (AUTH_SECRET) que usa la sesión de staff: es el mismo
// servidor/deploy, no hay razón para mantener dos secretos. Los tokens no
// se confunden entre sí porque van en cookies distintas y tienen forma
// distinta de payload.
function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    return new TextEncoder().encode("dev-insecure-secret-change-me-32");
  }
  return new TextEncoder().encode(secret);
}

export async function createColaboradorSessionToken(
  payload: ColaboradorSessionPayload,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(getSecret());
}

export async function verifyColaboradorSessionToken(
  token: string,
): Promise<ColaboradorSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const empleadoId = Number(payload.empleadoId);
    const empresaId = Number(payload.empresaId);
    if (!empleadoId || !empresaId) return null;
    return {
      empleadoId,
      empresaId,
      empresaSlug: payload.empresaSlug ? String(payload.empresaSlug) : null,
      nombre: payload.nombre ? String(payload.nombre) : undefined,
      debeCambiarPassword: Boolean(payload.debeCambiarPassword),
    };
  } catch {
    return null;
  }
}

async function readColaboradorSession(): Promise<ColaboradorSessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(COLABORADOR_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyColaboradorSessionToken(token);
}

/** Deduplica dentro del mismo request RSC (layout + page del portal). */
export const getColaboradorSession = cache(readColaboradorSession);

export async function setColaboradorSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(COLABORADOR_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

export async function clearColaboradorSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COLABORADOR_SESSION_COOKIE);
}