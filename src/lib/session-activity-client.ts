export type SessionKind = "staff" | "colaborador" | "cliente";

export const ACTIVITY_PING_THROTTLE_MS = 60_000;
export const ACTIVITY_LOCK_MS = 15_000;
export const HUMAN_ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

export type ActivityResponse = {
  serverNow: number;
  lastActivityAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
};

export type ConfirmedSessionClock = {
  serverOffsetMs: number;
  lastActivityAtMs: number;
  idleExpiresAtMs: number;
  absoluteExpiresAtMs: number;
};

type MinimalStorage = Pick<Storage, "getItem" | "setItem">;

export const SESSION_ENDPOINTS: Record<
  SessionKind,
  { activity: string; logout: string; login: string }
> = {
  staff: {
    activity: "/api/auth/activity",
    logout: "/api/auth/logout",
    login: "/login",
  },
  colaborador: {
    activity: "/api/portal/auth/activity",
    logout: "/api/portal/auth/logout",
    login: "/portal/login",
  },
  cliente: {
    activity: "/api/cliente-portal/auth/activity",
    logout: "/api/cliente-portal/auth/logout",
    login: "/cliente-portal/login",
  },
};

export function sessionKindForPath(pathname: string): SessionKind | null {
  if (pathname === "/portal/login" || pathname.startsWith("/portal/login/")) {
    return null;
  }
  if (
    pathname === "/cliente-portal/login" ||
    pathname.startsWith("/cliente-portal/login/")
  ) {
    return null;
  }
  if (pathname === "/login" || pathname.startsWith("/site")) return null;
  if (pathname.startsWith("/cliente-portal")) return "cliente";
  if (pathname.startsWith("/portal")) return "colaborador";
  if (pathname.startsWith("/e/") || pathname === "/select-empresa") {
    return "staff";
  }
  return null;
}

export function activityStorageKey(kind: SessionKind): string {
  return `sitsa:${kind}:human-activity`;
}

export function activityPingStorageKey(kind: SessionKind): string {
  return `sitsa:${kind}:activity-ping`;
}

export function activityLockStorageKey(kind: SessionKind): string {
  return `sitsa:${kind}:activity-lock`;
}

export function activityConfirmationStorageKey(kind: SessionKind): string {
  return `sitsa:${kind}:activity-confirmed`;
}

export function shouldSendActivityPing(
  lastPingMs: number,
  nowMs: number,
): boolean {
  return !Number.isFinite(lastPingMs) || nowMs - lastPingMs >= ACTIVITY_PING_THROTTLE_MS;
}

export function isTrustedHumanActivity(event: Pick<Event, "isTrusted" | "type">): boolean {
  return Boolean(
    event.isTrusted &&
      (HUMAN_ACTIVITY_EVENTS as readonly string[]).includes(event.type),
  );
}

/** Reserva best-effort compartida; escribir y releer reduce carreras entre pestañas. */
export function tryAcquireActivityLock(
  storage: MinimalStorage,
  kind: SessionKind,
  owner: string,
  nowMs: number,
): boolean {
  const key = activityLockStorageKey(kind);
  const existing = JSON.parse(storage.getItem(key) ?? "null") as
    | { owner?: string; until?: number }
    | null;
  if (existing?.until && existing.until > nowMs && existing.owner !== owner) {
    return false;
  }
  storage.setItem(key, JSON.stringify({ owner, until: nowMs + ACTIVITY_LOCK_MS }));
  const current = JSON.parse(storage.getItem(key) ?? "null") as
    | { owner?: string }
    | null;
  return current?.owner === owner;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Convierte una confirmación del servidor al reloj local de ESTA pestaña. */
export function confirmedClockFromServer(
  response: ActivityResponse,
  localReceivedAtMs: number,
): ConfirmedSessionClock | null {
  if (
    !positiveFinite(response.serverNow) ||
    !positiveFinite(response.lastActivityAt) ||
    !positiveFinite(response.idleExpiresAt) ||
    !positiveFinite(response.absoluteExpiresAt)
  ) {
    return null;
  }
  return {
    serverOffsetMs: response.serverNow * 1000 - localReceivedAtMs,
    lastActivityAtMs: response.lastActivityAt * 1000,
    idleExpiresAtMs: response.idleExpiresAt * 1000,
    absoluteExpiresAtMs: response.absoluteExpiresAt * 1000,
  };
}

/** Una respuesta ausente/inválida nunca extiende el estado confirmado anterior. */
export function confirmedClockAfterResponse(
  current: ConfirmedSessionClock | null,
  response: ActivityResponse | null,
  localReceivedAtMs: number,
): ConfirmedSessionClock | null {
  return response
    ? (confirmedClockFromServer(response, localReceivedAtMs) ?? current)
    : current;
}

export function isConfirmedSessionExpired(
  clock: ConfirmedSessionClock,
  localNowMs: number,
): boolean {
  const approximateServerNow = localNowMs + clock.serverOffsetMs;
  return (
    approximateServerNow >= clock.idleExpiresAtMs ||
    approximateServerNow >= clock.absoluteExpiresAtMs
  );
}
