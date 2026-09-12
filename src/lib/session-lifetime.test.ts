import { describe, expect, it } from "vitest";
import {
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
  isSessionTimeValid,
  resolveSessionTimes,
  sessionAbsoluteExpiresAt,
} from "./session-lifetime";

describe("session lifetime", () => {
  const authAt = 1_000_000;

  it("acepta 29:59 de inactividad y rechaza exactamente 30:00", () => {
    const times = { authAt, lastActivityAt: authAt };
    expect(isSessionTimeValid(times, authAt + SESSION_IDLE_SECONDS - 1)).toBe(true);
    expect(isSessionTimeValid(times, authAt + SESSION_IDLE_SECONDS)).toBe(false);
  });

  it("acepta 11:59:59 y rechaza exactamente 12:00:00", () => {
    const times = {
      authAt,
      lastActivityAt: authAt + SESSION_ABSOLUTE_SECONDS - 60,
    };
    expect(isSessionTimeValid(times, authAt + SESSION_ABSOLUTE_SECONDS - 1)).toBe(true);
    expect(isSessionTimeValid(times, authAt + SESSION_ABSOLUTE_SECONDS)).toBe(false);
  });

  it("usa iat como fallback para tokens heredados sin mutarlos", () => {
    expect(resolveSessionTimes({ iat: authAt })).toEqual({
      authAt,
      lastActivityAt: authAt,
    });
  });

  it("rechaza tiempos inválidos o actividad anterior a la autenticación", () => {
    expect(resolveSessionTimes({})).toBeNull();
    expect(resolveSessionTimes({ authAt, lastActivityAt: authAt - 1 })).toBeNull();
  });

  it("el vencimiento absoluto nunca supera authAt + 12 horas", () => {
    expect(sessionAbsoluteExpiresAt(authAt)).toBe(authAt + SESSION_ABSOLUTE_SECONDS);
  });
});
