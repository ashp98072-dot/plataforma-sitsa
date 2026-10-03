import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool, query } from "@/lib/db";
import {
  actualizarCotizacion,
  crearCotizacion,
  duplicarCotizacion,
  listarCotizaciones,
  obtenerCotizacion,
  type Cotizacion,
} from "./cotizaciones";
import {
  construirDocumentoComercial,
  esPrecioCombustibleValido,
  textoCombustibleReferencia,
} from "./cotizacion-documento";
import { COTIZACION_DOC } from "./cotizacion-documento.fixture";
import { cotizacionPdfKuiqtrans } from "./cotizacion-pdf-kuiqtrans";
import { cotizacionPdfMonaco } from "./cotizacion-pdf-monaco";

/**
 * COTIZACIONES-CREDITO-COMBUSTIBLE — condiciones de crédito + combustible de referencia: datos comerciales guardados
 * con la cotización (NULL en históricas), editables solo en Borrador, copiados al duplicar y mostrados en ambos PDFs.
 */
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

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

const CON_DATOS = { condiciones_credito: "Crédito 30 días", combustible_referencia_tipo: "diesel", combustible_referencia_precio: "29.75" };

function conexion(filaActual: Record<string, unknown> = filaCotizacion()) {
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM tms_clientes")) return [[{ nombre: "Cliente Acme" }]];
      if (sql.includes("FROM tms_cliente_rutas")) {
        return [[{ codigo: "RUTA-1", tarifa_referencia: "1250.00", lugar_carga_texto: "Bodega Zona 12", destino_descripcion: "PriceSmart Miraflores" }]];
      }
      if (sql.includes("FROM tms_cotizaciones")) return [[filaActual]];
      return [[]];
    }),
    execute: vi.fn(async (...args: [string, ...unknown[]]) => {
      const sql = args[0];
      if (sql.includes("INSERT INTO tms_cotizaciones")) return [{ insertId: 1, affectedRows: 1 }];
      return [{ insertId: 0, affectedRows: 1 }];
    }),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  return conn;
}

/** Valores enviados a las 3 columnas nuevas en el INSERT (posición por nombre de columna, no por índice fijo). */
function valoresInsert(conn: ReturnType<typeof conexion>) {
  const llamada = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_cotizaciones"))!;
  const sql = String(llamada[0]);
  const columnas = sql.match(/tms_cotizaciones\s*\(([\s\S]*?)\)\s*VALUES/i)![1].split(",").map((v) => v.trim());
  const params = llamada[1] as unknown[];
  const valor = (col: string) => params[columnas.indexOf(col)];
  return {
    credito: valor("condiciones_credito"),
    tipo: valor("combustible_referencia_tipo"),
    precio: valor("combustible_referencia_precio"),
    tarifaReferencia: valor("tarifa_referencia"),
  };
}

function valoresUpdate(conn: ReturnType<typeof conexion>) {
  const llamada = conn.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_cotizaciones SET"))!;
  const sql = String(llamada[0]);
  const asignaciones = sql.slice(sql.indexOf("SET") + 3, sql.indexOf("WHERE")).split(",").map((v) => v.trim().split(/\s*=/)[0]);
  const params = llamada[1] as unknown[];
  const valor = (col: string) => params[asignaciones.indexOf(col)];
  return { credito: valor("condiciones_credito"), tipo: valor("combustible_referencia_tipo"), precio: valor("combustible_referencia_precio") };
}

