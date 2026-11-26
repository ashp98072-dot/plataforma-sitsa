import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/cliente-portal-session", () => ({
  getClienteSession: vi.fn(),
}));
vi.mock("@/lib/tms/cliente-usuarios", () => ({
  validarClienteSessionActiva: vi.fn(),
  esUsuarioClienteSoloLectura: vi.fn(),
}));

import { getClienteSession } from "@/lib/tms/cliente-portal-session";
import { esUsuarioClienteSoloLectura, validarClienteSessionActiva } from "@/lib/tms/cliente-usuarios";
import { requireClienteEscritura, requireClienteSession } from "./cliente-portal-guard";

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

describe("requireClienteEscritura — acceso de SOLO CONSULTA (p. ej. PriceSmart)", () => {
  it("cuenta normal activa → permitido (devuelve la sesión)", async () => {
    vi.mocked(getClienteSession).mockResolvedValue(SESSION);
    vi.mocked(validarClienteSessionActiva).mockResolvedValue(true);
    vi.mocked(esUsuarioClienteSoloLectura).mockResolvedValue(false);
    const r = await requireClienteEscritura();
    expect(r.error).toBeUndefined(); expect(r.session).toEqual(SESSION);
    expect(esUsuarioClienteSoloLectura).toHaveBeenCalledWith(SESSION);   // la marca se lee de la fila real con los 3 identificadores de la sesión
  });
  it("cuenta de solo consulta → 403 'Tu acceso es de solo consulta.'", async () => {
    vi.mocked(getClienteSession).mockResolvedValue(SESSION);
    vi.mocked(validarClienteSessionActiva).mockResolvedValue(true);
    vi.mocked(esUsuarioClienteSoloLectura).mockResolvedValue(true);
    const r = await requireClienteEscritura();
    expect(r.error?.status).toBe(403); expect((await r.error!.json()).error).toBe("Tu acceso es de solo consulta."); expect(r.session).toBeUndefined();
  });
  it("sin sesión o sesión revocada → 401 y NO se consulta la marca de solo consulta; si la consulta falla, el error se propaga (no se concede por defecto)", async () => {
    vi.mocked(getClienteSession).mockResolvedValue(null);
    expect((await requireClienteEscritura()).error?.status).toBe(401);
    vi.mocked(getClienteSession).mockResolvedValue(SESSION); vi.mocked(validarClienteSessionActiva).mockResolvedValue(false);
    expect((await requireClienteEscritura()).error?.status).toBe(401);
    expect(esUsuarioClienteSoloLectura).not.toHaveBeenCalled();
    vi.mocked(validarClienteSessionActiva).mockResolvedValue(true); vi.mocked(esUsuarioClienteSoloLectura).mockRejectedValue(new Error("db caída"));
    await expect(requireClienteEscritura()).rejects.toThrow("db caída");
  });
});
