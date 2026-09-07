import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViajesCerrar: vi.fn() }));
vi.mock("@/lib/tms/cierre-viaje", () => ({ cerrarViaje: vi.fn(), cerrarViajeManual: vi.fn() }));

import { requireTenantViajesCerrar } from "@/lib/tenant";
import { cerrarViaje, cerrarViajeManual } from "@/lib/tms/cierre-viaje";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

function request(body?: unknown) {
  return new Request("http://localhost/api/x", {
    method: "POST",
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantViajesCerrar).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "jefe.operaciones", nombre: "Jefe", rol: "JefeOperaciones" } } as Awaited<ReturnType<typeof requireTenantViajesCerrar>>,
  );
  vi.mocked(cerrarViaje).mockResolvedValue({ ok: true });
  vi.mocked(cerrarViajeManual).mockResolvedValue({ ok: true, flotaViajeCerrado: false });
});

describe("POST /tms/planes/[id]/cerrar — retrocompatibilidad (cierre normal)", () => {
  it("sin body: cierre normal exactamente igual que antes", async () => {
    const res = await POST(request(), ctx);
    expect(res.status).toBe(200);
    expect(cerrarViaje).toHaveBeenCalledWith(7, 10, "jefe.operaciones");
    expect(cerrarViajeManual).not.toHaveBeenCalled();
  });

  it("body sin 'manual' (o manual: false): cierre normal, no manual", async () => {
    const res = await POST(request({ manual: false }), ctx);
    expect(res.status).toBe(200);
    expect(cerrarViaje).toHaveBeenCalledOnce();
    expect(cerrarViajeManual).not.toHaveBeenCalled();
  });

  it("cierre normal fallido -> 409 con el mensaje de la lib", async () => {
    vi.mocked(cerrarViaje).mockResolvedValue({ ok: false, error: "El piloto todavía no ha registrado la llegada de este viaje; no se puede cerrar todavía." });
    const res = await POST(request(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("todavía no ha registrado");
  });
});

describe("POST /tms/planes/[id]/cerrar — cierre manual", () => {
  it("7) sin permiso viajes_cerrar:editar -> 403 ANTES de tocar la lib (aplica a ambos modos)", async () => {
    vi.mocked(requireTenantViajesCerrar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantViajesCerrar>>);
    const res = await POST(request({ manual: true, motivo: "Cambio operativo confirmado." }), ctx);
    expect(res.status).toBe(403);
    expect(cerrarViajeManual).not.toHaveBeenCalled();
    expect(cerrarViaje).not.toHaveBeenCalled();
  });

  it("manual:true con motivo -> llama cerrarViajeManual con empresa/plan/usuario/motivo/comentario", async () => {
    const res = await POST(request({ manual: true, motivo: "Cambio operativo confirmado.", comentario: "Detalle adicional." }), ctx);
    expect(res.status).toBe(200);
    expect(cerrarViajeManual).toHaveBeenCalledWith({
      empresaId: 7,
      planId: 10,
      usuario: "jefe.operaciones",
      motivo: "Cambio operativo confirmado.",
      comentario: "Detalle adicional.",
    });
    expect(cerrarViaje).not.toHaveBeenCalled();
  });

  it("9) manual:true sin motivo -> 400 ANTES de llamar a la lib", async () => {
    const res = await POST(request({ manual: true }), ctx);
    expect(res.status).toBe(400);
    expect(cerrarViajeManual).not.toHaveBeenCalled();
  });

  it("manual:true con motivo vacío/solo espacios -> 400 ANTES de llamar a la lib", async () => {
    const res = await POST(request({ manual: true, motivo: "   " }), ctx);
    expect(res.status).toBe(400);
    expect(cerrarViajeManual).not.toHaveBeenCalled();
  });

  it("cierre manual bloqueado por la lib (p. ej. estado no permitido) -> 409 con el mensaje", async () => {
    vi.mocked(cerrarViajeManual).mockResolvedValue({ ok: false, error: "Este viaje ya fue cerrado." });
    const res = await POST(request({ manual: true, motivo: "Cambio operativo confirmado." }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Este viaje ya fue cerrado.");
  });

  it("ID inválido -> 400, sin llamar a ninguna lib", async () => {
    const res = await POST(request({ manual: true, motivo: "Cambio operativo confirmado." }), { params: Promise.resolve({ slug: "prueba", id: "abc" }) });
    expect(res.status).toBe(400);
    expect(cerrarViajeManual).not.toHaveBeenCalled();
    expect(cerrarViaje).not.toHaveBeenCalled();
  });
});
