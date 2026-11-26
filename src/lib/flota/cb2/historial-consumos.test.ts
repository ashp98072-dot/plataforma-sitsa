import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => ({ query: mock.query, beginTransaction: mock.begin, commit: mock.commit, rollback: mock.rollback, release: mock.release }) }) }));
import { historialConsumos } from "./historial-consumos";
beforeEach(() => { vi.clearAllMocks(); });
describe("historial cronológico", () => {
 it("usa un corte por empresa y avanza con fecha e ID, incluyendo empates", async () => {
  mock.query.mockResolvedValueOnce([[],[]]).mockResolvedValueOnce([[{ corte: 20 }],[]]).mockResolvedValueOnce([[{ id: 19, fecha: "2026-10-03" }, { id: 17, fecha: "2026-10-03" }, { id: 16, fecha: "2026-10-02" }],[]]);
  const primera = await historialConsumos(7, { desde: "2026-10-01", piloto: "Ana" }, undefined, 2);
  expect(primera.items.map(r=>r.id)).toEqual([19,17]); expect(primera.siguiente).toEqual({ corte: 20, fecha: "2026-10-03", id: 17 });
  mock.query.mockResolvedValueOnce([[],[]]).mockResolvedValueOnce([[{ id: 16, fecha: "2026-10-02" }],[]]);
  const segunda = await historialConsumos(7, { desde: "2026-10-01", piloto: "Ana" }, primera.siguiente!, 2);
  expect(segunda.items.map(r=>r.id)).toEqual([16]); expect(segunda.siguiente).toBeNull();
  const [sql,args] = mock.query.mock.calls.at(-1)!;
  expect(sql).toContain("c.empresa_id=?"); expect(sql).toContain("c.id<=?"); expect(sql).toContain("c.fecha_consumo<? OR (c.fecha_consumo=? AND c.id<?)"); expect(sql).toContain("ORDER BY c.fecha_consumo DESC,c.id DESC");
  expect(args).toEqual([7,20,"2026-10-01","Ana","2026-10-03","2026-10-03",17,3]);
 });
 it("rechaza rangos invertidos antes de consultar", async () => { await expect(historialConsumos(1, { desde:"2026-11-01", hasta:"2026-10-01" })).rejects.toMatchObject({ status: 400 }); expect(mock.query).not.toHaveBeenCalled(); });
});
