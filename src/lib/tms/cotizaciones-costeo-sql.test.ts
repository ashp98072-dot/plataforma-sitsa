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
  it("no crea una segunda variante: el documento reproduce el mismo DDL real (no la propuesta original)", () => {
    const bloques = [...propuesta.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1].trim());
    for (const tabla of TABLAS) expect(create(migracion, tabla)).toBe(bloques.find((b) => b.startsWith(`CREATE TABLE IF NOT EXISTS ${tabla} (`)));
  });
});

/**
 * DDL REAL aplicado manualmente en producción KT (Hostinger). Estas
 * expectativas son la referencia: la migración Y schema.sql deben
 * reproducirlo tal cual. No basta con que migración == schema.sql (ambos
 * podrían estar mal a la vez).
 */
const CLAVES_PRODUCCION: Record<string, string[]> = {
  tms_cotizacion_costeo_perfiles: [
    "UNIQUE KEY uq_costeo_perfil_codigo (empresa_id, codigo)",
    "UNIQUE KEY uq_costeo_perfil_empresa_id (empresa_id, id)",
    "INDEX idx_costeo_perfil_activo (empresa_id, activo, nombre)",
  ],
  tms_cotizacion_costeo_parametros: [
    "UNIQUE KEY uq_costeo_param_vigencia (empresa_id, vigente_desde)",
    "UNIQUE KEY uq_costeo_param_empresa_id (empresa_id, id)",
    "INDEX idx_costeo_param_fecha (empresa_id, vigente_desde)",
  ],
  tms_cotizacion_costeos: [
    "UNIQUE KEY uq_cotizacion_costeo_cotizacion (empresa_id, cotizacion_id)",
    "UNIQUE KEY uq_cotizacion_costeo_empresa_id (empresa_id, id)",
    "INDEX idx_cotizacion_costeo_fecha (empresa_id, creado_en)",
  ],
  tms_cotizacion_costeo_componentes: [
    "UNIQUE KEY uq_costeo_componente_orden (empresa_id, costeo_id, orden)",
    "INDEX idx_costeo_componente_costeo (empresa_id, costeo_id)",
  ],
};
/** Claves únicas e índices de una tabla, en el orden del DDL, sin la coma final. */
const claves = (ddl: string) => ddl.split("\n").map((l) => l.trim().replace(/,$/, "")).filter((l) => /^(UNIQUE KEY|INDEX|KEY)\s/.test(l));

describe.each([["sql/migrate-2026-09-cotizaciones-costeo.sql", migracion], ["sql/schema.sql", schema]] as const)("DDL real de producción en %s", (_nombre, sql) => {
  it.each(Object.entries(CLAVES_PRODUCCION))("%s: claves únicas e índices EXACTOS (nombre y columnas)", (tabla, esperadas) => {
    expect(claves(create(sql, tabla))).toEqual(esperadas);
  });
  it("perfiles: idx_costeo_perfil_activo (empresa_id, activo, nombre)", () => {
    expect(create(sql, "tms_cotizacion_costeo_perfiles")).toContain("INDEX idx_costeo_perfil_activo (empresa_id, activo, nombre)");
  });
  it("parámetros: uq_costeo_param_empresa_id (empresa_id, id) e idx_costeo_param_fecha (empresa_id, vigente_desde)", () => {
    const ddl = create(sql, "tms_cotizacion_costeo_parametros");
    expect(ddl).toContain("UNIQUE KEY uq_costeo_param_empresa_id (empresa_id, id)");
    expect(ddl).toContain("INDEX idx_costeo_param_fecha (empresa_id, vigente_desde)");
  });
  it("costeos: margen_objetivo DECIMAL(10,6), margen_real DECIMAL(12,6) e idx_cotizacion_costeo_fecha (empresa_id, creado_en)", () => {
    const ddl = create(sql, "tms_cotizacion_costeos");
    expect(ddl).toContain("margen_objetivo DECIMAL(10,6) NOT NULL");
    expect(ddl).toContain("margen_real DECIMAL(12,6) NULL");
    expect(ddl).not.toContain("margen_objetivo DECIMAL(6,4)");
    expect(ddl).not.toMatch(/margen_real DECIMAL\(10,6\)/);
    expect(ddl).toContain("INDEX idx_cotizacion_costeo_fecha (empresa_id, creado_en)");
  });
  it("componentes: uq_costeo_componente_orden (empresa_id, costeo_id, orden) e idx_costeo_componente_costeo (empresa_id, costeo_id); sin las variantes antiguas", () => {
    const ddl = create(sql, "tms_cotizacion_costeo_componentes");
    expect(ddl).toContain("UNIQUE KEY uq_costeo_componente_orden (empresa_id, costeo_id, orden)");
    expect(ddl).toContain("INDEX idx_costeo_componente_costeo (empresa_id, costeo_id)");
    expect(ddl).not.toContain("UNIQUE KEY uq_costeo_componente_orden (costeo_id, orden)");
    expect(ddl).not.toContain("idx_costeo_componente_empresa");
  });
  it("conserva los tipos aplicados (DECIMAL/JSON) y las FK compuestas de aislamiento", () => {
    expect(create(sql, "tms_cotizacion_costeo_perfiles")).toMatch(/gps_mensual DECIMAL\(12,2\)[\s\S]*costo_juego_llantas DECIMAL\(14,2\)[\s\S]*rendimiento_km_galon DECIMAL\(8,3\)/);
    expect(create(sql, "tms_cotizacion_costeo_parametros")).toMatch(/precio_combustible_galon DECIMAL\(10,4\)[\s\S]*iva_tasa DECIMAL\(6,4\)[\s\S]*margen_objetivo DECIMAL\(6,4\) NULL/);
    const costeos = create(sql, "tms_cotizacion_costeos");
    expect(costeos).toMatch(/perfil_snapshot JSON NOT NULL[\s\S]*parametros_snapshot JSON NOT NULL[\s\S]*input_snapshot JSON NOT NULL[\s\S]*motor_version VARCHAR\(20\) NOT NULL/);
    expect(costeos).toContain("costo_operativo DECIMAL(16,6) NOT NULL");
    expect(costeos).toContain("FOREIGN KEY (empresa_id, cotizacion_id) REFERENCES tms_cotizaciones (empresa_id, id) ON DELETE RESTRICT");
    const componentes = create(sql, "tms_cotizacion_costeo_componentes");
    expect(componentes).toContain("monto DECIMAL(16,6) NOT NULL");
    expect(componentes).toContain("FOREIGN KEY (empresa_id, costeo_id) REFERENCES tms_cotizacion_costeos (empresa_id, id)");
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
