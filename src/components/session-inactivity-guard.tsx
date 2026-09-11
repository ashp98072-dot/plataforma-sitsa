"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  SESSION_ENDPOINTS,
  activityLockStorageKey,
  activityPingStorageKey,
  activityStorageKey,
  sessionKindForPath,
  shouldSendActivityPing,
  isTrustedHumanActivity,
  tryAcquireActivityLock,
  type SessionKind,
} from "@/lib/session-activity-client";
import { SESSION_IDLE_SECONDS } from "@/lib/session-lifetime";

type ActivityResponse = {
  serverNow: number;
  lastActivityAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
};

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
  const requestInFlight = useRef(false);
  const owner = useRef("");
  const serverOffsetMs = useRef(0);
  const idleExpiresAtMs = useRef(0);

  useEffect(() => {
    if (!kind) return;
    const activeKind = kind;
    owner.current ||= globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    loggingOut.current = false;
    requestInFlight.current = false;

    const endpoints = SESSION_ENDPOINTS[activeKind];
    const humanKey = activityStorageKey(activeKind);
    const pingKey = activityPingStorageKey(activeKind);

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

    function applyServerTime(data: ActivityResponse) {
      const receivedAt = Date.now();
      serverOffsetMs.current = data.serverNow * 1000 - receivedAt;
      idleExpiresAtMs.current = data.idleExpiresAt * 1000;
      localStorage.setItem(humanKey, String(data.lastActivityAt * 1000));
    }

    async function validateOnly() {
      if (requestInFlight.current || loggingOut.current) return;
      requestInFlight.current = true;
      try {
        const response = await fetch(endpoints.activity, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.status === 401) return void logout();
        if (response.ok) applyServerTime((await response.json()) as ActivityResponse);
      } finally {
        requestInFlight.current = false;
      }
    }

    async function registerHumanActivity() {
      const now = Date.now();
      localStorage.setItem(humanKey, String(now));
      idleExpiresAtMs.current =
        now + serverOffsetMs.current + SESSION_IDLE_SECONDS * 1000;
      const lastPing = numberFromStorage(pingKey);
      if (!shouldSendActivityPing(lastPing, now)) return;
      if (!acquireCrossTabLock(activeKind, owner.current, now)) return;
      // Se reserva la ventana antes del fetch para agrupar eventos y pestañas.
      localStorage.setItem(pingKey, String(now));
      if (requestInFlight.current || loggingOut.current) return;
      requestInFlight.current = true;
      try {
        const response = await fetch(endpoints.activity, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.status === 401) return void logout();
        if (response.ok) applyServerTime((await response.json()) as ActivityResponse);
      } finally {
        requestInFlight.current = false;
        try {
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
      if (event.key !== humanKey || !event.newValue) return;
      const humanAt = Number(event.newValue);
      if (Number.isFinite(humanAt)) {
        idleExpiresAtMs.current = humanAt + SESSION_IDLE_SECONDS * 1000;
      }
    }

    const timer = window.setInterval(() => {
      if (!idleExpiresAtMs.current) return;
      const authoritativeApproxNow = Date.now() + serverOffsetMs.current;
      if (authoritativeApproxNow >= idleExpiresAtMs.current) void logout();
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
    };
  }, [kind, router]);

  return null;
}
