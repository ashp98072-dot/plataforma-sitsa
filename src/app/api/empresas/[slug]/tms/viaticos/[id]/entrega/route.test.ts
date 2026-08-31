import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosPagar: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({ registrarEntregaViatico: vi.fn() }));

import { requireTenantViaticosPagar } from "@/lib/tenant";
import { registrarEntregaViatico } from "@/lib/tms/viaticos";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

function req(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantViaticosPagar).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 8, username: "fact1", nombre: "Marta Ruiz", rol: "Facturador" } } as Awaited<ReturnType<typeof requireTenantViaticosPagar>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("POST /tms/viaticos/[id]/entrega", () => {
  it("exige viaticos_pagar:editar ANTES de tocar el body", async () => {
    await POST(req({ metodoPago: "EFECTIVO" }), ctx);
    expect(requireTenantViaticosPagar).toHaveBeenCalledWith("prueba", "editar");
  });

  it("sin permiso -> rechazo, sin llamar a la lib", async () => {
    vi.mocked(requireTenantViaticosPagar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantViaticosPagar>>);
    const res = await POST(req({ metodoPago: "EFECTIVO" }), ctx);
    expect(res.status).toBe(403);
    expect(registrarEntregaViatico).not.toHaveBeenCalled();
  });

  it("ID inválido -> 400, sin llamar a la lib", async () => {
    const res = await POST(req({ metodoPago: "EFECTIVO" }), { params: Promise.resolve({ slug: "prueba", id: "abc" }) });
    expect(res.status).toBe(400);
    expect(registrarEntregaViatico).not.toHaveBeenCalled();
  });

  it("body inválido (metodoPago no reconocido) -> 400, sin llamar a la lib", async () => {
    const res = await POST(req({ metodoPago: "BANCO" }), ctx);
    expect(res.status).toBe(400);
    expect(registrarEntregaViatico).not.toHaveBeenCalled();
  });

  it("delega en registrarEntregaViatico con empresa/usuario de la SESIÓN (nunca del cliente)", async () => {
    vi.mocked(registrarEntregaViatico).mockResolvedValue({ ok: true });
    const res = await POST(req({ metodoPago: "TRANSFERENCIA", referenciaPago: "REF-1", empresaId: 999 }), ctx);
    expect(res.status).toBe(200);
    expect(registrarEntregaViatico).toHaveBeenCalledWith(7, 10, { metodoPago: "TRANSFERENCIA", referenciaPago: "REF-1", observaciones: null }, "fact1");
    const body = await res.json();
    expect(body.mensaje).toBe("Entrega registrada.");
  });

  it("propaga el status real de la lib (404 no encontrado)", async () => {
    vi.mocked(registrarEntregaViatico).mockResolvedValue({ ok: false, error: "Viático no encontrado.", status: 404 });
    const res = await POST(req({ metodoPago: "EFECTIVO" }), ctx);
    expect(res.status).toBe(404);
  });

  it("propaga el status real de la lib (409 estado inválido)", async () => {
    vi.mocked(registrarEntregaViatico).mockResolvedValue({ ok: false, error: "Este viático está ENTREGADO; no se puede registrar la entrega desde ese estado.", status: 409 });
    const res = await POST(req({ metodoPago: "EFECTIVO" }), ctx);
    expect(res.status).toBe(409);
  });

  it("sin status en el resultado -> cae a 400 (compatibilidad con validaciones de forma)", async () => {
    vi.mocked(registrarEntregaViatico).mockResolvedValue({ ok: false, error: "Indica la referencia/número de la transferencia." });
    const res = await POST(req({ metodoPago: "TRANSFERENCIA" }), ctx);
    expect(res.status).toBe(400);
  });

  it("500 real: una excepción no controlada (p. ej. fallo de la nueva transacción) se captura y responde JSON {error}, nunca un 500 sin cuerpo", async () => {
    vi.mocked(registrarEntregaViatico).mockRejectedValue(new Error("fallo real de DB"));
    const res = await POST(req({ metodoPago: "EFECTIVO" }), ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });
});
