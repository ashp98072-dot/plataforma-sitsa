import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { calcularCosteoServicio, COTIZACION_COSTEO_MOTOR_VERSION, type InputCosteoServicio } from "./cotizacion-costeo";
import {
  ErrorCosteoConfig, ErrorCosteoYaRegistrado, MENSAJE_COSTEO_YA_REGISTRADO, MENSAJE_SIN_PARAMETROS, guardarSnapshotCosteoTx,
  listarPerfilesCosteo, obtenerParametrosCosteoVigentes, obtenerPerfilCosteo, obtenerSnapshotCosteo, sumaComponentesCoincide,
  type CosteoPreparado, type PerfilCosteoConId,
} from "./cotizacion-costeo-db";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const filaPerfil = (over: Record<string, unknown> = {}) => ({
  id: 4, codigo: "CABEZAL", nombre: "Cabezal", costo_adquisicion: null, dias_operacion_mes: "30.00", gps_mensual: "174.10",
  seguro_vehiculo_mensual: "1550.00", costo_aceite_servicio: "1860.00", vida_util_aceite_km: "5000.00", costo_juego_llantas: "38466.00",
  vida_util_llantas_km: "50000.00", rendimiento_km_galon: "9.300", deprec_valor_base: null, deprec_anios: null, deprec_dias_operacion_mes: null,
  refrig_valor_base: null, refrig_anios: null, refrig_dias_operacion_mes: null, ...over,
});
const filaParam = (vigente: string, over: Record<string, unknown> = {}) => ({
  empresa_id: 1, vigente_desde: vigente, precio_combustible_galon: "29.8900", iva_tasa: "0.1200", costo_piloto_dia: "207.74",
  costo_auxiliar_dia: "148.04", viatico_piloto_dia: "200.00", viatico_auxiliar_dia: "200.00", viatico_guia_dia: "125.00",
  hotel_dia: null, margen_objetivo: "0.2000", ...over,
});

beforeEach(() => vi.resetAllMocks());

// ---------------------------------------------------------------------------
describe("Perfiles (tenant-safe)", () => {
  it("obtenerPerfilCosteo filtra por empresa_id Y id; nunca confía en un id sin la empresa", async () => {
    vi.mocked(query).mockResolvedValue([filaPerfil()] as never);
    const perfil = await obtenerPerfilCosteo(1, 4);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("WHERE empresa_id = ? AND id = ?");
    expect(params).toEqual([1, 4]);
    expect(perfil).toMatchObject({ id: 4, codigo: "CABEZAL", diasOperacionMes: 30, gpsMensual: 174.1, rendimientoKmGalon: 9.3 });
  });
  it("un perfil de OTRA empresa no existe para esta (null)", async () => {
    vi.mocked(query).mockImplementation((async (_sql: string, params: unknown[]) => (params[0] === 1 ? [filaPerfil()] : [])) as never);
    expect(await obtenerPerfilCosteo(2, 4)).toBeNull();
    expect(await obtenerPerfilCosteo(1, 4)).not.toBeNull();
  });
  it("listarPerfilesCosteo: solo activos de la empresa, por nombre", async () => {
    vi.mocked(query).mockResolvedValue([filaPerfil()] as never);
    await listarPerfilesCosteo(1);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("empresa_id = ? AND activo = 1"); expect(String(sql)).toContain("ORDER BY nombre ASC"); expect(params).toEqual([1]);
  });
  it("deprec_*/refrig_* con los tres campos NULL => depreciacion/costoRefrigeracion null; con datos => objeto", async () => {
    vi.mocked(query).mockResolvedValue([filaPerfil()] as never);
    const sin = await obtenerPerfilCosteo(1, 4);
    expect(sin!.depreciacion).toBeNull(); expect(sin!.costoRefrigeracion).toBeNull();
    vi.mocked(query).mockResolvedValue([filaPerfil({ deprec_valor_base: "182142.86", deprec_anios: "5.00", deprec_dias_operacion_mes: "26.00", refrig_valor_base: "100000.00", refrig_anios: "5.00", refrig_dias_operacion_mes: "26.00" })] as never);
    const con = await obtenerPerfilCosteo(1, 4);
    expect(con!.depreciacion).toEqual({ valorBase: 182142.86, anios: 5, diasOperacionMes: 26 });
    expect(con!.costoRefrigeracion).toEqual({ valorBase: 100000, anios: 5, diasOperacionMes: 26 });
  });
});

