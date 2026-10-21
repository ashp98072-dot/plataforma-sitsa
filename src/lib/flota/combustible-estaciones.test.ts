import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => m }), query: m.query }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.audit }));
import { guardarEstacion, listarEstaciones, estacionSchema, estacionPatchSchema } from "./combustible-estaciones";
import { estacionesDelProveedor, estacionAlCambiarProveedor } from "./combustible-estaciones-ui";
const actor = { usuarioId: 7, username: "operador" };
beforeEach(() => {
  vi.resetAllMocks();
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes("compras_proveedores")) return [[{ id: 3, activo: 1 }]];
    if (sql.includes("FROM flota_combustible_cargas")) return [[]];
    return [[{ id: 55, proveedor_id: 3, nombre: "Estación", direccion: "Dirección", activo: 0 }]];
  });
  m.execute.mockResolvedValue([{ insertId: 55 }]);
});
it("crea estación ligada al proveedor del tenant y audita dentro de transacción", async () => {
  expect(await guardarEstacion(1, actor, { proveedorId: 3, nombre: " Estación ", direccion: "Refer." })).toBe(55);
  expect(m.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO flota_combustible_estaciones"), [1, 3, "Estación", "Refer.", true, 7, 7]);
  expect(m.audit).toHaveBeenCalledOnce(); expect(m.commit).toHaveBeenCalledOnce();
});
it("PATCH nombre no reactiva ni borra dirección por defaults", async () => {
  expect(estacionPatchSchema.parse({ nombre: "Otra" })).toEqual({ nombre: "Otra" });
  await guardarEstacion(1, actor, { nombre: "Otra" }, 55);
  expect(m.execute.mock.calls[0][1]).toEqual([3, "Otra", "Dirección", false, 7, 1, 55]);
});
it.each([false, true])("desactiva/reactiva con activo=%s sin borrado físico", async activo => {
  await guardarEstacion(1, actor, { activo }, 55);
  expect(m.execute.mock.calls[0][0]).toMatch(/^UPDATE/);
  expect(m.execute.mock.calls[0][1][3]).toBe(activo);
});
it("proveedor obligatorio y nombre acotado", () => {
  expect(estacionSchema.safeParse({ nombre: "A" }).success).toBe(false);
  expect(estacionSchema.safeParse({ proveedorId: 3, nombre: " " }).success).toBe(false);
  expect(estacionSchema.safeParse({ proveedorId: 3, nombre: "a".repeat(151) }).success).toBe(false);
});
it("rechaza proveedor ajeno y no escribe", async () => {
  m.query.mockResolvedValueOnce([[]]);
  await expect(guardarEstacion(1, actor, { proveedorId: 99, nombre: "A" })).rejects.toThrow("Proveedor");
  expect(m.execute).not.toHaveBeenCalled(); expect(m.rollback).toHaveBeenCalledOnce();
});
it("no cambia proveedor de estación utilizada en vales", async () => {
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes("compras_proveedores")) return [[{ id: 4, activo: 1 }]];
    if (sql.includes("flota_combustible_cargas")) return [[{ id: 2 }]];
    return [[{ proveedor_id: 3, nombre: "Estación", activo: 1 }]];
  });
  await expect(guardarEstacion(1, actor, { proveedorId: 4 }, 55)).rejects.toMatchObject({ status: 409 });
});
it("listado parametriza tenant/proveedor/estado y búsqueda literal", async () => {
  m.query.mockResolvedValue([]);
  await listarEstaciones(7, { proveedorId: 3, activo: false, buscar: "%_" });
  expect(m.query).toHaveBeenCalledWith(expect.stringContaining("WHERE e.empresa_id=?"), [7, 3, 3, false, false, "%_", "%_", "%_"]);
});
it("filtra estaciones por proveedor y limpia al cambiarlo", () => {
  const estaciones = [{ id: 1, proveedorId: 3, nombre: "A" }, { id: 2, proveedorId: 4, nombre: "B" }];
  expect(estacionesDelProveedor(estaciones, "3").map(e => e.id)).toEqual([1]);
  expect(estacionAlCambiarProveedor(estaciones, "4", "1")).toBe("");
  expect(estacionAlCambiarProveedor(estaciones, "3", "1")).toBe("1");
});
