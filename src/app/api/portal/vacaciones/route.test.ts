import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/rrhh/colaborador-session", () => ({ getColaboradorSession: vi.fn() }));
vi.mock("@/lib/rrhh/vacaciones", () => ({ calcularSaldoTotalDisponible: vi.fn(), obtenerPeriodosDisponibles: vi.fn() }));
vi.mock("@/lib/rrhh/solicitudes-vacaciones", () => ({ crearSolicitudVacaciones: vi.fn(), listarSolicitudesPorEmpleado: vi.fn() }));
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { crearSolicitudVacaciones, listarSolicitudesPorEmpleado } from "@/lib/rrhh/solicitudes-vacaciones";
import { GET, POST } from "./route";

const body = { fechaInicio: "2026-09-01", fechaFin: "2026-09-02" };
const request = (data: object) => new Request("http://localhost/api/portal/vacaciones", { method: "POST", body: JSON.stringify(data) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getColaboradorSession).mockResolvedValue({ empresaId: 7, empleadoId: 10 } as NonNullable<Awaited<ReturnType<typeof getColaboradorSession>>>);
  vi.mocked(crearSolicitudVacaciones).mockResolvedValue({ ok: true, mensaje: "Pendiente", id: 1 });
});
it("exige sesión para leer y solicitar", async () => {
  vi.mocked(getColaboradorSession).mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
  expect((await POST(request(body))).status).toBe(401);
  expect(crearSolicitudVacaciones).not.toHaveBeenCalled();
});
it("ignora empresa y autor del body; delega validación del beneficiario al servicio", async () => {
  expect((await POST(request({ ...body, empleadoId: 20, empresaId: 99, solicitanteId: 99 }))).status).toBe(200);
  expect(crearSolicitudVacaciones).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 7, solicitanteId: 10, empleadoId: 20 }));
});
it("conserva autoservicio sin beneficiario y GET propio", async () => {
  await POST(request(body));
  expect(crearSolicitudVacaciones).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 7, solicitanteId: 10, empleadoId: 10 }));
  await GET();
  expect(listarSolicitudesPorEmpleado).toHaveBeenCalledWith(7, 10);
});
it("rechaza fechas imposibles antes de escribir", async () => {
  expect((await POST(request({ ...body, fechaInicio: "2026-02-30" }))).status).toBe(400);
  expect(crearSolicitudVacaciones).not.toHaveBeenCalled();
});
it("propaga el rechazo del servicio sin conceder acceso", async () => {
  vi.mocked(crearSolicitudVacaciones).mockResolvedValue({ ok: false, mensaje: "Sin autorización" });
  expect((await POST(request({ ...body, empleadoId: 99 }))).status).toBe(400);
});
