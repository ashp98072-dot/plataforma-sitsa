import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/cliente-portal-guard", () => ({ requireClienteSession: vi.fn() }));
vi.mock("@/lib/tms/solicitudes-cliente", () => ({ obtenerSolicitudCliente: vi.fn() }));

import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import { obtenerSolicitudCliente } from "@/lib/tms/solicitudes-cliente";
import { GET } from "./route";

const SESSION_A = { usuarioClienteId: 10, empresaId: 7, clienteId: 30, nombre: "Contacto A" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireClienteSession).mockResolvedValue({
    session: SESSION_A,
  } as Awaited<ReturnType<typeof requireClienteSession>>);
});

describe("GET /api/cliente-portal/solicitudes/[id]", () => {
  it("sin sesión → 401", async () => {
    vi.mocked(requireClienteSession).mockResolvedValue({
      error: new Response(null, { status: 401 }),
    } as Awaited<ReturnType<typeof requireClienteSession>>);
    const res = await GET(new Request("http://localhost"), ctx("500"));
    expect(res.status).toBe(401);
    expect(obtenerSolicitudCliente).not.toHaveBeenCalled();
  });

  it("id no numérico → 404 sin consultar (nunca revela nada del formato)", async () => {
    const res = await GET(new Request("http://localhost"), ctx("no-es-un-id"));
    expect(res.status).toBe(404);
    expect(obtenerSolicitudCliente).not.toHaveBeenCalled();
  });

  it("IDOR: solicitud de OTRO cliente (dominio devuelve null) → 404, NUNCA 403 (un 403 confirmaría que el id existe)", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost"), ctx("500"));
    expect(res.status).toBe(404);
    expect(obtenerSolicitudCliente).toHaveBeenCalledWith(7, 30, 500);
  });

  it("solicitud propia → 200 con el detalle", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue({ id: 500, estado: "SOLICITADA" } as never);
    const res = await GET(new Request("http://localhost"), ctx("500"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.solicitud.id).toBe(500);
  });
});
