import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import type { RolGlobal } from "./roles";
import { getAuthSecretBytes } from "./auth-secret";

export const SESSION_COOKIE = "sitsa_session";
const SESSION_HOURS = 12;

export type SessionPayload = {
  id: number;
  username: string;
  rol: RolGlobal;
  nombre?: string;
  empresaId?: number | null;
  empresaSlug?: string | null;
  empresaNombre?: string | null;
  accesoTodas?: boolean;
};

function getSecret(): Uint8Array {
  return getAuthSecretBytes();
}

export async function createSessionToken(
  user: SessionPayload,
): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(getSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const id = Number(payload.id);
    const username = String(payload.username ?? "");
    const rol = String(payload.rol ?? "") as RolGlobal;
    if (!id || !username || !rol) return null;
    return {
      id,
      username,
      rol,
      nombre: payload.nombre ? String(payload.nombre) : undefined,
      empresaId: payload.empresaId != null ? Number(payload.empresaId) : null,
      empresaSlug: payload.empresaSlug
        ? String(payload.empresaSlug)
        : null,
      empresaNombre: payload.empresaNombre
        ? String(payload.empresaNombre)
        : null,
      accesoTodas: Boolean(payload.accesoTodas),
    };
  } catch {
    return null;
  }
}

async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Deduplica getSession dentro del mismo request RSC (layout + page). */
export const getSession = cache(readSession);

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}