const BASE = { clienteId: 3, rutaId: 5, tarifaCotizada: 1400, fechaEmision: "2026-09-08" };

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("crear — guarda los 3 campos tal cual", () => {
  it("crea cotización con condiciones de crédito", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion({ condiciones_credito: "Crédito 30 días" })] as never);
    const c = await crearCotizacion(7, { ...BASE, condicionesCredito: "  Crédito 30 días  " }, "admin");
    expect(valoresInsert(conn)).toMatchObject({ credito: "Crédito 30 días", tipo: null, precio: null });
    expect(c.condicionesCredito).toBe("Crédito 30 días");
  });

  it("crea cotización con Diésel + precio", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion(CON_DATOS)] as never);
    const c = await crearCotizacion(7, { ...BASE, combustibleReferenciaTipo: "diesel", combustibleReferenciaPrecio: 29.75 });
    expect(valoresInsert(conn)).toMatchObject({ tipo: "diesel", precio: 29.75 });
    expect(c.combustibleReferenciaTipo).toBe("diesel");
    expect(c.combustibleReferenciaPrecio).toBe(29.75);
  });

  it("crea cotización con Gasolina + precio", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion({ combustible_referencia_tipo: "gasolina", combustible_referencia_precio: "32.10" })] as never);
    const c = await crearCotizacion(7, { ...BASE, combustibleReferenciaTipo: "gasolina", combustibleReferenciaPrecio: 32.1 });
    expect(valoresInsert(conn)).toMatchObject({ tipo: "gasolina", precio: 32.1 });
    expect(c.combustibleReferenciaPrecio).toBe(32.1);
  });

  it("crea cotización sin estos datos: las 3 columnas van NULL", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    await crearCotizacion(7, BASE);
    expect(valoresInsert(conn)).toMatchObject({ credito: null, tipo: null, precio: null });
  });

  it("no toca tarifaReferencia: sigue saliendo de la ruta, aunque se envíe combustible", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion(CON_DATOS)] as never);
    const c = await crearCotizacion(7, { ...BASE, combustibleReferenciaTipo: "diesel", combustibleReferenciaPrecio: 29.75 });
    expect(valoresInsert(conn).tarifaReferencia).toBe(1250);
    expect(c.tarifaReferencia).toBe(1250);
    expect(c.combustibleReferenciaPrecio).toBe(29.75);
  });
});

describe("validación del servidor (capa de datos)", () => {
  it("precio decimal: acepta hasta 2 decimales y rechaza 3, cero o negativo", async () => {
    expect(esPrecioCombustibleValido(29.75)).toBe(true);
    expect(esPrecioCombustibleValido(30)).toBe(true);
    expect(esPrecioCombustibleValido(0.1 + 0.2)).toBe(true); // ruido binario de 0.30 no es un tercer decimal
    expect(esPrecioCombustibleValido(29.755)).toBe(false);
    expect(esPrecioCombustibleValido(0)).toBe(false);
    expect(esPrecioCombustibleValido(-1)).toBe(false);
    expect(esPrecioCombustibleValido(Number.NaN)).toBe(false);
    conexion();
    await expect(crearCotizacion(7, { ...BASE, combustibleReferenciaPrecio: 29.755 })).rejects.toThrow(/2 decimales/);
  });

  it("rechaza tipo de combustible inválido y crédito demasiado largo, sin escribir", async () => {
    const conn = conexion();
    await expect(crearCotizacion(7, { ...BASE, combustibleReferenciaTipo: "kerosene" as never })).rejects.toThrow(/combustible/i);
    await expect(crearCotizacion(7, { ...BASE, condicionesCredito: "x".repeat(301) })).rejects.toThrow(/crédito/i);
    expect(conn.execute).not.toHaveBeenCalled();
  });
});

