import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosAutorizar: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({ autorizarViatico: vi.fn() }));

import { requireTenantViaticosAutorizar } from "@/lib/tenant";
import { autorizarViatico } from "@/lib/tms/viaticos";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantViaticosAutorizar).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "jefe1", nombre: "Ana López", rol: "JefeOperaciones" } } as Awaited<ReturnType<typeof requireTenantViaticosAutorizar>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("POST /tms/viaticos/[id]/autorizar", () => {
  it("exige viaticos_autorizar:editar ANTES de tocar la lib", async () => {
    vi.mocked(requireTenantViaticosAutorizar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantViaticosAutorizar>>);
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ password: "x" }) }), ctx);
    expect(res.status).toBe(403);
    expect(autorizarViatico).not.toHaveBeenCalled();
  });

  it("rechaza sin contraseña antes de llamar a la lib", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({}) }), ctx);
    expect(res.status).toBe(400);
    expect(autorizarViatico).not.toHaveBeenCalled();
  });

  it("delega en autorizarViatico con la identidad de la SESIÓN del servidor (nombre/rol nunca del cliente)", async () => {
    vi.mocked(autorizarViatico).mockResolvedValue({
      ok: true,
      firma: { id: 1, codigoFirma: "SIG-1", fechaHoraServidor: new Date("2026-08-28T15:00:00Z"), hashPayload: "h", nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones" },
    });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ password: "clave123" }) }), ctx);
    expect(res.status).toBe(200);
    expect(autorizarViatico).toHaveBeenCalledWith(7, 10, "jefe1", {
      usuarioId: 3, nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones", password: "clave123",
      ip: null, userAgent: null,
    });
    const body = await res.json();
    expect(body.firma.codigoFirma).toBe("SIG-1");
  });

  it("propaga el status de error de la lib (p.ej. 401 contraseña incorrecta, 409 estado)", async () => {
    vi.mocked(autorizarViatico).mockResolvedValue({ ok: false, error: "Contraseña incorrecta.", status: 401 });
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ password: "mala" }) }), ctx);
    expect(res.status).toBe(401);
  });
});
