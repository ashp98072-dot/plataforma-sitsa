import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/dashboard", () => ({
  obtenerEstadisticasDashboard: vi.fn(), obtenerResumenGerencial: vi.fn(), obtenerSituacionEmpleadosHoy: vi.fn(),
}));
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerEstadisticasDashboard, obtenerResumenGerencial, obtenerSituacionEmpleadosHoy } from "@/lib/rrhh/dashboard";
import { GET } from "./route";
const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const req = new Request("https://local.test/?empresaId=99");
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 7, nombre: "Prueba" } } as never);
  vi.mocked(obtenerEstadisticasDashboard).mockResolvedValue({ totalEmpleados: 4 } as never);
  vi.mocked(obtenerResumenGerencial).mockResolvedValue([{ mes: "2026-08", altas: 2 }] as never);
  vi.mocked(obtenerSituacionEmpleadosHoy).mockResolvedValue([]);
});
it("preserva resumen aunque falle la bandeja diaria y no expone detalles internos", async () => {
  vi.mocked(obtenerSituacionEmpleadosHoy).mockRejectedValue(new Error("SQL privado"));
  const res = await GET(req, ctx), data = await res.json();
  expect(res.status).toBe(200);
  expect(data.resumenGerencial).toEqual([{ mes: "2026-08", altas: 2 }]);
  expect(data.stats.totalEmpleados).toBe(4);
  expect(data.situacionHoy).toBeNull();
  expect(data.avisos).toHaveLength(1);
  expect(JSON.stringify(data)).not.toContain("SQL privado");
  expect(res.headers.get("Cache-Control")).toContain("no-store");
});
it("fallo del resumen no oculta la situación diaria", async () => {
  vi.mocked(obtenerResumenGerencial).mockRejectedValue(new Error("fallo"));
  const data = await (await GET(req, ctx)).json();
  expect(data.stats.totalEmpleados).toBe(4);
  expect(data.situacionHoy).toEqual([]);
  expect(data.resumenGerencial).toEqual([]);
  expect(data.avisos).toHaveLength(1);
});
it("fallo de estadísticas no se presenta como cero", async () => {
  vi.mocked(obtenerEstadisticasDashboard).mockRejectedValue(new Error("fallo"));
  const data = await (await GET(req, ctx)).json();
  expect(data.stats).toBeNull();
  expect(data.resumenGerencial).toHaveLength(1);
});
it.each([401, 403])("respeta guard %s sin consultar datos", async (status) => {
  vi.mocked(requireTenantRrhh).mockResolvedValue({ error: new Response(null, { status }) } as never);
  expect((await GET(req, ctx)).status).toBe(status);
  expect(obtenerResumenGerencial).not.toHaveBeenCalled();
});
it("usa empresa validada, no la del query string", async () => {
  await GET(req, ctx);
  expect(requireTenantRrhh).toHaveBeenCalledWith("prueba", "empleados", "ver");
  for (const fn of [obtenerEstadisticasDashboard, obtenerResumenGerencial, obtenerSituacionEmpleadosHoy]) expect(fn).toHaveBeenCalledWith(7);
});
