import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn() }));
vi.mock("@/lib/facturacion/facturas", () => ({
  listarFacturas: vi.fn(() => Promise.resolve({ items: [], totalReal: 0, page: 1, pageSize: 50 })),
  crearFactura: vi.fn(),
}));

import { requireTenantFacturacion } from "@/lib/tenant";
import { crearFactura, listarFacturas } from "@/lib/facturacion/facturas";
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFacturacion).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "facturador1" } } as Awaited<ReturnType<typeof requireTenantFacturacion>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /facturacion/facturas — 26) permisos: facturacion:ver", () => {
  it("exige facturacion:ver ANTES de tocar la DB", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(listarFacturas).not.toHaveBeenCalled();
  });

  it("responde 200 con las facturas del tenant del guard", async () => {
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "ver");
    expect(listarFacturas).toHaveBeenCalledWith(7, expect.anything());
  });

  it("responde con totalReal/page/pageSize independientes del contenido de la página (paginación)", async () => {
    vi.mocked(listarFacturas).mockResolvedValue({ items: [], totalReal: 734, page: 2, pageSize: 100 });
    const res = await GET(new Request("http://localhost/x?page=2&pageSize=100"), ctx);
    const body = await res.json();
    expect(body).toEqual({ facturas: [], totalReal: 734, page: 2, pageSize: 100 });
    expect(listarFacturas).toHaveBeenCalledWith(7, expect.objectContaining({ page: 2, pageSize: 100 }));
  });
});

describe("POST /facturacion/facturas — 26) permisos: facturacion:crear", () => {
  it("exige facturacion:crear ANTES de tocar la DB", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>);
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 1 }] }) }), ctx);
    expect(res.status).toBe(403);
    expect(crearFactura).not.toHaveBeenCalled();
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "crear");
  });

  it("crea siempre como Borrador vía la lib (nunca escribe SQL directo en la ruta)", async () => {
    vi.mocked(crearFactura).mockResolvedValue({ ok: true, facturaId: 10 });
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 1 }] }) }),
      ctx,
    );
    expect(res.status).toBe(201);
    expect(crearFactura).toHaveBeenCalledWith(
      { empresaId: 7, usuarioId: 3, usuario: "facturador1" },
      expect.objectContaining({ clienteId: 1, planes: [{ planId: 1 }] }),
    );
  });

  it("propaga el status de error de la lib (p.ej. 409 viaje ya facturado)", async () => {
    vi.mocked(crearFactura).mockResolvedValue({ ok: false, error: "El viaje ya está vinculado a otra factura.", status: 409 });
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ clienteId: 1, planes: [{ planId: 1 }] }) }),
      ctx,
    );
    expect(res.status).toBe(409);
  });

  it("rechaza payload sin planes antes de llamar a la lib", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ clienteId: 1, planes: [] }) }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(crearFactura).not.toHaveBeenCalled();
  });
});
