import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import type { RolGlobal } from "./roles";
import { getAuthSecretBytes } from "./auth-secret";
import type { RowDataPacket } from "mysql2";
import { query } from "./db";
import {
  absoluteExpirySeconds,
  isSessionLifetimeExpired,
  nowSeconds,
  resolveSessionLifetime,
} from "./session-lifetime";

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
  /**
   * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — instante del último login
   * correcto con contraseña y última actividad humana registrada
   * (segundos desde epoch, ver session-lifetime.ts). Opcionales en el
   * TIPO únicamente para no romper los mocks/pruebas existentes de otros
   * módulos que construyen un SessionPayload sin ellos — cualquier sesión
   * REAL (la que produce verifySessionToken/getSession) siempre los trae
   * poblados; nunca son `undefined` en tiempo de ejecución para una
   * sesión válida.
   */
  authAt?: number;
  lastActivityAt?: number;
};

function getSecret(): Uint8Array {
  return getAuthSecretBytes();
}

/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — `authAt`/`lastActivityAt` son
 * OPCIONALES en la entrada: si no vienen, se toman como "ahora" (mismo
 * comportamiento que un login fresco). Quien SÍ debe preservarlos
 * explícitamente es un reemisión que conserva la sesión existente (cambio
 * de empresa en select-empresa/route.ts y tenant.ts, que hacen
 * `{...sessionActual, empresaId, ...}` y así los arrastran tal cual) o el
 * endpoint de actividad (que preserva `authAt` y solo actualiza
 * `lastActivityAt`). `exp` SIEMPRE se calcula desde `authAt` — nunca
 * desde `lastActivityAt` ni desde "ahora" — para que cambiar de empresa o
 * reportar actividad JAMÁS extienda el máximo absoluto de 12h.
 */
export async function createSessionToken(
  user: SessionPayload,
): Promise<string> {
  const authAt = user.authAt ?? nowSeconds();
  const lastActivityAt = user.lastActivityAt ?? nowSeconds();
  return new SignJWT({ ...user, authAt, lastActivityAt })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(absoluteExpirySeconds(authAt))
    .sign(getSecret());
}

/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — además de la verificación
 * criptográfica de siempre (firma + `exp`, que ya cubre el máximo
 * absoluto de 12h porque `exp` se fija en `authAt + 12h` desde
 * `createSessionToken`), rechaza también por INACTIVIDAD (30 min desde
 * `lastActivityAt`), algo que `jwtVerify` no sabe evaluar por sí solo.
 * Resuelve `authAt`/`lastActivityAt` con el mismo criterio que el resto
 * de la plataforma (`resolveSessionLifetime`, con compatibilidad para
 * tokens heredados vía `iat`) — nunca confía en un `exp` o tiempos que el
 * cliente pretenda imponer fuera de la firma del JWT.
 */
export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const id = Number(payload.id);
    const username = String(payload.username ?? "");
    const rol = String(payload.rol ?? "") as RolGlobal;
    if (!id || !username || !rol) return null;

    const lifetime = resolveSessionLifetime(payload);
    if (!lifetime || isSessionLifetimeExpired(lifetime, nowSeconds())) {
      return null;
    }

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
      authAt: lifetime.authAt,
      lastActivityAt: lifetime.lastActivityAt,
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

/**
 * `maxAgeSeconds`: por defecto 12h (login fresco: coincide exactamente
 * con `exp`). Un llamador que reemite preservando `authAt` (p. ej. el
 * endpoint de actividad) puede pasar el tiempo real restante hasta el
 * máximo absoluto para que la cookie del navegador no sobreviva más
 * tiempo del que el JWT en sí sigue siendo válido — esto es solo higiene
 * del lado del cliente: la validez REAL siempre la decide el servidor en
 * cada lectura (`verifySessionToken`), nunca el `Max-Age` de la cookie.
 */
export async function setSessionCookie(
  token: string,
  maxAgeSeconds: number = SESSION_HOURS * 60 * 60,
): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
