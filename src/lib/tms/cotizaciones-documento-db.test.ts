import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { actualizarCotizacion, crearCotizacion, duplicarCotizacion, obtenerCotizacion } from "./cotizaciones";

/** COTIZACIONES FASE 6 — persistencia de marca, atención, cargo y unidad (mismo harness de conexión que cotizaciones.test.ts). */
function fila(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, empresa_id: 7, codigo: "COT-000001", cliente_id: 3, cliente_nombre: "Cliente Acme",
    ruta_id: null, ruta_codigo_historico: null, origen_texto: "Bodega Zona 12", destino_texto: "Puerto Barrios",
    tarifa_referencia: null, tarifa_cotizada: "1400.00", incluye_iva: 0, moneda: "GTQ",
    fecha_emision: "2026-09-08", fecha_vencimiento: null, estado: "Borrador",
    piloto_incluido: 1, gps_incluido: 0, seguro_mercaderia_incluido: 0, seguro_terceros_incluido: 0, servicio_refrigerado: 0,
    km_incluidos: null, tarifa_km_adicional: null, condiciones_adicionales: null, observaciones: null,
    documento_emisor: "MONACO", atencion_nombre: "Claudia Cordero", atencion_cargo: "Compras", unidad_descripcion: "Camión 5 toneladas",
    mensaje_comercial: null, cierre_comercial: null,
    creado_por: "admin", creado_en: "2026-09-08 10:00:00", actualizado_en: null,
    ...over,
  };
}

function conexion(opts: { estadoActual?: string; filaActual?: Record<string, unknown> } = {}) {
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM tms_clientes")) return [[{ nombre: "Cliente Acme" }]];
      if (sql.includes("FROM tms_cliente_rutas")) return [[{ codigo: "RUTA-1", tarifa_referencia: "1250.00", lugar_carga_texto: "Bodega", destino_descripcion: "Destino" }]];
      if (sql.includes("cliente_nombre") && sql.includes("FROM tms_cotizaciones")) return [[fila({ estado: opts.estadoActual ?? "Borrador", ...(opts.filaActual ?? {}) })]];
      return [[]];
    }),
    execute: vi.fn(async (...args: [string, ...unknown[]]) => {
      if (args[0].includes("INSERT INTO tms_cotizaciones")) return [{ insertId: 1, affectedRows: 1 }];
      return [{ insertId: 0, affectedRows: 1 }];
    }),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  return conn;
}

const insertDe = (conn: ReturnType<typeof conexion>) => conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_cotizaciones"))!;
const updateDe = (conn: ReturnType<typeof conexion>) => conn.execute.mock.calls.find((c) => String(c[0]).startsWith("UPDATE tms_cotizaciones SET\n") || String(c[0]).includes("documento_emisor = ?"));
const BASE = { clienteId: 3, tarifaCotizada: 1400, fechaEmision: "2026-09-08" };

beforeEach(() => vi.resetAllMocks());

