import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn() }));
vi.mock("@/lib/facturacion/factura-demo-pdf", () => ({ generarPdfFacturaDemo: vi.fn() }));

import { requireTenantFacturacion } from "@/lib/tenant";
import { generarPdfFacturaDemo } from "@/lib/facturacion/factura-demo-pdf";
import { GET } from "./route";

const ctx = (id = "12") => ({ params: Promise.resolve({ slug: "prueba", id }) });
const guardOk = {
  empresa: { id: 7, nombre: "Empresa 7", logoUrl: "uploads/logo.png" },
  session: { id: 3, username: "facturador1" },
} as Awaited<ReturnType<typeof requireTenantFacturacion>>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFacturacion).mockResolvedValue(guardOk);
  vi.mocked(generarPdfFacturaDemo).mockResolvedValue({ ok: true, buffer: Buffer.from("%PDF-1.7 demo"), nombreArchivo: "factura-demo-12.pdf" });
});
afterEach(() => vi.restoreAllMocks());

describe("GET /facturacion/facturas/[id]/pdf-demo", () => {
  it("usa el permiso de LECTURA de Facturación (facturacion:ver), nunca el de tms, y lo exige antes de generar nada", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>);
    const res = await GET(new Request("http://localhost/x"), ctx());
    expect(res.status).toBe(403);
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "ver");
    expect(generarPdfFacturaDemo).not.toHaveBeenCalled();
  });

  it("la empresa sale SIEMPRE del guard (no hay forma de pedirla desde la URL ni el cuerpo)", async () => {
    await GET(new Request("http://localhost/x?empresaId=999&empresa_id=999"), ctx());
    expect(generarPdfFacturaDemo).toHaveBeenCalledWith({ id: 7, nombre: "Empresa 7", logoUrl: "uploads/logo.png" }, 12);
  });

  it("devuelve el PDF: tipo application/pdf, en línea (se abre en una pestaña), sin caché", async () => {
    const res = await GET(new Request("http://localhost/x"), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="factura-demo-12.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).toString().startsWith("%PDF-")).toBe(true);
  });

  it("id inválido → 400 sin generar; 404 (factura de otra empresa o inexistente) y 409 (Anulada / sin snapshot) se propagan con su motivo", async () => {
    for (const id of ["abc", "0", "-3", "1.5"]) {
      expect((await GET(new Request("http://localhost/x"), ctx(id))).status).toBe(400);
    }
    expect(generarPdfFacturaDemo).not.toHaveBeenCalled();

    vi.mocked(generarPdfFacturaDemo).mockResolvedValue({ ok: false, status: 404, error: "Factura no encontrada." });
    const r404 = await GET(new Request("http://localhost/x"), ctx());
    expect(r404.status).toBe(404);
    expect((await r404.json()).error).toBe("Factura no encontrada.");

    vi.mocked(generarPdfFacturaDemo).mockResolvedValue({ ok: false, status: 409, error: "Una factura Anulada no tiene PDF demo." });
    const r409 = await GET(new Request("http://localhost/x"), ctx());
    expect(r409.status).toBe(409);
    expect(r409.headers.get("Content-Type")).not.toBe("application/pdf");
  });
});
