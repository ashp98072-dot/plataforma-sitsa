import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(), conn: { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }, audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: mocks.query, getPool: () => ({ getConnection: async () => mocks.conn }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: mocks.audit }));
import { guardarProveedor, listarProveedores, obtenerProveedor } from "./proveedores";
import { crearProveedorSchema, editarProveedorSchema } from "./proveedor-schema";

beforeEach(() => { vi.resetAllMocks(); mocks.conn.execute.mockResolvedValue([{ insertId: 7, affectedRows: 1 }]); });
describe("validación", () => {
  it("nombre requerido", () => { expect(crearProveedorSchema.safeParse({ nombre_comercial: " " }).success).toBe(false); });
  it("trim, null y NIT opcional", () => { expect(crearProveedorSchema.parse({ nombre_comercial: " A ", correo: " ", nit: " " })).toEqual({ nombre_comercial: "A", correo: null, nit: null }); expect(crearProveedorSchema.parse({ nombre_comercial: "A" })).not.toHaveProperty("nit"); });
  it.each([-1, 1.5, "3"])("rechaza días crédito %s", value => { expect(crearProveedorSchema.safeParse({ nombre_comercial: "A", dias_credito: value }).success).toBe(false); });
  it("acepta cero y rechaza campos tenant/auditoría", () => { expect(crearProveedorSchema.safeParse({ nombre_comercial: "A", dias_credito: 0 }).success).toBe(true); expect(editarProveedorSchema.safeParse({ empresa_id: 2 }).success).toBe(false); });
});
describe("modelo tenant + auditoría transaccional", () => {
  it("crea tenant A y audita sin cuenta bancaria", async () => {
    expect(await guardarProveedor(1, 8, "admin", { nombre_comercial: "A", numero_cuenta: "privada" })).toBe(7);
    expect(mocks.conn.execute.mock.calls[0][0]).toContain("INSERT INTO compras_proveedores");
    expect(mocks.conn.execute.mock.calls[0][1][0]).toBe(1);
    const audit = mocks.audit.mock.calls[0]; expect(audit[0]).toBe(mocks.conn); expect(audit[1]).toMatchObject({ empresaId: 1, usuario: "admin", accion: "crear_proveedor_compras" });
    expect(audit[1].detalle).not.toContain("privada"); expect(mocks.conn.commit).toHaveBeenCalledOnce();
  });
  it("lista tenant A con búsqueda parametrizada", async () => {
    mocks.query.mockResolvedValue([{ id: 7, empresa_id: 1, nombre_comercial: "A", activo: 1 }]);
    expect(await listarProveedores(1, "a%" )).toHaveLength(1);
    expect(mocks.query.mock.calls[0][0]).toContain("WHERE empresa_id = ?"); expect(mocks.query.mock.calls[0][1]).toEqual([1, "a%", "a%", "a%", "a%"]);
  });
  it("id de tenant B no encontrado", async () => {
    mocks.query.mockResolvedValue([]); expect(await obtenerProveedor(1, 20)).toBeNull(); expect(mocks.query.mock.calls[0][1]).toEqual([1, 20]);
    mocks.conn.query.mockResolvedValue([[]]); expect(await guardarProveedor(1, 8, "admin", { activo: false }, 20)).toBeNull(); expect(mocks.conn.execute).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.conn.query.mock.calls[0][1]).toEqual([1, 20]);
  });
  it.each([
    [true, { nombre_comercial: "Editado" }, "editar_proveedor_compras"],
    [true, { activo: false }, "inactivar_proveedor_compras"],
    [false, { activo: true }, "reactivar_proveedor_compras"],
  ] as const)("actualiza/audita %s %s", async (activo, datos, accion) => {
    mocks.conn.query.mockResolvedValue([[{ id: 7, empresa_id: 1, nombre_comercial: "A", activo: activo ? 1 : 0, numero_cuenta: "privada" }]]);
    await guardarProveedor(1, 8, "admin", datos, 7);
    const [sql, params] = mocks.conn.execute.mock.calls[0]; expect(sql).toContain("WHERE empresa_id = ? AND id = ?"); expect(sql).not.toMatch(/DELETE/i); expect(params.slice(-2)).toEqual([1, 7]);
    expect(mocks.audit.mock.calls[0][1].accion).toBe(accion); expect(mocks.audit.mock.calls[0][1].detalle).not.toContain("privada"); expect(mocks.conn.query.mock.calls[0][0]).toContain("FOR UPDATE");
  });
  it("fallo de auditoría revierte sin commit", async () => { mocks.audit.mockRejectedValue(new Error("fallo")); await expect(guardarProveedor(1, 8, "admin", { nombre_comercial: "A" })).rejects.toThrow("fallo"); expect(mocks.conn.rollback).toHaveBeenCalledOnce(); expect(mocks.conn.commit).not.toHaveBeenCalled(); expect(mocks.conn.release).toHaveBeenCalledOnce(); });
});
