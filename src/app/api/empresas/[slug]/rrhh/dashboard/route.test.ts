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
it("loggea internamente sección + code/errno/sqlState/message de cada sección caída, sin exponerlos al cliente", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const sqlError = Object.assign(new Error("You have an error in your SQL syntax near 'GROUP_CONCAT'"), { code: "ER_PARSE_ERROR", errno: 1064, sqlState: "42000" });
  vi.mocked(obtenerSituacionEmpleadosHoy).mockRejectedValue(sqlError);
  vi.mocked(obtenerResumenGerencial).mockRejectedValue(Object.assign(new Error("timeout"), { code: "PROTOCOL_SEQUENCE_TIMEOUT" }));
  const res = await GET(req, ctx), data = await res.json();
  expect(log).toHaveBeenCalledWith("[dashboard-rrhh] Sección no disponible", {
    seccion: "Situación del personal", code: "ER_PARSE_ERROR", errno: 1064, sqlState: "42000", message: "You have an error in your SQL syntax near 'GROUP_CONCAT'",
  });
  expect(log).toHaveBeenCalledWith("[dashboard-rrhh] Sección no disponible", expect.objectContaining({ seccion: "Resumen mensual", code: "PROTOCOL_SEQUENCE_TIMEOUT", errno: null, sqlState: null }));
  expect(log).toHaveBeenCalledTimes(2); // la sección sana (Estadísticas) no se loguea
  const cuerpo = JSON.stringify(data);
  for (const secreto of ["ER_PARSE_ERROR", "1064", "42000", "GROUP_CONCAT", "SQL syntax", "PROTOCOL_SEQUENCE_TIMEOUT"]) expect(cuerpo).not.toContain(secreto);
  expect(data.avisos).toEqual([
    "Resumen mensual: no disponible. Intenta nuevamente o solicita revisar el servidor.",
    "Situación del personal: no disponible. Intenta nuevamente o solicita revisar el servidor.",
  ]);
  expect(data.stats.totalEmpleados).toBe(4); // las secciones sanas se conservan
  log.mockRestore();
});
it("un rechazo que no es un Error (valor arbitrario) también se loguea sin romper la respuesta", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(obtenerEstadisticasDashboard).mockRejectedValue("fallo raro");
  const res = await GET(req, ctx);
  expect(res.status).toBe(200);
  expect(log).toHaveBeenCalledWith("[dashboard-rrhh] Sección no disponible", expect.objectContaining({ seccion: "Estadísticas de hoy", code: null, message: "fallo raro" }));
  log.mockRestore();
});
it("sin fallos no se loguea nada", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await GET(req, ctx);
  expect(log).not.toHaveBeenCalled();
  log.mockRestore();
});
