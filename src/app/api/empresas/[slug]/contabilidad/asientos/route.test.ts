import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/tenant", () => ({ requireTenantModulo: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/contabilidad/asientos", () => ({ registrarAsiento: vi.fn(), AsientoInvalido: class extends Error {} }));
import { requireTenantModulo } from "@/lib/tenant";
import { registrarAsiento, AsientoInvalido } from "@/lib/contabilidad/asientos";
import { POST } from "./route";
const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const req = (body = "{}") => new Request("http://localhost/api/prueba?entidad=9", { method: "POST", body });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantModulo).mockResolvedValue({ empresa: { id: 7 }, session: { username: "real", id: 4, rol: "Contabilidad" } } as never);
  vi.mocked(registrarAsiento).mockResolvedValue(10);
});
it.each([401, 403])("rechaza acceso %s antes de tocar datos", async (status) => {
  vi.mocked(requireTenantModulo).mockResolvedValue({ error: new Response(null, { status }) } as never);
  expect((await POST(req(), ctx)).status).toBe(status);
  expect(registrarAsiento).not.toHaveBeenCalled();
});
it("empresa y usuario provienen del guard, conserva respuesta compatible", async () => {
  const r = await POST(req(JSON.stringify({ empresaId: 99, usuario: "falso" })), ctx);
  expect(requireTenantModulo).toHaveBeenCalledWith("prueba", "contabilidad", true);
  expect(registrarAsiento).toHaveBeenCalledWith(7, "real", expect.anything(), { entidadId: 9, usuarioId: 4, admin: false });
  expect(await r.json()).toEqual({ id: 10, mensaje: "Asiento registrado." });
});
it("JSON inválido llega como null al validador y responde 400", async () => {
  vi.mocked(registrarAsiento).mockRejectedValueOnce(new AsientoInvalido("Datos inválidos"));
  expect((await POST(req("{"), ctx)).status).toBe(400);
  expect(registrarAsiento).toHaveBeenCalledWith(7, "real", null, { entidadId: 9, usuarioId: 4, admin: false });
});
it.each(["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"])("conflicto %s responde 409 sin SQL privado", async (code) => {
  vi.mocked(registrarAsiento).mockRejectedValueOnce({ code, sql: "dato privado" });
  const r = await POST(req(), ctx);
  expect(r.status).toBe(409);
  expect(JSON.stringify(await r.json())).not.toContain("dato privado");
});
it("error inesperado no publica detalles y recomienda verificar antes de reintentar", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(registrarAsiento).mockRejectedValueOnce(new Error("dato privado"));
  const r = await POST(req(), ctx);
  expect(r.status).toBe(500);
  expect(JSON.stringify(await r.json())).not.toContain("dato privado");
  log.mockRestore();
});
