import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { configurarEntidad, listarEntidades } from "./entidades";
const conn = { beginTransaction: vi.fn(), query: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM cont_entidades")) return [[{ id: 10, activa: 1 }]];
    if (sql.includes("FROM usuarios")) return [[{ id: 20, activo: 1, rol_global: "Contabilidad", acceso_todas_empresas: 0 }]];
    if (sql.includes("FROM usuario_empresa")) return [[{ usuario_id: 20 }]];
    throw new Error("Consulta no prevista");
  });
  conn.execute.mockResolvedValue([{ insertId: 10, affectedRows: 1 }]);
  vi.mocked(query).mockResolvedValue([]);
});
it("filtra libros activos por empresa tras el guard central sin asignación duplicada", async () => {
  await listarEntidades(7, false);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("empresa_id = ? AND activa = 1"), [7]);
  expect(vi.mocked(query).mock.calls[0][0]).not.toContain("cont_entidad_usuarios");
  await listarEntidades(7, true);
  expect(vi.mocked(query).mock.calls[1][1]).toEqual([7]);
});
it("crea entidad con empresa/actor del servidor y auditoría transaccional", async () => {
  await configurarEntidad(7, "admin", { accion: "crear", codigo: "kt", nombre: "Entidad ficticia", empresaId: 99 });
  expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO cont_entidades"), [7, "KT", "Entidad ficticia"]);
  expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ empresaId: 7, usuario: "admin" }));
  expect(conn.commit).toHaveBeenCalledOnce(); expect(conn.release).toHaveBeenCalledOnce();
});
it.each(["ver", "editar", "revocar"])("rechaza la antigua acción de acceso %s sin escribir", async (acceso) => {
  await expect(configurarEntidad(7, "admin", { accion: "acceso", entidadId: 10, usuarioId: 20, acceso })).rejects.toThrow();
  expect(getPool).not.toHaveBeenCalled();
});
it("rechaza entidad de otro tenant o inexistente antes de escribir", async () => {
  conn.query.mockResolvedValueOnce([[]]);
  await expect(configurarEntidad(7, "admin", { accion: "estado", entidadId: 10, activa: false })).rejects.toThrow("esta empresa");
  expect(conn.execute).not.toHaveBeenCalled(); expect(conn.rollback).toHaveBeenCalledOnce();
});
it.each(["entidad", "usuario", "empresa"])("rechaza asignación inválida: %s", async (caso) => {
  if (caso === "entidad") conn.query.mockResolvedValueOnce([[{ id: 10, activa: 0 }]]);
  if (caso === "usuario") conn.query.mockResolvedValueOnce([[{ id: 10, activa: 1 }]]).mockResolvedValueOnce([[{ id: 20, activo: 0 }]]);
  if (caso === "empresa") conn.query.mockResolvedValueOnce([[{ id: 10, activa: 1 }]]).mockResolvedValueOnce([[{ id: 20, activo: 1, acceso_todas_empresas: 0 }]]).mockResolvedValueOnce([[]]);
  await expect(configurarEntidad(7, "admin", { accion: "acceso", entidadId: 10, usuarioId: 20, acceso: "ver" })).rejects.toThrow();
  expect(conn.execute).not.toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled();
});
it("desactiva sin borrar ni alterar cuentas", async () => {
  await configurarEntidad(7, "admin", { accion: "estado", entidadId: 10, activa: false });
  expect(conn.execute).toHaveBeenCalledWith("UPDATE cont_entidades SET activa = ? WHERE empresa_id = ? AND id = ?", [0, 7, 10]);
});
it("fallo de auditoría revierte la mutación completa", async () => {
  vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("auditoria"));
  await expect(configurarEntidad(7, "admin", { accion: "crear", codigo: "X", nombre: "Ficticia" })).rejects.toThrow("auditoria");
  expect(conn.rollback).toHaveBeenCalledOnce(); expect(conn.commit).not.toHaveBeenCalled(); expect(conn.release).toHaveBeenCalledOnce();
});
it("entrada inválida no adquiere conexión", async () => {
  await expect(configurarEntidad(7, "admin", { accion: "crear", codigo: "", nombre: "" })).rejects.toThrow();
  expect(getPool).not.toHaveBeenCalled();
});
it("migración y esquema coinciden; solo CREATE idempotente con RESTRICT", () => {
  const sql = readFileSync(resolve("sql/migrate-2026-08-contabilidad-entidades.sql"), "utf8");
  const esquema = readFileSync(resolve("sql/schema.sql"), "utf8");
  const normalizar = (s: string) => s.replace(/\s+/g, " ").trim();
  const tablas = sql.match(/CREATE TABLE IF NOT EXISTS[\s\S]*?ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;/g)!;
  expect(tablas).toHaveLength(2);
  for (const tabla of tablas) expect(normalizar(esquema)).toContain(normalizar(tabla));
  const ejecutable = sql.replace(/--[^\n]*/g, "").replace(/ON DELETE RESTRICT/g, "").replace(/ON UPDATE CURRENT_TIMESTAMP/g, "");
  expect(ejecutable).not.toMatch(/\b(ALTER|DROP|DELETE|INSERT|UPDATE|CASCADE|TRUNCATE)\b/i);
  expect(sql).toContain("FOREIGN KEY (empresa_id, entidad_id)");
});