describe("obtener / listar", () => {
  it("obtener conserva los datos guardados", async () => {
    vi.mocked(query).mockResolvedValue([filaCotizacion(CON_DATOS)] as never);
    const c = await obtenerCotizacion(7, 1);
    expect(c).toMatchObject({ condicionesCredito: "Crédito 30 días", combustibleReferenciaTipo: "diesel", combustibleReferenciaPrecio: 29.75 });
  });

  it("listado y detalle exponen los 3 campos y filtran por empresa", async () => {
    vi.mocked(query).mockResolvedValue([filaCotizacion(CON_DATOS)] as never);
    const [primera] = await listarCotizaciones(7);
    expect(primera).toMatchObject({ condicionesCredito: "Crédito 30 días", combustibleReferenciaTipo: "diesel", combustibleReferenciaPrecio: 29.75 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("condiciones_credito, combustible_referencia_tipo, combustible_referencia_precio");
    expect(String(sql)).toContain("empresa_id = ?");
    expect(params).toContain(7);
  });

  it("cotización histórica (columnas NULL) funciona: los 3 campos llegan null", async () => {
    vi.mocked(query).mockResolvedValue([filaCotizacion({ condiciones_credito: null, combustible_referencia_tipo: null, combustible_referencia_precio: null })] as never);
    const c = await obtenerCotizacion(7, 1);
    expect(c).toMatchObject({ condicionesCredito: null, combustibleReferenciaTipo: null, combustibleReferenciaPrecio: null });
  });

  it("antes de la migración (ER_BAD_FIELD_ERROR) la LECTURA cae al SELECT sin columnas nuevas; otros errores se propagan", async () => {
    vi.mocked(query).mockImplementation(async (sql: unknown) => {
      if (String(sql).includes("condiciones_credito")) {
        throw Object.assign(new Error("Unknown column 'condiciones_credito'"), { code: "ER_BAD_FIELD_ERROR", errno: 1054 });
      }
      if (String(sql).includes("FROM tms_cotizacion_lineas")) return [] as never;
      return [filaCotizacion()] as never;
    });
    const c = await obtenerCotizacion(7, 1);
    expect(c).toMatchObject({ condicionesCredito: null, combustibleReferenciaTipo: null, combustibleReferenciaPrecio: null });
    expect(String(vi.mocked(query).mock.calls[1][0])).not.toContain("condiciones_credito");

    vi.mocked(query).mockReset().mockRejectedValueOnce(Object.assign(new Error("conexión perdida"), { code: "PROTOCOL_CONNECTION_LOST" }));
    await expect(obtenerCotizacion(7, 1)).rejects.toThrow("conexión perdida");
  });
});

describe("editar (solo Borrador, mismas reglas de edición)", () => {
  it("editar sin enviar los campos conserva los guardados", async () => {
    const conn = conexion(filaCotizacion(CON_DATOS));
    vi.mocked(query).mockResolvedValue([filaCotizacion(CON_DATOS)] as never);
    await actualizarCotizacion(7, 1, { observaciones: "otra" });
    expect(valoresUpdate(conn)).toEqual({ credito: "Crédito 30 días", tipo: "diesel", precio: 29.75 });
  });

  it("editar cambia y limpia los campos (null explícito)", async () => {
    const conn = conexion(filaCotizacion(CON_DATOS));
    vi.mocked(query).mockResolvedValue([filaCotizacion()] as never);
    await actualizarCotizacion(7, 1, { condicionesCredito: "Contado", combustibleReferenciaTipo: "gasolina", combustibleReferenciaPrecio: null });
    expect(valoresUpdate(conn)).toEqual({ credito: "Contado", tipo: "gasolina", precio: null });
  });

  it("una cotización que ya no está en Borrador no se edita", async () => {
    const conn = conexion(filaCotizacion({ ...CON_DATOS, estado: "Enviada" }));
    await expect(actualizarCotizacion(7, 1, { condicionesCredito: "Contado" })).rejects.toThrow();
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("UPDATE tms_cotizaciones SET"))).toBe(false);
  });
});

describe("duplicar", () => {
  it("copia los 3 campos tal cual (sin recalcular)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaCotizacion(CON_DATOS)] as never);
    await duplicarCotizacion(7, 1, "admin");
    expect(valoresInsert(conn)).toMatchObject({ credito: "Crédito 30 días", tipo: "diesel", precio: 29.75 });
  });
});

