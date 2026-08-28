import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { guardarCaso, consultarCasos, casoSchema } from "./casos-legales";
const conn = { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const input = { titulo: "Seguimiento", descripcion: "Hechos", empleadoId: 20, responsableId: 10 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as unknown as ReturnType<typeof getPool>);
  conn.query.mockImplementation(async (sql: string) => sql.includes("FROM empleados") ? [[{ id: 10, nombre: "Responsable", estado: "Activo" }, { id: 20, nombre: "Empleado" }]] : [[{ id: 1, version: 1 }]]);
  conn.execute.mockResolvedValue([{ insertId: 1, affectedRows: 1 }]);
});
it("crea caso, primer seguimiento y auditoría en misma transacción", async () => {
  expect(await guardarCaso(7, "rrhh", input)).toEqual({ id: 1, version: 1 });
  expect(conn.query.mock.calls[0][1]).toEqual([7, 10, 20]);
  expect(conn.query.mock.calls[0][0]).toContain("FOR UPDATE");
  expect(conn.execute).toHaveBeenCalledTimes(2);
  expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ empresaId: 7, usuario: "rrhh" }));
  expect(conn.commit).toHaveBeenCalledOnce();
});
it("rechaza empleado o responsable de otra empresa antes de insertar", async () => {
  conn.query.mockResolvedValue([[]]);
  await expect(guardarCaso(7, "rrhh", input)).rejects.toThrow("no válido");
  expect(conn.execute).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalledOnce();
});
it("conflicto concurrente no pisa el seguimiento del otro usuario", async () => {
  await expect(guardarCaso(7, "rrhh", { id: 1, version: 2, comentario: "Cambio", estado: "Cerrado", responsableId: 10 })).rejects.toMatchObject({ status: 409 });
  expect(conn.execute).not.toHaveBeenCalled();
});
it("no modifica casos fuera de la empresa", async () => {
  conn.query.mockResolvedValue([[]]);
  await expect(guardarCaso(7, "rrhh", { id: 1, version: 1, comentario: "Cambio", estado: "Cerrado", responsableId: 10 })).rejects.toMatchObject({ status: 404 });
  expect(conn.query.mock.calls[0][1]).toEqual([7, 1]);
  expect(conn.execute).not.toHaveBeenCalled();
});
it("agrega seguimiento sin reescribir descripción ni historia", async () => {
  await guardarCaso(7, "rrhh", { id: 1, version: 1, comentario: "Cambio", estado: "Cerrado", responsableId: 10 });
  expect(conn.execute.mock.calls[0][0]).not.toContain("descripcion");
  expect(conn.execute.mock.calls[1][0]).toContain("INSERT INTO rrhh_casos_legales_seguimientos");
  expect(conn.execute.mock.calls[1][1]).toEqual([7, 1, 2, "Cambio", "Cerrado", "Responsable", "rrhh"]);
});
it("fallo de auditoría revierte todos los cambios", async () => {
  vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("DB"));
  await expect(guardarCaso(7, "rrhh", input)).rejects.toThrow();
  expect(conn.rollback).toHaveBeenCalledOnce();
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.release).toHaveBeenCalledOnce();
});
it("no consulta historial de un caso inexistente o ajeno", async () => {
  vi.mocked(query).mockResolvedValue([]);
  await expect(consultarCasos(7, 99)).rejects.toMatchObject({ status: 404 });
  expect(query).toHaveBeenCalledOnce();
});
it("no acepta título vacío ni IDs inválidos", () => {
  expect(casoSchema.safeParse({ ...input, titulo: "  " }).success).toBe(false);
  expect(casoSchema.safeParse({ ...input, responsableId: -1 }).success).toBe(false);
});
