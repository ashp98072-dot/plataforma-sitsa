import { beforeEach, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import { liberarReservasPeriodo } from "./planilla-reversion";
import { registrarAuditoriaTx } from "@/lib/auditoria";
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
const conn = { query: vi.fn(), execute: vi.fn() };
let estado: string;
let abono: number;
beforeEach(() => {
  vi.resetAllMocks(); estado = "FINALIZADO"; abono = 0;
  conn.execute.mockResolvedValue([{ affectedRows: 1 }, []]);
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT * FROM rrhh_descuento_cuotas")) return [[{
      id: 8, descuento_id: 2, monto_aplicado: "150.00", estado: "APLICADA",
    }], []];
    if (sql.includes("FROM rrhh_descuentos_maestro")) return [[{ estado, monto_original: 300 }], []];
    if (sql.includes("SELECT monto_aplicado")) return [[{ monto_aplicado: 150 }], []];
    if (sql.includes("FROM rrhh_descuento_abonos")) return [[{ monto: abono }], []];
    if (sql.includes("FROM horas_extra_registros")) return [[{ id: 9, monto: 10, estado: "APLICADA_EN_PLANILLA" }], []];
    throw new Error(sql);
  });
});
const liberar = () => liberarReservasPeriodo(conn as unknown as PoolConnection, 3, 1, "prueba");
it("libera cuotas y horas conservando condiciones y aprobación", async () => {
  await liberar();
  expect(conn.execute.mock.calls[0]).toEqual([expect.stringContaining("monto_aplicado = NULL"), [8, 3, 1]]);
  expect(conn.execute.mock.calls[2]).toEqual([expect.stringContaining("estado = 'APROBADA'"), [3, 9, 1]]);
  const sql = conn.execute.mock.calls.map(([s]) => s).join("\n");
  expect(sql).not.toMatch(/DELETE|monto_programado\s*=|fecha_programada\s*=|numero_cuota\s*=/);
  expect(registrarAuditoriaTx).toHaveBeenCalledTimes(3);
  for (const [read, params] of conn.query.mock.calls) {
    expect(read).toContain("FOR UPDATE");
    expect(read).toContain("empresa_id = ?");
    expect(params[0]).toBe(3);
  }
});
it.each(["PAUSADO", "CANCELADO", "ACTIVO"])("no cambia un descuento %s", async (value) => {
  estado = value; await liberar();
  expect(conn.execute.mock.calls.some(([sql]) => sql.includes("UPDATE rrhh_descuentos_maestro"))).toBe(false);
});
it("no reactiva un descuento ya cubierto por abonos", async () => {
  abono = 150; await liberar();
  expect(conn.execute.mock.calls.some(([sql]) => sql.includes("UPDATE rrhh_descuentos_maestro"))).toBe(false);
});
it("propaga error intermedio al dueño de la transacción", async () => {
  conn.execute.mockRejectedValueOnce(new Error("Fallo intermedio"));
  await expect(liberar()).rejects.toThrow("Fallo intermedio");
  expect(registrarAuditoriaTx).not.toHaveBeenCalled();
});
