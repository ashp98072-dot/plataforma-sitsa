import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenant: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn(() => { throw new Error("No debe iniciar motor estando fresh"); }) }));
import { requireTenant } from "@/lib/tenant";
import { query, execute, getPool } from "@/lib/db";
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  // Respuestas vacías: sin candidatos pendientes, política normal y sin alertas.
  // Recordatorios, Flota y sincronización son los helpers REALES, no mocks.
  vi.mocked(query).mockResolvedValue([] as never);
  vi.mocked(requireTenant).mockResolvedValue({ session: { id: 5, rol: "Admin" }, empresa: { id: 701 } } as never);
});

it("Admin fresh: 16 SELECT en cuerpo cold / 15 warm; sync solo 2 SELECT y 0 motores", async () => {
  const ctx = { params: Promise.resolve({ slug: "medicion" }) };
  expect((await GET(new Request("http://local"), ctx)).status).toBe(200);
  expect(query).toHaveBeenCalledTimes(16);
  const syncQueries = vi.mocked(query).mock.calls.filter(([sql]) => sql.includes("rrhh_vacaciones_sync_estado") || sql.includes("FROM configuracion"));
  expect(syncQueries).toHaveLength(2);
  expect(syncQueries.every(([sql]) => sql.trim().startsWith("SELECT"))).toBe(true);
  expect(getPool).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  vi.mocked(query).mockClear();
  await GET(new Request("http://local"), ctx);
  expect(query).toHaveBeenCalledTimes(15); // TTL km ya caliente, no se consulta Flota.
  expect(getPool).not.toHaveBeenCalled();
});
