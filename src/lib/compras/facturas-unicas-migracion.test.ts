import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), audit: vi.fn(), conn: { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() } }));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: () => ({ getConnection: async () => m.conn }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.audit }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn(async () => null) }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn(async () => ({ id: 50 })) }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));
import { ErrorCompra, esDuplicadoFacturaUnica, guardarRequerimiento, MSG_FACTURA_UNICA_BD } from "./requerimientos";
import { crearRequerimientoSchema } from "./requerimiento-schema";

const sql = readFileSync("sql/migrate-2026-09-compras-facturas-unicas.sql", "utf8").replace(/\r\n/g, "\n");
const sinComentarios = sql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");

describe("migración UNIQUE de facturas (solo se crea; NO se ejecuta)", () => {
  it("define la columna generada PERSISTENT factura_clave con la regla de la aplicación", () => {
    expect(sinComentarios).toContain("ADD COLUMN factura_clave VARCHAR(220) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    expect(sinComentarios).toContain("PERSISTENT");
    expect(sinComentarios).toContain("TRIM(REGEXP_REPLACE(COALESCE(serie_factura, ''''), ''[[:space:]]+'', '' ''))");
    expect(sinComentarios).toContain("TRIM(REGEXP_REPLACE(numero_factura, ''[[:space:]]+'', '' ''))");
    expect(sinComentarios).toContain("CHAR(1)");
  });
  it("factura_clave es NULL cuando el número es NULL o vacío (permite muchas líneas sin número)", () => {
    expect(sinComentarios).toContain("WHEN numero_factura IS NULL OR TRIM(REGEXP_REPLACE(numero_factura, ''[[:space:]]+'', '' '')) = '''' THEN NULL");
  });
  it("UNIQUE (empresa_id, proveedor_id, factura_clave) con el nombre esperado", () => {
    expect(sinComentarios).toContain("ADD UNIQUE KEY uq_compras_factura_proveedor (empresa_id, proveedor_id, factura_clave)");
  });
  it("no destruye ni modifica datos: sin DROP / DELETE / UPDATE / INSERT / TRUNCATE, y un solo ALTER", () => {
    expect(sinComentarios).not.toMatch(/\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE|REPLACE INTO|MODIFY|CHANGE)\b/i);
    expect(sinComentarios.match(/ALTER TABLE/g)).toHaveLength(1);
    expect(sinComentarios).not.toMatch(/serie_factura\s*=|numero_factura\s*=\s*[^=]/); // no reescribe las columnas originales
  });
  it("guardas previas: tabla, columna y índice inexistentes, colación, row format, REGEXP_REPLACE y 0 duplicados", () => {
    for (const g of ["@tabla", "@col_existe", "@idx_existe", "@colaciones_ok", "@row_format_ok", "@regexp_ok", "@duplicados"]) expect(sinComentarios).toContain(`SET ${g} :=`);
    expect(sinComentarios).toContain("COLLATION_NAME = 'utf8mb4_unicode_ci'");
    expect(sinComentarios).toContain("HAVING COUNT(*) > 1");
    expect(sinComentarios).toContain("DETENER: ");
  });
  it("el ALTER solo corre si TODAS las guardas pasan (@motivo IS NULL); si no, se omite", () => {
    expect(sinComentarios).toContain("SET @sql := IF(@motivo IS NULL,");
    expect(sinComentarios).toContain("ALTER omitido: precheck no superado");
  });
  it("postcheck: SHOW COLUMNS, SHOW INDEX y 0 duplicados según factura_clave", () => {
    expect(sinComentarios).toContain("SHOW COLUMNS FROM compras_requerimiento_lineas LIKE 'factura_clave';");
    expect(sinComentarios).toContain("SHOW INDEX FROM compras_requerimiento_lineas WHERE Key_name = 'uq_compras_factura_proveedor';");
    expect(sinComentarios).toContain("GROUP BY empresa_id, proveedor_id, factura_clave HAVING COUNT(*) > 1");
  });
  it("paridad con el preflight: misma normalización SQL", () => {
    const pre = readFileSync("sql/preflight-2026-09-compras-facturas-unicas.sql", "utf8");
    for (const t of ["TRIM(REGEXP_REPLACE(numero_factura, '[[:space:]]+', ' '))", "TRIM(REGEXP_REPLACE(COALESCE(serie_factura, ''), '[[:space:]]+', ' '))"]) {
      expect(pre).toContain(t);
      expect(sinComentarios).toContain(t);
    }
  });
});

