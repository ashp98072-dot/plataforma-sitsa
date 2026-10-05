import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * COTIZACIONES — HISTORIAL DE COSTEOS: SQL propuesto (NO ejecutado). 1 cotización -> N versiones de costeo.
 * Las migraciones anteriores (ya aplicadas en producción) no se tocan.
 */
const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const sentencias = (s: string) => sinComentarios(s).split(";").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
const migracion = leer("sql/migrate-2026-10-cotizaciones-historial-costeos.sql");
const preflight = leer("sql/preflight-2026-10-cotizaciones-historial-costeos.sql");
const schema = leer("sql/schema.sql");
const migracionOriginal = leer("sql/migrate-2026-09-cotizaciones-costeo.sql");
const migracionExcel = leer("sql/migrate-2026-10-cotizaciones-costeo-excel.sql");
const migracionParidad = leer("sql/migrate-2026-10-cotizaciones-paridad-cotizador-2026.sql");
const tabla = (sql: string) => {
  const ini = sql.indexOf("CREATE TABLE IF NOT EXISTS tms_cotizacion_costeos (");
  return sql.slice(ini, sql.indexOf(") ENGINE=InnoDB", ini));
};

describe("migración: secuencia y contenido", () => {
  const s = sentencias(migracion);
  it("declara que NO fue ejecutada y que ejecuta primero el preflight", () => {
    expect(migracion).toContain("NO ejecutada");
    expect(migracion).toContain("sql/preflight-2026-10-cotizaciones-historial-costeos.sql");
  });
  it("son 5 sentencias en orden seguro: columnas -> históricos -> version NOT NULL -> índices nuevos -> soltar el único viejo", () => {
    expect(s).toHaveLength(5);
    expect(s[0]).toMatch(/^ALTER TABLE tms_cotizacion_costeos ADD COLUMN IF NOT EXISTS version INT NULL DEFAULT NULL/);
    expect(s[1]).toMatch(/^UPDATE tms_cotizacion_costeos SET/);
    expect(s[2]).toBe("ALTER TABLE tms_cotizacion_costeos MODIFY COLUMN version INT NOT NULL");
    expect(s[3]).toMatch(/^ALTER TABLE tms_cotizacion_costeos ADD UNIQUE KEY IF NOT EXISTS uq_cotizacion_costeo_version/);
    expect(s[4]).toMatch(/DROP INDEX IF EXISTS uq_cotizacion_costeo_cotizacion$/);
  });
  it("A. agrega version (NULL solo mientras se rellena), es_seleccionado NOT NULL DEFAULT 0 y seleccionado_por/seleccionado_en NULL", () => {
    expect(s[0]).toContain("ADD COLUMN IF NOT EXISTS version INT NULL DEFAULT NULL");
    expect(s[0]).toContain("ADD COLUMN IF NOT EXISTS es_seleccionado TINYINT(1) NOT NULL DEFAULT 0");
    expect(s[0]).toContain("ADD COLUMN IF NOT EXISTS seleccionado_por VARCHAR(100) NULL DEFAULT NULL");
    expect(s[0]).toContain("ADD COLUMN IF NOT EXISTS seleccionado_en DATETIME NULL DEFAULT NULL");
  });
  it("A. los históricos reciben version = 1 y es_seleccionado = 1 (eran el único costeo de su cotización)", () => {
    expect(s[1]).toBe("UPDATE tms_cotizacion_costeos SET version = 1, es_seleccionado = 1 WHERE version IS NULL");
  });
  it("A. el UPDATE es idempotente: solo filas sin versión, así re-ejecutar NO marca como seleccionadas versiones posteriores", () => {
    expect(s[1]).toMatch(/WHERE version IS NULL$/);
    expect(s.filter((x) => /^UPDATE/i.test(x))).toHaveLength(1);
  });
  it("A. el UPDATE no toca montos ni snapshots: solo version y es_seleccionado", () => {
    const asignaciones = s[1].replace(/^UPDATE tms_cotizacion_costeos SET /, "").replace(/ WHERE .*$/, "").split(",").map((x) => x.split("=")[0].trim());
    expect(asignaciones).toEqual(["version", "es_seleccionado"]);
    expect(sinComentarios(migracion)).not.toMatch(/snapshot|costo_operativo|precio_sugerido|margen_|motor_version|perfil_/i);
  });
  it("A. el unique viejo se elimina (SOLO ese índice) y el nuevo es único por (empresa_id, cotizacion_id, version)", () => {
    expect(s[4]).toBe("ALTER TABLE tms_cotizacion_costeos DROP INDEX IF EXISTS uq_cotizacion_costeo_cotizacion");
    expect(s[3]).toContain("UNIQUE KEY IF NOT EXISTS uq_cotizacion_costeo_version (empresa_id, cotizacion_id, version)");
    expect(s[3]).toContain("INDEX IF NOT EXISTS idx_cotizacion_costeo_historial (empresa_id, cotizacion_id, creado_en)");
    expect(sinComentarios(migracion).match(/DROP\b/gi)).toHaveLength(1); // ningún otro DROP (ni de tablas, ni de otros índices)
    expect(sinComentarios(migracion)).not.toContain("uq_cotizacion_costeo_empresa_id"); // el índice de la FK de componentes permanece intacto
  });
  it("el índice nuevo se crea ANTES de soltar el viejo (la FK compuesta (empresa_id, cotizacion_id) siempre tiene índice)", () => {
    expect(s.findIndex((x) => x.includes("ADD UNIQUE KEY IF NOT EXISTS uq_cotizacion_costeo_version"))).toBeLessThan(s.findIndex((x) => x.includes("DROP INDEX")));
  });
  it("es acotada: solo tms_cotizacion_costeos; sin DELETE/TRUNCATE/DROP TABLE/INSERT ni cambios de FK", () => {
    const sql = sinComentarios(migracion);
    expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|INSERT|RENAME|REPLACE)\b|DROP TABLE|FOREIGN KEY|CONSTRAINT/i);
    for (const x of s) expect(x).toMatch(/^(ALTER TABLE|UPDATE) tms_cotizacion_costeos /);
    expect(sql).not.toMatch(/tms_cotizacion_costeo_componentes|tms_cotizaciones\b/);
  });
  it("documenta la decisión sobre históricos y la unicidad de la selección en la aplicación", () => {
    expect(migracion).toMatch(/version = 1 y es_seleccionado = 1/);
    expect(migracion).toMatch(/MariaDB no tiene índice parcial/);
    expect(migracion).toMatch(/FOR UPDATE/);
  });
  it("NO modifica las migraciones anteriores ya aplicadas", () => {
    for (const anterior of [migracionOriginal, migracionExcel, migracionParidad]) {
      expect(anterior).not.toMatch(/es_seleccionado|uq_cotizacion_costeo_version|idx_cotizacion_costeo_historial/);
    }
    expect(migracionOriginal).toContain("UNIQUE KEY uq_cotizacion_costeo_cotizacion (empresa_id, cotizacion_id)"); // la histórica sigue describiendo el 1:1 original
  });
});

