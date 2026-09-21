import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
const migracion = leer("sql/migrate-2026-09-cotizaciones-costeo.sql");
const preflight = leer("sql/preflight-2026-09-cotizaciones-costeo.sql");
const schema = leer("sql/schema.sql");
const propuesta = leer("docs/COTIZACIONES-COSTEO-PERSISTENCIA-PROPUESTA.md");

const TABLAS = ["tms_cotizacion_costeo_perfiles", "tms_cotizacion_costeo_parametros", "tms_cotizacion_costeos", "tms_cotizacion_costeo_componentes"];
const create = (sql: string, tabla: string) => {
  const inicio = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${tabla} (`);
  expect(inicio, `CREATE de ${tabla}`).toBeGreaterThanOrEqual(0);
  return sql.slice(inicio, sql.indexOf(") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;", inicio) + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;".length);
};

describe("Migración canónica (aplicada manualmente en producción antes de versionarse)", () => {
  it("documenta que producción KT se aplicó a mano y que no se vuelve a ejecutar", () => {
    expect(migracion).toContain("PRODUCCIÓN KT FUE APLICADA MANUALMENTE ANTES DE VERSIONAR ESTA MIGRACIÓN");
    expect(migracion).toMatch(/NO debe volver a ejecutarse/);
  });
  it("crea el índice único aditivo (idempotente) y las 4 tablas, en ese orden (la FK compuesta lo exige)", () => {
    expect(migracion).toContain("ALTER TABLE tms_cotizaciones ADD UNIQUE KEY IF NOT EXISTS uq_cotizacion_empresa_id (empresa_id, id);");
    const orden = TABLAS.map((t) => migracion.indexOf(`CREATE TABLE IF NOT EXISTS ${t} (`));
    expect(orden.every((i) => i > 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
    expect(migracion.indexOf("ADD UNIQUE KEY")).toBeLessThan(orden[0]);
  });
  it("NO inserta perfiles ni parámetros (configuración de negocio ya cargada) ni altera/elimina datos", () => {
    const sinComentarios = migracion.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    // Sentencias que EMPIEZAN con estas palabras (no "ON UPDATE"/"ON DELETE" de las definiciones).
    expect(sinComentarios).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|REPLACE)\b/im);
    expect(sinComentarios).not.toMatch(/^\s*ALTER TABLE(?! tms_cotizaciones ADD UNIQUE KEY)/im);
  });
  it("conserva los tipos aplicados en producción (DECIMAL y JSON) y las FK compuestas de aislamiento", () => {
    expect(create(migracion, "tms_cotizacion_costeo_perfiles")).toMatch(/gps_mensual DECIMAL\(12,2\)[\s\S]*costo_juego_llantas DECIMAL\(14,2\)[\s\S]*rendimiento_km_galon DECIMAL\(8,3\)/);
    expect(create(migracion, "tms_cotizacion_costeo_parametros")).toMatch(/precio_combustible_galon DECIMAL\(10,4\)[\s\S]*iva_tasa DECIMAL\(6,4\)[\s\S]*margen_objetivo DECIMAL\(6,4\) NULL/);
    const costeos = create(migracion, "tms_cotizacion_costeos");
    expect(costeos).toMatch(/perfil_snapshot JSON NOT NULL[\s\S]*parametros_snapshot JSON NOT NULL[\s\S]*input_snapshot JSON NOT NULL[\s\S]*motor_version VARCHAR\(20\) NOT NULL/);
    expect(costeos).toMatch(/costo_operativo DECIMAL\(16,6\) NOT NULL[\s\S]*margen_real DECIMAL\(10,6\) NULL/);
    expect(costeos).toContain("UNIQUE KEY uq_cotizacion_costeo_cotizacion (empresa_id, cotizacion_id)");
    expect(costeos).toContain("FOREIGN KEY (empresa_id, cotizacion_id) REFERENCES tms_cotizaciones (empresa_id, id) ON DELETE RESTRICT");
    expect(create(migracion, "tms_cotizacion_costeo_componentes")).toContain("monto DECIMAL(16,6) NOT NULL");
    expect(create(migracion, "tms_cotizacion_costeo_componentes")).toContain("FOREIGN KEY (empresa_id, costeo_id) REFERENCES tms_cotizacion_costeos (empresa_id, id)");
  });
  it("no crea una segunda variante: el DDL es idéntico al de la propuesta ya aprobada", () => {
    const bloques = [...propuesta.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1].trim());
    for (const tabla of TABLAS) expect(create(migracion, tabla)).toBe(bloques.find((b) => b.startsWith(`CREATE TABLE IF NOT EXISTS ${tabla} (`)));
  });
});

describe("Preflight compatible con Hostinger", () => {
  it("NO usa information_schema (el usuario de producción no tiene acceso)", () => {
    const sinComentarios = preflight.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sinComentarios).not.toMatch(/information_schema/i);
    for (const prohibido of ["information_schema.TABLES", "information_schema.STATISTICS", "information_schema.REFERENTIAL_CONSTRAINTS"]) expect(sinComentarios).not.toContain(prohibido);
  });
  it("usa SHOW INDEX, SHOW CREATE TABLE y SHOW TABLES LIKE para las 4 tablas y el índice", () => {
    expect(preflight).toContain("SHOW INDEX FROM tms_cotizaciones;");
    for (const tabla of TABLAS) { expect(preflight).toContain(`SHOW CREATE TABLE ${tabla};`); expect(preflight).toContain(`SHOW TABLES LIKE '${tabla}';`); }
    expect(preflight).toContain("uq_cotizacion_empresa_id");
  });
  it("es solo lectura", () => {
    const sinComentarios = preflight.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sinComentarios).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/im);
  });
});

describe("schema.sql coincide con la migración", () => {
  it("tms_cotizaciones incluye el índice único (empresa_id, id) sin más cambios de columnas", () => {
    expect(create(schema, "tms_cotizaciones")).toContain("UNIQUE KEY uq_cotizacion_empresa_id (empresa_id, id),");
  });
  it.each(TABLAS)("%s es idéntica a la migración", (tabla) => {
    expect(create(schema, tabla)).toBe(create(migracion, tabla));
  });
  it("no siembra perfiles ni parámetros", () => {
    expect(schema).not.toMatch(/INSERT INTO tms_cotizacion_costeo/i);
  });
});
