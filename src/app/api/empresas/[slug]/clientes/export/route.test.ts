import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clientes/acceso", () => ({ requireClientesOFacturacion: vi.fn() }));
vi.mock("@/lib/clientes/repository", () => ({ listarClientes: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/lib/clientes/export", () => ({
  exportarClientesExcel: vi.fn(() => Promise.resolve(Buffer.from("xlsx"))),
  exportarClientesPdf: vi.fn(() => Promise.resolve(Buffer.from("pdf"))),
}));

import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { exportarClientesExcel, exportarClientesPdf } from "@/lib/clientes/export";
import { listarClientes } from "@/lib/clientes/repository";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireClientesOFacturacion).mockResolvedValue({
    empresa: { id: 7, nombre: "KT / Mónaco" },
  } as Awaited<ReturnType<typeof requireClientesOFacturacion>>);
  vi.mocked(listarClientes).mockResolvedValue([]);
  vi.mocked(exportarClientesExcel).mockResolvedValue(Buffer.from("xlsx"));
  vi.mocked(exportarClientesPdf).mockResolvedValue(Buffer.from("pdf"));
});

describe("exportación del catálogo de clientes", () => {
  it("exige acceso al módulo antes de consultar datos", async () => {
    vi.mocked(requireClientesOFacturacion).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireClientesOFacturacion>>);
    const response = await GET(new Request("http://localhost/export?formato=xlsx"), ctx);
    expect(response.status).toBe(403);
    expect(listarClientes).not.toHaveBeenCalled();
  });

  it("aplica los filtros visibles y genera Excel", async () => {
    const response = await GET(new Request("http://localhost/export?formato=xlsx&estado=todos&q=Acme"), ctx);
    expect(listarClientes).toHaveBeenCalledWith(7, { estado: "todos", q: "Acme" });
    expect(exportarClientesExcel).toHaveBeenCalledWith([], "KT / Mónaco");
    expect(response.headers.get("Content-Type")).toContain("spreadsheetml");
  });

  it("genera PDF cuando se solicita", async () => {
    const response = await GET(new Request("http://localhost/export?formato=pdf"), ctx);
    expect(exportarClientesPdf).toHaveBeenCalledWith([], "KT / Mónaco");
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });
});
