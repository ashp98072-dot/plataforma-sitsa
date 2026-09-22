import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool, query } from "@/lib/db";
import {
  IVA_PORCENTAJE,
  actualizarCotizacion,
  calcularIva,
  cambiarEstadoCotizacion,
  crearCotizacion,
  duplicarCotizacion,
  listarCotizaciones,
  obtenerCotizacion,
} from "./cotizaciones";

function filaCotizacion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, empresa_id: 7, codigo: "COT-000001", cliente_id: 3, cliente_nombre: "Cliente Acme",
    ruta_id: 5, ruta_codigo_historico: "RUTA-1", origen_texto: "Bodega Zona 12", destino_texto: "PriceSmart Miraflores",
    tarifa_referencia: "1250.00", tarifa_cotizada: "1400.00",
    incluye_iva: 0, moneda: "GTQ", fecha_emision: "2026-09-08", fecha_vencimiento: "2026-09-22",
    estado: "Borrador", piloto_incluido: 1, gps_incluido: 0, seguro_mercaderia_incluido: 0, seguro_terceros_incluido: 0,
    km_incluidos: null, tarifa_km_adicional: null, condiciones_adicionales: null, observaciones: null,
    creado_por: "admin", creado_en: "2026-09-08 10:00:00", actualizado_en: "2026-09-08 10:00:00",
    ...overrides,
  };
}

function filaLinea(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10, cotizacion_id: 1, orden: 2, origen_texto: "PriceSmart Pradera", destino_texto: "PriceSmart Pradera — bodega",
    unidad_descripcion: "1 Tonelada", tarifa_cotizada: "937.50",
    ...overrides,
  };
}

/** El `query` de nivel superior (@/lib/db) lo usan tanto el SELECT de tms_cotizaciones como el de tms_cotizacion_lineas — se distinguen por el texto del SQL, igual que conn.query en `conexion()`. */
function mockQueryPorTabla(filasCotizaciones: Record<string, unknown>[], filasLineas: Record<string, unknown>[] = []) {
  vi.mocked(query).mockImplementation(async (sql: unknown) => {
    if (String(sql).includes("FROM tms_cotizacion_lineas")) return filasLineas as never;
    return filasCotizaciones as never;
  });
}

type ConnOpts = {
  clienteExiste?: boolean;
  rutaExiste?: boolean;
  rutaFila?: Record<string, unknown>;
  estadoActual?: string;
  fallaEn?: string;
};

function conexion(opts: ConnOpts = {}) {
  const clienteExiste = opts.clienteExiste ?? true;
  const rutaExiste = opts.rutaExiste ?? true;
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM tms_clientes")) return [clienteExiste ? [{ nombre: "Cliente Acme" }] : []];
      if (sql.includes("FROM tms_cliente_rutas")) {
        return [rutaExiste ? [opts.rutaFila ?? {
          codigo: "RUTA-1", tarifa_referencia: "1250.00",
          lugar_carga_texto: "Bodega Zona 12", destino_descripcion: "PriceSmart Miraflores",
        }] : []];
      }
      // actualizarCotizacion usa el SELECT completo (trae cliente_nombre);
      // cambiarEstadoCotizacion usa uno propio y angosto (solo id/estado).
      if (sql.includes("cliente_nombre") && sql.includes("FROM tms_cotizaciones")) {
        return [[filaCotizacion({ estado: opts.estadoActual ?? "Borrador" })]];
      }
      if (sql.includes("FROM tms_cotizaciones")) {
        return [[{ id: 1, estado: opts.estadoActual ?? "Borrador" }]];
      }
      return [[]];
    }),
    execute: vi.fn(async (...args: [string, ...unknown[]]) => {
      const sql = args[0];
      if (opts.fallaEn && sql.includes(opts.fallaEn)) throw new Error(`fallo:${opts.fallaEn}`);
      if (sql.includes("INSERT INTO tms_cotizaciones")) return [{ insertId: 1, affectedRows: 1 }];
      return [{ insertId: 0, affectedRows: 1 }];
    }),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  return conn;
}

