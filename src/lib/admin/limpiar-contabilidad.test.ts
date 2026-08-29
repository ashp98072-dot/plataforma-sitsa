import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { limpiarModuloEmpresa } from "./limpiar-modulo";
const conn = { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const opts = { empresaId: 7, empresaCodigo: "PRUEBA", usuario: "admin-prueba", usuarioId: 4, modulo: "contabilidad" as const };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.")) return [[{ ok: 1 }]];
    if (sql.includes("FROM empresas")) return [[{ id: 7 }]];
    if (sql.includes("COUNT(*)")) return [[{ n: 0 }]];
    return [[]];
  });
  conn.execute.mockResolvedValue([{ affectedRows: 0 }]);
});
it.each(["cont_cuentas", "cont_asientos", "cont_cxc", "cont_cxp"])("bloquea toda limpieza si %s contiene datos de entidad", async (tabla) => {
  const original = conn.query.getMockImplementation()!;
  conn.query.mockImplementation(async (sql: string, args: unknown[]) => sql.includes("FROM " + tabla + " WHERE") && sql.includes("IS NOT NULL")
    ? [[{ id: 1 }]] : original(sql, args));
  await expect(limpiarModuloEmpresa(opts)).rejects.toThrow("libros separados");
  expect(conn.query.mock.calls[0]).toEqual(["SELECT id FROM empresas WHERE id = ? FOR UPDATE", [7]]);
  expect(conn.execute).not.toHaveBeenCalled();
  expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalledOnce();
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.release).toHaveBeenCalledOnce();
});
it("mantiene limpieza legada transaccional sin tocar clientes ni otras empresas", async () => {
  await limpiarModuloEmpresa(opts);
  expect(conn.execute).toHaveBeenCalledTimes(5);
  for (const [sql, params] of conn.execute.mock.calls) {
    expect(sql).toMatch(/empresa_id = \?/);
    expect(params).toEqual([7]);
    expect(sql).not.toMatch(/clientes|facturas|pagos|empleados|tms_/);
  }
  expect(conn.commit).toHaveBeenCalledOnce();
  expect(registrarAuditoriaTx).toHaveBeenCalledOnce();
});
it("error intermedio revierte toda limpieza", async () => {
  conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }]).mockRejectedValueOnce(new Error("fallo"));
  await expect(limpiarModuloEmpresa(opts)).rejects.toThrow("fallo");
  expect(conn.rollback).toHaveBeenCalledOnce();
  expect(conn.commit).not.toHaveBeenCalled();
});
