import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/tms/cliente-portal-session", () => ({
  CLIENTE_SESSION_COOKIE: "sitsa_cliente_session",
  createClienteSessionToken: vi.fn(() => Promise.resolve("token-nuevo")),
  setClienteSessionCookie: vi.fn(),
  verifyClienteSessionToken: vi.fn(),
}));

import { cookies } from "next/headers";
import {
  createClienteSessionToken,
  setClienteSessionCookie,
  verifyClienteSessionToken,
} from "@/lib/tms/cliente-portal-session";
import { GET, POST } from "./route";

function jarConToken(token: string | undefined) {
  return {
    get: vi.fn((name: string) => (name === "sitsa_cliente_session" && token ? { value: token } : undefined)),
  };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

/** SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — mismo contrato que auth/activity, ver ese test para el detalle. */
describe("GET /api/cliente-portal/auth/activity — valida sin renovar", () => {
  it("sin cookie -> 401, nunca llama a verifyClienteSessionToken", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken(undefined) as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(verifyClienteSessionToken).not.toHaveBeenCalled();
  });

  it("sesión inválida/expirada -> 401", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken("token-viejo") as never);
    vi.mocked(verifyClienteSessionToken).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("sesión vigente -> 200, NUNCA renueva", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken("token-ok") as never);
    vi.mocked(verifyClienteSessionToken).mockResolvedValue({
      usuarioClienteId: 10, empresaId: 7, clienteId: 30, authAt: 1000, lastActivityAt: 1000,
    } as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(createClienteSessionToken).not.toHaveBeenCalled();
    expect(setClienteSessionCookie).not.toHaveBeenCalled();
  });
});

describe("POST /api/cliente-portal/auth/activity — reporta actividad humana real", () => {
  it("sin cookie -> 401, nunca reemite", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken(undefined) as never);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(createClienteSessionToken).not.toHaveBeenCalled();
  });

  it("sesión inválida/expirada -> 401, nunca reemite", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken("token-viejo") as never);
    vi.mocked(verifyClienteSessionToken).mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(createClienteSessionToken).not.toHaveBeenCalled();
  });

  it("sesión vigente -> reemite preservando authAt, actualizando solo lastActivityAt", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken("token-ok") as never);
    vi.mocked(verifyClienteSessionToken).mockResolvedValue({
      usuarioClienteId: 10, empresaId: 7, clienteId: 30, authAt: 1_700_000_000, lastActivityAt: 1_700_000_100,
    } as never);
    const res = await POST();
    expect(res.status).toBe(200);
    const arg = vi.mocked(createClienteSessionToken).mock.calls[0][0];
    expect(arg.authAt).toBe(1_700_000_000);
    expect(arg.lastActivityAt).not.toBe(1_700_000_100);
    expect(setClienteSessionCookie).toHaveBeenCalledWith("token-nuevo", expect.any(Number));
  });
});
