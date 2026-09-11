import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-guard", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/empresas", () => ({
  empresasParaUsuario: vi.fn(),
  obtenerEmpresaPorId: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  createSessionToken: vi.fn(() => Promise.resolve("token-nuevo")),
  setSessionCookie: vi.fn(),
}));

import { requireSession } from "@/lib/api-guard";
import { empresasParaUsuario, obtenerEmpresaPorId } from "@/lib/empresas";
import { createSessionToken, setSessionCookie } from "@/lib/session";
import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/auth/select-empresa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(empresasParaUsuario).mockResolvedValue([{ id: 7, slug: "sitsa", nombre: "SITSA" } as never]);
  vi.mocked(obtenerEmpresaPorId).mockResolvedValue({ id: 7, slug: "sitsa", nombre: "SITSA" } as never);
});

/**
 * SEGURIDAD-SESION-AUTOREFRESCO (Fase 1) — "Cambiar de empresa NO
 * reinicia las 12 horas": select-empresa/route.ts no cambió (el spread
 * `{...guard.user, empresaId, empresaSlug, empresaNombre}` ya arrastra
 * authAt/lastActivityAt tal cual porque ahora forman parte de
 * SessionPayload) — esta prueba confirma ese comportamiento end-to-end,
 * sin necesitar tocar el archivo fuente.
 */
describe("POST /api/auth/select-empresa — preserva authAt/lastActivityAt al cambiar de empresa", () => {
  it("reemite la sesión conservando authAt/lastActivityAt EXACTOS de la sesión actual", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      user: {
        id: 1, username: "hsitan", rol: "Operaciones",
        authAt: 1_700_000_000, lastActivityAt: 1_700_003_000,
      },
    } as never);

    const res = await POST(req({ empresaId: 7 }));
    expect(res.status).toBe(200);
    expect(createSessionToken).toHaveBeenCalledWith(
      expect.objectContaining({
        authAt: 1_700_000_000,
        lastActivityAt: 1_700_003_000,
        empresaId: 7,
        empresaSlug: "sitsa",
        empresaNombre: "SITSA",
      }),
    );
    expect(setSessionCookie).toHaveBeenCalledWith("token-nuevo");
  });

  it("sin acceso a la empresa solicitada -> 403, nunca reemite", async () => {
    vi.mocked(requireSession).mockResolvedValue({
      user: { id: 1, username: "hsitan", rol: "Operaciones", authAt: 1000, lastActivityAt: 1000 },
    } as never);
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);

    const res = await POST(req({ empresaId: 999 }));
    expect(res.status).toBe(403);
    expect(createSessionToken).not.toHaveBeenCalled();
  });
});
