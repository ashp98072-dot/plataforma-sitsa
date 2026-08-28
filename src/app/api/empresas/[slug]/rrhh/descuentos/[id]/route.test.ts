import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/admin/limpiar-pruebas", () => ({ eliminarDescuentoPrueba: vi.fn() }));
vi.mock("@/lib/rrhh/descuentos", () => ({}));
import { requireTenantRrhh } from "@/lib/tenant";
import { eliminarDescuentoPrueba } from "@/lib/admin/limpiar-pruebas";
import { LimpiezaBloqueada } from "@/lib/admin/limpiar-operaciones";
import { DELETE } from "./route";
const ctx = { params: Promise.resolve({ slug: "kt-monaco", id: "10" }) };
const req = (confirmacion = "ELIMINAR DESCUENTO 10") => new Request("http://localhost/api", { method: "DELETE", body: JSON.stringify({ confirmacion, empresaId: 99, usuario: "otro" }) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 7 }, session: { rol: "Admin", username: "admin" } } as Awaited<ReturnType<typeof requireTenantRrhh>>);
  vi.mocked(eliminarDescuentoPrueba).mockResolvedValue({ descuentos: 1 });
});
it("rechaza sin sesión/empresa autorizada", async () => {
  vi.mocked(requireTenantRrhh).mockResolvedValue({ error: NextResponse.json({}, { status: 401 }) });
  expect((await DELETE(req(), ctx)).status).toBe(401);
  expect(eliminarDescuentoPrueba).not.toHaveBeenCalled();
});
it("RRHH con editar no puede hacer borrado físico de pruebas", async () => {
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 7 }, session: { rol: "RRHH", username: "rrhh" } } as Awaited<ReturnType<typeof requireTenantRrhh>>);
  expect((await DELETE(req(), ctx)).status).toBe(403);
  expect(eliminarDescuentoPrueba).not.toHaveBeenCalled();
});
it("exige confirmación del ID exacto y usa actor/empresa del servidor", async () => {
  expect((await DELETE(req("ELIMINAR DESCUENTO 11"), ctx)).status).toBe(400);
  expect(eliminarDescuentoPrueba).not.toHaveBeenCalled();
  expect((await DELETE(req(), ctx)).status).toBe(200);
  expect(eliminarDescuentoPrueba).toHaveBeenCalledWith(7, 10, "admin");
});
it("rechaza ID inválido y expone bloqueo de planilla como 409", async () => {
  expect((await DELETE(req(), { params: Promise.resolve({ slug: "kt-monaco", id: "-1" }) })).status).toBe(400);
  vi.mocked(eliminarDescuentoPrueba).mockRejectedValue(new LimpiezaBloqueada("Limpia primero Planillas"));
  expect((await DELETE(req(), ctx)).status).toBe(409);
});
