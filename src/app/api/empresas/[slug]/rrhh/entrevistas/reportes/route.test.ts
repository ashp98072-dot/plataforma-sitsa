import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/entrevistas-reportes", () => ({ obtenerReporteEntrevistas: vi.fn() }));

import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerReporteEntrevistas } from "@/lib/rrhh/entrevistas-reportes";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const get = (qs = "") => GET(new Request(`http://x/api${qs ? `?${qs}` : ""}`), ctx);

const REPORTE_VACIO = {
  resumen: { total: 0, programadas: 0, realizadas: 0, canceladas: 0, noAsistio: 0, aprobados: 0, rechazados: 0, pendientes: 0, tasaAprobacion: null },
  porPuesto: [], porEntrevistador: [], detalle: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(obtenerReporteEntrevistas).mockResolvedValue(REPORTE_VACIO as never);
});

it("32) usa requireTenantRrhh(slug, 'entrevistas', 'ver') — mismo permiso ya existente, tenant SIEMPRE desde la sesión", async () => {
  vi.mocked(requireTenantRrhh).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "rrhh1", id: 3 } } as never);
  await get();
  expect(requireTenantRrhh).toHaveBeenCalledWith("kt-monaco", "entrevistas", "ver");
  expect(vi.mocked(obtenerReporteEntrevistas).mock.calls[0][0]).toBe(7); // empresaId del guard
});

it("sin permiso -> propaga el error del guard sin llamar al reporte", async () => {
  const errorResponse = new Response(JSON.stringify({ error: "Sin permiso." }), { status: 403 });
  vi.mocked(requireTenantRrhh).mockResolvedValue({ error: errorResponse } as never);
  const res = await get();
  expect(res.status).toBe(403);
  expect(obtenerReporteEntrevistas).not.toHaveBeenCalled();
});

it("nunca acepta empresaId del cliente — un intento de enviarlo en query string se ignora", async () => {
  vi.mocked(requireTenantRrhh).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "rrhh1", id: 3 } } as never);
  await get("empresaId=999");
  expect(vi.mocked(obtenerReporteEntrevistas).mock.calls[0][0]).toBe(7);
});

it("filtros inválidos (fecha con formato incorrecto) -> 400, sin consultar el reporte", async () => {
  vi.mocked(requireTenantRrhh).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "rrhh1", id: 3 } } as never);
  const res = await get("fechaDesde=29-09-2026");
  expect(res.status).toBe(400);
  expect(obtenerReporteEntrevistas).not.toHaveBeenCalled();
});

it("pasa los filtros de query string (puesto/estado/resultado/entrevistadorEmpleadoId) tal cual al reporte", async () => {
  vi.mocked(requireTenantRrhh).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "rrhh1", id: 3 } } as never);
  await get("puesto=Piloto&estado=Realizada&resultado=Aprobado&entrevistadorEmpleadoId=12");
  expect(obtenerReporteEntrevistas).toHaveBeenCalledWith(7, {
    puesto: "Piloto", estado: "Realizada", resultado: "Aprobado", entrevistadorEmpleadoId: 12,
  });
});