describe("crearCotizacion — documento comercial", () => {
  it("guarda documentoEmisor, atención, cargo, unidad, mensaje y cierre comercial en el INSERT", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await crearCotizacion(7, {
      ...BASE, documentoEmisor: "MONACO", atencionNombre: " Claudia Cordero ", atencionCargo: "Compras", unidadDescripcion: "Camión 5 toneladas",
      mensajeComercial: " Mensaje a la medida del cliente. ", cierreComercial: " Quedamos atentos. ",
    }, "admin");
    const [sql, params] = insertDe(conn) as [string, unknown[]];
    expect(sql).toContain("documento_emisor, atencion_nombre, atencion_cargo, unidad_descripcion");
    expect(sql).toContain("mensaje_comercial, cierre_comercial");
    expect(params.slice(-6)).toEqual(["MONACO", "Claudia Cordero", "Compras", "Camión 5 toneladas", "Mensaje a la medida del cliente.", "Quedamos atentos."]);
    expect(params[0]).toBe(7); // empresa_id
  });

  it("el INSERT tiene tantos placeholders como columnas (no se desalinean los parámetros)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await crearCotizacion(7, BASE, "admin");
    const [sql, params] = insertDe(conn) as [string, unknown[]];
    const columnas = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((c) => c.trim()).filter(Boolean);
    expect(sql.match(/\?/g)).toHaveLength(columnas.length);
    expect(params).toHaveLength(columnas.length);
  });

  it("sin marca explícita usa el default KUIQTRANS; atención/cargo/unidad vacíos => null", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await crearCotizacion(7, { ...BASE, atencionNombre: "  ", unidadDescripcion: "" }, "admin");
    expect((insertDe(conn)[1] as unknown[]).slice(-6)).toEqual(["KUIQTRANS", null, null, null, null, null]);
  });

  it("rechaza mensaje o cierre comercial de más de 2000 caracteres, sin insertar", async () => {
    conexion();
    const largo = "x".repeat(2001);
    await expect(crearCotizacion(7, { ...BASE, mensajeComercial: largo })).rejects.toThrow("El mensaje para el cliente no puede exceder 2000 caracteres.");
    await expect(crearCotizacion(7, { ...BASE, cierreComercial: largo })).rejects.toThrow("El cierre comercial no puede exceder 2000 caracteres.");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("mensaje y cierre comercial son opcionales: sin ellos se guarda NULL (nunca se inventa un texto)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await crearCotizacion(7, BASE, "admin");
    expect((insertDe(conn)[1] as unknown[]).slice(-2)).toEqual([null, null]);
  });

  it.each(["kuiqtrans", "SITSA", "", "MONACO ", "Monaco"])("rechaza documentoEmisor inválido %j sin abrir conexión ni insertar", async (malo) => {
    conexion();
    await expect(crearCotizacion(7, { ...BASE, documentoEmisor: malo as never }, "admin")).rejects.toThrow("Documento emisor inválido.");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("rechaza atención, cargo o unidad de más de 160 caracteres (límite de la columna)", async () => {
    conexion();
    const largo = "x".repeat(161);
    await expect(crearCotizacion(7, { ...BASE, atencionNombre: largo })).rejects.toThrow("La atención no puede exceder 160 caracteres.");
    await expect(crearCotizacion(7, { ...BASE, atencionCargo: largo })).rejects.toThrow("El cargo / referencia no puede exceder 160 caracteres.");
    await expect(crearCotizacion(7, { ...BASE, unidadDescripcion: largo })).rejects.toThrow("La unidad no puede exceder 160 caracteres.");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("la ruta sigue siendo opcional: sin ruta no consulta tms_cliente_rutas y guarda la marca igual", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await crearCotizacion(7, { ...BASE, rutaId: null, documentoEmisor: "MONACO" }, "admin");
    expect(conn.query.mock.calls.some((c) => String(c[0]).includes("FROM tms_cliente_rutas"))).toBe(false);
    expect((insertDe(conn)[1] as unknown[]).slice(-6)[0]).toBe("MONACO");
  });

  it("la marca no depende del cliente ni de la ruta elegidos", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await crearCotizacion(7, { ...BASE, rutaId: 5, documentoEmisor: "KUIQTRANS" }, "admin");
    expect((insertDe(conn)[1] as unknown[]).slice(-6)[0]).toBe("KUIQTRANS");
  });

  it("no toca el costeo ni el estado: sin costeo no se ejecuta ninguna sentencia de costeo", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await crearCotizacion(7, { ...BASE, documentoEmisor: "MONACO" }, "admin");
    expect(conn.execute.mock.calls.some((c) => /costeo/i.test(String(c[0])))).toBe(false);
    expect(String(insertDe(conn)[0])).not.toContain("estado");
  });
});

