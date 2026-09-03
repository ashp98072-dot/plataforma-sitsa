import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/lib/flota/combustible", () => ({ revisarCargaCombustible: vi.fn() }));

import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { registrarAuditoria } from "@/lib/auditoria";
import { revisarCargaCombustible } from "@/lib/flota/combustible";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "5" }) };

function req(body: unknown) {
  return new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFlotaCombustible).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 1, username: "op1" } } as Awaited<ReturnType<typeof requireTenantFlotaCombustible>>,
  );
  vi.mocked(revisarCargaCombustible).mockResolvedValue({ ok: true });
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/empresas/[slug]/flota/combustible/[id]/revisar", () => {
  it("exige flota_combustible:editar (distinto de :ver) ANTES de tocar la lib", async () => {
    vi.mocked(requireTenantFlotaCombustible).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantFlotaCombustible>>);
    const res = await POST(req({ accion: "aprobar" }), ctx);
    expect(res.status).toBe(403);
    expect(revisarCargaCombustible).not.toHaveBeenCalled();
    expect(requireTenantFlotaCombustible).toHaveBeenCalledWith("prueba", "editar");
  });

  it("acción inválida -> 400, sin llamar a la lib", async () => {
    const res = await POST(req({ accion: "algo" }), ctx);
    expect(res.status).toBe(400);
    expect(revisarCargaCombustible).not.toHaveBeenCalled();
  });

  it("aprobar delega en la lib con empresa/id/username correctos", async () => {
    const res = await POST(req({ accion: "aprobar" }), ctx);
    expect(res.status).toBe(200);
    expect(revisarCargaCombustible).toHaveBeenCalledWith(7, 5, "aprobar", "op1", undefined);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: "aprobar_combustible" }));
  });

  it("rechazar con motivo lo propaga a la lib y a la auditoría", async () => {
    const res = await POST(req({ accion: "rechazar", motivo: "Vale ilegible" }), ctx);
    expect(res.status).toBe(200);
    expect(revisarCargaCombustible).toHaveBeenCalledWith(7, 5, "rechazar", "op1", "Vale ilegible");
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: "rechazar_combustible" }));
  });

  it("propaga el error/status real de la lib (p.ej. 409 por doble revisión), sin auditar", async () => {
    vi.mocked(revisarCargaCombustible).mockResolvedValue({
      ok: false, error: "Esta carga ya fue revisada.", status: 409,
    });
    const res = await POST(req({ accion: "aprobar" }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Esta carga ya fue revisada.");
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});
