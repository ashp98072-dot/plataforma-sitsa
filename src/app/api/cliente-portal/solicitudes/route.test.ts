import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/cliente-portal-guard", () => ({ requireClienteSession: vi.fn() }));
vi.mock("@/lib/tms/solicitudes-cliente", () => ({ crearSolicitudCliente: vi.fn() }));
vi.mock("@/lib/tms/cliente-portal-seguimiento", () => ({ listarViajesCliente: vi.fn() }));

import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import { crearSolicitudCliente } from "@/lib/tms/solicitudes-cliente";
import { listarViajesCliente } from "@/lib/tms/cliente-portal-seguimiento";
import { GET, POST } from "./route";

const SESSION_A = { usuarioClienteId: 10, empresaId: 7, clienteId: 30, nombre: "Contacto A" };

function reqGet(qs = "") {
  return new Request(`http://localhost/api/cliente-portal/solicitudes${qs}`);
}
function reqPost(body: unknown) {
  return new Request("http://localhost/api/cliente-portal/solicitudes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const bodyValido = {
  fechaSolicitada: "2099-01-15",
  origen: { lugarNombre: "Bodega" },
  entregas: [{ lugarNombre: "Sucursal 1" }],
  destino: { lugarNombre: "Destino final" },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireClienteSession).mockResolvedValue({
    session: SESSION_A,
  } as Awaited<ReturnType<typeof requireClienteSession>>);
});

describe("GET /api/cliente-portal/solicitudes", () => {
  it("sin sesión → 401, nunca llega a consultar", async () => {
    vi.mocked(requireClienteSession).mockResolvedValue({
      error: new Response(JSON.stringify({ error: "No autenticado." }), { status: 401 }) as never,
    } as Awaited<ReturnType<typeof requireClienteSession>>);
    const res = await GET(reqGet());
    expect(res.status).toBe(401);
    expect(listarViajesCliente).not.toHaveBeenCalled();
  });

  it("lista únicamente con el empresaId+clienteId de LA SESIÓN, nunca de un query param", async () => {
    vi.mocked(listarViajesCliente).mockResolvedValue([]);
    // Un intento de inyectar empresaId/clienteId por querystring no tiene
    // ningún efecto: la ruta ni siquiera los lee.
    await GET(reqGet("?empresaId=999&clienteId=999&estado=PROGRAMADA"));
    expect(listarViajesCliente).toHaveBeenCalledWith(7, 30, {
      estado: "PROGRAMADA",
      fechaDesde: undefined,
      fechaHasta: undefined,
    });
  });

  it("CLIENTE-PORTAL-4: la respuesta conserva el contrato original (id/estado/...) más planCodigo/estadoViaje aditivos", async () => {
    vi.mocked(listarViajesCliente).mockResolvedValue([
      {
        solicitudId: 501,
        estadoSolicitud: "PROGRAMADA",
        fechaSolicitada: "2099-01-15",
        horaSolicitada: null,
        referenciaCliente: null,
        cantidadEntregas: 2,
        planId: 900,
        planCodigo: "PLAN-20990115-001",
        estadoViaje: "EN_RUTA",
        creadoEn: "2026-09-02 08:00:00",
      },
    ]);
    const res = await GET(reqGet());
    const data = await res.json();
    expect(data.solicitudes[0]).toEqual({
      id: 501,
      estado: "PROGRAMADA",
      fechaSolicitada: "2099-01-15",
      horaSolicitada: null,
      referenciaCliente: null,
      cantidadEntregas: 2,
      planId: 900,
      creadoEn: "2026-09-02 08:00:00",
      planCodigo: "PLAN-20990115-001",
      estadoViaje: "EN_RUTA",
    });
  });
});

describe("POST /api/cliente-portal/solicitudes", () => {
  it("sin sesión → 401, no crea nada", async () => {
    vi.mocked(requireClienteSession).mockResolvedValue({
      error: new Response(null, { status: 401 }),
    } as Awaited<ReturnType<typeof requireClienteSession>>);
    const res = await POST(reqPost(bodyValido));
    expect(res.status).toBe(401);
    expect(crearSolicitudCliente).not.toHaveBeenCalled();
  });

  it("payload inválido (sin entregas) → 400, no llega al dominio", async () => {
    const res = await POST(reqPost({ ...bodyValido, entregas: [] }));
    expect(res.status).toBe(400);
    expect(crearSolicitudCliente).not.toHaveBeenCalled();
  });

  it("payload con empresaId/clienteId/usuarioClienteId/estado/planId/version en el body → esos campos se IGNORAN, el scope real sale de la sesión", async () => {
    vi.mocked(crearSolicitudCliente).mockResolvedValue({
      ok: true,
      solicitud: { id: 501, estado: "SOLICITADA", cantidadEntregas: 1 } as never,
    });
    await POST(
      reqPost({
        ...bodyValido,
        empresaId: 999,
        clienteId: 999,
        usuarioClienteId: 999,
        estado: "PROGRAMADA",
        planId: 123,
        version: 99,
      }),
    );
    expect(crearSolicitudCliente).toHaveBeenCalledWith(
      { empresaId: 7, clienteId: 30, usuarioClienteId: 10 },
      expect.objectContaining({ fechaSolicitada: "2099-01-15" }),
    );
    // Ninguno de los 6 campos prohibidos llega como segundo argumento.
    const inputRecibido = vi.mocked(crearSolicitudCliente).mock.calls[0][1] as Record<string, unknown>;
    for (const campo of ["empresaId", "clienteId", "usuarioClienteId", "estado", "planId", "version"]) {
      expect(inputRecibido).not.toHaveProperty(campo);
    }
  });

  it("éxito → 201", async () => {
    vi.mocked(crearSolicitudCliente).mockResolvedValue({
      ok: true,
      solicitud: { id: 501, estado: "SOLICITADA", cantidadEntregas: 1 } as never,
    });
    const res = await POST(reqPost(bodyValido));
    expect(res.status).toBe(201);
  });

  it("el dominio rechaza (ej. ubicación de otro cliente) → 400, mensaje propagado", async () => {
    vi.mocked(crearSolicitudCliente).mockResolvedValue({
      ok: false,
      mensaje: "Una de las ubicaciones seleccionadas no pertenece a este cliente.",
    });
    const res = await POST(reqPost(bodyValido));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/no pertenece/i);
  });
});
