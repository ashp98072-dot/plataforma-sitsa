import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "sitsa_session",
  createSessionToken: vi.fn(() => Promise.resolve("token-nuevo")),
  setSessionCookie: vi.fn(),
  verifySessionToken: vi.fn(),
}));

import { cookies } from "next/headers";
import {
  createSessionToken,
  setSessionCookie,
  verifySessionToken,
} from "@/lib/session";
import { GET, POST } from "./route";

function jarConToken(token: string | undefined) {
  return {
    get: vi.fn((name: string) => (name === "sitsa_session" && token ? { value: token } : undefined)),
  };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — GET valida sin renovar; POST
 * reporta actividad humana real y renueva `lastActivityAt` preservando
 * `authAt`. Ambos delegan la vigencia (inactividad/máximo absoluto/firma)
 * ÍNTEGRAMENTE a verifySessionToken — nunca reimplementan ese chequeo
 * aquí, así que un token inválido para verifySessionToken es 401 en
 * ambos métodos sin excepción.
 */
describe("GET /api/auth/activity — valida sin renovar", () => {
  it("sin cookie -> 401, nunca llama a verifySessionToken", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken(undefined) as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(verifySessionToken).not.toHaveBeenCalled();
  });

  it("sesión inválida/expirada (verifySessionToken -> null) -> 401", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken("token-viejo") as never);
    vi.mocked(verifySessionToken).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.vigente).toBe(false);
  });

  it("sesión vigente -> 200, NUNCA llama a createSessionToken/setSessionCookie (no renueva)", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken("token-ok") as never);
    vi.mocked(verifySessionToken).mockResolvedValue({
      id: 1, username: "hsitan", rol: "Operaciones", authAt: 1000, lastActivityAt: 1000,
    } as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vigente).toBe(true);
    expect(createSessionToken).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/activity — reporta actividad humana real", () => {
  it("sin cookie -> 401, nunca reemite", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken(undefined) as never);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(createSessionToken).not.toHaveBeenCalled();
  });

  it("sesión inválida/expirada -> 401, nunca reemite (nunca extiende una sesión ya expirada)", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken("token-viejo") as never);
    vi.mocked(verifySessionToken).mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(createSessionToken).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it("sesión vigente -> reemite preservando authAt y TODA la identidad, actualizando solo lastActivityAt", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken("token-ok") as never);
    vi.mocked(verifySessionToken).mockResolvedValue({
      id: 1, username: "hsitan", rol: "Operaciones", empresaId: 7,
      authAt: 1_700_000_000, lastActivityAt: 1_700_000_100,
    } as never);
    const res = await POST();
    expect(res.status).toBe(200);
    expect(createSessionToken).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(createSessionToken).mock.calls[0][0];
    expect(arg.authAt).toBe(1_700_000_000); // preservado tal cual
    expect(arg.lastActivityAt).not.toBe(1_700_000_100); // se actualizó
    expect(arg.id).toBe(1);
    expect(arg.empresaId).toBe(7);
    expect(setSessionCookie).toHaveBeenCalledWith("token-nuevo", expect.any(Number));
  });

  it("el body de la request NUNCA se lee (POST no acepta ni confía en ningún dato del cliente)", async () => {
    vi.mocked(cookies).mockResolvedValue(jarConToken("token-ok") as never);
    vi.mocked(verifySessionToken).mockResolvedValue({
      id: 1, username: "hsitan", rol: "Operaciones", authAt: 1000, lastActivityAt: 1000,
    } as never);
    // POST() no recibe ni un Request como parámetro — la propia firma de
    // la función es la prueba: no hay forma de que lea authAt/
    // lastActivityAt/exp de un body.
    const res = await POST();
    expect(res.status).toBe(200);
  });
});
