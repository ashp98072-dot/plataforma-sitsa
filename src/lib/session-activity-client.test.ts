import { describe, expect, it } from "vitest";
import {
  ACTIVITY_PING_THROTTLE_MS,
  SESSION_ENDPOINTS,
  activityLockStorageKey,
  activityConfirmationStorageKey,
  activityPingStorageKey,
  sessionKindForPath,
  shouldSendActivityPing,
  isTrustedHumanActivity,
  tryAcquireActivityLock,
  confirmedClockAfterResponse,
  confirmedClockFromServer,
  isConfirmedSessionExpired,
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

  it("normaliza clock skew distinto por pestaña al mismo tiempo del servidor", () => {
    const response = {
      serverNow: 1_000,
      lastActivityAt: 900,
      idleExpiresAt: 2_700,
      absoluteExpiresAt: 40_000,
    };
    const tabAdelantada = confirmedClockFromServer(response, 9_000_000)!;
    const tabAtrasada = confirmedClockFromServer(response, 100_000)!;
    expect(isConfirmedSessionExpired(tabAdelantada, 9_000_000)).toBe(false);
    expect(isConfirmedSessionExpired(tabAtrasada, 100_000)).toBe(false);
    expect(isConfirmedSessionExpired(tabAdelantada, 10_700_000)).toBe(true);
    expect(isConfirmedSessionExpired(tabAtrasada, 1_800_000)).toBe(true);
  });

  it("storage confirmado no mezcla el reloj de la pestaña emisora", () => {
    const fromStorage = {
      serverNow: 5_000,
      lastActivityAt: 4_900,
      idleExpiresAt: 6_700,
      absoluteExpiresAt: 20_000,
    };
    const receiver = confirmedClockFromServer(fromStorage, 50_000_000)!;
    expect(receiver.idleExpiresAtMs).toBe(6_700_000);
    expect(receiver.serverOffsetMs).toBe(5_000_000 - 50_000_000);
    expect(isConfirmedSessionExpired(receiver, 50_000_000)).toBe(false);
  });

  it("POST fallido conserva expiración; respuesta válida sí la actualiza", () => {
    const previous = {
      serverOffsetMs: 0,
      lastActivityAtMs: 1_000_000,
      idleExpiresAtMs: 2_800_000,
      absoluteExpiresAtMs: 40_000_000,
    };
    expect(confirmedClockAfterResponse(previous, null, 1_500_000)).toBe(previous);
    const successful = confirmedClockAfterResponse(
      previous,
      {
        serverNow: 1_500,
        lastActivityAt: 1_500,
        idleExpiresAt: 3_300,
        absoluteExpiresAt: 40_000,
      },
      1_500_000,
    )!;
    expect(successful.lastActivityAtMs).toBe(1_500_000);
    expect(successful.idleExpiresAtMs).toBe(3_300_000);
  });

  it("usa llaves compartidas por tipo para coordinar pestañas", () => {
    expect(activityPingStorageKey("staff")).toBe(activityPingStorageKey("staff"));
    expect(activityLockStorageKey("staff")).toBe(activityLockStorageKey("staff"));
    expect(activityLockStorageKey("staff")).not.toBe(activityLockStorageKey("cliente"));
    expect(activityConfirmationStorageKey("staff")).not.toBe(
      activityConfirmationStorageKey("cliente"),
    );
  });
});
