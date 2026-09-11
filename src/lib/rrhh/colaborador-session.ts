import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import { getAuthSecretBytes } from "@/lib/auth-secret";
import {
  absoluteExpirySeconds,
  isSessionLifetimeExpired,
  nowSeconds,
  resolveSessionLifetime,
} from "@/lib/session-lifetime";

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
  /**
   * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — mismo criterio que
   * SessionPayload en session.ts: opcionales en el TIPO (para no romper
   * mocks existentes), siempre poblados en tiempo de ejecución para una
   * sesión real (ver verifyColaboradorSessionToken).
   */
  authAt?: number;
  lastActivityAt?: number;
};

// Mismo secreto (AUTH_SECRET) que usa la sesión de staff: es el mismo
// servidor/deploy, no hay razón para mantener dos secretos. Los tokens no
// se confunden entre sí porque van en cookies distintas y tienen forma
// distinta de payload.
function getSecret(): Uint8Array {
  return getAuthSecretBytes();
}

/** SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — mismo criterio que createSessionToken (session.ts): ver ese comentario para el porqué de authAt/lastActivityAt/exp. */
export async function createColaboradorSessionToken(
  payload: ColaboradorSessionPayload,
): Promise<string> {
  const authAt = payload.authAt ?? nowSeconds();
  const lastActivityAt = payload.lastActivityAt ?? nowSeconds();
  return new SignJWT({ ...payload, authAt, lastActivityAt })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(absoluteExpirySeconds(authAt))
    .sign(getSecret());
}

/** SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — mismo criterio que verifySessionToken (session.ts): ver ese comentario para el porqué del chequeo de inactividad además de la firma/exp. */
export async function verifyColaboradorSessionToken(
  token: string,
): Promise<ColaboradorSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const empleadoId = Number(payload.empleadoId);
    const empresaId = Number(payload.empresaId);
    if (!empleadoId || !empresaId) return null;

    const lifetime = resolveSessionLifetime(payload);
    if (!lifetime || isSessionLifetimeExpired(lifetime, nowSeconds())) {
      return null;
    }

    return {
      empleadoId,
      empresaId,
      empresaSlug: payload.empresaSlug ? String(payload.empresaSlug) : null,
      nombre: payload.nombre ? String(payload.nombre) : undefined,
      debeCambiarPassword: Boolean(payload.debeCambiarPassword),
      authAt: lifetime.authAt,
      lastActivityAt: lifetime.lastActivityAt,
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

/** `maxAgeSeconds`: ver el comentario de setSessionCookie en session.ts (mismo criterio). */
export async function setColaboradorSessionCookie(
  token: string,
  maxAgeSeconds: number = SESSION_HOURS * 60 * 60,
): Promise<void> {
  const jar = await cookies();
  jar.set(COLABORADOR_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export async function clearColaboradorSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COLABORADOR_SESSION_COOKIE);
}