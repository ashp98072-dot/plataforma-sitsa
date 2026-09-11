import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantGastosOperativosAutorizar: vi.fn() }));
vi.mock("@/lib/tms/gastos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/gastos")>();
  return { ...actual, rechazarGasto: vi.fn() };
});

import { requireTenantGastosOperativosAutorizar } from "@/lib/tenant";
import { ErrorGasto, rechazarGasto } from "@/lib/tms/gastos";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

function req(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const sesionOk = {
  empresa: { id: 7 },
  session: { id: 9, username: "hsitan", nombre: "Heber Sitan", rol: "JefeOperaciones" },
} as Awaited<ReturnType<typeof requireTenantGastosOperativosAutorizar>>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantGastosOperativosAutorizar).mockResolvedValue(sesionOk);
  vi.mocked(rechazarGasto).mockResolvedValue({ id: 10, estado: "Rechazada" } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /tms/gastos/[id]/rechazar", () => {
  it("exige EXACTAMENTE gastos_operativos_autorizar:editar antes de tocar el body", async () => {
    await POST(req({ motivoRechazo: "Factura ilegible." }), ctx);
    expect(requireTenantGastosOperativosAutorizar).toHaveBeenCalledWith("prueba", "editar");
  });

  it("sin permiso propio -> 403, nunca llama a la lib", async () => {
    vi.mocked(requireTenantGastosOperativosAutorizar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await POST(req({ motivoRechazo: "Factura ilegible." }), ctx);
    expect(res.status).toBe(403);
    expect(rechazarGasto).not.toHaveBeenCalled();
  });

  it("ID inválido -> 400, nunca llama a la lib", async () => {
    const res = await POST(req({ motivoRechazo: "Factura ilegible." }), { params: Promise.resolve({ slug: "prueba", id: "abc" }) });
    expect(res.status).toBe(400);
    expect(rechazarGasto).not.toHaveBeenCalled();
  });

  it("sin motivoRechazo -> 400, nunca llama a la lib", async () => {
    const res = await POST(req({}), ctx);
    expect(res.status).toBe(400);
    expect(rechazarGasto).not.toHaveBeenCalled();
  });

  it("delega en rechazarGasto con empresa/usuario de la SESIÓN (nunca del body)", async () => {
    await POST(req({ motivoRechazo: "Factura ilegible.", usuario: "otro", empresaId: 999 }), ctx);
    expect(rechazarGasto).toHaveBeenCalledWith(7, 10, { usuario: "hsitan", motivoRechazo: "Factura ilegible." });
  });

  it("gasto no encontrado -> 404", async () => {
    vi.mocked(rechazarGasto).mockResolvedValue(null);
    const res = await POST(req({ motivoRechazo: "Factura ilegible." }), ctx);
    expect(res.status).toBe(404);
  });

  it("respuesta 200 con el gasto actualizado", async () => {
    const res = await POST(req({ motivoRechazo: "Factura ilegible." }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mensaje).toBe("Gasto rechazado.");
    expect(body.gasto.estado).toBe("Rechazada");
  });

  describe("mapeo de errores HTTP (ErrorGasto)", () => {
    it("ErrorGasto 409 (histórico o transición inválida) se propaga tal cual", async () => {
      vi.mocked(rechazarGasto).mockRejectedValue(new ErrorGasto('No se puede pasar de "Autorizada" a "Rechazada".', 409));
      const res = await POST(req({ motivoRechazo: "x" }), ctx);
      expect(res.status).toBe(409);
    });

    it("Error plano (p. ej. lib exige motivo aunque el schema ya lo valida) -> 400", async () => {
      vi.mocked(rechazarGasto).mockRejectedValue(new Error("El rechazo requiere un motivo."));
      const res = await POST(req({ motivoRechazo: "x" }), ctx);
      expect(res.status).toBe(400);
    });

    it("excepción inesperada (no Error) -> 500 con cuerpo JSON, nunca un 500 vacío", async () => {
      vi.mocked(rechazarGasto).mockRejectedValue("fallo real de DB");
      const res = await POST(req({ motivoRechazo: "x" }), ctx);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(typeof body.error).toBe("string");
    });
  });
});
