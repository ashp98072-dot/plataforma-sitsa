import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api-guard", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorId: vi.fn() }));
vi.mock("@/lib/admin/limpiar-modulo", () => ({ limpiarModuloEmpresa: vi.fn(), contarModuloEmpresa: vi.fn() }));
import { requireSession } from "@/lib/api-guard";
import { obtenerEmpresaPorId } from "@/lib/empresas";
import { limpiarModuloEmpresa } from "@/lib/admin/limpiar-modulo";
import { LimpiezaBloqueada } from "@/lib/admin/limpiar-operaciones";
import { POST } from "./route";
const request = (confirmacion = "TEST LIMPIAR OPERACIONES") => new Request("http://localhost/api/admin/limpiar-modulo", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ empresaId: 7, modulo: "operaciones", confirmacion }),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ user: { id: 2, rol: "Admin", username: "admin" } });
  vi.mocked(obtenerEmpresaPorId).mockResolvedValue({ id: 7, codigo: "TEST" } as NonNullable<Awaited<ReturnType<typeof obtenerEmpresaPorId>>>);
  vi.mocked(limpiarModuloEmpresa).mockResolvedValue({ afectados: {}, restantes: {} });
});
it("rechaza usuarios sin rol Admin en servidor", async () => {
  vi.mocked(requireSession).mockResolvedValue({ user: { id: 3, rol: "Piloto", username: "pilot" } });
  expect((await POST(request())).status).toBe(403);
  expect(limpiarModuloEmpresa).not.toHaveBeenCalled();
});
it("rechaza confirmación para otra empresa o módulo", async () => {
  expect((await POST(request("OTHER LIMPIAR OPERACIONES"))).status).toBe(400);
  expect(limpiarModuloEmpresa).not.toHaveBeenCalled();
});
it("usa empresa validada y actor de sesión, no del cliente", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(limpiarModuloEmpresa).toHaveBeenCalledWith({ empresaId: 7, empresaCodigo: "TEST", modulo: "operaciones", usuarioId: 2, usuario: "admin" });
});
it("devuelve bloqueo seguro como 409", async () => {
  vi.mocked(limpiarModuloEmpresa).mockRejectedValue(new LimpiezaBloqueada("Hay pagos vinculados."));
  const res = await POST(request());
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "Hay pagos vinculados." });
});
it.each(["pruebas_operaciones", "pruebas_viaticos", "pruebas_multas", "operaciones_eliminar_rutas"])("%s exige confirmación distinta del módulo normal", async (modulo) => {
  const construir = (confirmacion: string) => new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ empresaId: 7, modulo, confirmacion }) });
  expect((await POST(construir("TEST LIMPIAR OPERACIONES"))).status).toBe(400);
  expect(limpiarModuloEmpresa).not.toHaveBeenCalled();
  expect((await POST(construir(`TEST LIMPIAR ${modulo.toUpperCase()}`))).status).toBe(200);
  expect(limpiarModuloEmpresa).toHaveBeenCalledWith(expect.objectContaining({ modulo, empresaId: 7, usuario: "admin" }));
});

it("la antigua confirmación de desactivar rutas nunca autoriza borrado físico", async () => {
  const res = await POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify({
    empresaId: 7, modulo: "operaciones_rutas", confirmacion: "TEST LIMPIAR OPERACIONES_RUTAS",
  }) }));
  expect(res.status).toBe(400);
  expect(limpiarModuloEmpresa).not.toHaveBeenCalled();
});
