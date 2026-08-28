import { beforeEach, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { eliminarDescuentoPrueba, limpiarMultasPrueba } from "./limpiar-pruebas";
import { limpiarModuloEmpresa } from "./limpiar-modulo";
const conn = { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
let filas: Record<string, Record<string, unknown>[]>;
const borradas = () => conn.query.mock.calls.filter(([s]) => String(s).startsWith("DELETE"));
beforeEach(() => {
  vi.resetAllMocks();
  filas = { rrhh_descuentos_maestro: [{ id: 10, empresa_id: 7, codigo: "TEST", monto_original: 20 }], rrhh_descuento_cuotas: [{ id: 11, empresa_id: 7, descuento_id: 10, planilla_periodo_id: null }], rrhh_descuento_abonos: [{ id: 12, empresa_id: 7, descuento_id: 10 }], inventario_rrhh_entregas: [{ id: 20, empresa_id: 7, descuento_id: 10 }] };
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.TABLES")) return [[{ ENGINE: "InnoDB" }]];
    if (sql.includes("information_schema.tables")) return [[{ ok: 1 }]];
    if (sql.includes("KEY_COLUMN_USAGE") || sql.includes("information_schema.COLUMNS")) return [[]];
    if (sql.startsWith("SELECT *")) return [filas[sql.match(/FROM `([^`]+)`/)![1]] ?? []];
    if (sql.startsWith("SELECT COUNT")) return [[{ n: 0 }]];
    if (sql.startsWith("DELETE")) return [{ affectedRows: 1 }];
    throw new Error(`Consulta inesperada ${sql}`);
  });
  conn.execute.mockResolvedValue([{ affectedRows: 1 }]);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as unknown as ReturnType<typeof getPool>);
});
it("elimina solo el descuento seleccionado; conserva entrega con vínculo nulo", async () => {
  await eliminarDescuentoPrueba(7, 10, "admin");
  expect(borradas().map(([, params]) => params)).toEqual([[[11]], [[12]], [[10]]]);
  const lectura = conn.query.mock.calls.find(([s]) => String(s).includes("FROM `rrhh_descuentos_maestro`"))!;
  expect(lectura[0]).toContain("empresa_id = ? AND id = ?");
  expect(lectura[1]).toEqual([7, 10]);
  expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("SET descuento_id = NULL WHERE empresa_id = ? AND descuento_id = ?"), [7, 10]);
  expect(conn.commit).toHaveBeenCalledOnce();
  expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ usuario: "admin", accion: "eliminar_descuento_prueba" }));
});
it("un descuento con multa exige la limpieza conjunta", async () => {
  filas.ops_multas = [{ id: 1, empresa_id: 7, rrhh_descuento_id: 10 }];
  await expect(eliminarDescuentoPrueba(7, 10, "admin")).rejects.toThrow("ambos juntos");
  expect(borradas()).toHaveLength(0);
});
it("cuotas reservadas o aplicadas en planillas bloquean antes de escribir", async () => {
  filas.rrhh_descuento_cuotas[0].planilla_periodo_id = 9;
  await expect(eliminarDescuentoPrueba(7, 10, "admin")).rejects.toThrow("primero Planillas");
  expect(borradas()).toHaveLength(0);
  expect(conn.execute).not.toHaveBeenCalled();
});
it("rechaza vínculos entre empresas y descuentos inexistentes", async () => {
  filas.rrhh_descuento_cuotas[0].empresa_id = 8;
  await expect(eliminarDescuentoPrueba(7, 10, "admin")).rejects.toThrow("entre empresas");
  filas.rrhh_descuentos_maestro = [];
  await expect(eliminarDescuentoPrueba(7, 10, "admin")).rejects.toThrow("no encontrado");
  expect(borradas()).toHaveLength(0);
});
it("fallo de auditoría revierte el borrado y la desvinculación", async () => {
  vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("audit"));
  await expect(eliminarDescuentoPrueba(7, 10, "admin")).rejects.toThrow("audit");
  expect(conn.rollback).toHaveBeenCalledOnce();
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.release).toHaveBeenCalledOnce();
});
it("multas de pruebas borra documentos, descuento y revisión en orden RESTRICT", async () => {
  filas.ops_multas = [{ id: 30, empresa_id: 7, estado_pago: "PAGADA", rrhh_descuento_id: 10 }];
  filas.ops_multa_documentos = [{ id: 31, empresa_id: 7, multa_id: 30 }];
  filas.ops_multas_revisiones = [{ id: 32, empresa_id: 7 }];
  const out = await limpiarMultasPrueba(conn as unknown as PoolConnection, 7);
  expect(Object.keys(out)).toEqual(["ops_multa_documentos", "rrhh_descuento_cuotas", "rrhh_descuento_abonos", "ops_multas", "rrhh_descuentos_maestro", "ops_multas_revisiones"]);
  const cuotaRead = conn.query.mock.calls.find(([s]) => String(s).startsWith("SELECT * FROM `rrhh_descuento_cuotas`"))!;
  expect(cuotaRead[0]).toContain("descuento_id IN (SELECT rrhh_descuento_id FROM ops_multas WHERE empresa_id = ?)");
  expect(borradas().some(([s]) => String(s).includes("flota_vehiculos"))).toBe(false);
});
it("fallo al borrar multas revierte también documentos y cuotas anteriores", async () => {
  filas.ops_multas = [{ id: 30, empresa_id: 7 }];
  const normal = conn.query.getMockImplementation()!;
  conn.query.mockImplementation(async (...args) => {
    if (String(args[0]).startsWith("DELETE FROM `ops_multas`")) throw new Error("intermedio");
    return normal(...args);
  });
  await expect(limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "pruebas_multas", usuario: "admin", usuarioId: 1 })).rejects.toThrow("intermedio");
  expect(conn.rollback).toHaveBeenCalledOnce();
  expect(conn.commit).not.toHaveBeenCalled();
});
