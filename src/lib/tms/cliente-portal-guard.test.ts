import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/cliente-portal-session", () => ({
  getClienteSession: vi.fn(),
}));
vi.mock("@/lib/tms/cliente-usuarios", () => ({
  validarClienteSessionActiva: vi.fn(),
}));

import { getClienteSession } from "@/lib/tms/cliente-portal-session";
import { validarClienteSessionActiva } from "@/lib/tms/cliente-usuarios";
import { requireClienteSession } from "./cliente-portal-guard";

const SESSION = {
  usuarioClienteId: 10,
  empresaId: 7,
  clienteId: 30,
  nombre: "Contacto ACME",
  debeCambiarPassword: false,
};

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("requireClienteSession — AJUSTE PRE-MERGE PR #167 (punto 4)", () => {
  it("sin cookie/JWT → 401 'No autenticado.', NUNCA llega a consultar la base de datos", async () => {
    vi.mocked(getClienteSession).mockResolvedValue(null);
    const r = await requireClienteSession();
    expect(r.error?.status).toBe(401);
    const data = await r.error!.json();
    expect(data.error).toBe("No autenticado.");
    expect(validarClienteSessionActiva).not.toHaveBeenCalled();
  });

  it("1) JWT válido + usuario activo + cliente activo (validación DB ok) → permitido, devuelve la sesión", async () => {
    vi.mocked(getClienteSession).mockResolvedValue(SESSION);
    vi.mocked(validarClienteSessionActiva).mockResolvedValue(true);
    const r = await requireClienteSession();
    expect(r.error).toBeUndefined();
    expect(r.session).toEqual(SESSION);
    expect(validarClienteSessionActiva).toHaveBeenCalledWith(SESSION);
  });

  it("2)/3) JWT válido pero la validación DB falla (usuario o cliente desactivado después del login) → 401 'Sesión inválida.', NO se confía solo en la firma del JWT", async () => {
    vi.mocked(getClienteSession).mockResolvedValue(SESSION);
    vi.mocked(validarClienteSessionActiva).mockResolvedValue(false);
    const r = await requireClienteSession();
    expect(r.session).toBeUndefined();
    expect(r.error?.status).toBe(401);
    const data = await r.error!.json();
    expect(data.error).toBe("Sesión inválida.");
  });
});
