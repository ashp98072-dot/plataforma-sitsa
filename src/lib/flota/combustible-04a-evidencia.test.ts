import { beforeEach, describe, expect, it, vi } from "vitest";

// Todas las operaciones SQL/archivos son dobles en memoria: nunca se importa DB/uploads reales.
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), subir: vi.fn(), borrar: vi.fn(), vehiculo: vi.fn(), auditar: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => m }), query: m.query }));
vi.mock("@/lib/load-env", () => ({ loadRuntimeEnv: () => { throw Error("ENV_REAL_PROHIBIDO"); } }));
vi.mock("./acceso", () => ({ obtenerVehiculoAccesibleTx: m.vehiculo, predicadoVehiculoAccesible: () => "MOCK" }));
vi.mock("./combustible-fondos", () => ({ validarLineaFondoCombustibleTx: () => { throw Error("FONDO_NO_PREVISTO"); } }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.auditar }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: m.subir, borrarUpload: m.borrar, contentTypeFor: () => "application/pdf", validarRutaArchivoEmpresa: () => true }));
import { guardarCombustibleStaff } from "./combustible-staff";

const input = { estacionId: 55, vehiculoId: 7, viajeId: null, numeroVale: " A  001 ", fechaConsumo: "2026-10-15", tipoCombustible: "diesel" as const, galones: "10.125", monto: "300.50", km: null, gasolinera: "", observaciones: "" };
const actor = { usuarioId: 91, username: "demo-04a" };
const file = { name: "sintetico.pdf", size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
const nueva = "empresas/1/flota/sintetico-04a.pdf";
let durable: boolean;
let proveedor: number;
let activa: boolean;
beforeEach(() => {
  vi.resetAllMocks(); durable = false; proveedor = 3; activa = true;
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT proveedor_id FROM flota_combustible_estaciones")) return [[{ proveedor_id: 3 }]];
    if (sql.includes("FROM compras_proveedores")) return [[{ id: 3, activo: 1 }]];
    if (sql.includes("LOCK IN SHARE MODE")) return [proveedor === 3 ? [{ id: 55, nombre: "Estación sintética", activo: Number(activa) }] : []];
    if (sql.includes("UPPER(TRIM")) return [[]];
    throw Error(`SQL mock no previsto: ${sql}`);
  });
  m.vehiculo.mockResolvedValue({ id: 7, activo: 1 });
  m.execute.mockResolvedValue([{ insertId: 101, affectedRows: 1 }]);
  m.subir.mockResolvedValue({ relative: nueva, original: file.name, size: 1 });
  m.commit.mockImplementation(async () => { durable = true; });
});

describe("04A R3: evidencia staff con transacción y almacenamiento simulados", () => {
  it("COMMIT confirmado conserva archivo nuevo y no intenta rollback", async () => {
    expect(await guardarCombustibleStaff(1, actor, input, file)).toBe(101);
    expect(durable).toBe(true); expect(m.borrar).not.toHaveBeenCalled(); expect(m.rollback).not.toHaveBeenCalled();
    expect(m.release).toHaveBeenCalledOnce();
  });
  it.each(["insert", "auditoria"])("fallo previo al COMMIT en %s compensa exclusivamente evidencia nueva", async fallo => {
    (fallo === "insert" ? m.execute : m.auditar).mockRejectedValueOnce(Error("fallo previo"));
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toThrow("fallo previo");
    expect(durable).toBe(false); expect(m.commit).not.toHaveBeenCalled(); expect(m.rollback).toHaveBeenCalledOnce();
    expect(m.borrar.mock.calls).toEqual([[nueva]]);
  });
  it.each([false, true])("DEUDA R3: respuesta COMMIT perdida, aplicado=%s: solicita borrar evidencia incluso si pudo persistir", async aplicado => {
    m.commit.mockImplementation(async () => { durable = aplicado; throw Error("respuesta COMMIT perdida"); });
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toThrow("respuesta COMMIT perdida");
    expect(durable).toBe(aplicado); expect(m.rollback).toHaveBeenCalledOnce();
    expect(m.borrar.mock.calls).toEqual([[nueva]]);
    // El mock solo observa la solicitud de borrado; no borra un archivo ni demuestra el estado de una BD.
  });
  it("DEUDA: rollback fallido enmascara fallo previo y aun solicita compensación", async () => {
    m.execute.mockRejectedValueOnce(Error("fallo original")); m.rollback.mockRejectedValueOnce(Error("rollback perdido"));
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toThrow("rollback perdido");
    expect(m.borrar.mock.calls).toEqual([[nueva]]); expect(m.release).toHaveBeenCalledOnce();
  });
  it("upload fallido no escribe ni solicita borrar archivos", async () => {
    m.subir.mockRejectedValueOnce(Error("upload simulado"));
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toThrow("upload simulado");
    expect(m.execute).not.toHaveBeenCalled(); expect(m.borrar).not.toHaveBeenCalled();
  });
  it("edición con evidencia anterior y COMMIT incierto solicita borrar solo la nueva, conservando referencia histórica", async () => {
    const anterior = "empresas/1/flota/evidencia-anterior-sintetica.pdf";
    const original = m.query.getMockImplementation()!;
    m.query.mockImplementation(async (sql: string, p: unknown[]) => {
      if (sql.includes("SELECT proveedor_id, estacion_id FROM flota_combustible_cargas")) return [[{ proveedor_id: 3, estacion_id: 55 }]];
      if (sql.includes("SELECT id, estado")) return [[{ id: 101, estado: "PENDIENTE", proveedor_id: 3, estacion_id: 55, vehiculo_id: 7, viaje_id: null, ruta_relativa: anterior }]];
      return original(sql, p);
    });
    m.commit.mockRejectedValueOnce(Error("respuesta perdida"));
    await expect(guardarCombustibleStaff(1, actor, input, file, 101)).rejects.toThrow("respuesta perdida");
    expect(m.borrar.mock.calls).toEqual([[nueva]]);
    expect(m.borrar).not.toHaveBeenCalledWith(anterior);
  });
  it.each(["estacion-inactiva", "proveedor-cambiado", "acceso-revocado"])("revalida %s antes de subir evidencia", async caso => {
    if (caso === "estacion-inactiva") activa = false;
    if (caso === "proveedor-cambiado") proveedor = 4;
    if (caso === "acceso-revocado") m.vehiculo.mockResolvedValueOnce(null);
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toThrow();
    expect(m.subir).not.toHaveBeenCalled(); expect(m.execute).not.toHaveBeenCalled(); expect(m.commit).not.toHaveBeenCalled();
  });
  it("staff conserva espacios internos del vale y usa SQL UPPER/TRIM, sin equivalencia SQL simulada", async () => {
    await guardarCombustibleStaff(1, actor, input, file);
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("UPPER(TRIM(numero_vale)) = UPPER(TRIM(?))"), [1, 3, "A  001", 0]);
    expect(m.execute.mock.calls[0][1][3]).toBe("A  001");
    expect(m.query.mock.calls.some(([sql]) => /flota_cb2_/.test(sql))).toBe(false);
  });
});
