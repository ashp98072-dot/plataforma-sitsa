import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_LIMIT_SECONDS,
  INACTIVITY_LIMIT_SECONDS,
  absoluteExpirySeconds,
  isLegacyLifetimeClaims,
  isSessionLifetimeExpired,
  legacyLifetimeFromIat,
  resolveSessionLifetime,
} from "./session-lifetime";

const T0 = 1_800_000_000; // ancla arbitraria (segundos desde epoch), solo para legibilidad de los tests.

describe("SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — constantes", () => {
  it("30 minutos de inactividad, 12 horas absolutas", () => {
    expect(INACTIVITY_LIMIT_SECONDS).toBe(30 * 60);
    expect(ABSOLUTE_LIMIT_SECONDS).toBe(12 * 60 * 60);
  });
});

describe("isSessionLifetimeExpired — inactividad (30 min), límite INCLUSIVO", () => {
  it("29:59 de inactividad → sigue VÁLIDA", () => {
    const lifetime = { authAt: T0, lastActivityAt: T0 };
    const now = T0 + 29 * 60 + 59;
    expect(isSessionLifetimeExpired(lifetime, now)).toBe(false);
  });

  it("30:00 exactos de inactividad → INVÁLIDA (exactamente al alcanzar el límite ya expiró)", () => {
    const lifetime = { authAt: T0, lastActivityAt: T0 };
    const now = T0 + 30 * 60;
    expect(isSessionLifetimeExpired(lifetime, now)).toBe(true);
  });

  it("30:01 de inactividad → INVÁLIDA", () => {
    const lifetime = { authAt: T0, lastActivityAt: T0 };
    const now = T0 + 30 * 60 + 1;
    expect(isSessionLifetimeExpired(lifetime, now)).toBe(true);
  });
});

describe("isSessionLifetimeExpired — máximo absoluto (12h), límite INCLUSIVO", () => {
  it("11:59:59 desde authAt (con actividad reciente) → sigue VÁLIDA", () => {
    const now = T0 + 11 * 3600 + 59 * 60 + 59;
    const lifetime = { authAt: T0, lastActivityAt: now }; // actividad al segundo, nunca expira por inactividad en este caso
    expect(isSessionLifetimeExpired(lifetime, now)).toBe(false);
  });

  it("12:00:00 exactas desde authAt → INVÁLIDA aunque haya actividad reciente", () => {
    const now = T0 + 12 * 3600;
    const lifetime = { authAt: T0, lastActivityAt: now };
    expect(isSessionLifetimeExpired(lifetime, now)).toBe(true);
  });

  it("12:00:01 desde authAt → INVÁLIDA", () => {
    const now = T0 + 12 * 3600 + 1;
    const lifetime = { authAt: T0, lastActivityAt: now };
    expect(isSessionLifetimeExpired(lifetime, now)).toBe(true);
  });

  it("el límite absoluto rige aunque la inactividad sea 0 (actividad constante no puede extenderlo)", () => {
    const now = T0 + ABSOLUTE_LIMIT_SECONDS;
    const lifetime = { authAt: T0, lastActivityAt: now };
    expect(isSessionLifetimeExpired(lifetime, now)).toBe(true);
  });
});

describe("isSessionLifetimeExpired — ambos límites combinados", () => {
  it("válida cuando ninguno de los dos límites se alcanzó", () => {
    const lifetime = { authAt: T0, lastActivityAt: T0 + 3600 };
    const now = T0 + 3600 + 60; // 1 min de inactividad, ~1h de vida total
    expect(isSessionLifetimeExpired(lifetime, now)).toBe(false);
  });

  it("inválida si CUALQUIERA de los dos límites se alcanzó, aunque el otro no", () => {
    // Inactividad de 31 min, pero vida total de solo 40 min (lejos de 12h).
    const lifetime = { authAt: T0, lastActivityAt: T0 + 9 * 60 };
    const now = T0 + 40 * 60;
    expect(isSessionLifetimeExpired(lifetime, now)).toBe(true);
  });
});

describe("absoluteExpirySeconds", () => {
  it("siempre authAt + 12h, sin importar lastActivityAt", () => {
    expect(absoluteExpirySeconds(T0)).toBe(T0 + ABSOLUTE_LIMIT_SECONDS);
  });
});

describe("legacyLifetimeFromIat / resolveSessionLifetime — tokens heredados", () => {
  it("legacyLifetimeFromIat usa iat como authAt Y lastActivityAt", () => {
    expect(legacyLifetimeFromIat(T0)).toEqual({ authAt: T0, lastActivityAt: T0 });
  });

  it("resolveSessionLifetime: formato nuevo (authAt+lastActivityAt propios) se usa tal cual, ignora iat", () => {
    const resuelto = resolveSessionLifetime({ authAt: T0, lastActivityAt: T0 + 100, iat: T0 - 999 });
    expect(resuelto).toEqual({ authAt: T0, lastActivityAt: T0 + 100 });
  });

  it("resolveSessionLifetime: formato heredado (sin authAt/lastActivityAt) cae a iat", () => {
    const resuelto = resolveSessionLifetime({ iat: T0 });
    expect(resuelto).toEqual({ authAt: T0, lastActivityAt: T0 });
  });

  it("resolveSessionLifetime: solo authAt sin lastActivityAt (formato a medias) también cae a iat completo, nunca mezcla fuentes", () => {
    const resuelto = resolveSessionLifetime({ authAt: T0 + 500, iat: T0 });
    expect(resuelto).toEqual({ authAt: T0, lastActivityAt: T0 });
  });

  it("resolveSessionLifetime: sin authAt/lastActivityAt/iat → null (sesión no resoluble)", () => {
    expect(resolveSessionLifetime({})).toBeNull();
  });

  it("resolveSessionLifetime: valores no numéricos (posible intento de manipulación) se ignoran como si no vinieran", () => {
    const resuelto = resolveSessionLifetime({ authAt: "9999999999" as unknown, lastActivityAt: "9999999999" as unknown, iat: T0 });
    expect(resuelto).toEqual({ authAt: T0, lastActivityAt: T0 });
  });

  it("un token heredado con iat de hace 30 min o más ya está expirado (exige contraseña de nuevo)", () => {
    const iat = T0;
    const now = T0 + 30 * 60;
    const resuelto = resolveSessionLifetime({ iat });
    expect(resuelto).not.toBeNull();
    expect(isSessionLifetimeExpired(resuelto!, now)).toBe(true);
  });

  it("un token heredado todavía reciente (iat < 30 min) sigue siendo válido — puede migrarse tras actividad humana", () => {
    const iat = T0;
    const now = T0 + 29 * 60;
    const resuelto = resolveSessionLifetime({ iat });
    expect(resuelto).not.toBeNull();
    expect(isSessionLifetimeExpired(resuelto!, now)).toBe(false);
  });

  it("isLegacyLifetimeClaims: true cuando falta authAt o lastActivityAt", () => {
    expect(isLegacyLifetimeClaims({ iat: T0 })).toBe(true);
    expect(isLegacyLifetimeClaims({ authAt: T0, iat: T0 })).toBe(true);
    expect(isLegacyLifetimeClaims({ lastActivityAt: T0, iat: T0 })).toBe(true);
  });

  it("isLegacyLifetimeClaims: false cuando trae authAt Y lastActivityAt (formato nuevo)", () => {
    expect(isLegacyLifetimeClaims({ authAt: T0, lastActivityAt: T0 })).toBe(false);
  });
});