describe("lectura — histórico y mapeo", () => {
  it("SELECT incluye las columnas del documento comercial (marca, atención, cargo, unidad, mensaje, cierre)", async () => {
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await obtenerCotizacion(7, 1);
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    for (const columna of ["documento_emisor", "atencion_nombre", "atencion_cargo", "unidad_descripcion", "mensaje_comercial", "cierre_comercial"]) expect(sql).toContain(columna);
  });

  it("mapea marca, atención, cargo, unidad, mensaje y cierre comercial", async () => {
    vi.mocked(query).mockResolvedValue([fila({ mensaje_comercial: "Mensaje guardado.", cierre_comercial: "Cierre guardado." })] as never);
    expect(await obtenerCotizacion(7, 1)).toMatchObject({
      documentoEmisor: "MONACO", atencionNombre: "Claudia Cordero", atencionCargo: "Compras", unidadDescripcion: "Camión 5 toneladas",
      mensajeComercial: "Mensaje guardado.", cierreComercial: "Cierre guardado.",
    });
  });

  it("cotización histórica sin mensaje/cierre guardado (columna NULL): se mapea a null, sin inventar texto (el fallback lo aplica el PDF)", async () => {
    vi.mocked(query).mockResolvedValue([fila()] as never);
    expect(await obtenerCotizacion(7, 1)).toMatchObject({ mensajeComercial: null, cierreComercial: null });
  });

  it("cotización histórica (DEFAULT de la columna): KUIQTRANS y textos null", async () => {
    vi.mocked(query).mockResolvedValue([fila({ documento_emisor: "KUIQTRANS", atencion_nombre: null, atencion_cargo: null, unidad_descripcion: null })] as never);
    expect(await obtenerCotizacion(7, 1)).toMatchObject({ documentoEmisor: "KUIQTRANS", atencionNombre: null, atencionCargo: null, unidadDescripcion: null });
  });

  it("valor ausente o inesperado en la fila no rompe: cae a KUIQTRANS", async () => {
    vi.mocked(query).mockResolvedValue([fila({ documento_emisor: undefined })] as never);
    expect((await obtenerCotizacion(7, 1))?.documentoEmisor).toBe("KUIQTRANS");
    vi.mocked(query).mockResolvedValue([fila({ documento_emisor: "OTRO" })] as never);
    expect((await obtenerCotizacion(7, 1))?.documentoEmisor).toBe("KUIQTRANS");
  });

  it("aislamiento por empresa: la consulta filtra por (id, empresa_id) con la empresa recibida", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await obtenerCotizacion(8, 1)).toBeNull();
    const [sql, params] = vi.mocked(query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE id = ? AND empresa_id = ?");
    expect(params).toEqual([1, 8]);
  });
});

describe("actualizarCotizacion — documento comercial (solo Borrador)", () => {
  it("en Borrador cambia marca, atención, cargo y unidad", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila({ documento_emisor: "KUIQTRANS" })] as never);
    await actualizarCotizacion(7, 1, {
      documentoEmisor: "KUIQTRANS", atencionNombre: "Otra Persona", atencionCargo: null, unidadDescripcion: "Cabezal 53'",
      mensajeComercial: "Nuevo mensaje.", cierreComercial: "Nuevo cierre.",
    });
    const [sql, params] = updateDe(conn) as [string, unknown[]];
    expect(sql).toContain("documento_emisor = ?, atencion_nombre = ?, atencion_cargo = ?, unidad_descripcion = ?");
    expect(sql).toContain("mensaje_comercial = ?, cierre_comercial = ?");
    expect(params.slice(-8)).toEqual(["KUIQTRANS", "Otra Persona", null, "Cabezal 53'", "Nuevo mensaje.", "Nuevo cierre.", 1, 7]); // ... WHERE id = ? AND empresa_id = ?
    expect(conn.commit).toHaveBeenCalled();
  });

  it("un PATCH sin esos campos conserva los valores guardados (no los pisa con default)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await actualizarCotizacion(7, 1, { observaciones: "Solo cambia esto" });
    expect((updateDe(conn)![1] as unknown[]).slice(-8)).toEqual(["MONACO", "Claudia Cordero", "Compras", "Camión 5 toneladas", null, null, 1, 7]);
  });

  it("un PATCH sin mensaje/cierre conserva el valor guardado, aunque cambie otros campos (nunca se pisa en silencio)", async () => {
    const conn = conexion({ filaActual: { mensaje_comercial: "Mensaje original.", cierre_comercial: "Cierre original." } });
    // Solo alimenta el re-fetch final (obtenerCotizacion, fuera de la transacción) — la lectura
    // "antes de escribir" (SELECT ... FOR UPDATE) es la de conn.query, vía filaActual arriba.
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await actualizarCotizacion(7, 1, { documentoEmisor: "KUIQTRANS" });
    expect((updateDe(conn)![1] as unknown[]).slice(-4, -2)).toEqual(["Mensaje original.", "Cierre original."]);
  });

  it("cadena vacía en atención/cargo/unidad los borra (null); no queda espacio en blanco guardado", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await actualizarCotizacion(7, 1, { atencionNombre: "  ", atencionCargo: "", unidadDescripcion: "   " });
    expect((updateDe(conn)![1] as unknown[]).slice(-8, -4)).toEqual(["MONACO", null, null, null]);
  });

  it("cadena vacía en mensaje/cierre comercial también los borra (null)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila({ mensaje_comercial: "Algo previo.", cierre_comercial: "Algo previo." })] as never);
    await actualizarCotizacion(7, 1, { mensajeComercial: "   ", cierreComercial: "" });
    expect((updateDe(conn)![1] as unknown[]).slice(-4, -2)).toEqual([null, null]);
  });

  it("rechaza mensaje o cierre comercial de más de 2000 caracteres y revierte sin actualizar", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await expect(actualizarCotizacion(7, 1, { mensajeComercial: "x".repeat(2001) })).rejects.toThrow("no puede exceder 2000 caracteres");
    expect(updateDe(conn)).toBeUndefined();
    expect(conn.rollback).toHaveBeenCalled();
  });

  it.each(["Enviada", "Aceptada", "Rechazada", "Vencida"])("una cotización %s NO se edita: ni marca ni contacto ni unidad", async (estadoActual) => {
    const conn = conexion({ estadoActual });
    await expect(actualizarCotizacion(7, 1, { documentoEmisor: "KUIQTRANS", atencionNombre: "Nuevo", unidadDescripcion: "Otra" })).rejects.toThrow(/solo mientras está en Borrador/);
    expect(updateDe(conn)).toBeUndefined();
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("rechaza documentoEmisor inválido y revierte sin actualizar", async () => {
    const conn = conexion();
    await expect(actualizarCotizacion(7, 1, { documentoEmisor: "NADA" as never })).rejects.toThrow("Documento emisor inválido.");
    expect(updateDe(conn)).toBeUndefined();
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("aislamiento por empresa: SELECT ... FOR UPDATE y UPDATE van acotados por empresa_id", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await actualizarCotizacion(9, 1, { documentoEmisor: "MONACO" });
    const seleccion = conn.query.mock.calls.find((c) => String(c[0]).includes("FOR UPDATE"))!;
    expect(String(seleccion[0])).toContain("id = ? AND empresa_id = ?");
    expect((seleccion as unknown[])[1]).toEqual([1, 9]);
    expect(String(updateDe(conn)![0])).toContain("WHERE id = ? AND empresa_id = ?");
    expect((updateDe(conn)![1] as unknown[]).slice(-2)).toEqual([1, 9]);
  });

  it("no toca el costeo si no se envía (ninguna sentencia de costeo)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await actualizarCotizacion(7, 1, { documentoEmisor: "KUIQTRANS" });
    expect(conn.execute.mock.calls.some((c) => /costeo/i.test(String(c[0])))).toBe(false);
  });
});

