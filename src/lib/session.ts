import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import type { RolGlobal } from "./roles";
import { getAuthSecretBytes } from "./auth-secret";
import type { RowDataPacket } from "mysql2";
import { query } from "./db";

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
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  // Rol, estado y alcance empresarial son revocables. La cookie identifica
  // la sesión, pero la autorización vigente siempre sale de la BD para que
  // un cambio administrativo aplique inmediatamente sin cerrar sesión.
  const rows = await query<RowDataPacket[]>(
    `SELECT username, nombre, rol_global, activo, acceso_todas_empresas
     FROM usuarios WHERE id = ? LIMIT 1`,
    [payload.id],
  );
  const actual = rows[0];
  if (!actual || !Boolean(actual.activo)) return null;
  return {
    ...payload,
    username: String(actual.username),
    nombre: actual.nombre ? String(actual.nombre) : undefined,
    rol: String(actual.rol_global) as RolGlobal,
    accesoTodas: Boolean(actual.acceso_todas_empresas),
  };
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
