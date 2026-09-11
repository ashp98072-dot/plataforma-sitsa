import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rrhh/colaborador-session", () => ({
  getColaboradorSession: vi.fn(),
  createColaboradorSessionToken: vi.fn(() => Promise.resolve("colab-token")),
  setColaboradorSessionCookie: vi.fn(),
}));

import {
  createColaboradorSessionToken,
  getColaboradorSession,
  setColaboradorSessionCookie,
} from "@/lib/rrhh/colaborador-session";
import { GET, POST } from "./route";

const session = { empleadoId: 2, empresaId: 1, authAt: 1_000, lastActivityAt: 1_500 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getColaboradorSession).mockResolvedValue(session);
});

describe("collaborator activity endpoint", () => {
  it("GET no renueva y POST conserva la sesión validada", async () => {
    expect((await GET()).status).toBe(200);
    expect(setColaboradorSessionCookie).not.toHaveBeenCalled();
    expect((await POST()).status).toBe(200);
    expect(createColaboradorSessionToken).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ renewActivity: true }),
    );
  });
});