describe("duplicarCotizacion — copia el documento comercial", () => {
  it("copia marca, atención, cargo y unidad a un alta nueva (Borrador, sin costeo)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila()] as never);
    await duplicarCotizacion(7, 1, "admin");
    const [sql, params] = insertDe(conn) as [string, unknown[]];
    expect(params.slice(-6)).toEqual(["MONACO", "Claudia Cordero", "Compras", "Camión 5 toneladas", null, null]);
    expect(params[0]).toBe(7);
    expect(sql).not.toContain("estado"); // el alta nueva queda en el DEFAULT de la tabla: Borrador
    expect(conn.execute.mock.calls.some((c) => /costeo/i.test(String(c[0])))).toBe(false);
  });

  it("copia el mensaje y cierre comercial guardados (nunca los recalcula desde Ajustes)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila({ mensaje_comercial: "Mensaje original.", cierre_comercial: "Cierre original." })] as never);
    await duplicarCotizacion(7, 1, "admin");
    expect((insertDe(conn)[1] as unknown[]).slice(-2)).toEqual(["Mensaje original.", "Cierre original."]);
  });

  it("duplicar una cotización histórica copia el default KUIQTRANS (no la deja sin marca)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([fila({ documento_emisor: "KUIQTRANS", atencion_nombre: null, atencion_cargo: null, unidad_descripcion: null })] as never);
    await duplicarCotizacion(7, 1, "admin");
    expect((insertDe(conn)[1] as unknown[]).slice(-6)).toEqual(["KUIQTRANS", null, null, null, null, null]);
  });

  it("de otra empresa: no encuentra el original y no inserta nada", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await duplicarCotizacion(8, 1, "admin")).toBeNull();
    expect(conn.execute).not.toHaveBeenCalled();
  });
});
