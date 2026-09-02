import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/cliente-portal-guard", () => ({ requireClienteSession: vi.fn() }));
vi.mock("@/lib/tms/cliente-portal-seguimiento", () => ({
  obtenerEvidenciasParadaCliente: vi.fn(),
}));

import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import { obtenerEvidenciasParadaCliente } from "@/lib/tms/cliente-portal-seguimiento";
import { GET } from "./route";

const SESSION_A = { usuarioClienteId: 10, empresaId: 7, clienteId: 30, nombre: "Contacto A" };

function ctx(id: string, paradaId: string) {
  return { params: Promise.resolve({ id, paradaId }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireClienteSession).mockResolvedValue({
    session: SESSION_A,
  } as Awaited<ReturnType<typeof requireClienteSession>>);
});

describe("GET /api/cliente-portal/solicitudes/[id]/paradas/[paradaId]/evidencias", () => {
  it("sin sesión → 401", async () => {
    vi.mocked(requireClienteSession).mockResolvedValue({
      error: new Response(null, { status: 401 }) as never,
    } as Awaited<ReturnType<typeof requireClienteSession>>);
    const res = await GET(new Request("http://localhost"), ctx("500", "1"));
    expect(res.status).toBe(401);
    expect(obtenerEvidenciasParadaCliente).not.toHaveBeenCalled();
  });

  it("id/paradaId no numéricos → 404", async () => {
    const res = await GET(new Request("http://localhost"), ctx("abc", "1"));
    expect(res.status).toBe(404);
    expect(obtenerEvidenciasParadaCliente).not.toHaveBeenCalled();
  });

  it("resuelve empresaId/clienteId de LA SESIÓN y solicitudId/paradaId de la URL, nunca al revés", async () => {
    vi.mocked(obtenerEvidenciasParadaCliente).mockResolvedValue([]);
    await GET(new Request("http://localhost"), ctx("500", "42"));
    expect(obtenerEvidenciasParadaCliente).toHaveBeenCalledWith(7, 30, 500, 42);
  });

  it("IDOR — parada de un plan que no es del cliente (dominio devuelve null) → 404", async () => {
    vi.mocked(obtenerEvidenciasParadaCliente).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost"), ctx("500", "42"));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Parada no encontrada.");
  });

  it("caso feliz → 200 con { evidencias }, nunca expone ruta de archivo alguna", async () => {
    vi.mocked(obtenerEvidenciasParadaCliente).mockResolvedValue([
      { id: 1, tipo: "producto", capturadoEn: "2026-09-02 10:00:00", nombreOriginal: "foto1.jpg" },
    ]);
    const res = await GET(new Request("http://localhost"), ctx("500", "42"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.evidencias).toEqual([
      { id: 1, tipo: "producto", capturadoEn: "2026-09-02 10:00:00", nombreOriginal: "foto1.jpg" },
    ]);
    expect(JSON.stringify(data)).not.toMatch(/ruta|path|C:\\|\/uploads\//i);
  });
});