beforeEach(() => vi.resetAllMocks());

describe("cálculo de IVA (Guatemala, tasa fija)", () => {
  it("tasa legal es 12%", () => {
    expect(IVA_PORCENTAJE).toBe(0.12);
  });

  it("incluyeIva=false: tarifaCotizada es el subtotal, se le suma el IVA", () => {
    expect(calcularIva(1000, false)).toEqual({ subtotal: 1000, iva: 120, total: 1120 });
  });

  it("incluyeIva=true: tarifaCotizada YA es el total, se retro-calcula el subtotal", () => {
    const r = calcularIva(1120, true);
    expect(r.total).toBe(1120);
    expect(r.subtotal).toBe(1000);
    expect(r.iva).toBe(120);
  });

  it("redondea a 2 decimales", () => {
    const r = calcularIva(999.99, false);
    expect(r.iva).toBe(120);
    expect(r.total).toBe(1119.99);
  });
});

describe("crearCotizacion — snapshot histórico (COTIZADOR-TMS-1)", () => {
  it("captura tarifa_referencia/origen/destino de la ruta AL MOMENTO de crear", async () => {
    conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    const c = await crearCotizacion(7, {
      clienteId: 3, rutaId: 5, tarifaCotizada: 1400, fechaEmision: "2026-09-08",
    }, "admin");
    expect(c.tarifaReferencia).toBe(1250);
    expect(c.origenTexto).toBe("Bodega Zona 12");
    expect(c.destinoTexto).toBe("PriceSmart Miraflores");
  });

  it("nunca confía en un tarifaReferencia enviado por el cliente HTTP — siempre relee la ruta real", async () => {
    // El tipo CotizacionInput ni siquiera acepta tarifaReferencia — esta
    // prueba confirma que el INSERT usa el valor releído del servidor
    // (1250 de la ruta mockeada), no algo que un caller malicioso
    // pudiera inyectar por otra vía.
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    await crearCotizacion(7, { clienteId: 3, rutaId: 5, tarifaCotizada: 1400, fechaEmision: "2026-09-08" });
    const insertCall = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_cotizaciones"))!;
    const params = insertCall[1] as unknown[];
    expect(params).toContain(1250); // tarifa_referencia
  });

  it("mantiene alineadas 29 columnas, 29 placeholders y 29 parámetros en el INSERT (23 + 4 del documento comercial + 2 de presentación comercial)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    await crearCotizacion(7, { clienteId: 3, rutaId: 5, tarifaCotizada: 1400, fechaEmision: "2026-09-08" }, "admin");
    const insertCall = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_cotizaciones"))!;
    const sql = String(insertCall[0]);
    const columnas = sql.match(/tms_cotizaciones\s*\(([\s\S]*?)\)\s*VALUES/i)?.[1].split(",").map((v) => v.trim()).filter(Boolean) ?? [];
    const placeholders = sql.match(/VALUES\s*\(([\s\S]*?)\)/i)?.[1].match(/\?/g) ?? [];
    const parametros = insertCall[1] as unknown[];
    expect(columnas).toHaveLength(29);
    expect(placeholders).toHaveLength(29);
    expect(parametros).toHaveLength(29);
  });

  it("una vez guardada, cambios posteriores en la ruta maestra NO se reflejan (el snapshot ya quedó fijo en la fila)", async () => {
    conexion();
    // Primera lectura (creación): ruta con tarifa 1250.
    vi.mocked(query).mockResolvedValue([filaCotizacion({ tarifa_referencia: "1250.00" })] as never);
    const c = await crearCotizacion(7, { clienteId: 3, rutaId: 5, tarifaCotizada: 1400, fechaEmision: "2026-09-08" });
    expect(c.tarifaReferencia).toBe(1250);
    // obtenerCotizacion (lectura posterior) NUNCA vuelve a tocar
    // tms_cliente_rutas — solo lee de tms_cotizaciones, que ya tiene el
    // valor congelado en sus propias columnas.
    const leidoDeRutas = vi.mocked(query).mock.calls.some((c) => String(c[0]).includes("tms_cliente_rutas"));
    expect(leidoDeRutas).toBe(false);
  });

  it("sin rutaId: no consulta tms_cliente_rutas, snapshot queda null", async () => {
    conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion({ ruta_id: null, ruta_codigo_historico: null, tarifa_referencia: null })] as never);
    const c = await crearCotizacion(7, { clienteId: 3, tarifaCotizada: 1400, fechaEmision: "2026-09-08" });
    expect(c.rutaId).toBeNull();
    expect(c.tarifaReferencia).toBeNull();
  });

  /**
   * TMS-SIN-COSTO-OPERATIVO-1 — negocio confirmó que "costo operativo"
   * ya no se utiliza en el cotizador: no se copia de la ruta, no se
   * muestra y no entra en ningún cálculo. La columna
   * tms_cotizaciones.costo_operativo_referencia NO se eliminó (sin DROP,
   * sin migración destructiva) — esta prueba confirma que la capa de
   * aplicación ya no la lee ni la escribe.
   */
  it("ya no copia costo_operativo de la ruta ni lo incluye en la cotización creada", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    const c = await crearCotizacion(7, { clienteId: 3, rutaId: 5, tarifaCotizada: 1400, fechaEmision: "2026-09-08" });
    expect(c).not.toHaveProperty("costoOperativoReferencia");
    const rutaQueryCall = conn.query.mock.calls.find((c) => String(c[0]).includes("FROM tms_cliente_rutas"))!;
    expect(String(rutaQueryCall[0])).not.toContain("costo_operativo");
    const insertCall = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_cotizaciones"))!;
    expect(String(insertCall[0])).not.toContain("costo_operativo_referencia");
  });

  it("genera código COT-###### derivado del id, sin condición de carrera", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    await crearCotizacion(7, { clienteId: 3, tarifaCotizada: 1400, fechaEmision: "2026-09-08" });
    const updateCodigo = conn.execute.mock.calls.find((c) => (c[0] as string).includes("SET codigo"));
    expect(updateCodigo?.[1]).toEqual(["COT-000001", 1, 7]);
  });

  it("rechaza tarifaCotizada <= 0 sin insertar", async () => {
    conexion();
    await expect(crearCotizacion(7, { clienteId: 3, tarifaCotizada: 0, fechaEmision: "2026-09-08" })).rejects.toThrow("mayor a cero");
  });
});