describe("ER_DUP_ENTRY del índice único", () => {
  const dupIndice = { code: "ER_DUP_ENTRY", errno: 1062, message: "Duplicate entry '1-3-A\u000123' for key 'uq_compras_factura_proveedor'" };
  it("solo reconoce ER_DUP_ENTRY del índice esperado", () => {
    expect(esDuplicadoFacturaUnica(dupIndice)).toBe(true);
    expect(esDuplicadoFacturaUnica({ errno: 1062, message: "Duplicate entry 'x' for key 'uq_compras_factura_proveedor'" })).toBe(true);
    expect(esDuplicadoFacturaUnica({ code: "ER_DUP_ENTRY", errno: 1062, message: "Duplicate entry 'x' for key 'otro_indice'" })).toBe(false);
    expect(esDuplicadoFacturaUnica({ code: "ER_LOCK_DEADLOCK", errno: 1213, message: "uq_compras_factura_proveedor" })).toBe(false);
    expect(esDuplicadoFacturaUnica(new Error("boom"))).toBe(false);
    expect(esDuplicadoFacturaUnica(null)).toBe(false);
  });
  describe("guardarRequerimiento", () => {
    const linea = { fecha: "2026-09-17", proveedor_id: 3, vehiculo_id: null, repuesto_descripcion: "Filtro", metodo_pago: "Transferencia", condicion_pago: "Contado", total: "10.25", numero_factura: "1" };
    const guardar = () => guardarRequerimiento(1, 8, "r", crearRequerimientoSchema.parse({ fecha_requerimiento: "2026-09-17", entidad_requirente_id: 4, requirente_usuario_id: 9, lineas: [linea] }), false);
    beforeEach(() => {
      vi.resetAllMocks();
      m.conn.query.mockImplementation(async (s: string) => {
        if (s.includes("GET_LOCK") || s.includes("RELEASE_LOCK")) return [[{ l: 1 }]];
        if (s.includes("FROM cont_entidades")) return [[{ id: 4, nombre: "E" }]];
        if (s.includes("FROM usuarios")) return [[{ nombre: "U", rol_global: "Operaciones" }]];
        if (s.includes("FROM compras_proveedores")) return [[{ id: 3, activo: 1, nombre_comercial: "P", razon_social: "S", nit: "1", banco: "B", numero_cuenta: "c", dias_credito: 0 }]];
        return [[]];
      });
      m.conn.execute.mockResolvedValue([{ insertId: 12, affectedRows: 1 }]); m.query.mockResolvedValue([]);
    });
    it("el índice único rechaza en la carrera → 409 claro, con rollback", async () => {
      m.conn.commit.mockRejectedValueOnce(dupIndice);
      const error = await guardar().catch(e => e);
      expect(error).toBeInstanceOf(ErrorCompra);
      expect(error).toMatchObject({ status: 409, message: MSG_FACTURA_UNICA_BD });
      expect(m.conn.rollback).toHaveBeenCalled();
    });
    it("otro ER_DUP_ENTRY NO se esconde: se propaga tal cual", async () => {
      const otro = { code: "ER_DUP_ENTRY", errno: 1062, message: "Duplicate entry 'x' for key 'otro_indice'" };
      m.conn.commit.mockRejectedValueOnce(otro);
      await expect(guardar()).rejects.toBe(otro);
    });
  });
});
