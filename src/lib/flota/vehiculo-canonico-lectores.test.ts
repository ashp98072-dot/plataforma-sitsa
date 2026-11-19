import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/flota/vehiculos-alias", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/flota/vehiculos-alias")>();
  return { ...actual, idsHistoricosVehiculo: vi.fn() };
});
import { query } from "@/lib/db";
import { canonicosDeAlias, canonizarVehiculoTx, idsHistoricosVehiculo } from "./vehiculos-alias";
import { SQL_FK_A_OTRAS_TABLAS, esColumnaDeVehiculo } from "./vehiculo-referencias";
import { obtenerReporteGastosPorTipo, reporteGastosDetalle, reporteSolicitudesFondo } from "@/lib/tms/reportes-gastos";

/**
 * Lectores de la identidad canónica: detección de columnas de vehículo, helpers de alias y filtro de reportes por TODOS los IDs de la unidad.
 */
beforeEach(() => vi.resetAllMocks());

describe("esColumnaDeVehiculo — una columna con nombre parecido pero FK a otra tabla NO es un vehículo", () => {
  const fkAVehiculos = [{ TABLE_NAME: "tms_gastos_operativos", COLUMN_NAME: "vehiculo_id" }, { TABLE_NAME: "tms_x", COLUMN_NAME: "unidad_ref" }];
  const fkAOtras = [{ TABLE_NAME: "tms_planes_viaje", COLUMN_NAME: "vehiculo_solicitado_perfil_id" }];

  it("excluye vehiculo_solicitado_perfil_id (FK a un perfil de costeo)", () => {
    expect(esColumnaDeVehiculo("tms_planes_viaje", "vehiculo_solicitado_perfil_id", fkAVehiculos, fkAOtras)).toBe(false);
  });
  it("sin esa FK, el mismo nombre por convención sí se trataría como vehículo (comportamiento anterior preservado)", () => {
    expect(esColumnaDeVehiculo("otra_tabla", "vehiculo_solicitado_perfil_id", fkAVehiculos, fkAOtras)).toBe(true);
  });
  it("conserva las columnas reales: convención por nombre, FK a flota_vehiculos y unidad_recurrente_id", () => {
    for (const campo of ["vehiculo_id", "tc_vehiculo_id", "flota_vehiculo_id", "unidad_recurrente_id"]) expect(esColumnaDeVehiculo("tms_planes_viaje", campo, fkAVehiculos, fkAOtras), campo).toBe(true);
    expect(esColumnaDeVehiculo("tms_x", "unidad_ref", fkAVehiculos, fkAOtras)).toBe(true); // FK real a flota_vehiculos aunque el nombre no lo diga
  });
  it("columnas ajenas no se confunden", () => {
    for (const campo of ["empresa_id", "unidad_id", "plan_id", "cliente_id", "estado"]) expect(esColumnaDeVehiculo("tms_planes_viaje", campo, fkAVehiculos, fkAOtras), campo).toBe(false);
  });
  it("la consulta de FK ajenas lee solo el esquema actual y excluye flota_vehiculos", () => {
    expect(SQL_FK_A_OTRAS_TABLAS).toContain("TABLE_SCHEMA=DATABASE()");
    expect(SQL_FK_A_OTRAS_TABLAS).toContain("REFERENCED_TABLE_NAME<>'flota_vehiculos'");
    expect(SQL_FK_A_OTRAS_TABLAS).toMatch(/^SELECT /);
  });
});

describe("canonizarVehiculoTx / canonicosDeAlias", () => {
  const conn = (tabla: boolean, destino: number | null) => ({
    query: vi.fn(async (sql: string) => (sql.includes("information_schema") ? [tabla ? [{ TABLE_NAME: "x" }] : []] : [destino == null ? [] : [{ destino_id: destino }]])),
  });
  it("null/undefined -> null sin consultar", async () => {
    const c = conn(true, 2);
    expect(await canonizarVehiculoTx(c as never, 7, null)).toBeNull();
    expect(await canonizarVehiculoTx(c as never, 7, undefined)).toBeNull();
    expect(c.query).not.toHaveBeenCalled();
  });
  it("sin tabla de fusiones -> el mismo ID, una sola consulta", async () => {
    const c = conn(false, null);
    expect(await canonizarVehiculoTx(c as never, 7, 3)).toBe(3);
    expect(c.query).toHaveBeenCalledTimes(1);
  });
  it("con alias -> destino; sin alias -> el mismo ID; el alias se filtra por empresa", async () => {
    const c = conn(true, 2);
    expect(await canonizarVehiculoTx(c as never, 7, 3)).toBe(2);
    const [sql, params] = c.query.mock.calls[1] as unknown as [string, number[]];
    expect(sql).toContain("empresa_id=?");
    expect(params).toEqual([3, 7]);
    expect(await canonizarVehiculoTx(conn(true, null) as never, 7, 3)).toBe(3);
  });
  it("canonicosDeAlias: mapa origen -> {id, placa} solo para los IDs con alias; sin tabla, vacío; sin IDs, no consulta", async () => {
    const consultar = vi.fn(async (sql: string) => (sql.includes("information_schema") ? [{ TABLE_NAME: "f" }] : [{ origen_id: 3, destino_id: 2, placa: "558 BSJ" }]));
    const mapa = await canonicosDeAlias([3, 2, 3, 0, -1], 7, consultar as never);
    expect([...mapa.entries()]).toEqual([[3, { id: 2, placa: "558 BSJ" }]]);
    expect((consultar.mock.calls[1] as unknown as [string, unknown[]])[1]).toEqual([7, 3, 2]); // únicos y válidos
    const sinTabla = vi.fn(async () => []);
    expect((await canonicosDeAlias([3], 7, sinTabla as never)).size).toBe(0);
    const nada = vi.fn();
    expect((await canonicosDeAlias([], 7, nada as never)).size).toBe(0);
    expect(nada).not.toHaveBeenCalled();
  });
});

