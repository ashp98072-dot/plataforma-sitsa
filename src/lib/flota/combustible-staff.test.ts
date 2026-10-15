import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), subir: vi.fn(), borrar: vi.fn(), vehiculo: vi.fn(), auditar: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => m }), query: m.query }));
vi.mock("./acceso", () => ({ obtenerVehiculoAccesibleTx: m.vehiculo, predicadoVehiculoAccesible: () => "v.empresa_id = ? OR EXISTS (SELECT 1 FROM flota_vehiculo_acceso a WHERE a.empresa_id=?)" }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.auditar }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: m.subir, borrarUpload: m.borrar, contentTypeFor: () => "application/pdf", validarRutaArchivoEmpresa: () => true }));
import { catalogosCombustible, guardarCombustibleStaff } from "./combustible-staff";
import { combustibleStaffSchema, precioCalculado } from "./combustible-staff-schema";
import { listarCargasCombustibleRevision } from "./combustible";
const input = { proveedorId: 3, vehiculoId: 7, viajeId: null, numeroVale: "A-1", fechaConsumo: "2026-10-15", tipoCombustible: "diesel" as const, galones: "10.125", monto: "300.50", km: null, gasolinera: "Estación", observaciones: "Control operativo" };
const file = { name: "vale.pdf", size: 10, arrayBuffer: async () => new ArrayBuffer(10) };
let estado = "PENDIENTE";
let duplicado = false;
beforeEach(() => {
  vi.resetAllMocks(); estado = "PENDIENTE"; duplicado = false;
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM compras_proveedores")) return [[{ id: 3, activo: 1 }]];
    if (sql.includes("SELECT id, estado")) return [[{ id: 11, estado, vehiculo_id: 7, proveedor_id: 3, ruta_relativa: "empresas/1/flota/viejo.pdf" }]];
    if (sql.includes("FROM flota_viajes")) return [[{ id: 9, vehiculo_id: 7 }]];
    if (sql.includes("UPPER(TRIM")) return [duplicado ? [{ id: 5 }] : []];
    return [];
  });
  m.vehiculo.mockResolvedValue({ id: 7, activo: 1 });
  m.execute.mockResolvedValue([{ insertId: 11 }]);
  m.subir.mockResolvedValue({ relative: "empresas/1/flota/nuevo.pdf", original: "vale.pdf", size: 10 });
});
describe("captura staff C-1", () => {
  it("registra sin piloto ni viaje, PENDIENTE y precio Decimal", async () => {
    expect(await guardarCombustibleStaff(1, "op", input, file)).toBe(11);
    const [sql, params] = m.execute.mock.calls[0];
    expect(sql).toContain("NULL, NULL"); expect(sql).toContain("'PENDIENTE'");
    expect(params[1]).toBeNull(); expect(params[8]).toBe("29.68");
    expect(m.commit).toHaveBeenCalledOnce(); expect(m.auditar).toHaveBeenCalledOnce();
  });
  it("acepta viaje opcional de la misma empresa/unidad", async () => {
    await guardarCombustibleStaff(1, "op", { ...input, viajeId: 9 }, file);
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("WHERE empresa_id = ? AND id = ?"), [1, 9]);
  });
  it.each(["proveedor", "vehiculo", "viaje"])("rechaza %s ajeno", async recurso => {
    if (recurso === "vehiculo") m.vehiculo.mockResolvedValue(null);
    else { const original = m.query.getMockImplementation()!; m.query.mockImplementation((sql, params) => sql.includes(recurso === "proveedor" ? "FROM compras_proveedores" : "FROM flota_viajes") ? Promise.resolve([[]]) : original(sql, params)); }
    await expect(guardarCombustibleStaff(1, "op", { ...input, viajeId: recurso === "viaje" ? 9 : null }, file)).rejects.toThrow();
    expect(m.execute).not.toHaveBeenCalled(); expect(m.subir).not.toHaveBeenCalled();
  });
  it("edita PENDIENTE conservando evidencia e identidad histórica", async () => {
    await guardarCombustibleStaff(1, "op", input, null, 11);
    expect(m.execute.mock.calls[0][0]).toContain("estado='PENDIENTE'");
    expect(m.execute.mock.calls[0][0]).not.toContain("empleado_id"); expect(m.subir).not.toHaveBeenCalled();
  });
  it.each(["APROBADO", "RECHAZADO"])("no edita %s", async value => {
    estado = value;
    await expect(guardarCombustibleStaff(1, "op", input, file, 11)).rejects.toMatchObject({ status: 409 });
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("nuevo exige evidencia", async () => {
    await expect(guardarCombustibleStaff(1, "op", input, null)).rejects.toThrow("evidencia");
  });
  it("duplicado preventivo dentro de empresa/proveedor", async () => {
    duplicado = true;
    await expect(guardarCombustibleStaff(1, "op", input, file)).rejects.toMatchObject({ status: 409 });
    expect(m.subir).not.toHaveBeenCalled(); expect(m.query).toHaveBeenCalledWith(expect.stringContaining("UPPER(TRIM"), [1, 3, "A-1", 0]);
  });
  it("compensa el archivo si falla BD", async () => {
    m.execute.mockRejectedValue(new Error("fallo"));
    await expect(guardarCombustibleStaff(1, "op", input, file)).rejects.toThrow("fallo");
    expect(m.rollback).toHaveBeenCalledOnce(); expect(m.borrar).toHaveBeenCalledWith("empresas/1/flota/nuevo.pdf");
  });
  it("si falla upload no escribe ni borra evidencia anterior", async () => {
    m.subir.mockRejectedValue(new Error("upload"));
    await expect(guardarCombustibleStaff(1, "op", input, file, 11)).rejects.toThrow("upload");
    expect(m.execute).not.toHaveBeenCalled(); expect(m.borrar).not.toHaveBeenCalled();
  });
  it("catálogo mínimo sin datos bancarios ni credenciales", async () => {
    await catalogosCombustible(1);
    const sql = m.query.mock.calls.map(c => c[0]).join(" ");
    expect(sql).not.toMatch(/banco|cuenta|password|SELECT \*/i); expect(sql).toContain("flota_vehiculo_acceso");
  });
});
describe("validación y mapeo", () => {
  it.each(["proveedorId", "vehiculoId", "numeroVale", "fechaConsumo", "monto", "galones"])("exige %s", campo => expect(combustibleStaffSchema.safeParse({ ...input, [campo]: "" }).success).toBe(false));
  it.each(["abc", "NaN", "0", "-1", "1.1234"])("rechaza galones %s", galones => expect(combustibleStaffSchema.safeParse({ ...input, galones }).success).toBe(false));
  it("calcula con Decimal", () => expect(precioCalculado("100", "3")).toBe("33.33"));
  it("histórico sin proveedor y sin viaje conserva NULL, no viaje 0", async () => {
    m.query.mockResolvedValueOnce([{ id: 1, viaje_id: null, proveedor_id: null, vehiculo_id: 7 }]).mockResolvedValueOnce([]);
    expect((await listarCargasCombustibleRevision(1)).items[0]).toMatchObject({ viajeId: null, proveedorId: null });
  });
});
