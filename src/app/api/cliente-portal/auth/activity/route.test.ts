import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/cliente-portal-session", () => ({
  getClienteSession: vi.fn(),
  createClienteSessionToken: vi.fn(() => Promise.resolve("cliente-token")),
  setClienteSessionCookie: vi.fn(),
}));

import {
  createClienteSessionToken,
  getClienteSession,
  setClienteSessionCookie,
} from "@/lib/tms/cliente-portal-session";
import { GET, POST } from "./route";

const session = {
  usuarioClienteId: 3,
  empresaId: 1,
  clienteId: 4,
  authAt: 1_000,
  lastActivityAt: 1_500,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClienteSession).mockResolvedValue(session);
});

describe("customer activity endpoint", () => {
  it("GET no toca cookie", async () => {
    expect((await GET()).status).toBe(200);
    expect(createClienteSessionToken).not.toHaveBeenCalled();
    expect(setClienteSessionCookie).not.toHaveBeenCalled();
  });

  it("POST ignora authAt/lastActivityAt/exp enviados: no recibe body y usa la sesión", async () => {
    expect((await POST()).status).toBe(200);
    expect(createClienteSessionToken).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ renewActivity: true }),
    );
    expect(setClienteSessionCookie).toHaveBeenCalledWith("cliente-token");
  });
});
