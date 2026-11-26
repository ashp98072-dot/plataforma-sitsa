import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionExportar: vi.fn() }));
vi.mock("@/lib/integrations/pricesmart/lab-demo/kpi-entry", () => {
  class KpiInputError extends Error {}
  return { consultarKpiPriceSmart: vi.fn(), KpiInputError };
});

import { requireTenantProgramacionExportar } from "@/lib/tenant";
import { consultarKpiPriceSmart, KpiInputError } from "@/lib/integrations/pricesmart/lab-demo/kpi-entry";
import { GET } from "@/app/api/empresas/[slug]/tms/solicitudes-clientes/pricesmart/kpi/route";

// KPI interno: la EMPRESA sale SIEMPRE de la sesión; nunca de la URL. Sin permiso → no se consulta nada; fuera del laboratorio/sandbox → 404.
const ctx = { params: Promise.resolve({ slug: "empresa-a" }) };
const req = (qs = "") => new Request(`http://localhost/api/empresas/empresa-a/tms/solicitudes-clientes/pricesmart/kpi${qs}`);
beforeEach(() => { vi.resetAllMocks(); vi.mocked(requireTenantProgramacionExportar).mockResolvedValue({ empresa: { id: 7 }, session: { id: 1, rol: "Admin" } } as never); });

describe("GET …/pricesmart/kpi", () => {
  it("sin permiso de exportar → se devuelve el error del guard y NO se consulta nada", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireTenantProgramacionExportar).mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) } as never);
    expect((await GET(req(), ctx)).status).toBe(403); expect(consultarKpiPriceSmart).not.toHaveBeenCalled();
  });
  it("la empresa es la de la sesión: `empresaId`, `empresa_id` o `slug` en la URL se IGNORAN; los demás filtros se pasan acotados", async () => {
    vi.mocked(consultarKpiPriceSmart).mockResolvedValue({ enabled: true, rows: [], csv: "h\n" });
    expect((await GET(req("?empresaId=999&empresa_id=999&clienteId=3&desde=2030-01-01&hasta=2030-01-31&limite=10"), ctx)).status).toBe(200);
    expect(consultarKpiPriceSmart).toHaveBeenCalledWith({ empresaId: 7, clienteId: 3, desde: "2030-01-01", hasta: "2030-01-31", limite: 10 });
  });
  it("fuera del laboratorio/sandbox → 404; parámetros inválidos → 400; CSV con tipo y sin caché; no existe ningún método de escritura", async () => {
    vi.mocked(consultarKpiPriceSmart).mockResolvedValueOnce({ enabled: false }); expect((await GET(req(), ctx)).status).toBe(404);
    vi.mocked(consultarKpiPriceSmart).mockRejectedValueOnce(new KpiInputError("x")); expect((await GET(req("?desde=mal"), ctx)).status).toBe(400);
    vi.mocked(consultarKpiPriceSmart).mockResolvedValueOnce({ enabled: true, rows: [], csv: "numero_orden\n" });
    const csv = await GET(req("?formato=csv"), ctx); expect(csv.headers.get("content-type")).toMatch(/text\/csv/); expect(csv.headers.get("cache-control")).toBe("private, no-store"); expect(await csv.text()).toBe("numero_orden\n");
    const mod = await import("@/app/api/empresas/[slug]/tms/solicitudes-clientes/pricesmart/kpi/route"); expect(Object.keys(mod).filter((k) => ["POST", "PUT", "PATCH", "DELETE"].includes(k))).toEqual([]);
  });
});
