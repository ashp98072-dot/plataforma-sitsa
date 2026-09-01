import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import { getAuthSecretBytes } from "@/lib/auth-secret";

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
};

// Mismo secreto (AUTH_SECRET) que staff/colaborador: es el mismo
// servidor/deploy, no hay razón para mantener secretos distintos. Los
// tokens no se confunden entre sí porque van en cookies distintas y
// tienen forma de payload distinta (empleadoId vs. usuarioClienteId).
function getSecret(): Uint8Array {
  return getAuthSecretBytes();
}

export async function createClienteSessionToken(
  payload: ClientePortalSessionPayload,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(getSecret());
}

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
    return {
      usuarioClienteId,
      empresaId,
      clienteId,
      nombre: payload.nombre ? String(payload.nombre) : undefined,
      debeCambiarPassword: Boolean(payload.debeCambiarPassword),
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

export async function setClienteSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(CLIENTE_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

export async function clearClienteSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(CLIENTE_SESSION_COOKIE);
}
