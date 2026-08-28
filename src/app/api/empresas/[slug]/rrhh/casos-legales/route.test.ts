import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/casos-legales", async (original) => ({ ...await original<object>(), guardarCaso: vi.fn(), consultarCasos: vi.fn() }));
import { requireTenantRrhh } from "@/lib/tenant";
import { guardarCaso, consultarCasos } from "@/lib/rrhh/casos-legales";
import { GET, POST, PATCH } from "./route";
const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const req = (body: object) => new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 7 }, session: { username: "rrhh" } } as Awaited<ReturnType<typeof requireTenantRrhh>>);
});
it("denegación impide consultas y escrituras", async () => {
  vi.mocked(requireTenantRrhh).mockResolvedValue({ error: NextResponse.json({}, { status: 403 }) });
  expect((await GET(new Request("http://localhost/api"), ctx)).status).toBe(403);
  expect((await POST(req({}), ctx)).status).toBe(403);
  expect((await PATCH(req({}), ctx)).status).toBe(403);
  expect(guardarCaso).not.toHaveBeenCalled();
  expect(consultarCasos).not.toHaveBeenCalled();
});
it("usa empresa y autor del guard e impone editar para escribir", async () => {
  vi.mocked(guardarCaso).mockResolvedValue({ id: 1, version: 1 });
  await POST(req({ titulo: "Caso", descripcion: "Hechos", empleadoId: null, responsableId: 2, empresaId: 99, autor: "admin" }), ctx);
  expect(requireTenantRrhh).toHaveBeenCalledWith("kt-monaco", "bitacora_legal", "editar");
  expect(guardarCaso).toHaveBeenCalledWith(7, "rrhh", { titulo: "Caso", descripcion: "Hechos", empleadoId: null, responsableId: 2 });
});
it("falta de migración devuelve aviso controlado sin ejecutar DDL", async () => {
  vi.mocked(consultarCasos).mockRejectedValue({ code: "ER_NO_SUCH_TABLE" });
  const res = await GET(new Request("http://localhost/api"), ctx);
  expect(res.status).toBe(503);
  expect((await res.json()).error).toContain("migración manual");
  expect(requireTenantRrhh).toHaveBeenCalledWith("kt-monaco", "bitacora_legal", "ver");
});
it("rechaza IDs y JSON inválidos", async () => {
  expect((await GET(new Request("http://localhost/api?id=-1"), ctx)).status).toBe(400);
  expect((await PATCH(req({ id: 1, version: 1 }), ctx)).status).toBe(400);
  expect(guardarCaso).not.toHaveBeenCalled();
});
