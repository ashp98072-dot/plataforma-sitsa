"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  SESSION_ENDPOINTS,
  activityConfirmationStorageKey,
  activityLockStorageKey,
  activityPingStorageKey,
  activityStorageKey,
  sessionKindForPath,
  shouldSendActivityPing,
  isTrustedHumanActivity,
  tryAcquireActivityLock,
  confirmedClockAfterResponse,
  canStartHumanActivityRequest,
  isConfirmedSessionExpired,
  type ActivityResponse,
  type ConfirmedSessionClock,
  type SessionKind,
} from "@/lib/session-activity-client";

function numberFromStorage(key: string): number {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) ? value : 0;
}

function acquireCrossTabLock(kind: SessionKind, owner: string, now: number): boolean {
  try {
    return tryAcquireActivityLock(localStorage, kind, owner, now);
  } catch {
    return true;
  }
}

export function SessionInactivityGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const kind = sessionKindForPath(pathname);
  const loggingOut = useRef(false);
  const validationInFlight = useRef(false);
  const activityInFlight = useRef(false);
  const owner = useRef("");
  const confirmedClock = useRef<ConfirmedSessionClock | null>(null);

  useEffect(() => {
    if (!kind) return;
    const activeKind = kind;
    owner.current ||= globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    loggingOut.current = false;
    validationInFlight.current = false;
    activityInFlight.current = false;
    confirmedClock.current = null;

    const endpoints = SESSION_ENDPOINTS[activeKind];
    const humanKey = activityStorageKey(activeKind);
    const pingKey = activityPingStorageKey(activeKind);
    const confirmationKey = activityConfirmationStorageKey(activeKind);

    async function logout() {
      if (loggingOut.current) return;
      loggingOut.current = true;
      try {
        await fetch(endpoints.logout, { method: "POST", credentials: "same-origin" });
      } catch {
        // La sesión ya no será aceptada por el servidor aunque falle la red.
      }
      router.replace(endpoints.login);
      router.refresh();
    }

    function applyServerTime(data: ActivityResponse, broadcast = true): boolean {
      const next = confirmedClockAfterResponse(
        confirmedClock.current,
        data,
        Date.now(),
      );
      if (!next || next === confirmedClock.current) return false;
      confirmedClock.current = next;
      if (broadcast) localStorage.setItem(confirmationKey, JSON.stringify(data));
      return true;
    }

    async function validateOnly() {
      if (validationInFlight.current || loggingOut.current) return;
      validationInFlight.current = true;
      try {
        const response = await fetch(endpoints.activity, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.status === 401) return void logout();
        if (response.ok) applyServerTime((await response.json()) as ActivityResponse);
      } catch {
        // Mantener el último estado confirmado; validar no renueva la sesión.
      } finally {
        validationInFlight.current = false;
      }
    }

    async function registerHumanActivity() {
      const now = Date.now();
      localStorage.setItem(humanKey, String(now));
      if (
        loggingOut.current ||
        !canStartHumanActivityRequest({
          validationInFlight: validationInFlight.current,
          activityInFlight: activityInFlight.current,
        })
      ) {
        return;
      }
      const lastPing = numberFromStorage(pingKey);
      if (!shouldSendActivityPing(lastPing, now)) return;
      if (!acquireCrossTabLock(activeKind, owner.current, now)) return;
      // Se reserva la ventana antes del fetch para agrupar eventos y pestañas.
      localStorage.setItem(pingKey, String(now));
      activityInFlight.current = true;
      let confirmed = false;
      try {
        const response = await fetch(endpoints.activity, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.status === 401) return void logout();
        if (response.ok) {
          confirmed = applyServerTime((await response.json()) as ActivityResponse);
        }
      } catch {
        // Una falla de red no equivale a actividad aceptada por el servidor.
      } finally {
        activityInFlight.current = false;
        try {
          if (!confirmed && numberFromStorage(pingKey) === now) {
            localStorage.removeItem(pingKey);
          }
          const lockKey = activityLockStorageKey(activeKind);
          const current = JSON.parse(localStorage.getItem(lockKey) ?? "null") as
            | { owner?: string }
            | null;
          if (current?.owner === owner.current) localStorage.removeItem(lockKey);
        } catch {
          // El throttle sigue evitando una tormenta aunque storage esté limitado.
        }
      }
    }

    function onHumanEvent(event: Event) {
      if (isTrustedHumanActivity(event)) void registerHumanActivity();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void validateOnly();
    }

    function onFocus() {
      void validateOnly();
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== confirmationKey || !event.newValue) return;
      try {
        applyServerTime(JSON.parse(event.newValue) as ActivityResponse, false);
      } catch {
        // Ignorar storage corrupto; conservar la última expiración confirmada.
      }
    }

    const timer = window.setInterval(() => {
      const clock = confirmedClock.current;
      if (clock && isConfirmedSessionExpired(clock, Date.now())) void logout();
    }, 1_000);

    window.addEventListener("pointerdown", onHumanEvent, { passive: true });
    window.addEventListener("keydown", onHumanEvent);
    window.addEventListener("touchstart", onHumanEvent, { passive: true });
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    void validateOnly();

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", onHumanEvent);
      window.removeEventListener("keydown", onHumanEvent);
      window.removeEventListener("touchstart", onHumanEvent);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      confirmedClock.current = null;
    };
  }, [kind, router]);

  return null;
}
