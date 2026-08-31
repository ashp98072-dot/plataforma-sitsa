import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/vacaciones", () => ({ sincronizarVacacionesEmpleadosActivos: vi.fn() }));
import { query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";
import { sincronizarVacacionesEmpleadosActivos } from "@/lib/rrhh/vacaciones";
import { GET } from "./route";
const ctx = { params: Promise.resolve({ slug: "prueba" }) };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 7 } } as never);
  vi.mocked(query).mockResolvedValue([]);
});
it("usa contratación y tenant del guard, conservando umbral y sincronización", async () => {
  vi.mocked(query).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 2, nombre: "Prueba", fecha_contratacion: "2020-01-01", dias_disponibles: 15 }] as never);
  const res = await GET(new Request("https://local.test/?empresaId=99"), ctx);
  const data = await res.json();
  expect(data.colaboradoresConQuinceDias[0].fechaContratacion).toBe("2020-01-01");
  expect(sincronizarVacacionesEmpleadosActivos).toHaveBeenCalledWith(7);
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining("DATE_FORMAT(e.fecha_alta"), [7]);
  expect(vi.mocked(query).mock.calls[1][0]).toContain("HAVING SUM(s.dias_disponibles) >= 15");
  expect(res.headers.get("Cache-Control")).toContain("no-store");
});
it("sin permiso no consulta ni sincroniza", async () => {
  vi.mocked(requireTenantRrhh).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
  expect((await GET(new Request("https://local.test/"), ctx)).status).toBe(403);
  expect(query).not.toHaveBeenCalled();
  expect(sincronizarVacacionesEmpleadosActivos).not.toHaveBeenCalled();
});
