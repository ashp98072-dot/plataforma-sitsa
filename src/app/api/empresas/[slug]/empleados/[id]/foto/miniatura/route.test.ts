import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({ obtenerEmpleado: vi.fn() }));
vi.mock("@/lib/rrhh/foto-empleado-miniatura", () => ({ respuestaMiniaturaEmpleado: vi.fn() }));
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { respuestaMiniaturaEmpleado } from "@/lib/rrhh/foto-empleado-miniatura";
import { GET } from "./route";
const ctx = { params: Promise.resolve({ slug: "empresa", id: "7" }) };
const req = () => new Request("http://local/foto/miniatura", { headers: { "If-None-Match": "*" } });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 3 }, session: { id: 2 } } as Awaited<ReturnType<typeof requireTenantRrhh>>);
  vi.mocked(obtenerEmpleado).mockResolvedValue({ id: 7 } as NonNullable<Awaited<ReturnType<typeof obtenerEmpleado>>>);
  vi.mocked(respuestaMiniaturaEmpleado).mockResolvedValue(new NextResponse(null, { status: 304 }));
});
it("valida guard y pertenencia antes del 304", async () => {
  const request = req();
  expect((await GET(request, ctx)).status).toBe(304);
  expect(requireTenantRrhh).toHaveBeenCalledWith("empresa", "empleados", "ver");
  expect(obtenerEmpleado).toHaveBeenCalledWith(3, 7);
  expect(respuestaMiniaturaEmpleado).toHaveBeenCalledWith(request, 3, 7);
  expect(vi.mocked(obtenerEmpleado).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(respuestaMiniaturaEmpleado).mock.invocationCallOrder[0]);
});
it.each([401, 403])("sin sesión/permiso: %s, nunca 304", async (status) => {
  vi.mocked(requireTenantRrhh).mockResolvedValue({ error: new NextResponse(null, { status }) });
  expect((await GET(req(), ctx)).status).toBe(status);
  expect(obtenerEmpleado).not.toHaveBeenCalled();
  expect(respuestaMiniaturaEmpleado).not.toHaveBeenCalled();
});
it("empleado de otra empresa/inexistente no expone foto ni 304", async () => {
  vi.mocked(obtenerEmpleado).mockResolvedValue(null);
  expect((await GET(req(), ctx)).status).toBe(404);
  expect(respuestaMiniaturaEmpleado).not.toHaveBeenCalled();
});
it("ID inválido no consulta empleado", async () => {
  expect((await GET(req(), { params: Promise.resolve({ slug: "empresa", id: "0" }) })).status).toBe(400);
  expect(obtenerEmpleado).not.toHaveBeenCalled();
});
