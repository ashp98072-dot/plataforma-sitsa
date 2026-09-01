import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/cliente-usuarios", () => ({
  verificarCredencialesCliente: vi.fn(),
}));
vi.mock("@/lib/tms/cliente-portal-session", () => ({
  createClienteSessionToken: vi.fn(() => Promise.resolve("token-fake")),
  setClienteSessionCookie: vi.fn(),
}));

import { verificarCredencialesCliente } from "@/lib/tms/cliente-usuarios";
import {
  createClienteSessionToken,
  setClienteSessionCookie,
} from "@/lib/tms/cliente-portal-session";
import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/cliente-portal/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("POST /api/cliente-portal/auth/login", () => {
  it("credenciales válidas → 200, arma la sesión con exactamente empresa/cliente/usuario esperados", async () => {
    vi.mocked(verificarCredencialesCliente).mockResolvedValue({
      usuarioClienteId: 10,
      empresaId: 7,
      clienteId: 30,
      nombre: "Contacto ACME",
      debeCambiarPassword: false,
    });

    const res = await POST(req({ email: "contacto@cliente.com", password: "clave-correcta" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.redirect).toBe("/cliente-portal");

    // 12) la sesión creada trae EXACTAMENTE los 3 identificadores de scope
    // esperados — nunca menos, nunca datos de otro cliente.
    expect(createClienteSessionToken).toHaveBeenCalledWith({
      usuarioClienteId: 10,
      empresaId: 7,
      clienteId: 30,
      nombre: "Contacto ACME",
      debeCambiarPassword: false,
    });
    expect(setClienteSessionCookie).toHaveBeenCalledWith("token-fake");
  });

  it("5) usuario de cliente A solo obtiene el clienteId de cliente A (nunca uno enviado por el body)", async () => {
    vi.mocked(verificarCredencialesCliente).mockResolvedValue({
      usuarioClienteId: 10,
      empresaId: 7,
      clienteId: 30,
      nombre: "Contacto A",
      debeCambiarPassword: false,
    });

    // El body NUNCA trae clienteId/empresaId — el endpoint solo acepta
    // email/password (ver schema de la ruta); aunque alguien intentara
    // enviarlos, no hay ningún campo del schema que los lea.
    await POST(req({ email: "a@cliente.com", password: "clave", empresaId: 999, clienteId: 1 }));
    const payload = vi.mocked(createClienteSessionToken).mock.calls[0][0];
    expect(payload.clienteId).toBe(30);
    expect(payload.empresaId).toBe(7);
  });

  it("credenciales inválidas → 401 con mensaje genérico, sin crear sesión", async () => {
    vi.mocked(verificarCredencialesCliente).mockResolvedValue(null);
    const res = await POST(req({ email: "x@cliente.com", password: "mala" }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Credenciales inválidas.");
    expect(createClienteSessionToken).not.toHaveBeenCalled();
    expect(setClienteSessionCookie).not.toHaveBeenCalled();
  });

  it("body inválido (sin password) → 400 con el mismo mensaje genérico", async () => {
    const res = await POST(req({ email: "x@cliente.com" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Credenciales inválidas.");
  });

  it("debeCambiarPassword=true → redirect a cambiar-password", async () => {
    vi.mocked(verificarCredencialesCliente).mockResolvedValue({
      usuarioClienteId: 10,
      empresaId: 7,
      clienteId: 30,
      nombre: "Contacto ACME",
      debeCambiarPassword: true,
    });
    const res = await POST(req({ email: "contacto@cliente.com", password: "clave" }));
    const data = await res.json();
    expect(data.redirect).toBe("/cliente-portal/cambiar-password");
  });
});
