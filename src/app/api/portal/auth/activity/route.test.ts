import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/rrhh/colaborador-session", () => ({
  COLABORADOR_SESSION_COOKIE: "sitsa_colab_session",
  createColaboradorSessionToken: vi.fn(() => Promise.resolve("token-nuevo")),
  setColaboradorSessionCookie: vi.fn(),
  verifyColaboradorSessionToken: vi.fn(),
}));

import { cookies } from "next/headers";
import {
  createColaboradorSessionToken,
  setColaboradorSessionCookie,
  verifyColaboradorSessionToken,
} from "@/lib/rrhh/colaborador-session";
import { GET, POST } from "./route";

function jarConToken(token: string | undefined) {
  return {
    get: vi.fn((name: string) => (name === "sitsa_colab_session" && token ? { value: token } : undefined)),
  };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

/** SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — mismo contrato que auth/activity, ver ese test para el detalle. */
describe("GET /api/portal/auth/activity — valida sin renovar", () => {
  it("sin cookie -> 401, nunca llama a verifyColaboradorSessionToken", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken(undefined) as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(verifyColaboradorSessionToken).not.toHaveBeenCalled();
  });

  it("sesión inválida/expirada -> 401", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken("token-viejo") as never);
    vi.mocked(verifyColaboradorSessionToken).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("sesión vigente -> 200, NUNCA renueva", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken("token-ok") as never);
    vi.mocked(verifyColaboradorSessionToken).mockResolvedValue({
      empleadoId: 42, empresaId: 7, authAt: 1000, lastActivityAt: 1000,
    } as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(createColaboradorSessionToken).not.toHaveBeenCalled();
    expect(setColaboradorSessionCookie).not.toHaveBeenCalled();
  });
});

describe("POST /api/portal/auth/activity — reporta actividad humana real", () => {
  it("sin cookie -> 401, nunca reemite", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken(undefined) as never);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(createColaboradorSessionToken).not.toHaveBeenCalled();
  });

  it("sesión inválida/expirada -> 401, nunca reemite", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken("token-viejo") as never);
    vi.mocked(verifyColaboradorSessionToken).mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(createColaboradorSessionToken).not.toHaveBeenCalled();
  });

  it("sesión vigente -> reemite preservando authAt, actualizando solo lastActivityAt", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken("token-ok") as never);
    vi.mocked(verifyColaboradorSessionToken).mockResolvedValue({
      empleadoId: 42, empresaId: 7, authAt: 1_700_000_000, lastActivityAt: 1_700_000_100,
    } as never);
    const res = await POST();
    expect(res.status).toBe(200);
    const arg = vi.mocked(createColaboradorSessionToken).mock.calls[0][0];
    expect(arg.authAt).toBe(1_700_000_000);
    expect(arg.lastActivityAt).not.toBe(1_700_000_100);
    expect(setColaboradorSessionCookie).toHaveBeenCalledWith("token-nuevo", expect.any(Number));
  });
});
