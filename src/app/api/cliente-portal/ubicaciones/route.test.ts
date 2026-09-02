import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/cliente-portal-guard", () => ({ requireClienteSession: vi.fn() }));
vi.mock("@/lib/tms/cliente-ubicaciones", () => ({ listarUbicacionesCliente: vi.fn() }));

import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import { listarUbicacionesCliente } from "@/lib/tms/cliente-ubicaciones";
import { GET } from "./route";

const SESSION_A = { usuarioClienteId: 10, empresaId: 7, clienteId: 30, nombre: "Contacto A" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireClienteSession).mockResolvedValue({
    session: SESSION_A,
  } as Awaited<ReturnType<typeof requireClienteSession>>);
});

describe("GET /api/cliente-portal/ubicaciones", () => {
  it("sin sesión → 401", async () => {
    vi.mocked(requireClienteSession).mockResolvedValue({
      error: new Response(null, { status: 401 }),
    } as Awaited<ReturnType<typeof requireClienteSession>>);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listarUbicacionesCliente).not.toHaveBeenCalled();
  });

  it("lista con el empresaId+clienteId de la sesión", async () => {
    vi.mocked(listarUbicacionesCliente).mockResolvedValue([]);
    await GET();
    expect(listarUbicacionesCliente).toHaveBeenCalledWith(7, 30);
  });
});
