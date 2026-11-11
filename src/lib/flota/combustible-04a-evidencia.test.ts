import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Todas las operaciones SQL/archivos son dobles en memoria: nunca se importa DB/uploads reales.
const m = vi.hoisted(() => ({ get: vi.fn(), query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn(), subir: vi.fn(), borrar: vi.fn(), validarRuta: vi.fn(), vehiculo: vi.fn(), auditar: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: m.get }), query: m.query }));
vi.mock("@/lib/load-env", () => ({ loadRuntimeEnv: () => { throw Error("ENV_REAL_PROHIBIDO"); } }));
vi.mock("./acceso", () => ({ obtenerVehiculoAccesibleTx: m.vehiculo, predicadoVehiculoAccesible: () => "MOCK" }));
vi.mock("./combustible-fondos", () => ({ validarLineaFondoCombustibleTx: () => { throw Error("FONDO_NO_PREVISTO"); } }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.auditar }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: m.subir, borrarUpload: m.borrar, contentTypeFor: () => "application/pdf", validarRutaArchivoEmpresa: m.validarRuta }));
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  m.get.mockResolvedValue(m);
  m.validarRuta.mockReturnValue(true);
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
afterEach(() => {
  // Invariante para TODOS los escenarios: ni validación de ruta ni borrado se usan como prueba de propiedad.
  expect(m.borrar).not.toHaveBeenCalled(); expect(m.validarRuta).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("04B: regresión segura de evidencia staff, con transacción y almacenamiento simulados", () => {
  it("COMMIT confirmado conserva archivo nuevo y no intenta rollback", async () => {
    expect(await guardarCombustibleStaff(1, actor, input, file)).toBe(101);
    expect(durable).toBe(true); expect(m.borrar).not.toHaveBeenCalled(); expect(m.rollback).not.toHaveBeenCalled();
    expect(m.release).toHaveBeenCalledOnce();
    expect(m.destroy).not.toHaveBeenCalled();
  });
  it.each(["insert", "auditoria"])("fallo previo al COMMIT en %s conserva evidencia y error original aun con rollback confirmado", async fallo => {
    const original = Error("fallo previo");
    (fallo === "insert" ? m.execute : m.auditar).mockRejectedValueOnce(original);
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toBe(original);
    expect(durable).toBe(false); expect(m.commit).not.toHaveBeenCalled(); expect(m.rollback).toHaveBeenCalledOnce();
    expect(m.release).toHaveBeenCalledOnce(); expect(m.destroy).not.toHaveBeenCalled();
  });
  it.each([[false, false], [false, true], [true, false], [true, true]])("COMMIT desconocido aplicado=%s / rollback fallido=%s conserva archivo y error original", async (aplicado, fallaRollback) => {
    const original = Error("respuesta COMMIT perdida");
    m.commit.mockImplementation(async () => { durable = aplicado; throw original; });
    if (fallaRollback) m.rollback.mockRejectedValueOnce(Error("rollback perdido"));
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toBe(original);
    expect(durable).toBe(aplicado); expect(m.rollback).toHaveBeenCalledOnce();
    expect(m.destroy).toHaveBeenCalledOnce(); expect(m.release).not.toHaveBeenCalled(); expect(m.commit).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), { etapa: "resultado_incierto", transaccion: "COMMIT_INTENTADO", rollback: fallaRollback ? "FALLIDO" : "CONFIRMADO" });
  });
  it("rollback fallido conserva error previo por identidad y descarta conexión", async () => {
    const original = Error("fallo original");
    m.execute.mockRejectedValueOnce(original); m.rollback.mockRejectedValueOnce(Error("rollback perdido"));
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toBe(original);
    expect(m.destroy).toHaveBeenCalledOnce(); expect(m.release).not.toHaveBeenCalled();
    expect(m.commit).not.toHaveBeenCalled();
  });
  it("upload fallido no escribe ni solicita borrar archivos", async () => {
    m.subir.mockRejectedValueOnce(Error("upload simulado"));
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toThrow("upload simulado");
    expect(m.execute).not.toHaveBeenCalled(); expect(m.borrar).not.toHaveBeenCalled();
  });
  it("edición con evidencia anterior y COMMIT incierto conserva ambas rutas", async () => {
    const anterior = "empresas/1/flota/evidencia-anterior-sintetica.pdf";
    const original = m.query.getMockImplementation()!;
    m.query.mockImplementation(async (sql: string, p: unknown[]) => {
      if (sql.includes("SELECT proveedor_id, estacion_id FROM flota_combustible_cargas")) return [[{ proveedor_id: 3, estacion_id: 55 }]];
      if (sql.includes("SELECT id, estado")) return [[{ id: 101, estado: "PENDIENTE", proveedor_id: 3, estacion_id: 55, vehiculo_id: 7, viaje_id: null, ruta_relativa: anterior }]];
      return original(sql, p);
    });
    const error = Error("respuesta perdida"); m.commit.mockRejectedValueOnce(error);
    await expect(guardarCombustibleStaff(1, actor, input, file, 101)).rejects.toBe(error);
    expect(m.borrar).not.toHaveBeenCalled();
    expect(m.borrar).not.toHaveBeenCalledWith(anterior);
  });
  it.each([false, true])("edición confirmada con archivo nuevo=%s conserva cargaId y evidencia anterior", async nuevo => {
    const anterior = "empresas/1/flota/anterior-sintetica.pdf";
    const vale = Object.freeze({ id: 101, estado: "PENDIENTE", proveedor_id: 3, estacion_id: 55, vehiculo_id: 7, viaje_id: null, ruta_relativa: anterior });
    const original = m.query.getMockImplementation()!;
    m.query.mockImplementation(async (sql: string, p: unknown[]) => {
      if (sql.includes("SELECT proveedor_id, estacion_id FROM flota_combustible_cargas")) return [[vale]];
      if (sql.includes("SELECT id, estado")) return [[vale]];
      return original(sql, p);
    });
    expect(await guardarCombustibleStaff(1, actor, input, nuevo ? file : null, 101)).toBe(101);
    expect(vale.ruta_relativa).toBe(anterior); expect(m.subir).toHaveBeenCalledTimes(nuevo ? 1 : 0);
    expect(m.commit).toHaveBeenCalledOnce(); expect(m.rollback).not.toHaveBeenCalled();
    expect(m.release).toHaveBeenCalledOnce(); expect(m.destroy).not.toHaveBeenCalled();
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
  it("beginTransaction fallido es incierto: destroy sin consultas, upload ni rollback supuesto", async () => {
    const original = Error("inicio sin respuesta"); m.beginTransaction.mockRejectedValueOnce(original);
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toBe(original);
    expect(m.query).not.toHaveBeenCalled(); expect(m.subir).not.toHaveBeenCalled(); expect(m.rollback).not.toHaveBeenCalled();
    expect(m.destroy).toHaveBeenCalledOnce(); expect(m.release).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), { etapa: "resultado_incierto", transaccion: "INICIO_EN_CURSO", rollback: "NO_INTENTADO" });
  });
  it("getConnection fallido conserva error sin disponer una conexión inexistente", async () => {
    const original = Error("sin conexión"); m.get.mockRejectedValueOnce(original);
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toBe(original);
    expect(m.beginTransaction).not.toHaveBeenCalled(); expect(m.release).not.toHaveBeenCalled(); expect(m.destroy).not.toHaveBeenCalled();
  });
  it.each([false, true])("COMMIT confirmado mantiene cargaId aunque release falle y destroy falle=%s", async fallaDestroy => {
    m.release.mockImplementationOnce(() => { throw Error("release perdido"); });
    if (fallaDestroy) m.destroy.mockImplementationOnce(() => { throw Error("destroy perdido"); });
    expect(await guardarCombustibleStaff(1, actor, input, file)).toBe(101);
    expect(durable).toBe(true); expect(m.commit).toHaveBeenCalledOnce(); expect(m.rollback).not.toHaveBeenCalled();
    expect(m.release).toHaveBeenCalledOnce(); expect(m.destroy).toHaveBeenCalledOnce();
  });
  it.each([false, true])("error previo conserva identidad ante release fallido y destroy fallido=%s", async fallaDestroy => {
    const original = Error("fallo de INSERT"); m.execute.mockRejectedValueOnce(original);
    m.release.mockImplementationOnce(() => { throw Error("release perdido"); });
    if (fallaDestroy) m.destroy.mockImplementationOnce(() => { throw Error("destroy perdido"); });
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toBe(original);
    expect(m.rollback).toHaveBeenCalledOnce(); expect(m.release).toHaveBeenCalledOnce(); expect(m.destroy).toHaveBeenCalledOnce();
  });
  it.each(["inicio", "rollback", "commit"])("destroy y diagnóstico fallidos en %s no sustituyen error original ni hacen release", async etapa => {
    const original = Error("error primario");
    if (etapa === "inicio") m.beginTransaction.mockRejectedValueOnce(original);
    if (etapa === "rollback") { m.execute.mockRejectedValueOnce(original); m.rollback.mockRejectedValueOnce(Error("secundario")); }
    if (etapa === "commit") m.commit.mockRejectedValueOnce(original);
    m.destroy.mockImplementationOnce(() => { throw Error("destroy perdido"); });
    vi.mocked(console.warn).mockImplementation(() => { throw Error("diagnóstico perdido"); });
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toBe(original);
    expect(m.destroy).toHaveBeenCalledOnce(); expect(m.release).not.toHaveBeenCalled();
  });
  it.each([null, "rechazo no Error"])("preserva literalmente el rechazo %j incluso si falla rollback", async original => {
    m.execute.mockRejectedValueOnce(original); m.rollback.mockRejectedValueOnce(Error("secundario"));
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toBe(original);
    expect(m.destroy).toHaveBeenCalledOnce();
  });
  it("rollback confirmado no autoriza compensar aunque mocks de ruta/borrado lancen", async () => {
    const original = Error("fallo previo"); m.execute.mockRejectedValueOnce(original);
    m.validarRuta.mockImplementation(() => { throw Error("no probar propiedad con ruta"); });
    m.borrar.mockImplementation(() => { throw Error("no compensar"); });
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toBe(original);
    expect(m.rollback).toHaveBeenCalledOnce(); expect(m.release).toHaveBeenCalledOnce();
  });
  it("diagnóstico fallido tras release fallido no convierte COMMIT confirmado en error", async () => {
    m.release.mockImplementationOnce(() => { throw Error("release perdido"); });
    vi.mocked(console.warn).mockImplementation(() => { throw Error("diagnóstico perdido"); });
    expect(await guardarCombustibleStaff(1, actor, input, file)).toBe(101);
    expect(m.destroy).toHaveBeenCalledOnce(); expect(m.rollback).not.toHaveBeenCalled();
  });
});
