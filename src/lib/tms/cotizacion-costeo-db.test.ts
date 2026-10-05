import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { calcularCosteoServicio, COTIZACION_COSTEO_MOTOR_VERSION, type InputCosteoServicio } from "./cotizacion-costeo";
import {
  ErrorCosteoConfig, ErrorCosteoVersionConflicto, MENSAJE_COSTEO_VERSION_CONFLICTO, MENSAJE_SIN_PARAMETROS, guardarSnapshotCosteoTx,
  listarHistorialCosteos, listarPerfilesCosteo, obtenerCosteoSeleccionado, obtenerParametrosCosteoVigentes, obtenerPerfilCosteo, sumaComponentesCoincide,
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

/**
 * Consultas del guardado de una versión: 1) bloqueo de la cotización padre, 2) MAX(version) + «hay seleccionado» de sus costeos.
 * `maxVersion` = última versión ya registrada (0 = primer costeo); `haySeleccionado` = 1 si alguna ya es la utilizada.
 */
const consultaGuardar = (over: { padre?: boolean; maxVersion?: number; haySeleccionado?: number } = {}) => async (sql: string) => {
  if (String(sql).includes("FROM tms_cotizaciones ")) return [over.padre === false ? [] : [{ id: 10 }]];
  return [[{ max_version: over.maxVersion ?? 0, hay_seleccionado: over.haySeleccionado ?? (over.maxVersion ? 1 : 0) }]];
};

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
    expect(r.parametros).toMatchObject({ precioCombustibleGalon: 29.89, ivaTasa: 0.12, costoPilotoDia: 207.74, costoAuxiliarDia: 148.04, viaticoPilotoDia: 200, viaticoAuxiliarDia: 200, viaticoGuiaDia: 125, margenObjetivo: 0.2 });
    expect(r.parametros.gastosAdministracion).toBeNull();
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

  function conexion(over: { padre?: boolean; maxVersion?: number; haySeleccionado?: number; falla?: (sql: string) => Error | null } = {}) {
    const conn = {
      query: vi.fn(consultaGuardar(over)),
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
    expect(params.slice(9, 18)).toEqual([r.costoOperativo, r.iva, r.costoConIva, r.margenObjetivoAplicado, r.precioSugerido, r.precioVenta, r.utilidadEstimada, r.margenReal, "admin"]);
    expect(JSON.parse(String(params[18]))).toEqual(r);
  });
  it("V2 conserva override, margen objetivo y resultado completo; envía importes DECIMAL como texto", async () => {
    const entrada = {...input,motorVersion:"COSTEO_EXCEL_2026",perfil:{...input.perfil,viajesMes:20,salarioPilotoMensual:4000,salarioAuxiliarMensual:3000},parametros:{...input.parametros,diasLaboralesMes:20},precioCombustibleOverride:43,margenObjetivo:.45};
    const resultado = calcularCosteoServicio(entrada);
    const conn = conexion();
    await guardar(conn,{perfil:{...perfil,...entrada.perfil},input:entrada,resultado});
    const [sql, params] = conn.execute.mock.calls[0] as unknown as [string,unknown[]];
    expect(sql.match(/\?/g)).toHaveLength(params.length);
    expect(params[8]).toBe("COSTEO_EXCEL_2026");
    expect(params[9]).toBe(resultado.costoOperativo.toFixed(6));
    expect(JSON.parse(String(params[7]))).toMatchObject({precioCombustibleOverride:43,margenObjetivo:.45});
    expect(JSON.parse(String(params[18]))).toEqual(resultado);
    expect(JSON.parse(String(params[5]))).toMatchObject({salarioPilotoMensual:4000,salarioAuxiliarMensual:3000});
    expect(JSON.parse(String(params[6]))).not.toHaveProperty("salarioPilotoMensual");
    expect(JSON.parse(String(params[18]))).toMatchObject({valoresUsados:{salarioPilotoMensual:4000,salarioAuxiliarMensual:3000,costoPilotoDia:200,costoAuxiliarDia:150}});
    expect(input.parametros.precioCombustibleGalon).toBe(29.89);
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
    expect(datos.detalle).toBe("Costeo interno versión 1 registrado para cotización COT-000010 con perfil CABEZAL.");
    for (const secreto of ["29.89", "207", "148", "margen", "combustible", "0.2", "3907"]) expect(datos.detalle).not.toContain(secreto);
  });
  it("primer costeo => versión 1 y queda SELECCIONADO; inserta version, es_seleccionado y seleccionado_por/seleccionado_en", async () => {
    const conn = conexion();
    await guardar(conn);
    const [sql, params] = conn.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("version, es_seleccionado, seleccionado_por, seleccionado_en");
    expect(sql).toMatch(/NOW\(\)\)$/);
    expect(sql.match(/\?/g)).toHaveLength(params.length);
    expect(params.slice(19)).toEqual([1, 1, "admin"]);
  });
  it("segundo costeo => versión 2, NO seleccionado (no reemplaza al utilizado); tercero => versión 3", async () => {
    const dos = conexion({ maxVersion: 1, haySeleccionado: 1 });
    await guardar(dos);
    const [sql2, p2] = dos.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(p2.slice(19)).toEqual([2, 0, null]);
    expect(sql2).toMatch(/NULL\)$/);
    const tres = conexion({ maxVersion: 2, haySeleccionado: 1 });
    await guardar(tres);
    expect((tres.execute.mock.calls[0] as unknown as [string, unknown[]])[1].slice(19)).toEqual([3, 0, null]);
  });
  it("si por datos antiguos ninguna versión está seleccionada, la nueva queda seleccionada (la cotización nunca se queda sin costeo utilizado)", async () => {
    const conn = conexion({ maxVersion: 4, haySeleccionado: 0 });
    await guardar(conn);
    expect((conn.execute.mock.calls[0] as unknown as [string, unknown[]])[1].slice(19)).toEqual([5, 1, "admin"]);
  });
  it("una versión nueva NUNCA sobrescribe a la anterior: solo INSERT (sin UPDATE/DELETE/REPLACE), componentes de la versión nueva con su propio costeo_id", async () => {
    const conn = conexion({ maxVersion: 1, haySeleccionado: 1 });
    await guardar(conn);
    const sentencias = [...conn.query.mock.calls, ...conn.execute.mock.calls].map((c) => String((c as unknown as unknown[])[0]));
    expect(sentencias.filter((q) => /^\s*(UPDATE|DELETE|REPLACE)\b/i.test(q))).toEqual([]);
    expect(conn.execute.mock.calls).toHaveLength(2);
    const [, comp] = conn.execute.mock.calls[1] as unknown as [string, unknown[]];
    expect(comp[1]).toBe(55); // costeo_id = insertId de la versión nueva
  });
  it("serializa con la cotización padre: bloquea tms_cotizaciones (empresa_id + id) FOR UPDATE ANTES de leer MAX(version) y de insertar", async () => {
    const conn = conexion();
    await guardar(conn);
    const [[sqlPadre, paramsPadre], [sqlMax, paramsMax]] = conn.query.mock.calls as unknown as [[string, unknown[]], [string, unknown[]]];
    expect(sqlPadre).toContain("FROM tms_cotizaciones WHERE empresa_id = ? AND id = ?"); expect(sqlPadre).toContain("FOR UPDATE"); expect(paramsPadre).toEqual([1, 10]);
    expect(sqlMax).toContain("MAX(version)"); expect(sqlMax).toContain("WHERE empresa_id = ? AND cotizacion_id = ?"); expect(sqlMax).toContain("FOR UPDATE"); expect(paramsMax).toEqual([1, 10]);
  });
  it("cotización inexistente en la empresa => error antes de insertar nada (no se versiona una cotización ajena)", async () => {
    const conn = conexion({ padre: false });
    await expect(guardar(conn)).rejects.toThrow("Cotización no encontrada.");
    expect(conn.execute).not.toHaveBeenCalled(); expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });
  it("CONCURRENCIA: dos guardados simultáneos de la misma cotización obtienen versiones distintas (2 y 3), sin duplicados", async () => {
    const filas: { version: number; sel: number }[] = [{ version: 1, sel: 1 }];
    let cola: Promise<void> = Promise.resolve();
    const guardarSerializado = async () => {
      const previa = cola;
      let liberar!: () => void;
      cola = new Promise<void>((r) => { liberar = r; }); // el bloqueo FOR UPDATE de la cotización se mantiene hasta el commit del llamador
      const conn = {
        query: async (sql: string) => {
          if (sql.includes("FROM tms_cotizaciones ")) { await previa; return [[{ id: 10 }]]; }
          await new Promise((r) => setTimeout(r, 5)); // ventana de carrera: sin el bloqueo ambos leerían el mismo MAX
          return [[{ max_version: Math.max(0, ...filas.map((f) => f.version)), hay_seleccionado: filas.some((f) => f.sel) ? 1 : 0 }]];
        },
        execute: async (sql: string, params: unknown[]) => {
          if (sql.includes("INSERT INTO tms_cotizacion_costeos")) { filas.push({ version: params[19] as number, sel: params[20] as number }); return [{ insertId: 100 + filas.length, affectedRows: 1 }]; }
          return [{ affectedRows: 1 }];
        },
      };
      try { await guardar(conn as never); } finally { liberar(); }
    };
    await Promise.all([guardarSerializado(), guardarSerializado()]);
    expect(filas.map((f) => f.version).sort()).toEqual([1, 2, 3]);
    expect(new Set(filas.map((f) => f.version)).size).toBe(3);
    expect(filas.filter((f) => f.sel === 1)).toHaveLength(1);
  });
  it("la restricción UNIQUE (empresa_id, cotizacion_id, version) de la BD (carrera residual) se traduce a ErrorCosteoVersionConflicto", async () => {
    const conn = conexion({ falla: (sql) => (sql.includes("INSERT INTO tms_cotizacion_costeos") ? Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }) : null) });
    await expect(guardar(conn)).rejects.toBeInstanceOf(ErrorCosteoVersionConflicto);
    await expect(guardar(conn)).rejects.toThrow(MENSAJE_COSTEO_VERSION_CONFLICTO);
  });
  it("cualquier otro fallo se propaga tal cual (el llamador revierte la transacción)", async () => {
    const conn = conexion({ falla: (sql) => (sql.includes("costeo_componentes") ? new Error("falló componentes") : null) });
    await expect(guardar(conn)).rejects.toThrow("falló componentes");
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });
  it("el módulo nunca hace UPDATE ni DELETE sobre las tablas de snapshot", () => {
    const fuente = readFileSync("src/lib/tms/cotizacion-costeo-db.ts", "utf8");
    expect(fuente).not.toMatch(/\b(UPDATE|DELETE)\s+(FROM\s+)?tms_cotizacion_costeo/i);
    expect(fuente).not.toContain("ErrorCosteoYaRegistrado");
    expect(fuente).not.toMatch(/REPLACE INTO|ON DUPLICATE KEY UPDATE/i);
  });
});

