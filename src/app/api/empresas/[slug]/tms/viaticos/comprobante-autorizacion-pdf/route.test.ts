import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosComprobantes: vi.fn() }));
vi.mock("@/lib/tms/viaticos-comprobante-pdf", () => ({ comprobanteAutorizacionesPdf: vi.fn() }));

import { requireTenantViaticosComprobantes } from "@/lib/tenant";
import { comprobanteAutorizacionesPdf } from "@/lib/tms/viaticos-comprobante-pdf";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantViaticosComprobantes).mockResolvedValue(
    { empresa: { id: 7, nombre: "SITSA" }, session: { id: 8, username: "op1", nombre: "Ana", rol: "JefeOperaciones" } } as Awaited<
      ReturnType<typeof requireTenantViaticosComprobantes>
    >,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tms/viaticos/comprobante-autorizacion-pdf", () => {
  it("exige viaticos_comprobantes:ver ANTES de tocar la lib", async () => {
    vi.mocked(requireTenantViaticosComprobantes).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantViaticosComprobantes>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(comprobanteAutorizacionesPdf).not.toHaveBeenCalled();
    expect(requireTenantViaticosComprobantes).toHaveBeenCalledWith("prueba", "ver");
  });

  it("sin viáticos AUTORIZADO -> 404 con mensaje claro, nunca un PDF vacío", async () => {
    vi.mocked(comprobanteAutorizacionesPdf).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("No hay viáticos autorizados");
  });

  it("sirve el PDF con los headers correctos (attachment, no-store, empresa/id correctos a la lib)", async () => {
    const buffer = Buffer.from("%PDF-1.4 contenido de prueba");
    vi.mocked(comprobanteAutorizacionesPdf).mockResolvedValue(buffer);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    expect(comprobanteAutorizacionesPdf).toHaveBeenCalledWith(7, "SITSA");
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("viaticos-autorizados-");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const arrBuf = await res.arrayBuffer();
    expect(Buffer.from(arrBuf).equals(buffer)).toBe(true);
  });
});
