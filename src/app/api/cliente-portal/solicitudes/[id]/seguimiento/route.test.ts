import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/cliente-portal-guard", () => ({ requireClienteSession: vi.fn() }));
vi.mock("@/lib/tms/cliente-portal-seguimiento", () => ({
  obtenerSeguimientoSolicitudCliente: vi.fn(),
}));

import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import { obtenerSeguimientoSolicitudCliente } from "@/lib/tms/cliente-portal-seguimiento";
import { GET } from "./route";

const SESSION_A = { usuarioClienteId: 10, empresaId: 7, clienteId: 30, nombre: "Contacto A" };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireClienteSession).mockResolvedValue({
    session: SESSION_A,
  } as Awaited<ReturnType<typeof requireClienteSession>>);
});

describe("GET /api/cliente-portal/solicitudes/[id]/seguimiento", () => {
  it("sin sesión → 401, nunca consulta seguimiento", async () => {
    vi.mocked(requireClienteSession).mockResolvedValue({
      error: new Response(null, { status: 401 }) as never,
    } as Awaited<ReturnType<typeof requireClienteSession>>);
    const res = await GET(new Request("http://localhost"), ctx("500"));
    expect(res.status).toBe(401);
    expect(obtenerSeguimientoSolicitudCliente).not.toHaveBeenCalled();
  });

  it("id no numérico → 404, nunca consulta seguimiento", async () => {
    const res = await GET(new Request("http://localhost"), ctx("abc"));
    expect(res.status).toBe(404);
    expect(obtenerSeguimientoSolicitudCliente).not.toHaveBeenCalled();
  });

  it("usa SIEMPRE el empresaId+clienteId de la SESIÓN — el id de la URL es solo el solicitudId", async () => {
    vi.mocked(obtenerSeguimientoSolicitudCliente).mockResolvedValue({
      solicitud: { id: 500 } as never,
      plan: null,
    });
    await GET(new Request("http://localhost"), ctx("500"));
    expect(obtenerSeguimientoSolicitudCliente).toHaveBeenCalledWith(7, 30, 500);
  });

  it("IDOR — cliente A pide una solicitud que no es suya (dominio ya scoped devuelve null) → 404, nunca 403", async () => {
    vi.mocked(obtenerSeguimientoSolicitudCliente).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost"), ctx("999"));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Solicitud no encontrada.");
  });

  it("caso feliz → 200 con { seguimiento }, Cache-Control private/no-store", async () => {
    const seguimiento = { solicitud: { id: 500 } as never, plan: null };
    vi.mocked(obtenerSeguimientoSolicitudCliente).mockResolvedValue(seguimiento);
    const res = await GET(new Request("http://localhost"), ctx("500"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.seguimiento).toEqual(seguimiento);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
