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
  return await import("./cliente-portal-session");
}

describe("CLIENTE-PORTAL-1 — token de sesión del cliente", () => {
  it("12) round-trip: crea y verifica un token, devuelve exactamente empresa/cliente/usuario esperados", async () => {
    const { createClienteSessionToken, verifyClienteSessionToken } = await importFresh();
    const token = await createClienteSessionToken({
      usuarioClienteId: 10,
      empresaId: 7,
      clienteId: 30,
      nombre: "Contacto ACME",
      debeCambiarPassword: false,
    });
    const payload = await verifyClienteSessionToken(token);
    // SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — authAt/lastActivityAt se
    // agregan automáticamente (login fresco: ambos "ahora"), por eso se
    // verifican por separado en vez de con toEqual estricto.
    expect(payload).toMatchObject({
      usuarioClienteId: 10,
      empresaId: 7,
      clienteId: 30,
      nombre: "Contacto ACME",
      debeCambiarPassword: false,
    });
    expect(payload?.authAt).toEqual(payload?.lastActivityAt);
    expect(typeof payload?.authAt).toBe("number");
  });

  it("token sin usuarioClienteId/empresaId/clienteId → inválido", async () => {
    const { verifyClienteSessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const tokenIncompleto = await new SignJWT({ empresaId: 7 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(secret);
    expect(await verifyClienteSessionToken(tokenIncompleto)).toBeNull();
  });

  it("10) un token con forma de sesión de COLABORADOR (empleadoId, sin usuarioClienteId) NO autentica como cliente", async () => {
    const { verifyClienteSessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    // Mismo secreto (a propósito, ver comentario del módulo), pero forma de
    // payload distinta: esto es exactamente lo que produciría
    // createColaboradorSessionToken({ empleadoId, empresaId, ... }).
    const tokenColaborador = await new SignJWT({
      empleadoId: 42,
      empresaId: 7,
      nombre: "Juan Piloto",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(secret);
    expect(await verifyClienteSessionToken(tokenColaborador)).toBeNull();
  });

  it("11) un token con forma de sesión de STAFF (id/username/rol, sin usuarioClienteId) NO autentica como cliente", async () => {
    const { verifyClienteSessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    // Forma exacta de src/lib/session.ts (SessionPayload de staff).
    const tokenStaff = await new SignJWT({
      id: 1,
      username: "admin",
      rol: "Admin",
      empresaId: 7,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(secret);
    expect(await verifyClienteSessionToken(tokenStaff)).toBeNull();
  });

  it("token firmado con otro secreto → inválido (rechazado por jwtVerify)", async () => {
    const { verifyClienteSessionToken } = await importFresh();
    const otroSecreto = new TextEncoder().encode("otro-secreto-distinto-16chars");
    const token = await new SignJWT({ usuarioClienteId: 10, empresaId: 7, clienteId: 30 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(otroSecreto);
    expect(await verifyClienteSessionToken(token)).toBeNull();
  });
});

/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — vigencia de sesión: cierre por
 * 30 min de inactividad, máximo absoluto de 12h, compatibilidad con
 * tokens heredados (sin authAt/lastActivityAt propios, solo iat), y que
 * el cliente NUNCA pueda imponer estos tiempos por fuera de la firma del
 * JWT. Mismo criterio de prueba que se repite en session.test.ts y
 * colaborador-session.test.ts (las 3 sesiones comparten session-lifetime.ts).
 */
describe("CLIENTE-PORTAL-1 — vigencia de sesión (SEGURIDAD-SESION-AUTOREFRESCO Fase 1)", () => {
  it("un token recién creado trae authAt === lastActivityAt (login fresco)", async () => {
    const { createClienteSessionToken, verifyClienteSessionToken } = await importFresh();
    const token = await createClienteSessionToken({ usuarioClienteId: 10, empresaId: 7, clienteId: 30 });
    const payload = await verifyClienteSessionToken(token);
    expect(payload?.authAt).toBe(payload?.lastActivityAt);
  });

  it("authAt/lastActivityAt explícitos se preservan tal cual (reemisión que conserva la sesión)", async () => {
    const { createClienteSessionToken, verifyClienteSessionToken } = await importFresh();
    const now = Math.floor(Date.now() / 1000);
    const authAt = now - 3600; // login fue hace 1 hora
    const lastActivityAt = now - 60; // actividad hace 1 minuto (dentro de los 30 min)
    const token = await createClienteSessionToken({
      usuarioClienteId: 10, empresaId: 7, clienteId: 30, authAt, lastActivityAt,
    });
    const payload = await verifyClienteSessionToken(token);
    expect(payload?.authAt).toBe(authAt);
    expect(payload?.lastActivityAt).toBe(lastActivityAt);
  });

  it("token heredado (sin authAt/lastActivityAt, solo iat reciente) sigue siendo VÁLIDO — puede migrarse tras actividad humana", async () => {
    const { verifyClienteSessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const tokenHeredado = await new SignJWT({ usuarioClienteId: 10, empresaId: 7, clienteId: 30 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt() // iat = ahora
      .setExpirationTime("12h")
      .sign(secret);
    const payload = await verifyClienteSessionToken(tokenHeredado);
    expect(payload).not.toBeNull();
    expect(payload?.authAt).toBe(payload?.lastActivityAt); // authAt = lastActivityAt = iat (aproximación heredada)
  });

  it("token heredado con iat de 30 minutos o más → INVÁLIDO (exige contraseña de nuevo)", async () => {
    const { verifyClienteSessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const iatHace30Min = Math.floor(Date.now() / 1000) - 30 * 60;
    const tokenHeredadoViejo = await new SignJWT({ usuarioClienteId: 10, empresaId: 7, clienteId: 30 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(iatHace30Min)
      .setExpirationTime("12h")
      .sign(secret);
    expect(await verifyClienteSessionToken(tokenHeredadoViejo)).toBeNull();
  });

  it("inactivo por 30 minutos o más (formato nuevo) → INVÁLIDO, aunque el JWT no haya llegado a su exp de 12h", async () => {
    const { createClienteSessionToken, verifyClienteSessionToken } = await importFresh();
    const now = Math.floor(Date.now() / 1000);
    const token = await createClienteSessionToken({
      usuarioClienteId: 10, empresaId: 7, clienteId: 30,
      authAt: now - 3600, lastActivityAt: now - 30 * 60, // 1h de vida, pero 30 min sin actividad
    });
    expect(await verifyClienteSessionToken(token)).toBeNull();
  });

  it("el cliente NUNCA puede imponer authAt/lastActivityAt/exp fuera de la firma: un JWT con esos claims pero SIN firma válida se rechaza igual", async () => {
    const { verifyClienteSessionToken } = await importFresh();
    const otroSecreto = new TextEncoder().encode("otro-secreto-distinto-16chars");
    const now = Math.floor(Date.now() / 1000);
    // Un atacante que intente forjar un token con authAt/lastActivityAt
    // "recientes" (sesión eternamente fresca) sin conocer AUTH_SECRET
    // sigue siendo rechazado por jwtVerify antes de que la vigencia
    // siquiera se evalúe.
    const tokenForjado = await new SignJWT({
      usuarioClienteId: 10, empresaId: 7, clienteId: 30, authAt: now, lastActivityAt: now,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(now + 999_999)
      .sign(otroSecreto);
    expect(await verifyClienteSessionToken(tokenForjado)).toBeNull();
  });

  it("un JWT expirado (exp ya pasado) sigue siendo rechazado por jwtVerify, sin llegar al chequeo de inactividad", async () => {
    const { verifyClienteSessionToken } = await importFresh();
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const now = Math.floor(Date.now() / 1000);
    const tokenExpirado = await new SignJWT({
      usuarioClienteId: 10, empresaId: 7, clienteId: 30, authAt: now, lastActivityAt: now,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(now - 10) // ya expiró
      .sign(secret);
    expect(await verifyClienteSessionToken(tokenExpirado)).toBeNull();
  });
});
