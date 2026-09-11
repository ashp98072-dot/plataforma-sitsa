/** Módulo puro y Edge-compatible: no agregar dependencias de Node, React o BD. */
export const SESSION_IDLE_SECONDS = 30 * 60;
export const SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;

export type SessionTimes = {
  authAt: number;
  lastActivityAt: number;
};

type SessionTimeClaims = {
  authAt?: unknown;
  lastActivityAt?: unknown;
  iat?: unknown;
};

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * Los tokens heredados usan iat como fallback, pero leerlos no los migra ni
 * renueva. Los nuevos tiempos solo se escriben al iniciar sesión o registrar
 * actividad humana.
 */
export function resolveSessionTimes(claims: SessionTimeClaims): SessionTimes | null {
  const issuedAt = positiveInteger(claims.iat);
  const authAt = positiveInteger(claims.authAt) ?? issuedAt;
  const lastActivityAt = positiveInteger(claims.lastActivityAt) ?? issuedAt;
  if (!authAt || !lastActivityAt || lastActivityAt < authAt) return null;
  return { authAt, lastActivityAt };
}

export function sessionAbsoluteExpiresAt(authAt: number): number {
  return authAt + SESSION_ABSOLUTE_SECONDS;
}

export function sessionIdleExpiresAt(lastActivityAt: number): number {
  return lastActivityAt + SESSION_IDLE_SECONDS;
}

export function isSessionTimeValid(
  times: SessionTimes,
  nowSeconds: number,
): boolean {
  return (
    nowSeconds - times.lastActivityAt < SESSION_IDLE_SECONDS &&
    nowSeconds - times.authAt < SESSION_ABSOLUTE_SECONDS
  );
}

export function currentServerSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

