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
  // Import dinámico dentro del test: getAuthSecretBytes lee
  // process.env.AUTH_SECRET en cada llamada, así que no hace falta
  // resetear módulos — pero lo hacemos por higiene entre tests.
  return await import("./session");
}

/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — vigencia de la sesión de staff
 * (`sitsa_session`): cierre por 30 min de inactividad, máximo absoluto de
 * 12h, compatibilidad con tokens heredados (sin authAt/lastActivityAt
 * propios, solo `iat`), y que el cliente nunca pueda imponer estos
 * tiempos por fuera de la firma del JWT. Solo se prueba
 * createSessionToken/verifySessionToken aquí (JWT puro) — readSession()/
 * getSession() además consultan la BD y se prueban donde corresponda
 * (requireSession/requireTenant, no en este archivo).
 */
describe("session.ts — token de sesión de staff", () => {
  it("round-trip: crea y verifica un token, devuelve exactamente lo esperado más authAt === lastActivityAt (login fresco)", async () => {
    const { createSessionToken, verifySessionToken } = await importFresh();
    const token = await createSessionToken({
      id: 1, username: "hsitan", rol: "Operaciones", nombre: "Heber Sitan",
      empresaId: 7, empresaSlug: "sitsa", empresaNombre: "SITSA", accesoTodas: false,
    });
    const payload = await verifySessionToken(token);
    expect(payload).toMatchObject({
      id: 1, username: "hsitan", rol: "Operaciones", nombre: "Heber Sitan",
      empresaId: 7, empresaSlug: "sitsa", empresaNombre: "SITSA", accesoTodas: false,
    });
    expect(payload?.authAt).toBe(payload?.lastActivityAt);
    expect(typeof payload?.authAt).toBe("number");
  });

  it("token sin id/username/rol → inválido", async () => {
    const { verifySessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const tokenIncompleto = await new SignJWT({ empresaId: 7 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(secret);
    expect(await verifySessionToken(tokenIncompleto)).toBeNull();
  });

  it("token firmado con otro secreto → inválido (rechazado por jwtVerify)", async () => {
    const { verifySessionToken } = await importFresh();
    const otroSecreto = new TextEncoder().encode("otro-secreto-distinto-16chars");
    const token = await new SignJWT({ id: 1, username: "hsitan", rol: "Operaciones" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(otroSecreto);
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("authAt/lastActivityAt explícitos se preservan tal cual (reemisión que conserva la sesión — select-empresa, tenant.ts)", async () => {
    const { createSessionToken, verifySessionToken } = await importFresh();
    const now = Math.floor(Date.now() / 1000);
    const authAt = now - 3600; // login fue hace 1 hora
    const lastActivityAt = now - 60; // actividad hace 1 minuto
    const token = await createSessionToken({
      id: 1, username: "hsitan", rol: "Operaciones", authAt, lastActivityAt,
    });
    const payload = await verifySessionToken(token);
    expect(payload?.authAt).toBe(authAt);
    expect(payload?.lastActivityAt).toBe(lastActivityAt);
  });

  it("cambiar de empresa (authAt preservado) NO reinicia el máximo absoluto: el exp sigue calculado desde el authAt ORIGINAL", async () => {
    const { createSessionToken, verifySessionToken } = await importFresh();
    const now = Math.floor(Date.now() / 1000);
    const authAtOriginal = now - 11 * 3600; // sesión con 11h de vida
    // Reemisión típica de select-empresa/route.ts: {...sessionActual, empresaId: nuevo}.
    const token = await createSessionToken({
      id: 1, username: "hsitan", rol: "Operaciones",
      authAt: authAtOriginal, lastActivityAt: now,
      empresaId: 99, empresaSlug: "otra-empresa", empresaNombre: "Otra Empresa",
    });
    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull(); // todavía válida: 11h < 12h
    expect(payload?.authAt).toBe(authAtOriginal); // nunca se reinicia a "ahora"
    expect(payload?.empresaId).toBe(99);
  });

  it("token heredado (sin authAt/lastActivityAt, solo iat reciente) sigue siendo VÁLIDO — puede migrarse tras actividad humana", async () => {
    const { verifySessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const tokenHeredado = await new SignJWT({ id: 1, username: "hsitan", rol: "Operaciones" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt() // iat = ahora
      .setExpirationTime("12h")
      .sign(secret);
    const payload = await verifySessionToken(tokenHeredado);
    expect(payload).not.toBeNull();
    expect(payload?.authAt).toBe(payload?.lastActivityAt); // authAt = lastActivityAt = iat (aproximación heredada)
  });

  it("token heredado con iat de 30 minutos o más → INVÁLIDO (exige contraseña de nuevo)", async () => {
    const { verifySessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const iatHace30Min = Math.floor(Date.now() / 1000) - 30 * 60;
    const tokenHeredadoViejo = await new SignJWT({ id: 1, username: "hsitan", rol: "Operaciones" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(iatHace30Min)
      .setExpirationTime("12h")
      .sign(secret);
    expect(await verifySessionToken(tokenHeredadoViejo)).toBeNull();
  });

  it("token heredado con iat de menos de 30 minutos → VÁLIDO", async () => {
    const { verifySessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const iatHace29Min = Math.floor(Date.now() / 1000) - 29 * 60;
    const tokenHeredadoReciente = await new SignJWT({ id: 1, username: "hsitan", rol: "Operaciones" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(iatHace29Min)
      .setExpirationTime("12h")
      .sign(secret);
    expect(await verifySessionToken(tokenHeredadoReciente)).not.toBeNull();
  });

  it("inactivo por 30 minutos o más (formato nuevo) → INVÁLIDO, aunque el JWT no haya llegado a su exp de 12h", async () => {
    const { createSessionToken, verifySessionToken } = await importFresh();
    const now = Math.floor(Date.now() / 1000);
    const token = await createSessionToken({
      id: 1, username: "hsitan", rol: "Operaciones",
      authAt: now - 3600, lastActivityAt: now - 30 * 60, // 1h de vida, pero 30 min sin actividad
    });
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("12 horas o más desde authAt (aunque haya actividad reciente) → INVÁLIDO", async () => {
    const { createSessionToken, verifySessionToken } = await importFresh();
    const now = Math.floor(Date.now() / 1000);
    // exp se calcula desde authAt=now-12h -> ya pasó -> jwtVerify ya lo
    // rechazaría por sí solo; esta prueba confirma que efectivamente se
    // rechaza (defensa en profundidad: exp Y el chequeo de vigencia
    // explícito coinciden).
    const token = await createSessionToken({
      id: 1, username: "hsitan", rol: "Operaciones",
      authAt: now - 12 * 3600, lastActivityAt: now,
    });
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("el cliente NUNCA puede imponer authAt/lastActivityAt/exp fuera de la firma: un JWT forjado sin la firma correcta se rechaza igual", async () => {
    const { verifySessionToken } = await importFresh();
    const otroSecreto = new TextEncoder().encode("otro-secreto-distinto-16chars");
    const now = Math.floor(Date.now() / 1000);
    const tokenForjado = await new SignJWT({
      id: 1, username: "hsitan", rol: "Admin", authAt: now, lastActivityAt: now,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(now + 999_999)
      .sign(otroSecreto);
    expect(await verifySessionToken(tokenForjado)).toBeNull();
  });

  it("un JWT expirado (exp ya pasado) sigue siendo rechazado por jwtVerify, sin llegar al chequeo de inactividad", async () => {
    const { verifySessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const now = Math.floor(Date.now() / 1000);
    const tokenExpirado = await new SignJWT({
      id: 1, username: "hsitan", rol: "Operaciones", authAt: now, lastActivityAt: now,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(now - 10) // ya expiró
      .sign(secret);
    expect(await verifySessionToken(tokenExpirado)).toBeNull();
  });
});
