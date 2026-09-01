import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/cliente-usuarios", () => ({
  cambiarPasswordCliente: vi.fn(),
}));
vi.mock("@/lib/tms/cliente-portal-guard", () => ({
  requireClienteSession: vi.fn(),
}));
vi.mock("@/lib/tms/cliente-portal-session", () => ({
  createClienteSessionToken: vi.fn(() => Promise.resolve("token-nuevo")),
  setClienteSessionCookie: vi.fn(),
}));

import { cambiarPasswordCliente } from "@/lib/tms/cliente-usuarios";
import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import {
  createClienteSessionToken,
  setClienteSessionCookie,
} from "@/lib/tms/cliente-portal-session";
import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/cliente-portal/auth/cambiar-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireClienteSession).mockResolvedValue({
    session: {
      usuarioClienteId: 10,
      empresaId: 7,
      clienteId: 30,
      nombre: "Contacto ACME",
      debeCambiarPassword: true,
    },
  } as Awaited<ReturnType<typeof requireClienteSession>>);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/cliente-portal/auth/cambiar-password", () => {
  it("sin sesión → 401, no llama a cambiarPasswordCliente", async () => {
    vi.mocked(requireClienteSession).mockResolvedValue({
      error: new Response(JSON.stringify({ error: "No autenticado." }), { status: 401 }) as never,
    } as Awaited<ReturnType<typeof requireClienteSession>>);
    const res = await POST(req({ passwordActual: "a", passwordNueva: "nueva123" }));
    expect(res.status).toBe(401);
    expect(cambiarPasswordCliente).not.toHaveBeenCalled();
  });

  it("9) cambio exitoso → reemite el token con debeCambiarPassword=false", async () => {
    vi.mocked(cambiarPasswordCliente).mockResolvedValue({ ok: true, mensaje: "Contraseña actualizada." });
    const res = await POST(req({ passwordActual: "actual123", passwordNueva: "nueva123" }));
    expect(res.status).toBe(200);
    expect(cambiarPasswordCliente).toHaveBeenCalledWith(10, "actual123", "nueva123");
    expect(createClienteSessionToken).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioClienteId: 10, debeCambiarPassword: false }),
    );
    expect(setClienteSessionCookie).toHaveBeenCalledWith("token-nuevo");
  });

  it("contraseña actual incorrecta → 400, no reemite token", async () => {
    vi.mocked(cambiarPasswordCliente).mockResolvedValue({
      ok: false,
      mensaje: "La contraseña actual no es correcta.",
    });
    const res = await POST(req({ passwordActual: "mala", passwordNueva: "nueva123" }));
    expect(res.status).toBe(400);
    expect(createClienteSessionToken).not.toHaveBeenCalled();
  });

  it("nueva contraseña corta → 400 antes de llamar a cambiarPasswordCliente", async () => {
    const res = await POST(req({ passwordActual: "actual123", passwordNueva: "abc" }));
    expect(res.status).toBe(400);
    expect(cambiarPasswordCliente).not.toHaveBeenCalled();
  });
});
