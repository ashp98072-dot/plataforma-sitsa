import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeJwt, SignJWT } from "jose";
import { SESSION_ABSOLUTE_SECONDS, SESSION_IDLE_SECONDS } from "./session-lifetime";
import { createSessionToken, verifySessionToken } from "./session";
import {
  createColaboradorSessionToken,
  verifyColaboradorSessionToken,
} from "./rrhh/colaborador-session";
import {
  createClienteSessionToken,
  verifyClienteSessionToken,
} from "./tms/cliente-portal-session";

const ORIGINAL_SECRET = process.env.AUTH_SECRET;
const NOW = 2_000_000_000;

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-de-al-menos-16-caracteres";
  vi.setSystemTime(new Date(NOW * 1000));
});

afterEach(() => {
  process.env.AUTH_SECRET = ORIGINAL_SECRET;
  vi.useRealTimers();
});

describe("session tokens with idle and absolute lifetime", () => {
  it("staff, colaborador y cliente nacen con tiempos controlados por servidor", async () => {
    const tokens = await Promise.all([
      createSessionToken({ id: 1, username: "admin", rol: "Admin" }),
      createColaboradorSessionToken({ empleadoId: 2, empresaId: 1 }),
      createClienteSessionToken({ usuarioClienteId: 3, empresaId: 1, clienteId: 4 }),
    ]);
    for (const token of tokens) {
      const claims = decodeJwt(token);
      expect(claims.authAt).toBe(NOW);
      expect(claims.lastActivityAt).toBe(NOW);
      expect(claims.exp).toBe(NOW + SESSION_ABSOLUTE_SECONDS);
    }
  });

  it("renovar actividad conserva authAt y nunca extiende exp", async () => {
    const authAt = NOW - 600;
    const token = await createSessionToken(
      { id: 1, username: "admin", rol: "Admin", authAt, lastActivityAt: NOW - 100 },
      { renewActivity: true, nowSeconds: NOW },
    );
    const claims = decodeJwt(token);
    expect(claims.authAt).toBe(authAt);
    expect(claims.lastActivityAt).toBe(NOW);
    expect(claims.exp).toBe(authAt + SESSION_ABSOLUTE_SECONDS);
  });

  it("tokens heredados usan iat: 29:59 válido y 30:00 inválido", async () => {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const legacy = async (iat: number) =>
      new SignJWT({ id: 1, username: "admin", rol: "Admin" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(iat)
        .setExpirationTime(iat + SESSION_ABSOLUTE_SECONDS)
        .sign(secret);
    expect(await verifySessionToken(await legacy(NOW - SESSION_IDLE_SECONDS + 1))).not.toBeNull();
    expect(await verifySessionToken(await legacy(NOW - SESSION_IDLE_SECONDS))).toBeNull();
  });

  it("los tres verificadores usan el mismo límite temporal", async () => {
    const oldActivity = NOW - SESSION_IDLE_SECONDS;
    expect(await verifySessionToken(await createSessionToken({ id: 1, username: "a", rol: "Admin", authAt: NOW - 3600, lastActivityAt: oldActivity }, { nowSeconds: NOW }))).toBeNull();
    expect(await verifyColaboradorSessionToken(await createColaboradorSessionToken({ empleadoId: 2, empresaId: 1, authAt: NOW - 3600, lastActivityAt: oldActivity }, { nowSeconds: NOW }))).toBeNull();
    expect(await verifyClienteSessionToken(await createClienteSessionToken({ usuarioClienteId: 3, empresaId: 1, clienteId: 4, authAt: NOW - 3600, lastActivityAt: oldActivity }, { nowSeconds: NOW }))).toBeNull();
  });
});