// ---------------------------------------------------------------------------
describe("Historial de costeos: leer (snapshots persistidos, tenant-safe)", () => {
  const fila = (id: number, version: number, over: Record<string, unknown> = {}) => ({
    id, cotizacion_id: 10, version, es_seleccionado: version === 1 ? 1 : 0, seleccionado_por: version === 1 ? "admin" : null, seleccionado_en: version === 1 ? "2026-09-21 10:05:00" : null,
    perfil_id: 4, perfil_codigo: "CABEZAL", perfil_nombre: "Cabezal", perfil_snapshot: '{"codigo":"CABEZAL"}',
    parametros_snapshot: { ivaTasa: 0.12 }, input_snapshot: '{"distanciaKm":600}', motor_version: "COSTEO_V1", costo_operativo: "3907.209097",
    iva: "468.865092", costo_con_iva: "4376.074188", margen_objetivo: "0.2000", precio_sugerido: "5251.289026", precio_venta: "6000.00",
    utilidad_estimada: "1623.925812", margen_real: "0.371100", creado_por: "admin", creado_en: "2026-09-21 10:00:00", ...over,
  });
  it("obtenerCosteoSeleccionado: filtra por empresa_id + cotizacion_id + es_seleccionado = 1 y devuelve componentes por orden", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([fila(55, 1)] as never)
      .mockResolvedValueOnce([{ clave: "gps", concepto: "GPS", monto: "5.803333" }, { clave: "aceite", concepto: "Aceite", monto: "223.200000" }] as never);
    const s = await obtenerCosteoSeleccionado(1, 10);
    const [[sql1, p1], [sql2, p2]] = vi.mocked(query).mock.calls;
    expect(String(sql1)).toContain("WHERE empresa_id = ? AND cotizacion_id = ? AND es_seleccionado = 1"); expect(p1).toEqual([1, 10]);
    expect(String(sql2)).toContain("WHERE empresa_id = ? AND costeo_id = ?"); expect(String(sql2)).toContain("ORDER BY orden ASC"); expect(p2).toEqual([1, 55]);
    expect(s).toMatchObject({ id: 55, version: 1, esSeleccionado: true, seleccionadoPor: "admin", motorVersion: "COSTEO_V1", costoOperativo: 3907.209097, precioVenta: 6000, margenReal: 0.3711, perfil: { codigo: "CABEZAL" }, parametros: { ivaTasa: 0.12 }, input: { distanciaKm: 600 } });
    expect(s!.componentes).toEqual([{ clave: "gps", concepto: "GPS", monto: 5.803333 }, { clave: "aceite", concepto: "Aceite", monto: 223.2 }]);
  });
  it("sin costeo seleccionado (o de otra empresa) => null, sin consultar componentes", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await obtenerCosteoSeleccionado(2, 10)).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("lee el resultado V2 guardado sin consultar parámetros maestros ni ejecutar el motor", async () => {
    const resultado = { motorVersion: "COSTEO_EXCEL_2026", margenObjetivoAplicado: .45, margenObjetivoMonto: 870.21, subtotalComercial: 2804.02, precioPorKm: 14.28 };
    vi.mocked(query).mockResolvedValueOnce([fila(55, 1, { motor_version: "COSTEO_EXCEL_2026", resultado_snapshot: JSON.stringify(resultado) })] as never).mockResolvedValueOnce([] as never);
    const s = await obtenerCosteoSeleccionado(1, 10);
    expect(s!.resultado).toEqual(resultado);
    expect(query).toHaveBeenCalledTimes(2);
    expect(vi.mocked(query).mock.calls.every(([sql]) => !String(sql).includes("FROM tms_cotizacion_costeo_parametros"))).toBe(true);
  });
  it("listarHistorialCosteos: todas las versiones ORDER BY version DESC, filtrando por empresa_id + cotizacion_id y componentes por empresa_id + costeo_id IN (...)", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([fila(57, 3), fila(56, 2), fila(55, 1)] as never)
      .mockResolvedValueOnce([
        { costeo_id: 55, clave: "gps", concepto: "GPS", monto: "5.000000" },
        { costeo_id: 56, clave: "gps", concepto: "GPS", monto: "6.000000" },
        { costeo_id: 56, clave: "aceite", concepto: "Aceite", monto: "7.000000" },
        { costeo_id: 57, clave: "gps", concepto: "GPS", monto: "8.000000" },
      ] as never);
    const h = await listarHistorialCosteos(1, 10);
    const [[sql1, p1], [sql2, p2]] = vi.mocked(query).mock.calls;
    expect(String(sql1)).toContain("WHERE empresa_id = ? AND cotizacion_id = ?"); expect(String(sql1)).toContain("ORDER BY version DESC"); expect(p1).toEqual([1, 10]);
    expect(String(sql2)).toContain("WHERE empresa_id = ? AND costeo_id IN (?, ?, ?)"); expect(String(sql2)).toContain("ORDER BY costeo_id ASC, orden ASC"); expect(p2).toEqual([1, 57, 56, 55]);
    expect(h.map((x) => x.version)).toEqual([3, 2, 1]);
    expect(h.map((x) => x.esSeleccionado)).toEqual([false, false, true]);
    expect(h.map((x) => x.componentes.map((c) => c.monto))).toEqual([[8], [6, 7], [5]]); // cada versión conserva SUS componentes
    expect(h.every((x) => x.cotizacionId === 10)).toBe(true);
  });
  it("listarHistorialCosteos: sin costeos (o de otra empresa) => [] y sin consultar componentes", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await listarHistorialCosteos(2, 10)).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("las versiones conservan SUS snapshots distintos (perfil, parámetros, input, motor): la configuración posterior no los altera", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([
        fila(56, 2, { perfil_snapshot: '{"codigo":"CABEZAL","rendimientoKmGalon":8}', parametros_snapshot: '{"precioCombustibleGalon":35}', input_snapshot: '{"distanciaKm":700}', motor_version: "COSTEO_COTIZADOR_2026" }),
        fila(55, 1, { perfil_snapshot: '{"codigo":"CABEZAL","rendimientoKmGalon":9.3}', parametros_snapshot: '{"precioCombustibleGalon":29.89}', input_snapshot: '{"distanciaKm":600}' }),
      ] as never)
      .mockResolvedValueOnce([] as never);
    const [v2, v1] = await listarHistorialCosteos(1, 10);
    expect(v2.perfil).toMatchObject({ rendimientoKmGalon: 8 }); expect(v1.perfil).toMatchObject({ rendimientoKmGalon: 9.3 });
    expect(v2.parametros).toMatchObject({ precioCombustibleGalon: 35 }); expect(v1.parametros).toMatchObject({ precioCombustibleGalon: 29.89 });
    expect([v2.input.distanciaKm, v1.input.distanciaKm]).toEqual([700, 600]);
    expect([v2.motorVersion, v1.motorVersion]).toEqual(["COSTEO_COTIZADOR_2026", "COSTEO_V1"]);
    // Todo vino de las columnas *_snapshot: ninguna consulta toca perfiles ni parámetros vigentes.
    expect(vi.mocked(query).mock.calls.every(([sql]) => !/FROM tms_cotizacion_costeo_(perfiles|parametros)/.test(String(sql)))).toBe(true);
  });
  it("fechas: un DATETIME entregado como Date se normaliza a «YYYY-MM-DD HH:mm:ss» (local); una cadena se conserva", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([fila(55, 1, { creado_en: new Date(2026, 9, 5, 9, 55, 7), seleccionado_en: "2026-10-05 10:00:00" })] as never)
      .mockResolvedValueOnce([] as never);
    const [v] = await listarHistorialCosteos(1, 10);
    expect(v.creadoEn).toBe("2026-10-05 09:55:07");
    expect(v.seleccionadoEn).toBe("2026-10-05 10:00:00");
  });
  it("un costeo histórico (fila previa a la migración, ya con version = 1 y seleccionado) se lee sin cambios de formato", async () => {
    vi.mocked(query).mockResolvedValueOnce([fila(55, 1, { seleccionado_por: null, seleccionado_en: null })] as never).mockResolvedValueOnce([] as never);
    const [v] = await listarHistorialCosteos(1, 10);
    expect(v).toMatchObject({ version: 1, esSeleccionado: true, seleccionadoPor: null, seleccionadoEn: null, creadoPor: "admin" });
  });
});

