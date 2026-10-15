import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), guardar: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: m.guard }));
vi.mock("./combustible-staff", () => ({ guardarCombustibleStaff: m.guardar }));
import { guardarCombustibleHttp } from "./combustible-staff-http";
beforeEach(() => {
  vi.resetAllMocks();
  m.guard.mockResolvedValue({ empresa: { id: 1 }, session: { id: 91, username: "op" } });
  m.guardar.mockResolvedValue(5);
});
function request(fields: Record<string, string> = {}, evidencia = true) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ proveedorId: "3", vehiculoId: "7", numeroVale: "V-1", fechaConsumo: "2026-10-15", tipoCombustible: "diesel", galones: "10.125", monto: "300.50", ...fields })) f.set(k, v);
  if (evidencia) f.set("file", new File(["%PDF-1.7"], "vale.pdf", { type: "application/pdf" }));
  return new Request("http://localhost/x", { method: "POST", body: f });
}
it("POST exige editar antes de leer cuerpo", async () => {
  m.guard.mockResolvedValue({ error: new Response(null, { status: 403 }) });
  expect((await guardarCombustibleHttp(request(), "empresa")).status).toBe(403);
  expect(m.guard).toHaveBeenCalledWith("empresa", "editar"); expect(m.guardar).not.toHaveBeenCalled();
});
it("empresa y registrador vienen del guard, nunca del navegador", async () => {
  expect((await guardarCombustibleHttp(request({ empresaId: "99", username: "otro", pilotoNombre: "falso", creado_por_usuario_id: "999", empleadoId: "0" }), "empresa")).status).toBe(201);
  expect(m.guardar).toHaveBeenCalledWith(1, { usuarioId: 91, username: "op" }, expect.objectContaining({ viajeId: null }), expect.any(File), undefined);
  expect(m.guardar.mock.calls[0][2]).not.toHaveProperty("pilotoNombre");
  expect(m.guardar.mock.calls[0][2]).not.toHaveProperty("creado_por_usuario_id");
});
it.each(["proveedorId", "vehiculoId", "galones", "monto", "fechaConsumo", "numeroVale"])("400 por campo requerido %s", async campo => {
  expect((await guardarCombustibleHttp(request({ [campo]: "" }), "empresa")).status).toBe(400);
  expect(m.guardar).not.toHaveBeenCalled();
});
it("PATCH usa mismo guard y el id validado", async () => {
  expect((await guardarCombustibleHttp(request(), "empresa", 5)).status).toBe(200);
  expect(m.guardar.mock.calls[0][4]).toBe(5);
});
it("ID inválido no escribe", async () => {
  expect((await guardarCombustibleHttp(request(), "empresa", 0)).status).toBe(400);
  expect(m.guardar).not.toHaveBeenCalled();
});
