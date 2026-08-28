import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/tenant", () => ({ requireTenantModulo: vi.fn() }));
vi.mock("@/lib/contabilidad/entidades", () => ({ configurarEntidad: vi.fn(), listarEntidades: vi.fn(), listarAsignaciones: vi.fn(), usuariosAsignables: vi.fn(), EntidadInvalida: class extends Error {} }));
import { requireTenantModulo } from "@/lib/tenant";
import { configurarEntidad, listarEntidades, listarAsignaciones, usuariosAsignables, EntidadInvalida } from "@/lib/contabilidad/entidades";
import { GET, POST } from "./route";
const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const req = () => new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ empresaId: 99, usuario: "falso" }) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantModulo).mockResolvedValue({ empresa: { id: 7 }, session: { id: 1, username: "real", rol: "Admin" } } as never);
  vi.mocked(listarEntidades).mockResolvedValue([]); vi.mocked(listarAsignaciones).mockResolvedValue([]); vi.mocked(usuariosAsignables).mockResolvedValue([]);
  vi.mocked(configurarEntidad).mockResolvedValue(10);
});
it.each([401, 403])("GET y POST respetan guard %s", async (status) => {
  vi.mocked(requireTenantModulo).mockResolvedValue({ error: new Response(null, { status }) } as never);
  expect((await GET(req(), ctx)).status).toBe(status); expect((await POST(req(), ctx)).status).toBe(status);
  expect(listarEntidades).not.toHaveBeenCalled(); expect(configurarEntidad).not.toHaveBeenCalled();
});
it("no Admin solo ve asignadas, sin nombres/asignaciones de otros usuarios", async () => {
  vi.mocked(requireTenantModulo).mockResolvedValue({ empresa: { id: 7 }, session: { id: 2, username: "lector", rol: "Contabilidad" } } as never);
  const r = await GET(req(), ctx);
  expect(listarEntidades).toHaveBeenCalledWith(7, 2, false);
  expect(listarAsignaciones).not.toHaveBeenCalled(); expect(usuariosAsignables).not.toHaveBeenCalled();
  expect(r.headers.get("Cache-Control")).toContain("no-store");
  expect((await POST(req(), ctx)).status).toBe(403);
  expect(configurarEntidad).not.toHaveBeenCalled();
});
it("Admin configura con tenant y actor reales, no los del cuerpo", async () => {
  expect((await POST(req(), ctx)).status).toBe(200);
  expect(requireTenantModulo).toHaveBeenCalledWith("prueba", "contabilidad", true);
  expect(configurarEntidad).toHaveBeenCalledWith(7, "real", expect.anything());
});
it.each(["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"])("esquema pendiente %s devuelve 503 sin DDL", async (code) => {
  vi.mocked(listarEntidades).mockRejectedValueOnce({ code });
  const r = await GET(req(), ctx);
  expect(r.status).toBe(503); expect((await r.json()).codigo).toBe("MIGRACION_PENDIENTE");
  expect(configurarEntidad).not.toHaveBeenCalled();
});
it.each(["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"])("conflicto %s sin SQL privado", async (code) => {
  vi.mocked(configurarEntidad).mockRejectedValueOnce({ code, sql: "privado" });
  const r = await POST(req(), ctx);
  expect(r.status).toBe(409); expect(JSON.stringify(await r.json())).not.toContain("privado");
});
it("error de validación devuelve 400", async () => {
  vi.mocked(configurarEntidad).mockRejectedValueOnce(new EntidadInvalida("Datos inválidos"));
  expect((await POST(req(), ctx)).status).toBe(400);
});