// ---------------------------------------------------------------------------
// Paridad Cotizador 2026: columna viaticos_hotel_viaje y snapshot COSTEO_COTIZADOR_2026
// ---------------------------------------------------------------------------
describe("Perfil: viaticos_hotel_viaje", () => {
  it("el SELECT del perfil lee la columna nueva y se mapea a viaticosHotelViaje (NULL => null, no 0)", async () => {
    vi.mocked(query).mockResolvedValue([filaPerfil({ viaticos_hotel_viaje: "300.00" })] as never);
    const conValor = await obtenerPerfilCosteo(1, 4);
    expect(String(vi.mocked(query).mock.calls[0][0])).toContain("viaticos_hotel_viaje");
    expect(conValor?.viaticosHotelViaje).toBe(300);
    vi.mocked(query).mockResolvedValue([filaPerfil({ viaticos_hotel_viaje: null })] as never);
    expect((await obtenerPerfilCosteo(1, 4))?.viaticosHotelViaje).toBeNull();
    vi.mocked(query).mockResolvedValue([filaPerfil({ viaticos_hotel_viaje: "0.00" })] as never);
    expect((await obtenerPerfilCosteo(1, 4))?.viaticosHotelViaje).toBe(0); // 0 configurado es 0
  });
  it("el SELECT lee las banderas «por cada día» y las mapea: NULL => null (sin configurar), 1 => true, 0 => false", async () => {
    vi.mocked(query).mockResolvedValue([filaPerfil({ auxiliar_multiplica_dias: 1, viaticos_hotel_multiplica_dias: 0 })] as never);
    const cfg = await obtenerPerfilCosteo(1, 4);
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("auxiliar_multiplica_dias");
    expect(sql).toContain("viaticos_hotel_multiplica_dias");
    expect([cfg?.auxiliarMultiplicaDias, cfg?.viaticosHotelMultiplicaDias]).toEqual([true, false]);
    vi.mocked(query).mockResolvedValue([filaPerfil({ auxiliar_multiplica_dias: null, viaticos_hotel_multiplica_dias: null })] as never);
    const sin = await obtenerPerfilCosteo(1, 4);
    expect([sin?.auxiliarMultiplicaDias, sin?.viaticosHotelMultiplicaDias]).toEqual([null, null]);
    vi.mocked(query).mockResolvedValue([filaPerfil()] as never); // fila sin las columnas (datos previos a la migración)
    expect((await obtenerPerfilCosteo(1, 4))?.auxiliarMultiplicaDias).toBeNull();
    vi.mocked(query).mockResolvedValue([filaPerfil({ auxiliar_multiplica_dias: "0", viaticos_hotel_multiplica_dias: "1" })] as never);
    const txt = await obtenerPerfilCosteo(1, 4);
    expect([txt?.auxiliarMultiplicaDias, txt?.viaticosHotelMultiplicaDias]).toEqual([false, true]);
  });
  it("sigue filtrando por empresa_id (aislamiento) también al leer la columna nueva", async () => {
    vi.mocked(query).mockResolvedValue([filaPerfil()] as never);
    await listarPerfilesCosteo(7);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("WHERE empresa_id = ?");
    expect(params).toEqual([7]);
  });
});

