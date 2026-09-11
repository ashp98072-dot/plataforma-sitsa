import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
  createSessionToken: vi.fn(() => Promise.resolve("renewed-token")),
  setSessionCookie: vi.fn(),
}));

import {
  createSessionToken,
  getSession,
  setSessionCookie,
} from "@/lib/session";
import { GET, POST } from "./route";

const session = {
  id: 1,
  username: "admin",
  rol: "Admin" as const,
  authAt: 1_000,
  lastActivityAt: 1_500,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(session);
});

describe("staff activity endpoint", () => {
  it("GET solo valida y no modifica cookie ni actividad", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(createSessionToken).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it("POST usa tiempos de la sesión y hora del servidor, no datos del cliente", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(createSessionToken).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ renewActivity: true }),
    );
    expect(setSessionCookie).toHaveBeenCalledWith("renewed-token");
  });

  it("sesión inválida devuelve 401 y no puede reemitir token", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    expect(createSessionToken).not.toHaveBeenCalled();
  });
});

