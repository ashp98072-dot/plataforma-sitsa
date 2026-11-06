import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => m }) }));
import { movimientosMayorBancario } from "./bancos-mayor";
const a = { entidadId: 5, usuarioId: 91, admin: false };
let entidades: object[], bancos: object[], lineas: object[];
beforeEach(() => {
  vi.resetAllMocks(); entidades = [{ id: 5, activa: 1 }]; bancos = [{ id: 10, cuenta_id: 20, codigo: "11103001", nombre: "Banco sintético" }];
  lineas = [{ detalle_id: 1, asiento_id: 2, numero: "A1", fecha: "2026-01-01", debe: "999999999999.99", haber: "0.00", glosa: "privado" }];
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM cont_entidades")) return [entidades];
    if (sql.includes("FROM cont_cuentas_bancarias")) return [bancos];
    if (sql.includes("FROM cont_asiento_detalle")) return [lineas];
    return [[]];
  });
});
it("comparte consulta del Mayor, exactitud DECIMAL, sin saldo ni glosas", async () => {
  const r = await movimientosMayorBancario(7, a, 10, { desde: "2026-01-01", hasta: "2026-01-31" });
  expect(r.movimientos).toEqual([{ detalleId: 1, asientoId: 2, numero: "A1", fecha: "2026-01-01", estado: "Registrado", debe: "999999999999.99", haber: "0.00" }]);
  expect(r.procedencia).toBe("LIBRO_MAYOR"); expect(JSON.stringify(r)).not.toContain("privado"); expect(r).not.toHaveProperty("saldoInicial");
  const [sql, params] = m.query.mock.calls.find(([s]) => s.includes("FROM cont_asiento_detalle"))!;
  expect(sql).toContain("d.empresa_id = a.empresa_id"); expect(sql).toContain("d.entidad_id = a.entidad_id");
  expect(sql).toContain("a.estado = 'Registrado'"); expect(sql).toContain("ORDER BY a.fecha, a.id, d.id");
  expect(params).toEqual([7, 5, "2026-01-01", "2026-01-31", 20, 5001]);
  expect(m.query.mock.calls.some(([s]) => s.includes("START TRANSACTION READ ONLY"))).toBe(true);
  expect(m.commit).toHaveBeenCalled(); expect(m.release).toHaveBeenCalled();
});
it("vacío no inventa movimientos; líneas iguales conservan identidades", async () => {
  lineas = []; expect((await movimientosMayorBancario(7, a, 10, {})).movimientos).toEqual([]);
  lineas = [1, 2].map(id => ({ detalle_id: id, asiento_id: 2, numero: "A", fecha: "2026-01-01", debe: "0.10", haber: "0" }));
  expect((await movimientosMayorBancario(7, a, 10, {})).movimientos.map(m => m.detalleId)).toEqual([1, 2]);
});
it("entidad inexistente/inactiva o banco ajeno no consulta líneas", async () => {
  entidades = []; await expect(movimientosMayorBancario(7, a, 10, {})).rejects.toMatchObject({ status: 404 });
  entidades = [{ id: 5, activa: 0 }]; await expect(movimientosMayorBancario(7, a, 10, {})).rejects.toMatchObject({ status: 404 });
  entidades = [{ id: 5, activa: 1 }]; bancos = []; await expect(movimientosMayorBancario(7, a, 10, {})).rejects.toMatchObject({ status: 404 });
  expect(m.query.mock.calls.some(([s]) => s.includes("FROM cont_asiento_detalle"))).toBe(false);
  expect(m.rollback).toHaveBeenCalled(); expect(m.release).toHaveBeenCalled();
});
it("Admin consulta entidad inactiva; banco inactivo no oculta historia", async () => {
  entidades = [{ id: 5, activa: 0 }]; expect((await movimientosMayorBancario(7, { ...a, admin: true }, 10, {})).movimientos).toHaveLength(1);
  const [sql, params] = m.query.mock.calls.find(([s]) => s.includes("FROM cont_cuentas_bancarias"))!;
  expect(params).toEqual([7, 5, 10]); expect(sql).not.toContain("activa=1");
});
it("más de 5000 líneas falla explícitamente sin truncar", async () => {
  lineas = Array(5001).fill({}); await expect(movimientosMayorBancario(7, a, 10, {})).rejects.toMatchObject({ status: 422 });
  expect(m.commit).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalled();
});
it("período se resuelve por empresa/entidad y usa sus fechas inclusivas", async () => {
  const original = m.query.getMockImplementation()!;
  m.query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("FROM cont_periodos p")) {
      expect(params).toEqual([7, 5, 12]);
      return [[{ id: 12, ejercicio_id: 1, ejercicio: "2026", codigo: "ENE", estado: "CONFIGURADO", version: 1, revision_cierre: 0, desde: "2026-01-01", hasta: "2026-01-31" }]];
    }
    return original(sql, params);
  });
  const r = await movimientosMayorBancario(7, a, 10, { periodoId: 12 });
  expect(r).toMatchObject({ desde: "2026-01-01", hasta: "2026-01-31", periodoSeleccionado: { id: 12 } });
  expect(m.query.mock.calls.find(([s]) => s.includes("FROM cont_asiento_detalle"))![1]).toEqual([7, 5, "2026-01-01", "2026-01-31", 20, 5001]);
});