describe("Snapshot COSTEO_COTIZADOR_2026", () => {
  const perfil: PerfilCosteoConId = {
    id: 4, codigo: "CAMION_2_7T", nombre: "Camión 2.7 toneladas", costoAdquisicion: null, diasOperacionMes: 30, gpsMensual: 100, seguroVehiculoMensual: 950,
    costoAceiteServicio: 1750, vidaUtilAceiteKm: 5000, costoJuegoLlantas: 3400, vidaUtilLlantasKm: 50000, rendimientoKmGalon: 25, viajesMes: 20,
    precioLlanta: 850, cantidadLlantas: 4, salarioPilotoMensual: 6787.685066666668, salarioAuxiliarMensual: 6039.965066666668, viaticosHotelViaje: 200,
    depreciacion: { valorBase: 150000, anios: 5, diasOperacionMes: 26 }, costoRefrigeracion: null,
  };
  const parametros = {
    precioCombustibleGalon: 43, ivaTasa: 0.12, costoPilotoDia: 0, costoAuxiliarDia: 0, viaticoPilotoDia: 0, viaticoAuxiliarDia: 0, viaticoGuiaDia: 0,
    seguroMercaderiaAnual: 70000, cantidadCamiones: 46, viajesAnuales: 240, diasDepreciacionMes: 26, diasGastosMes: 20, diasLaboralesMes: 20,
    gastosAdministracion: 90586.01, gastosMantenimiento: 34602.28, gastosSeguridad: 25826.24, gastosPredios: 52221.96,
  };
  const { id: _id, ...perfilMotor } = perfil; void _id;
  const input: InputCosteoServicio = {
    motorVersion: "COSTEO_COTIZADOR_2026", perfil: perfilMotor, parametros, distanciaKm: 220, diasServicio: 1, cantidadPilotos: 1, cantidadAuxiliares: 1,
    incluirGps: true, incluirSeguroVehiculo: true, margenObjetivo: 0.3, viaticosHotelTotal: 250,
  };
  const resultado = calcularCosteoServicio(input);
  const conexion = () => ({ query: vi.fn(consultaGuardar()), execute: vi.fn(async () => [{ insertId: 55, affectedRows: 1 }]) });
  const guardar = (conn: ReturnType<typeof conexion>) =>
    guardarSnapshotCosteoTx(conn as never, { empresaId: 1, cotizacionId: 10, cotizacionCodigo: "COT-000010", usuario: "admin", costeo: { perfil, input, resultado } });

  it("guarda versión COSTEO_COTIZADOR_2026, importes como texto DECIMAL, el override y el perfil con viaticosHotelViaje", async () => {
    const conn = conexion();
    await guardar(conn);
    const [sql, params] = conn.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql.match(/\?/g)).toHaveLength(params.length);
    expect(params[8]).toBe("COSTEO_COTIZADOR_2026");
    expect(params[9]).toBe(resultado.costoOperativo.toFixed(6));
    expect(typeof params[9]).toBe("string");
    expect(JSON.parse(String(params[5]))).toMatchObject({ viaticosHotelViaje: 200 });
    expect(JSON.parse(String(params[7]))).toMatchObject({ viaticosHotelTotal: 250, margenObjetivo: 0.3 });
    expect(JSON.parse(String(params[18]))).toEqual(resultado);
  });
  it("los componentes llevan UNA sola línea «Viáticos y hotel» (sin viático por rol ni hotel) y suman el costo operativo", async () => {
    const conn = conexion();
    await guardar(conn);
    const [, params] = conn.execute.mock.calls[1] as unknown as [string, unknown[]];
    const claves = [] as string[];
    for (let i = 0; i < params.length; i += 6) claves.push(String(params[i + 3]));
    expect(claves).toContain("viaticosHotel");
    for (const retirada of ["viaticoPiloto", "viaticoAuxiliar", "viaticoGuia", "hotel"]) expect(claves).not.toContain(retirada);
    expect(sumaComponentesCoincide(resultado)).toBe(true);
  });
  it("la lectura devuelve el resultado guardado tal cual, sin consultar parámetros ni recalcular", async () => {
    const fila = {
      id: 55, cotizacion_id: 10, version: 1, es_seleccionado: 1, seleccionado_por: null, seleccionado_en: null, perfil_id: 4, perfil_codigo: "CAMION_2_7T", perfil_nombre: "Camión 2.7 toneladas", perfil_snapshot: JSON.stringify(perfil),
      parametros_snapshot: JSON.stringify(parametros), input_snapshot: JSON.stringify({ distanciaKm: 220 }), motor_version: "COSTEO_COTIZADOR_2026",
      costo_operativo: String(resultado.costoOperativo), iva: String(resultado.iva), costo_con_iva: String(resultado.costoConIva), margen_objetivo: "0.300000",
      precio_sugerido: String(resultado.precioSugerido), precio_venta: null, utilidad_estimada: null, margen_real: null, creado_por: "admin", creado_en: "2026-10-05 10:00:00",
      resultado_snapshot: JSON.stringify(resultado),
    };
    vi.mocked(query).mockResolvedValueOnce([fila] as never).mockResolvedValueOnce([] as never);
    const s = await obtenerCosteoSeleccionado(1, 10);
    expect(s?.motorVersion).toBe("COSTEO_COTIZADOR_2026");
    expect(s?.resultado).toEqual(resultado);
    expect(vi.mocked(query).mock.calls.every(([sql]) => !String(sql).includes("FROM tms_cotizacion_costeo_parametros"))).toBe(true);
  });
  it("los snapshots anteriores (V1 y COSTEO_EXCEL_2026) siguen usando su propio formato de persistencia", async () => {
    const conn = conexion();
    const anterior = { ...input, motorVersion: "COSTEO_EXCEL_2026", viaticosHotelTotal: undefined, hotelTotal: 900 };
    const r = calcularCosteoServicio(anterior);
    await guardarSnapshotCosteoTx(conn as never, { empresaId: 1, cotizacionId: 11, cotizacionCodigo: "COT-000011", usuario: "admin", costeo: { perfil, input: anterior, resultado: r } });
    const [, params] = conn.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(params[8]).toBe("COSTEO_EXCEL_2026");
    expect(params[9]).toBe(r.costoOperativo.toFixed(6));
    expect(r.hotel).toBe(900);
  });
});
