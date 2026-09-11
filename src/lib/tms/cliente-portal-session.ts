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
 * CLIENTE-PORTAL-1 — sesión del Portal del Cliente (empresas externas que
 * solicitan/consultan sus viajes), calcada del patrón de
 * src/lib/rrhh/colaborador-session.ts, pero con su PROPIA cookie y su
 * PROPIO payload. Nunca comparte cookie con el staff (`sitsa_session`) ni
 * con el colaborador (`sitsa_colab_session`) — un mismo navegador puede
 * tener las tres sesiones abiertas a la vez sin que ninguna pise a otra.
 */
export const CLIENTE_SESSION_COOKIE = "sitsa_cliente_session";
const SESSION_HOURS = 12;

export type ClientePortalSessionPayload = {
  usuarioClienteId: number;
  empresaId: number;
  clienteId: number;
  nombre?: string;
  debeCambiarPassword?: boolean;
  /**
   * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — mismo criterio que
   * SessionPayload en session.ts: opcionales en el TIPO (para no romper
   * mocks existentes), siempre poblados en tiempo de ejecución para una
   * sesión real (ver verifyClienteSessionToken).
   */
  authAt?: number;
  lastActivityAt?: number;
};

// Mismo secreto (AUTH_SECRET) que staff/colaborador: es el mismo
// servidor/deploy, no hay razón para mantener secretos distintos. Los
// tokens no se confunden entre sí porque van en cookies distintas y
// tienen forma de payload distinta (empleadoId vs. usuarioClienteId).
function getSecret(): Uint8Array {
  return getAuthSecretBytes();
}

/** SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — mismo criterio que createSessionToken (session.ts): ver ese comentario para el porqué de authAt/lastActivityAt/exp. */
export async function createClienteSessionToken(
  payload: ClientePortalSessionPayload,
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
export async function verifyClienteSessionToken(
  token: string,
): Promise<ClientePortalSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const usuarioClienteId = Number(payload.usuarioClienteId);
    const empresaId = Number(payload.empresaId);
    const clienteId = Number(payload.clienteId);
    // Los 3 identificadores del scope son obligatorios — un token que no
    // los traiga los tres no es una sesión de cliente válida (nunca se
    // "completa" con datos de otra fuente).
    if (!usuarioClienteId || !empresaId || !clienteId) return null;

    const lifetime = resolveSessionLifetime(payload);
    if (!lifetime || isSessionLifetimeExpired(lifetime, nowSeconds())) {
      return null;
    }

    return {
      usuarioClienteId,
      empresaId,
      clienteId,
      nombre: payload.nombre ? String(payload.nombre) : undefined,
      debeCambiarPassword: Boolean(payload.debeCambiarPassword),
      authAt: lifetime.authAt,
      lastActivityAt: lifetime.lastActivityAt,
    };
  } catch {
    return null;
  }
}

async function readClienteSession(): Promise<ClientePortalSessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(CLIENTE_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyClienteSessionToken(token);
}

/** Deduplica dentro del mismo request RSC (layout + page del portal del cliente). */
export const getClienteSession = cache(readClienteSession);

/** `maxAgeSeconds`: ver el comentario de setSessionCookie en session.ts (mismo criterio). */
export async function setClienteSessionCookie(
  token: string,
  maxAgeSeconds: number = SESSION_HOURS * 60 * 60,
): Promise<void> {
  const jar = await cookies();
  jar.set(CLIENTE_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export async function clearClienteSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(CLIENTE_SESSION_COOKIE);
}