describe("documento comercial y PDFs", () => {
  const CON: Cotizacion = { ...COTIZACION_DOC, condicionesCredito: "Crédito 30 días", combustibleReferenciaTipo: "diesel", combustibleReferenciaPrecio: 29.75 };

  async function textosPdf(generar: () => Promise<Buffer>) {
    const espia = vi.spyOn(PDFDocument.prototype, "text");
    const buffer = await generar();
    const todo = espia.mock.calls.map((c) => String(c[0])).join("\n");
    espia.mockRestore();
    return { buffer, todo };
  }

  it("construirDocumentoComercial usa solo el valor guardado y lo pone en condiciones", () => {
    const doc = construirDocumentoComercial(CON);
    expect(doc.condicionesCredito).toBe("Crédito 30 días");
    expect(doc.combustibleReferencia).toBe(textoCombustibleReferencia("diesel", 29.75));
    expect(doc.condiciones).toContain("Condiciones de crédito: Crédito 30 días");
    expect(doc.condiciones.some((l) => l.startsWith("Combustible de referencia: Diésel") && l.includes("29.75") && l.endsWith("/galón"))).toBe(true);
  });

  it("PDF KuiqTrans muestra condiciones de crédito", async () => {
    const { buffer, todo } = await textosPdf(() => cotizacionPdfKuiqtrans(construirDocumentoComercial({ ...CON, documentoEmisor: "KUIQTRANS", combustibleReferenciaTipo: null, combustibleReferenciaPrecio: null })));
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(todo).toContain("Condiciones de crédito: Crédito 30 días");
    expect(todo).not.toContain("Combustible de referencia");
  });

  it("PDF KuiqTrans muestra combustible de referencia", async () => {
    const { todo } = await textosPdf(() => cotizacionPdfKuiqtrans(construirDocumentoComercial({ ...CON, documentoEmisor: "KUIQTRANS", condicionesCredito: null })));
    expect(todo).toContain("Combustible de referencia: Diésel");
    expect(todo).not.toContain("Condiciones de crédito");
  });

  it("PDF Mónaco muestra ambos", async () => {
    const { buffer, todo } = await textosPdf(() => cotizacionPdfMonaco(construirDocumentoComercial({ ...CON, documentoEmisor: "MONACO", combustibleReferenciaTipo: "gasolina", combustibleReferenciaPrecio: 32.1 })));
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(todo).toContain("Condiciones de crédito: Crédito 30 días");
    expect(todo).toContain("Combustible de referencia: Gasolina");
  });

  it("PDF de cotización histórica sin datos no falla y omite las líneas", async () => {
    for (const [emisor, gen] of [["KUIQTRANS", cotizacionPdfKuiqtrans], ["MONACO", cotizacionPdfMonaco]] as const) {
      const historica: Cotizacion = { ...COTIZACION_DOC, documentoEmisor: emisor };
      const doc = construirDocumentoComercial(historica);
      expect(doc.condicionesCredito).toBeNull();
      expect(doc.combustibleReferencia).toBeNull();
      const { buffer, todo } = await textosPdf(() => gen(doc));
      expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(todo).not.toContain("Condiciones de crédito");
      expect(todo).not.toContain("Combustible de referencia");
    }
  });

  it("el precio histórico no se recalcula: el documento no consulta BD ni Ajustes", () => {
    const doc = construirDocumentoComercial({ ...CON, combustibleReferenciaPrecio: 25.4 });
    expect(doc.combustibleReferencia).toContain("25.40");
    expect(query).not.toHaveBeenCalled();
    const fuente = leer("src/lib/tms/cotizacion-documento.ts");
    expect(fuente).not.toMatch(/from\s+["']@\/lib\/db["']/);
    expect(fuente).not.toMatch(/import[^;]*(ajustes|costeo)/i);
  });
});

describe("SQL, esquema y UI", () => {
  const migracion = leer("sql/migrate-2026-10-cotizaciones-credito-combustible.sql");
  const preflight = leer("sql/preflight-2026-10-cotizaciones-credito-combustible.sql");
  const schema = leer("sql/schema.sql");

  it("migración idempotente, solo ADD COLUMN NULL, sin backfill ni operaciones destructivas", () => {
    expect(migracion).toMatch(/ADD COLUMN IF NOT EXISTS condiciones_credito VARCHAR\(300\) NULL/);
    expect(migracion).toMatch(/ADD COLUMN IF NOT EXISTS combustible_referencia_tipo VARCHAR\(20\) NULL/);
    expect(migracion).toMatch(/ADD COLUMN IF NOT EXISTS combustible_referencia_precio DECIMAL\(12,2\) NULL/);
    const sinComentarios = migracion.replace(/--.*$/gm, "");
    expect(sinComentarios).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|CREATE TABLE)\b/i);
    expect(sinComentarios).not.toMatch(/tarifa_referencia/);
  });

  it("preflight solo lee (SHOW), sin information_schema", () => {
    const sinComentarios = preflight.replace(/--.*$/gm, "");
    expect(sinComentarios).toMatch(/SHOW COLUMNS FROM tms_cotizaciones\s+LIKE 'condiciones_credito'/);
    expect(sinComentarios).not.toMatch(/information_schema/i);
    expect(sinComentarios).not.toMatch(/\b(ALTER|DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
  });

  it("schema.sql incluye las 3 columnas en tms_cotizaciones", () => {
    const tabla = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS tms_cotizaciones ("));
    const fin = tabla.indexOf(";");
    const def = tabla.slice(0, fin);
    expect(def).toContain("condiciones_credito VARCHAR(300) NULL");
    expect(def).toContain("combustible_referencia_tipo VARCHAR(20) NULL");
    expect(def).toContain("combustible_referencia_precio DECIMAL(12,2) NULL");
  });

  it("formulario y detalle muestran los campos (detalle con «—» si vacío)", () => {
    const page = leer("src/app/e/[slug]/cotizaciones/page.tsx");
    expect(page).toContain("Condiciones de crédito");
    expect(page).toContain("Tipo de combustible");
    expect(page).toContain("Precio referencia combustible (Q/galón)");
    expect(page).toContain('{c.condicionesCredito?.trim() || "—"}');
    expect(page).toContain('textoCombustibleReferencia(c.combustibleReferenciaTipo, c.combustibleReferenciaPrecio) ?? "—"');
  });
});
