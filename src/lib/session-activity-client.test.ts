import { describe, expect, it } from "vitest";
import {
  ACTIVITY_PING_THROTTLE_MS,
  SESSION_ENDPOINTS,
  activityLockStorageKey,
  activityPingStorageKey,
  sessionKindForPath,
  shouldSendActivityPing,
  isTrustedHumanActivity,
  tryAcquireActivityLock,
} from "./session-activity-client";

describe("session inactivity client policy", () => {
  it("separa los tres portales y sus rutas de login", () => {
    expect(sessionKindForPath("/e/kt/dashboard")).toBe("staff");
    expect(sessionKindForPath("/portal/viajes")).toBe("colaborador");
    expect(sessionKindForPath("/cliente-portal/solicitudes")).toBe("cliente");
    expect(SESSION_ENDPOINTS.staff.login).toBe("/login");
    expect(SESSION_ENDPOINTS.colaborador.login).toBe("/portal/login");
    expect(SESSION_ENDPOINTS.cliente.login).toBe("/cliente-portal/login");
  });

  it("no activa el guard en rutas públicas o de login", () => {
    expect(sessionKindForPath("/login")).toBeNull();
    expect(sessionKindForPath("/portal/login")).toBeNull();
    expect(sessionKindForPath("/cliente-portal/login")).toBeNull();
    expect(sessionKindForPath("/site")).toBeNull();
    expect(sessionKindForPath("/")).toBeNull();
  });

  it("agrupa eventos rápidos dentro de una ventana de un minuto", () => {
    const now = 2_000_000;
    expect(shouldSendActivityPing(0, now)).toBe(true);
    expect(shouldSendActivityPing(now, now + ACTIVITY_PING_THROTTLE_MS - 1)).toBe(false);
    expect(shouldSendActivityPing(now, now + ACTIVITY_PING_THROTTLE_MS)).toBe(true);
  });

  it("solo acepta pointer, teclado o touch confiables como actividad humana", () => {
    expect(isTrustedHumanActivity({ type: "pointerdown", isTrusted: true })).toBe(true);
    expect(isTrustedHumanActivity({ type: "keydown", isTrusted: true })).toBe(true);
    expect(isTrustedHumanActivity({ type: "touchstart", isTrusted: true })).toBe(true);
    expect(isTrustedHumanActivity({ type: "pointerdown", isTrusted: false })).toBe(false);
    expect(isTrustedHumanActivity({ type: "focus", isTrusted: true })).toBe(false);
    expect(isTrustedHumanActivity({ type: "visibilitychange", isTrusted: true })).toBe(false);
    expect(isTrustedHumanActivity({ type: "mousemove", isTrusted: true })).toBe(false);
  });

  it("dos pestañas comparten un lock y no reservan la misma ventana", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    expect(tryAcquireActivityLock(storage, "staff", "tab-a", 10_000)).toBe(true);
    expect(tryAcquireActivityLock(storage, "staff", "tab-b", 10_001)).toBe(false);
    expect(tryAcquireActivityLock(storage, "staff", "tab-b", 25_000)).toBe(true);
  });

  it("usa llaves compartidas por tipo para coordinar pestañas", () => {
    expect(activityPingStorageKey("staff")).toBe(activityPingStorageKey("staff"));
    expect(activityLockStorageKey("staff")).toBe(activityLockStorageKey("staff"));
    expect(activityLockStorageKey("staff")).not.toBe(activityLockStorageKey("cliente"));
  });
});
