import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";

const ORIGINAL_SECRET = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-de-al-menos-16-caracteres";
});
afterEach(() => {
  process.env.AUTH_SECRET = ORIGINAL_SECRET;
});

async function importFresh() {
  return await import("./colaborador-session");
}

/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — vigencia de la sesión de
 * colaborador (`sitsa_colab_session`): mismo criterio EXACTO que
 * session.test.ts (staff) y cliente-portal-session.test.ts (cliente) —
 * las 3 sesiones comparten session-lifetime.ts.
 */
describe("colaborador-session.ts — token de sesión del colaborador", () => {
  it("round-trip: crea y verifica un token, devuelve exactamente lo esperado más authAt === lastActivityAt (login fresco)", async () => {
    const { createColaboradorSessionToken, verifyColaboradorSessionToken } = await importFresh();
    const token = await createColaboradorSessionToken({
      empleadoId: 42, empresaId: 7, empresaSlug: "sitsa", nombre: "Juan Piloto", debeCambiarPassword: false,
    });
    const payload = await verifyColaboradorSessionToken(token);
    expect(payload).toMatchObject({
      empleadoId: 42, empresaId: 7, empresaSlug: "sitsa", nombre: "Juan Piloto", debeCambiarPassword: false,
    });
    expect(payload?.authAt).toBe(payload?.lastActivityAt);
    expect(typeof payload?.authAt).toBe("number");
  });

  it("token sin empleadoId/empresaId → inválido", async () => {
    const { verifyColaboradorSessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const tokenIncompleto = await new SignJWT({ nombre: "Sin ids" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(secret);
    expect(await verifyColaboradorSessionToken(tokenIncompleto)).toBeNull();
  });

  it("token firmado con otro secreto → inválido (rechazado por jwtVerify)", async () => {
    const { verifyColaboradorSessionToken } = await importFresh();
    const otroSecreto = new TextEncoder().encode("otro-secreto-distinto-16chars");
    const token = await new SignJWT({ empleadoId: 42, empresaId: 7 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(otroSecreto);
    expect(await verifyColaboradorSessionToken(token)).toBeNull();
  });

  it("authAt/lastActivityAt explícitos se preservan tal cual", async () => {
    const { createColaboradorSessionToken, verifyColaboradorSessionToken } = await importFresh();
    const now = Math.floor(Date.now() / 1000);
    const authAt = now - 3600;
    const lastActivityAt = now - 60;
    const token = await createColaboradorSessionToken({
      empleadoId: 42, empresaId: 7, authAt, lastActivityAt,
    });
    const payload = await verifyColaboradorSessionToken(token);
    expect(payload?.authAt).toBe(authAt);
    expect(payload?.lastActivityAt).toBe(lastActivityAt);
  });

  it("token heredado (sin authAt/lastActivityAt, solo iat reciente) sigue siendo VÁLIDO — puede migrarse tras actividad humana", async () => {
    const { verifyColaboradorSessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const tokenHeredado = await new SignJWT({ empleadoId: 42, empresaId: 7 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(secret);
    const payload = await verifyColaboradorSessionToken(tokenHeredado);
    expect(payload).not.toBeNull();
    expect(payload?.authAt).toBe(payload?.lastActivityAt);
  });

  it("token heredado con iat de 30 minutos o más → INVÁLIDO (exige contraseña de nuevo)", async () => {
    const { verifyColaboradorSessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const iatHace30Min = Math.floor(Date.now() / 1000) - 30 * 60;
    const tokenHeredadoViejo = await new SignJWT({ empleadoId: 42, empresaId: 7 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(iatHace30Min)
      .setExpirationTime("12h")
      .sign(secret);
    expect(await verifyColaboradorSessionToken(tokenHeredadoViejo)).toBeNull();
  });

  it("inactivo por 30 minutos o más (formato nuevo) → INVÁLIDO, aunque el JWT no haya llegado a su exp de 12h", async () => {
    const { createColaboradorSessionToken, verifyColaboradorSessionToken } = await importFresh();
    const now = Math.floor(Date.now() / 1000);
    const token = await createColaboradorSessionToken({
      empleadoId: 42, empresaId: 7,
      authAt: now - 3600, lastActivityAt: now - 30 * 60,
    });
    expect(await verifyColaboradorSessionToken(token)).toBeNull();
  });

  it("el cliente NUNCA puede imponer authAt/lastActivityAt/exp fuera de la firma", async () => {
    const { verifyColaboradorSessionToken } = await importFresh();
    const otroSecreto = new TextEncoder().encode("otro-secreto-distinto-16chars");
    const now = Math.floor(Date.now() / 1000);
    const tokenForjado = await new SignJWT({
      empleadoId: 42, empresaId: 7, authAt: now, lastActivityAt: now,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(now + 999_999)
      .sign(otroSecreto);
    expect(await verifyColaboradorSessionToken(tokenForjado)).toBeNull();
  });

  it("un JWT expirado (exp ya pasado) sigue siendo rechazado por jwtVerify", async () => {
    const { verifyColaboradorSessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const now = Math.floor(Date.now() / 1000);
    const tokenExpirado = await new SignJWT({
      empleadoId: 42, empresaId: 7, authAt: now, lastActivityAt: now,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(now - 10)
      .sign(secret);
    expect(await verifyColaboradorSessionToken(tokenExpirado)).toBeNull();
  });
});