describe("crearCotizacion — aislamiento multiempresa (cross-tenant)", () => {
  it("cliente que no pertenece a esta empresa se rechaza, no inserta nada", async () => {
    const conn = conexion({ clienteExiste: false });
    await expect(crearCotizacion(7, { clienteId: 999, tarifaCotizada: 100, fechaEmision: "2026-09-08" }))
      .rejects.toThrow("El cliente indicado no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("ruta que no pertenece a esta empresa se rechaza, no inserta nada", async () => {
    const conn = conexion({ rutaExiste: false });
    await expect(crearCotizacion(7, { clienteId: 3, rutaId: 999, tarifaCotizada: 100, fechaEmision: "2026-09-08" }))
      .rejects.toThrow("La ruta indicada no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("actualizarCotizacion rechaza reasignar a un cliente de otra empresa", async () => {
    conexion({ clienteExiste: false, estadoActual: "Borrador" });
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    await expect(actualizarCotizacion(7, 1, { clienteId: 999 })).rejects.toThrow("El cliente indicado no pertenece a esta empresa.");
  });
});

describe("actualizarCotizacion — solo editable en Borrador", () => {
  it("rechaza editar una cotización Enviada", async () => {
    conexion({ estadoActual: "Enviada" });
    vi.mocked(query).mockResolvedValue([filaCotizacion({ estado: "Enviada" })] as never);
    await expect(actualizarCotizacion(7, 1, { tarifaCotizada: 2000 })).rejects.toThrow('solo mientras está en Borrador');
  });

  it("permite editar mientras está en Borrador", async () => {
    conexion({ estadoActual: "Borrador" });
    vi.mocked(query).mockResolvedValue([filaCotizacion({ tarifa_cotizada: "2000.00" })] as never);
    const c = await actualizarCotizacion(7, 1, { tarifaCotizada: 2000 });
    expect(c?.tarifaCotizada).toBe(2000);
  });

  it("devuelve null si la cotización no existe", async () => {
    const conn = conexion();
    conn.query.mockImplementation(async () => [[]]);
    expect(await actualizarCotizacion(7, 999, { tarifaCotizada: 100 })).toBeNull();
  });
});

describe("cambiarEstadoCotizacion — transiciones válidas", () => {
  it("permite Borrador -> Enviada", async () => {
    const conn = conexion({ estadoActual: "Borrador" });
    vi.mocked(query).mockResolvedValue([filaCotizacion({ estado: "Enviada" })] as never);
    const c = await cambiarEstadoCotizacion(7, 1, "Enviada", "admin");
    expect(c?.estado).toBe("Enviada");
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("permite Enviada -> Aceptada", async () => {
    conexion({ estadoActual: "Enviada" });
    vi.mocked(query).mockResolvedValue([filaCotizacion({ estado: "Aceptada" })] as never);
    const c = await cambiarEstadoCotizacion(7, 1, "Aceptada");
    expect(c?.estado).toBe("Aceptada");
  });

  it("rechaza Borrador -> Aceptada (salto de estado)", async () => {
    const conn = conexion({ estadoActual: "Borrador" });
    await expect(cambiarEstadoCotizacion(7, 1, "Aceptada")).rejects.toThrow('No se puede pasar de "Borrador" a "Aceptada"');
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("Aceptada es un estado final: no admite ninguna transición más", async () => {
    conexion({ estadoActual: "Aceptada" });
    await expect(cambiarEstadoCotizacion(7, 1, "Enviada")).rejects.toThrow();
  });

  it("Rechazada es un estado final: no admite ninguna transición más", async () => {
    conexion({ estadoActual: "Rechazada" });
    await expect(cambiarEstadoCotizacion(7, 1, "Enviada")).rejects.toThrow();
  });

  it("devuelve null si la cotización no existe", async () => {
    const conn = conexion();
    conn.query.mockImplementation(async () => [[]]);
    expect(await cambiarEstadoCotizacion(7, 999, "Enviada")).toBeNull();
  });
});

describe("duplicarCotizacion", () => {
  it("copia cliente/ruta/tarifas/condiciones a una cotización nueva en Borrador", async () => {
    conexion();
    vi.mocked(query)
      .mockResolvedValueOnce([filaCotizacion({ id: 1 })] as never) // obtenerCotizacion (original)
      .mockResolvedValue([filaCotizacion({ id: 2, codigo: "COT-000002" })] as never); // obtenerCotizacion (nueva, tras crear)
    const nueva = await duplicarCotizacion(7, 1, "admin");
    expect(nueva?.id).toBe(2);
    expect(nueva?.codigo).toBe("COT-000002");
  });

  it("devuelve null si la cotización original no existe", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await duplicarCotizacion(7, 999)).toBeNull();
  });

  it("copia también las líneas adicionales (sin sus id/orden originales — se reasignan al insertar)", async () => {
    const conn = conexion();
    mockQueryPorTabla(
      [filaCotizacion({ id: 1 })],
      [filaLinea({ id: 10, orden: 2, origen_texto: "Pradera", tarifa_cotizada: "937.50" }), filaLinea({ id: 11, orden: 3, origen_texto: "Fraijanes", tarifa_cotizada: "820.00" })],
    );
    const nueva = await duplicarCotizacion(7, 1, "admin");
    expect(nueva).not.toBeNull();
    const inserts = conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_cotizacion_lineas"));
    expect(inserts).toHaveLength(2);
    expect(inserts.map((c) => (c[1] as unknown[])[3])).toEqual(["Pradera", "Fraijanes"]); // origen_texto, en el mismo orden
    expect(inserts.map((c) => (c[1] as unknown[])[2])).toEqual([2, 3]); // orden reasignado desde 2, nunca el id/orden original
  });
});

describe("líneas adicionales — varias rutas/destinos en una sola cotización, cada una con su propio precio", () => {
  it("crearCotizacion inserta cada línea adicional con orden consecutivo desde 2 (1 es la línea principal)", async () => {
    const conn = conexion();
    mockQueryPorTabla([filaCotizacion()]);
    await crearCotizacion(7, {
      clienteId: 3, tarifaCotizada: 1400, fechaEmision: "2026-09-08",
      lineasAdicionales: [
        { origenTexto: "PriceSmart Pradera", destinoTexto: "PriceSmart Pradera", unidadDescripcion: "1 Tonelada", tarifaCotizada: 937.5 },
        { origenTexto: "PriceSmart Fraijanes", destinoTexto: "PriceSmart Fraijanes", unidadDescripcion: "1 Tonelada", tarifaCotizada: 937.5 },
        { origenTexto: "PriceSmart San Cristóbal", destinoTexto: "PriceSmart San Cristóbal", unidadDescripcion: "1 Tonelada", tarifaCotizada: 937.5 },
      ],
    }, "admin");
    const inserts = conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_cotizacion_lineas"));
    expect(inserts).toHaveLength(3);
    const ordenes = inserts.map((c) => (c[1] as unknown[])[2]); // empresaId, cotizacionId, orden, ...
    expect(ordenes).toEqual([2, 3, 4]);
    expect(inserts[0][1]).toEqual([7, 1, 2, "PriceSmart Pradera", "PriceSmart Pradera", "1 Tonelada", 937.5]);
  });

  it("crearCotizacion sin lineasAdicionales no inserta nada en tms_cotizacion_lineas", async () => {
    const conn = conexion();
    mockQueryPorTabla([filaCotizacion()]);
    await crearCotizacion(7, { clienteId: 3, tarifaCotizada: 1400, fechaEmision: "2026-09-08" }, "admin");
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("tms_cotizacion_lineas"))).toBe(false);
  });

  it("rechaza una línea adicional con precio <= 0, sin insertar la cotización", async () => {
    const conn = conexion();
    await expect(crearCotizacion(7, {
      clienteId: 3, tarifaCotizada: 1400, fechaEmision: "2026-09-08",
      lineasAdicionales: [{ tarifaCotizada: 0 }],
    })).rejects.toThrow("El precio de la línea 2 debe ser mayor a cero");
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("rechaza más de 50 líneas adicionales", async () => {
    conexion();
    const muchas = Array.from({ length: 51 }, () => ({ tarifaCotizada: 100 }));
    await expect(crearCotizacion(7, { clienteId: 3, tarifaCotizada: 1400, fechaEmision: "2026-09-08", lineasAdicionales: muchas }))
      .rejects.toThrow("No se pueden agregar más de 50 líneas adicionales");
  });

  it("rechaza un punto de carga/descarga de más de 300 caracteres en una línea adicional", async () => {
    conexion();
    await expect(crearCotizacion(7, {
      clienteId: 3, tarifaCotizada: 1400, fechaEmision: "2026-09-08",
      lineasAdicionales: [{ origenTexto: "x".repeat(301), tarifaCotizada: 100 }],
    })).rejects.toThrow("no puede exceder 300 caracteres");
  });

  it("actualizarCotizacion: si lineasAdicionales se omite, NO toca tms_cotizacion_lineas (las existentes se conservan)", async () => {
    const conn = conexion({ estadoActual: "Borrador" });
    mockQueryPorTabla([filaCotizacion()]);
    await actualizarCotizacion(7, 1, { tarifaCotizada: 2000 });
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("tms_cotizacion_lineas"))).toBe(false);
  });

  it("actualizarCotizacion: si se manda lineasAdicionales (aunque vacío), reemplaza por completo — DELETE + INSERT", async () => {
    const conn = conexion({ estadoActual: "Borrador" });
    mockQueryPorTabla([filaCotizacion()]);
    await actualizarCotizacion(7, 1, {
      lineasAdicionales: [{ origenTexto: "Nueva ruta", destinoTexto: "Nuevo destino", tarifaCotizada: 500 }],
    });
    const deleteCall = conn.execute.mock.calls.find((c) => String(c[0]).includes("DELETE FROM tms_cotizacion_lineas"));
    expect(deleteCall?.[1]).toEqual([7, 1]);
    const insertCalls = conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_cotizacion_lineas"));
    expect(insertCalls).toHaveLength(1);
  });

  it("actualizarCotizacion: lineasAdicionales = [] borra todas las líneas adicionales guardadas (DELETE sin ningún INSERT)", async () => {
    const conn = conexion({ estadoActual: "Borrador" });
    mockQueryPorTabla([filaCotizacion()]);
    await actualizarCotizacion(7, 1, { lineasAdicionales: [] });
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("DELETE FROM tms_cotizacion_lineas"))).toBe(true);
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("INSERT INTO tms_cotizacion_lineas"))).toBe(false);
  });

  it("una cotización Enviada rechaza el cambio de líneas igual que cualquier otro campo (solo Borrador es editable)", async () => {
    conexion({ estadoActual: "Enviada" });
    mockQueryPorTabla([filaCotizacion({ estado: "Enviada" })]);
    await expect(actualizarCotizacion(7, 1, { lineasAdicionales: [{ tarifaCotizada: 100 }] })).rejects.toThrow("solo mientras está en Borrador");
  });

  it("obtenerCotizacion adjunta las líneas adicionales de la tabla nueva, en orden, aisladas por empresa_id", async () => {
    mockQueryPorTabla(
      [filaCotizacion({ id: 1 })],
      [filaLinea({ id: 11, orden: 3, origen_texto: "Fraijanes", tarifa_cotizada: "937.50" }), filaLinea({ id: 10, orden: 2, origen_texto: "Pradera", tarifa_cotizada: "820.00" })],
    );
    const c = await obtenerCotizacion(7, 1);
    expect(c?.lineasAdicionales).toHaveLength(2);
    const lineasCall = vi.mocked(query).mock.calls.find((c) => String(c[0]).includes("FROM tms_cotizacion_lineas"))!;
    expect(lineasCall[1]).toEqual([7, 1]);
    expect(String(lineasCall[0])).toContain("empresa_id = ?");
  });

  it("listarCotizaciones agrupa las líneas de varias cotizaciones en una sola consulta batch (IN)", async () => {
    mockQueryPorTabla(
      [filaCotizacion({ id: 1 }), filaCotizacion({ id: 2, codigo: "COT-000002" })],
      [filaLinea({ id: 10, cotizacion_id: 1 }), filaLinea({ id: 11, cotizacion_id: 2, orden: 2 })],
    );
    const lista = await listarCotizaciones(7);
    expect(lista.find((c) => c.id === 1)?.lineasAdicionales).toHaveLength(1);
    expect(lista.find((c) => c.id === 2)?.lineasAdicionales).toHaveLength(1);
    const lineasCalls = vi.mocked(query).mock.calls.filter((c) => String(c[0]).includes("FROM tms_cotizacion_lineas"));
    expect(lineasCalls).toHaveLength(1); // una sola consulta batch, no N+1
  });

  it("sin cotizaciones: listarCotizaciones no ejecuta ninguna consulta a tms_cotizacion_lineas (evita un IN () vacío)", async () => {
    mockQueryPorTabla([]);
    await listarCotizaciones(7);
    expect(vi.mocked(query).mock.calls.some((c) => String(c[0]).includes("FROM tms_cotizacion_lineas"))).toBe(false);
  });
});