describe("schema.sql", () => {
  const ddl = tabla(schema);
  it("incluye las 4 columnas nuevas con la definición de la migración", () => {
    expect(ddl).toContain("version INT NOT NULL,");
    expect(ddl).toContain("es_seleccionado TINYINT(1) NOT NULL DEFAULT 0,");
    expect(ddl).toContain("seleccionado_por VARCHAR(100) NULL DEFAULT NULL,");
    expect(ddl).toContain("seleccionado_en DATETIME NULL DEFAULT NULL,");
  });
  it("A. unique por versión e índice de historial; el unique 1:1 viejo ya no existe", () => {
    expect(ddl).toContain("UNIQUE KEY uq_cotizacion_costeo_version (empresa_id, cotizacion_id, version),");
    expect(ddl).toContain("INDEX idx_cotizacion_costeo_historial (empresa_id, cotizacion_id, creado_en),");
    expect(ddl).not.toContain("uq_cotizacion_costeo_cotizacion");
    expect(ddl).toContain("UNIQUE KEY uq_cotizacion_costeo_empresa_id (empresa_id, id),"); // lo usa la FK de componentes
  });
  it("conserva la FK compuesta a la cotización (el índice nuevo empieza por empresa_id, cotizacion_id) y la de empresa", () => {
    expect(ddl).toContain("FOREIGN KEY (empresa_id, cotizacion_id) REFERENCES tms_cotizaciones (empresa_id, id) ON DELETE RESTRICT");
    expect(ddl).toContain("FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE");
  });
  it("no hay un índice único parcial inventado para el seleccionado (MariaDB no lo soporta): sin UNIQUE sobre es_seleccionado", () => {
    expect(ddl).not.toMatch(/UNIQUE[^\n]*es_seleccionado/);
    expect(sinComentarios(migracion)).not.toMatch(/UNIQUE[^;]*es_seleccionado/);
  });
  it("no se siembra nada y las columnas no aparecen en otras tablas", () => {
    expect(schema).not.toMatch(/INSERT INTO tms_cotizacion_costeos/i);
    expect((schema.match(/es_seleccionado/g) ?? []).length).toBe(2); // columna + comentario del DDL
  });
});

describe("preflight (solo lectura)", () => {
  it("únicamente SELECT y SHOW, sin information_schema (Hostinger)", () => {
    for (const x of sentencias(preflight)) expect(x).toMatch(/^(SELECT|SHOW)\b/i);
    expect(preflight).not.toContain("information_schema");
    expect(sinComentarios(preflight)).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/im); // «SHOW CREATE TABLE» es lectura
  });
  it("verifica versión de MariaDB, estructura (SHOW CREATE TABLE), índices y las 4 columnas nuevas", () => {
    expect(preflight).toContain("SELECT DATABASE() AS base_objetivo, VERSION() AS version_servidor;");
    expect(preflight).toContain("SHOW CREATE TABLE tms_cotizacion_costeos;");
    expect(preflight).toContain("SHOW INDEX FROM tms_cotizacion_costeos;");
    for (const col of ["version", "es_seleccionado", "seleccionado_por", "seleccionado_en"]) expect(preflight).toContain(`SHOW COLUMNS FROM tms_cotizacion_costeos LIKE '${col}';`);
    expect(preflight).toContain("uq_cotizacion_costeo_cotizacion");
  });
  it("cuenta los costeos existentes y detecta cotizaciones con más de un costeo ANTES de migrar", () => {
    expect(preflight).toContain("SELECT COUNT(*) AS total_costeos FROM tms_cotizacion_costeos;");
    expect(preflight).toMatch(/cotizaciones_con_mas_de_un_costeo FROM \(SELECT 1 FROM tms_cotizacion_costeos GROUP BY empresa_id, cotizacion_id HAVING COUNT\(\*\) > 1\) t;/);
  });
  it("incluye verificación posterior (sin versión NULL; una sola seleccionada por cotización) y criterios APLICAR / NOOP / DETENER", () => {
    expect(preflight).toContain("costeos_sin_version");
    expect(preflight).toContain("cotizaciones_con_mas_de_un_seleccionado");
    for (const palabra of ["APLICAR", "NOOP", "DETENER"]) expect(preflight).toContain(palabra);
  });
});
