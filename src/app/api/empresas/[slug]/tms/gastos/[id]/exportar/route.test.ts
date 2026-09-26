import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantGastos: vi.fn() }));
vi.mock("@/lib/tms/gastos", () => ({ obtenerGasto: vi.fn() }));
vi.mock("@/lib/tms/gastos-export-excel", () => ({ exportarGastoOperativoExcel: vi.fn() }));

import { requireTenantGastos } from "@/lib/tenant";
import { obtenerGasto } from "@/lib/tms/gastos";
import { exportarGastoOperativoExcel } from "@/lib/tms/gastos-export-excel";
import { GET } from "./route";

describe("Excel individual protegido de gastos", () => {
  beforeEach(() => vi.resetAllMocks());
  const ctx = { params: Promise.resolve({ slug: "tenant", id: "10" }) };
  const req = new Request("http://localhost/exportar");

  it("consulta solo la empresa autorizada y entrega el snapshot sin sustituirlo por el tenant", async () => {
    vi.mocked(requireTenantGastos).mockResolvedValue({ empresa: { id: 7, nombre: "Tenant distinto" } } as Awaited<ReturnType<typeof requireTenantGastos>>);
    const gasto = { id: 10, codigo: "GASTO-000010", empresaId: 7, entidadRequirenteNombre: "Requirente real" } as NonNullable<Awaited<ReturnType<typeof obtenerGasto>>>;
    vi.mocked(obtenerGasto).mockResolvedValue(gasto);
    vi.mocked(exportarGastoOperativoExcel).mockResolvedValue(Buffer.from("xlsx"));
    const respuesta = await GET(req, ctx);
    expect(requireTenantGastos).toHaveBeenCalledWith("tenant", "ver");
    expect(obtenerGasto).toHaveBeenCalledWith(7, 10);
    expect(exportarGastoOperativoExcel).toHaveBeenCalledExactlyOnceWith(gasto);
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Disposition")).toBe('attachment; filename="GASTO-000010.xlsx"'); // código persistido, no el id
    expect(respuesta.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("no exporta un registro ausente en la empresa", async () => {
    vi.mocked(requireTenantGastos).mockResolvedValue({ empresa: { id: 8 } } as Awaited<ReturnType<typeof requireTenantGastos>>);
    vi.mocked(obtenerGasto).mockResolvedValue(null);
    expect((await GET(req, ctx)).status).toBe(404);
    expect(obtenerGasto).toHaveBeenCalledWith(8, 10);
    expect(exportarGastoOperativoExcel).not.toHaveBeenCalled();
  });

  it("respeta el rechazo de permisos sin consultar ni exportar", async () => {
    vi.mocked(requireTenantGastos).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantGastos>>);
    expect((await GET(req, ctx)).status).toBe(403);
    expect(obtenerGasto).not.toHaveBeenCalled();
    expect(exportarGastoOperativoExcel).not.toHaveBeenCalled();
  });
});
