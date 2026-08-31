import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosAutorizar: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({ rechazarViatico: vi.fn() }));

import { requireTenantViaticosAutorizar } from "@/lib/tenant";
import { rechazarViatico } from "@/lib/tms/viaticos";
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
  vi.mocked(requireTenantViaticosAutorizar).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "jefe1", nombre: "Ana López", rol: "JefeOperaciones" } } as Awaited<ReturnType<typeof requireTenantViaticosAutorizar>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("POST /tms/viaticos/[id]/rechazar", () => {
  it("9) exige EXACTAMENTE viaticos_autorizar:editar (mismo permiso que autorizar) ANTES de tocar el body", async () => {
    await POST(req({ motivoRechazo: "El viaje fue cancelado por el cliente." }), ctx);
    expect(requireTenantViaticosAutorizar).toHaveBeenCalledWith("prueba", "editar");
  });

  it("10) Facturador/AuxiliarOperaciones sin permiso -> rechazo ANTES de llamar a la lib", async () => {
    vi.mocked(requireTenantViaticosAutorizar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantViaticosAutorizar>>);
    const res = await POST(req({ motivoRechazo: "El viaje fue cancelado por el cliente." }), ctx);
    expect(res.status).toBe(403);
    expect(rechazarViatico).not.toHaveBeenCalled();
  });

  it("ID inválido -> 400, sin llamar a la lib", async () => {
    const res = await POST(req({ motivoRechazo: "El viaje fue cancelado." }), { params: Promise.resolve({ slug: "prueba", id: "abc" }) });
    expect(res.status).toBe(400);
    expect(rechazarViatico).not.toHaveBeenCalled();
  });

  it("body no es JSON / sin motivoRechazo -> se delega igual con string vacío (la validación de longitud vive en la lib)", async () => {
    vi.mocked(rechazarViatico).mockResolvedValue({ ok: false, error: "El motivo debe tener al menos 10 caracteres.", status: 400 });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: "no-es-json" }), ctx);
    expect(res.status).toBe(400);
    expect(rechazarViatico).toHaveBeenCalledWith(7, 10, "", "jefe1");
  });

  it("delega en rechazarViatico con empresa/usuario de la SESIÓN (nunca del cliente)", async () => {
    vi.mocked(rechazarViatico).mockResolvedValue({ ok: true });
    const res = await POST(req({ motivoRechazo: "No corresponde: el viaje fue cancelado.", empresaId: 999 }), ctx);
    expect(res.status).toBe(200);
    expect(rechazarViatico).toHaveBeenCalledWith(7, 10, "No corresponde: el viaje fue cancelado.", "jefe1");
    const body = await res.json();
    expect(body.mensaje).toBe("Viático rechazado.");
  });

  it("propaga el status/error real de la lib (p. ej. 409 estado inválido)", async () => {
    vi.mocked(rechazarViatico).mockResolvedValue({ ok: false, error: "Este viático está AUTORIZADO; no se puede rechazar desde ese estado.", status: 409 });
    const res = await POST(req({ motivoRechazo: "No corresponde: el viaje fue cancelado." }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("AUTORIZADO");
  });

  it("500 real: una excepción no controlada se captura y responde JSON {error}, nunca un 500 sin cuerpo", async () => {
    vi.mocked(rechazarViatico).mockRejectedValue(new Error("fallo real de DB"));
    const res = await POST(req({ motivoRechazo: "No corresponde: el viaje fue cancelado." }), ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });
});