describe("reportes: filtrar por vehículo incluye la historia de todos los IDs de la unidad", () => {
  const fondoFila = { linea_id: 1, solicitud_id: 10, solicitud_codigo: "F-10", fecha_solicitud: "2026-09-03", fecha_viaje: null, empleado_id: null, empleado_nombre: null, cuenta: null, metodo_pago: null, cargo: null, vehiculo_id: 3, placa: "558BSJ", cliente_id: null, cliente_nombre: null, plan_id: null, categoria: "Combustible", cantidad: "1.00", descripcion: null, monto: "10.00", total_solicitud: "10.00", estado: "Autorizada", observaciones: null };

  it("fondos con vehiculoIds: IN (...) con los parámetros en su lugar; con vehiculoId solo, igualdad exacta como antes", async () => {
    vi.mocked(query).mockResolvedValue([fondoFila] as never);
    await reporteSolicitudesFondo(7, { vehiculoIds: [2, 3], clienteId: 5 });
    let [sql, params] = vi.mocked(query).mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("l.vehiculo_id IN (?,?)");
    expect(params).toEqual([7, 5, 2, 3]);
    vi.mocked(query).mockClear();
    await reporteSolicitudesFondo(7, { vehiculoId: 3 });
    [sql, params] = vi.mocked(query).mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("l.vehiculo_id = ?");
    expect(sql).not.toContain("vehiculo_id IN");
    expect(params).toEqual([7, 3]);
  });

  it("gastosDetalle con vehiculoIds: ambas ramas (cabecera y líneas) filtran por IN con los IDs", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteGastosDetalle(7, { vehiculoIds: [2, 3] });
    const [sql, params] = vi.mocked(query).mock.calls[0] as unknown as [string, number[]];
    expect(sql).toContain("g.vehiculo_id IN (?,?)");
    expect(sql).toContain("l.vehiculo_id IN (?,?)");
    expect(params.filter((p) => p === 2 || p === 3)).toHaveLength(4);
  });

  it("obtenerReporteGastosPorTipo resuelve los IDs históricos desde el vehiculoId (fondos y gastosDetalle) y no lo hace sin vehiculoId", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    vi.mocked(idsHistoricosVehiculo).mockResolvedValue([2, 3]);
    await obtenerReporteGastosPorTipo(7, "fondos", { vehiculoId: 2 });
    await obtenerReporteGastosPorTipo(7, "gastosDetalle", { vehiculoId: 2 });
    expect(idsHistoricosVehiculo).toHaveBeenCalledTimes(2);
    expect(idsHistoricosVehiculo).toHaveBeenCalledWith(7, 2);
    for (const [, params] of vi.mocked(query).mock.calls as unknown as [string, number[]][]) expect(params).toEqual(expect.arrayContaining([2, 3]));
    vi.mocked(idsHistoricosVehiculo).mockClear();
    await obtenerReporteGastosPorTipo(7, "fondos", {});
    expect(idsHistoricosVehiculo).not.toHaveBeenCalled();
  });

  it("los demás reportes (agregados) conservan su filtro exacto y no resuelven IDs", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await obtenerReporteGastosPorTipo(7, "categoria", { vehiculoId: 2 });
    expect(idsHistoricosVehiculo).not.toHaveBeenCalled();
    const [sql, params] = vi.mocked(query).mock.calls[0] as unknown as [string, number[]];
    expect(sql).toContain("g.vehiculo_id = ?");
    expect(params).toContain(2);
  });

  it("vehiculoIds ya resuelto por el llamador se respeta sin volver a resolver", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await obtenerReporteGastosPorTipo(7, "fondos", { vehiculoId: 2, vehiculoIds: [2, 3, 8] });
    expect(idsHistoricosVehiculo).not.toHaveBeenCalled();
    expect(vi.mocked(query).mock.calls[0][0]).toContain("l.vehiculo_id IN (?,?,?)");
  });
});
