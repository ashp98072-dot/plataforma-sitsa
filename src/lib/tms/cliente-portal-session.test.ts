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
    expect(payload).toEqual({
      usuarioClienteId: 10,
      empresaId: 7,
      clienteId: 30,
      nombre: "Contacto ACME",
      debeCambiarPassword: false,
    });
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