// ---------------------------------------------------------------------------
describe("Parámetros vigentes por fecha", () => {
  const tabla = [filaParam("2026-09-21"), filaParam("2026-12-01", { precio_combustible_galon: "35.0000" })];
  /** Evalúa lo que pide el SQL: empresa, vigente_desde <= fecha, ORDER BY vigente_desde DESC, LIMIT 1. */
  function baseSimulada() {
    vi.mocked(query).mockImplementation((async (sql: string, params: [number, string]) => {
      expect(sql).toContain("vigente_desde <= ?"); expect(sql).toContain("ORDER BY vigente_desde DESC"); expect(sql).toContain("LIMIT 1");
      const [empresa, fecha] = params;
      return tabla.filter((f) => f.empresa_id === empresa && f.vigente_desde <= fecha).sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde)).slice(0, 1);
    }) as never);
  }
  it("devuelve la vigente a la fecha y mapea los tipos (hotel NULL => sin hotelDia)", async () => {
    baseSimulada();
    const r = await obtenerParametrosCosteoVigentes(1, "2026-09-21");
    expect(r.vigenteDesde).toBe("2026-09-21");
    expect(r.parametros).toEqual({ precioCombustibleGalon: 29.89, ivaTasa: 0.12, costoPilotoDia: 207.74, costoAuxiliarDia: 148.04, viaticoPilotoDia: 200, viaticoAuxiliarDia: 200, viaticoGuiaDia: 125, margenObjetivo: 0.2 });
    expect("hotelDia" in r.parametros).toBe(false);
  });
  it("usa la fila más reciente cuyo vigente_desde <= fecha", async () => {
    baseSimulada();
    expect((await obtenerParametrosCosteoVigentes(1, "2026-12-15")).parametros.precioCombustibleGalon).toBe(35);
  });
  it("una fila con fecha FUTURA no aplica aunque sea la más nueva", async () => {
    baseSimulada();
    expect((await obtenerParametrosCosteoVigentes(1, "2026-10-01")).parametros.precioCombustibleGalon).toBe(29.89);
  });
  it("sin parámetros vigentes (fecha anterior a todos, o empresa sin filas) => error claro", async () => {
    baseSimulada();
    await expect(obtenerParametrosCosteoVigentes(1, "2026-01-01")).rejects.toThrow(MENSAJE_SIN_PARAMETROS);
    await expect(obtenerParametrosCosteoVigentes(2, "2026-10-01")).rejects.toBeInstanceOf(ErrorCosteoConfig);
    expect(MENSAJE_SIN_PARAMETROS).toBe("No hay parámetros de costeo vigentes para la fecha indicada.");
  });
  it("una fecha mal formada nunca llega a la consulta", async () => {
    await expect(obtenerParametrosCosteoVigentes(1, "mañana")).rejects.toBeInstanceOf(ErrorCosteoConfig);
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("Snapshot: guardar (INMUTABLE, misma transacción del llamador)", () => {
  const perfil: PerfilCosteoConId = {
    id: 4, codigo: "CABEZAL", nombre: "Cabezal", costoAdquisicion: null, diasOperacionMes: 30, gpsMensual: 174.1, seguroVehiculoMensual: 1550,
    costoAceiteServicio: 1860, vidaUtilAceiteKm: 5000, costoJuegoLlantas: 38466, vidaUtilLlantasKm: 50000, rendimientoKmGalon: 9.3,
    depreciacion: null, costoRefrigeracion: null,
  };
  const parametros = { precioCombustibleGalon: 29.89, ivaTasa: 0.12, costoPilotoDia: 207.74, costoAuxiliarDia: 148.04, viaticoPilotoDia: 200, viaticoAuxiliarDia: 200, viaticoGuiaDia: 125, margenObjetivo: 0.2 };
  const { id: _id, ...perfilMotor } = perfil; void _id;
  const input: InputCosteoServicio = {
    perfil: perfilMotor, parametros, distanciaKm: 600, diasServicio: 1, cantidadPilotos: 2, cantidadAuxiliares: 2,
    incluirGps: true, incluirSeguroVehiculo: true, viaticoPilotoTotal: 200, viaticoAuxiliarTotal: 200, viaticoGuiaTotal: 125,
    otrosCostos: [{ concepto: "Peaje", monto: 100 }], precioVenta: 6000,
  };
  const costeo: CosteoPreparado = { perfil, input, resultado: calcularCosteoServicio(input) };

  function conexion(over: { existente?: boolean; falla?: (sql: string) => Error | null } = {}) {
    const conn = {
      query: vi.fn(async () => [over.existente ? [{ id: 9 }] : []]),
      execute: vi.fn(async (sql: string) => {
        const error = over.falla?.(sql);
        if (error) throw error;
        return [{ insertId: 55, affectedRows: 1 }];
      }),
    };
    return conn;
  }
  const guardar = (conn: ReturnType<typeof conexion>, c: CosteoPreparado = costeo) =>
    guardarSnapshotCosteoTx(conn as never, { empresaId: 1, cotizacionId: 10, cotizacionCodigo: "COT-000010", usuario: "admin", costeo: c });

  it("persiste perfil, parámetros e input EXACTOS como JSON (input sin repetir perfil/parámetros) y motor_version COSTEO_V1", async () => {
    const conn = conexion();
    await guardar(conn);
    const [sql, params] = conn.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("INSERT INTO tms_cotizacion_costeos");
    const [empresa, cotizacion, perfilId, codigo, nombre, perfilJson, parametrosJson, inputJson, version] = params as [number, number, number, string, string, string, string, string, string];
    expect([empresa, cotizacion, perfilId, codigo, nombre]).toEqual([1, 10, 4, "CABEZAL", "Cabezal"]);
    expect(JSON.parse(perfilJson)).toEqual(perfilMotor);
    expect(JSON.parse(parametrosJson)).toEqual(parametros);
    const inputGuardado = JSON.parse(inputJson);
    expect(inputGuardado).toEqual(JSON.parse(JSON.stringify({ ...input, perfil: undefined, parametros: undefined })));
    expect(inputGuardado.perfil).toBeUndefined(); expect(inputGuardado.parametros).toBeUndefined();
    expect(version).toBe("COSTEO_V1"); expect(version).toBe(COTIZACION_COSTEO_MOTOR_VERSION);
  });
  it("guarda los resultados denormalizados del motor sin recalcularlos", async () => {
    const conn = conexion();
    await guardar(conn);
    const params = (conn.execute.mock.calls[0] as unknown as [string, unknown[]])[1];
    const r = costeo.resultado;
    expect(params.slice(9)).toEqual([r.costoOperativo, r.iva, r.costoConIva, r.margenObjetivoAplicado, r.precioSugerido, r.precioVenta, r.utilidadEstimada, r.margenReal, "admin"]);
  });
  it("inserta TODOS los componentes del motor, en orden estable 1..N, y su suma coincide con el costo operativo", async () => {
    const conn = conexion();
    await guardar(conn);
    const [sql, params] = conn.execute.mock.calls[1] as unknown as [string, unknown[]];
    expect(sql).toContain("INSERT INTO tms_cotizacion_costeo_componentes");
    const n = costeo.resultado.componentes.length;
    expect(n).toBeGreaterThan(14); // 14 estándar + el "otro costo"
    expect(params).toHaveLength(n * 6);
    const filas = Array.from({ length: n }, (_, i) => params.slice(i * 6, i * 6 + 6));
    expect(filas.map((f) => f[2])).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(filas.map((f) => f[3])).toEqual(costeo.resultado.componentes.map((c) => c.clave));
    expect(filas.every((f) => f[0] === 1 && f[1] === 55)).toBe(true);
    expect(filas.reduce((s, f) => s + (f[5] as number), 0)).toBeCloseTo(costeo.resultado.costoOperativo, 8);
    expect(sumaComponentesCoincide(costeo.resultado)).toBe(true);
  });
  it("componentes que NO suman el costo operativo se rechazan antes de tocar la BD", async () => {
    const conn = conexion();
    const adulterado = { ...costeo, resultado: { ...costeo.resultado, costoOperativo: costeo.resultado.costoOperativo + 5 } };
    await expect(guardar(conn, adulterado)).rejects.toThrow("no coinciden");
    expect(conn.query).not.toHaveBeenCalled(); expect(conn.execute).not.toHaveBeenCalled();
  });
  it("auditoría crear_costeo/tms_cotizaciones sin montos, parámetros ni márgenes en el texto", async () => {
    const conn = conexion();
    await guardar(conn);
    const [, datos] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(datos).toMatchObject({ empresaId: 1, usuario: "admin", accion: "crear_costeo", modulo: "tms_cotizaciones" });
    expect(datos.detalle).toBe("Costeo interno registrado para cotización COT-000010 con perfil CABEZAL.");
    for (const secreto of ["29.89", "207", "148", "margen", "combustible", "0.2", "3907"]) expect(datos.detalle).not.toContain(secreto);
  });
  it("el snapshot NO puede reemplazarse: si ya existe => ErrorCosteoYaRegistrado, sin INSERT/UPDATE/DELETE", async () => {
    const conn = conexion({ existente: true });
    await expect(guardar(conn)).rejects.toBeInstanceOf(ErrorCosteoYaRegistrado);
    await expect(guardar(conn)).rejects.toThrow(MENSAJE_COSTEO_YA_REGISTRADO);
    expect(MENSAJE_COSTEO_YA_REGISTRADO).toBe("Esta cotización ya tiene un costeo registrado.");
    expect(conn.execute).not.toHaveBeenCalled(); expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.query.mock.calls[0]).toEqual([expect.stringContaining("FOR UPDATE"), [1, 10]]);
  });
  it("la restricción UNIQUE de la BD (carrera) también se traduce a ErrorCosteoYaRegistrado", async () => {
    const conn = conexion({ falla: (sql) => (sql.includes("INSERT INTO tms_cotizacion_costeos") ? Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }) : null) });
    await expect(guardar(conn)).rejects.toBeInstanceOf(ErrorCosteoYaRegistrado);
  });
  it("cualquier otro fallo se propaga tal cual (el llamador revierte la transacción)", async () => {
    const conn = conexion({ falla: (sql) => (sql.includes("costeo_componentes") ? new Error("falló componentes") : null) });
    await expect(guardar(conn)).rejects.toThrow("falló componentes");
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });
  it("el módulo nunca hace UPDATE ni DELETE sobre las tablas de snapshot", () => {
    const fuente = readFileSync("src/lib/tms/cotizacion-costeo-db.ts", "utf8");
    expect(fuente).not.toMatch(/\b(UPDATE|DELETE)\b[^;`]*tms_cotizacion_costeo/i);
    expect(fuente).not.toMatch(/REPLACE INTO|ON DUPLICATE KEY UPDATE/i);
  });
});

// ---------------------------------------------------------------------------
describe("Snapshot: leer", () => {
  const fila = {
    id: 55, cotizacion_id: 10, perfil_id: 4, perfil_codigo: "CABEZAL", perfil_nombre: "Cabezal", perfil_snapshot: '{"codigo":"CABEZAL"}',
    parametros_snapshot: { ivaTasa: 0.12 }, input_snapshot: '{"distanciaKm":600}', motor_version: "COSTEO_V1", costo_operativo: "3907.209097",
    iva: "468.865092", costo_con_iva: "4376.074188", margen_objetivo: "0.2000", precio_sugerido: "5251.289026", precio_venta: "6000.00",
    utilidad_estimada: "1623.925812", margen_real: "0.371100", creado_por: "admin", creado_en: "2026-09-21 10:00:00",
  };
  it("filtra por empresa_id en ambas tablas y devuelve componentes por orden", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([fila] as never)
      .mockResolvedValueOnce([{ clave: "gps", concepto: "GPS", monto: "5.803333" }, { clave: "aceite", concepto: "Aceite", monto: "223.200000" }] as never);
    const s = await obtenerSnapshotCosteo(1, 10);
    const [[sql1, p1], [sql2, p2]] = vi.mocked(query).mock.calls;
    expect(String(sql1)).toContain("WHERE empresa_id = ? AND cotizacion_id = ?"); expect(p1).toEqual([1, 10]);
    expect(String(sql2)).toContain("WHERE empresa_id = ? AND costeo_id = ?"); expect(String(sql2)).toContain("ORDER BY orden ASC"); expect(p2).toEqual([1, 55]);
    expect(s).toMatchObject({ id: 55, motorVersion: "COSTEO_V1", costoOperativo: 3907.209097, precioVenta: 6000, margenReal: 0.3711, perfil: { codigo: "CABEZAL" }, parametros: { ivaTasa: 0.12 }, input: { distanciaKm: 600 } });
    expect(s!.componentes).toEqual([{ clave: "gps", concepto: "GPS", monto: 5.803333 }, { clave: "aceite", concepto: "Aceite", monto: 223.2 }]);
  });
  it("sin costeo (o de otra empresa) => null, sin consultar componentes", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await obtenerSnapshotCosteo(2, 10)).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
