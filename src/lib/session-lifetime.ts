/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1 — núcleo de sesiones).
 *
 * Matemática PURA de vigencia de sesión, compartida por las TRES sesiones
 * independientes de la plataforma (administrativo `sitsa_session`,
 * colaborador `sitsa_colab_session`, cliente `sitsa_cliente_session`) y
 * por TODOS los puntos que la validan: middleware.ts, session.ts,
 * colaborador-session.ts, cliente-portal-session.ts, y los 3 endpoints de
 * actividad. Deliberadamente:
 *   - sin acceso a base de datos;
 *   - sin filesystem;
 *   - sin React;
 *   - sin ninguna API específica de Node incompatible con el runtime Edge.
 * middleware.ts corre en Edge — este archivo debe poder importarse desde
 * ahí sin romper ese build. Un mismo cálculo de vigencia usado en los dos
 * lugares (middleware y los helpers de sesión de cada dominio) evita que
 * la lógica se duplique y diverja con el tiempo.
 *
 * Todos los tiempos son SEGUNDOS desde epoch (mismo formato que los
 * claims `iat`/`exp` de un JWT) — nunca milisegundos, para no arrastrar
 * conversiones en cada punto de uso.
 */

/** Cierre automático por inactividad humana real: 30 minutos. */
export const INACTIVITY_LIMIT_SECONDS = 30 * 60;

/** Máximo absoluto de una sesión desde el último login correcto con contraseña: 12 horas. */
export const ABSOLUTE_LIMIT_SECONDS = 12 * 60 * 60;

export type SessionLifetime = {
  /** Instante del último login correcto con contraseña. */
  authAt: number;
  /** Última actividad humana real registrada (ver session-inactivity-guard.tsx: pointerdown/keydown/touchstart, solo event.isTrusted). */
  lastActivityAt: number;
};

/**
 * `now - lastActivityAt >= 30min` O `now - authAt >= 12h` → expirada.
 * Límite INCLUSIVO a propósito: "Exactamente al alcanzar el límite ya se
 * considera expirada" (29:59 válido, 30:00 inválido; 11:59:59 válido,
 * 12:00:00 inválido).
 */
export function isSessionLifetimeExpired(
  lifetime: SessionLifetime,
  nowSeconds: number,
): boolean {
  const inactiveForSeconds = nowSeconds - lifetime.lastActivityAt;
  const aliveForSeconds = nowSeconds - lifetime.authAt;
  return (
    inactiveForSeconds >= INACTIVITY_LIMIT_SECONDS ||
    aliveForSeconds >= ABSOLUTE_LIMIT_SECONDS
  );
}

/**
 * `exp` del JWT — SIEMPRE `authAt + 12h`, nunca recalculado a partir de
 * `lastActivityAt`. Ni renovar actividad (endpoint de actividad) ni
 * cambiar de empresa (select-empresa / cambio implícito en tenant.ts)
 * deben extender este límite — cambiar de empresa NO reinicia las 12h.
 */
export function absoluteExpirySeconds(authAt: number): number {
  return authAt + ABSOLUTE_LIMIT_SECONDS;
}

/**
 * Tokens heredados (emitidos ANTES de este ticket) no traen `authAt` ni
 * `lastActivityAt` propios — pero todo JWT de esta app siempre trae
 * `iat` (los 3 creadores de token ya llamaban `.setIssuedAt()` desde
 * antes de este ticket), así que se usa como sustituto TEMPORAL de
 * ambos mientras no haya evidencia mejor.
 */
export function legacyLifetimeFromIat(iatSeconds: number): SessionLifetime {
  return { authAt: iatSeconds, lastActivityAt: iatSeconds };
}

/** Forma mínima de un payload JWT YA verificado criptográficamente (firma + exp), del que se puede leer vigencia. */
export type RawLifetimeClaims = {
  authAt?: unknown;
  lastActivityAt?: unknown;
  iat?: unknown;
};

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Resuelve la vigencia real de un payload YA verificado
 * criptográficamente (firma/exp OK vía `jwtVerify`) — nunca se llama
 * antes de esa verificación, porque un atacante podría intentar imponer
 * `authAt`/`lastActivityAt`/`exp` propios en un JWT sin firmar o mal
 * firmado. Si el token ya trae `authAt`+`lastActivityAt` (formato
 * nuevo), se usan tal cual. Si no (formato heredado), cae a
 * `legacyLifetimeFromIat`. Si ni siquiera trae `iat` (no debería pasar
 * nunca — jose siempre lo pone), devuelve `null`: sesión no resoluble,
 * se trata como inválida.
 */
export function resolveSessionLifetime(
  claims: RawLifetimeClaims,
): SessionLifetime | null {
  const authAt = asFiniteNumber(claims.authAt);
  const lastActivityAt = asFiniteNumber(claims.lastActivityAt);
  if (authAt !== undefined && lastActivityAt !== undefined) {
    return { authAt, lastActivityAt };
  }
  const iat = asFiniteNumber(claims.iat);
  if (iat !== undefined) {
    return legacyLifetimeFromIat(iat);
  }
  return null;
}

/** `true` si el payload decodificado corresponde a un token heredado (sin `authAt`/`lastActivityAt` propios). */
export function isLegacyLifetimeClaims(claims: RawLifetimeClaims): boolean {
  return !(
    asFiniteNumber(claims.authAt) !== undefined &&
    asFiniteNumber(claims.lastActivityAt) !== undefined
  );
}

/** Hora del servidor, en segundos desde epoch — única fuente autoritativa de tiempo para toda esta lógica. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
