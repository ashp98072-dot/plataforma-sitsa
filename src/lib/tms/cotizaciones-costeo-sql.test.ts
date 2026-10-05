import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
const migracion = leer("sql/migrate-2026-09-cotizaciones-costeo.sql");
const preflight = leer("sql/preflight-2026-09-cotizaciones-costeo.sql");
const schema = leer("sql/schema.sql");
import { CAMPOS_EXCEL_PARAMETROS, CAMPOS_EXCEL_PERFIL } from "./cotizacion-costeo-excel-campos";
const migracionExcel = leer("sql/migrate-2026-10-cotizaciones-costeo-excel.sql");
const preflightExcel = leer("sql/preflight-2026-10-cotizaciones-costeo-excel.sql");
// La migración del PR #406 (ya aplicada) NO incluye viaticos_hotel_viaje: esa columna tiene su propia migración (paridad Cotizador 2026).
const CAMPOS_PR406_PERFIL = CAMPOS_EXCEL_PERFIL.filter(c=>c.key!=="viaticosHotelViaje");
const nuevas: string[] = [...CAMPOS_EXCEL_PARAMETROS, ...CAMPOS_EXCEL_PERFIL].map(c=>c.col);
nuevas.push("resultado_snapshot", "auxiliar_multiplica_dias", "viaticos_hotel_multiplica_dias"); // banderas TINYINT(1): no están en el catálogo numérico
// Historial de costeos (migración propia): columnas nuevas de tms_cotizacion_costeos.
nuevas.push("version", "es_seleccionado", "seleccionado_por", "seleccionado_en");
function sinAdicionesExcel(sql: string) {
 return sql.split("\n")
  // Historial de costeos: schema.sql reemplaza el índice único 1:1 original (ya aplicado en producción) por el de versión y agrega un índice de consulta.
  .map(l=>l.replace("UNIQUE KEY uq_cotizacion_costeo_version (empresa_id, cotizacion_id, version),","UNIQUE KEY uq_cotizacion_costeo_cotizacion (empresa_id, cotizacion_id),"))
  // motor_version se amplió a VARCHAR(40) (migrate-2026-10-cotizaciones-motor-version.sql, YA aplicada en producción); la migración 2026-09 es histórica y conserva VARCHAR(20).
  .map(l=>l.replace("motor_version VARCHAR(40) NOT NULL","motor_version VARCHAR(20) NOT NULL"))
  .filter(l=>!nuevas.some(c=>l.trim().startsWith(c+" "))&&!l.includes("-- Excel 2026:")&&!l.includes("-- Paridad Cotizador 2026:")&&!l.includes("-- Configuración global aditiva")&&!l.includes("-- Historial de costeos")&&!l.includes("idx_cotizacion_costeo_historial")).join("\n");
}
const propuesta = leer("docs/COTIZACIONES-COSTEO-PERSISTENCIA-PROPUESTA.md");

const TABLAS = ["tms_cotizacion_costeo_perfiles", "tms_cotizacion_costeo_parametros", "tms_cotizacion_costeos", "tms_cotizacion_costeo_componentes"];
describe("Migración Excel 2026",()=>{
 it("cada columna aditiva coincide con el esquema y es idempotente",()=>{
  for(const c of [...CAMPOS_EXCEL_PARAMETROS,...CAMPOS_PR406_PERFIL]){
   expect(migracionExcel).toContain("ADD COLUMN IF NOT EXISTS "+c.col+" "+c.type+" NULL DEFAULT NULL");
   expect(schema).toContain(c.col+" "+c.type+" NULL DEFAULT NULL");
  }
  // La columna de la paridad Cotizador 2026 está en schema.sql pero NO se coló en la migración ya aplicada del PR #406.
  expect(schema).toContain("viaticos_hotel_viaje DECIMAL(12,2) NULL DEFAULT NULL");
  expect(migracionExcel).not.toContain("viaticos_hotel_viaje");
  expect(migracionExcel).toContain("ADD COLUMN IF NOT EXISTS resultado_snapshot JSON NULL DEFAULT NULL");
 });
 it("salarios pertenecen solo al perfil; el único margen conserva su columna histórica",()=>{
  const params=migracionExcel.split("ALTER TABLE tms_cotizacion_costeo_parametros")[1].split(";")[0];
  const perfiles=migracionExcel.split("ALTER TABLE tms_cotizacion_costeo_perfiles")[1].split(";")[0];
  expect(CAMPOS_EXCEL_PARAMETROS.map(c=>c.key).filter(k=>/salario|margen/i.test(k))).toEqual([]);
  expect(CAMPOS_EXCEL_PERFIL.map(c=>c.key).filter(k=>/salario/.test(k))).toEqual(["salarioPilotoMensual","salarioAuxiliarMensual"]);
  expect(params).not.toMatch(/salario|margen/i);
  for(const col of ["salario_piloto_mensual","salario_auxiliar_mensual"]) expect(perfiles).toContain(col+" DECIMAL(12,2) NULL DEFAULT NULL");
  expect(migracionExcel).not.toMatch(/ADD COLUMN.*margen/i);
  expect(create(schema,"tms_cotizacion_costeo_parametros")).not.toMatch(/salario/i);
  expect(create(schema,"tms_cotizacion_costeo_perfiles")).toContain("salario_piloto_mensual DECIMAL(12,2) NULL DEFAULT NULL");
 });
 it("no altera datos/snapshots ni siembra costos inventados; preflight solo SHOW/SELECT",()=>{
  const limpio=(s:string)=>s.split("\n").filter(l=>!l.trim().startsWith("--")).join("\n");
  expect(limpio(migracionExcel)).not.toMatch(/\b(?:DROP|TRUNCATE|UPDATE|DELETE|INSERT)\b/i);
  expect(limpio(preflightExcel)).not.toMatch(/^\s*(?:ALTER|CREATE|DROP|TRUNCATE|UPDATE|DELETE|INSERT)\b/im);
  for (const sentencia of limpio(preflightExcel).split(";").map(s=>s.trim()).filter(Boolean)) expect(sentencia).toMatch(/^(?:SELECT|SHOW)\b/i);
  expect(preflightExcel).not.toContain("information_schema");
 });
});

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
/** Estado actual de schema.sql para tms_cotizacion_costeos tras la migración del historial (el índice único 1:1 se reemplazó por el de versión). */
const CLAVES_SCHEMA_COSTEOS = [
  "UNIQUE KEY uq_cotizacion_costeo_version (empresa_id, cotizacion_id, version)",
  "UNIQUE KEY uq_cotizacion_costeo_empresa_id (empresa_id, id)",
  "INDEX idx_cotizacion_costeo_fecha (empresa_id, creado_en)",
  "INDEX idx_cotizacion_costeo_historial (empresa_id, cotizacion_id, creado_en)",
];
/** Claves únicas e índices de una tabla, en el orden del DDL, sin la coma final. */
const claves = (ddl: string) => ddl.split("\n").map((l) => l.trim().replace(/,$/, "")).filter((l) => /^(UNIQUE KEY|INDEX|KEY)\s/.test(l));

describe.each([["sql/migrate-2026-09-cotizaciones-costeo.sql", migracion], ["sql/schema.sql", schema]] as const)("DDL real de producción en %s", (nombre, sql) => {
  it.each(Object.entries(CLAVES_PRODUCCION))("%s: claves únicas e índices EXACTOS (nombre y columnas)", (tabla, esperadas) => {
    // La migración 2026-09 es histórica (ya aplicada) y conserva el índice único 1:1; schema.sql refleja el historial de costeos.
    const final = nombre === "sql/schema.sql" && tabla === "tms_cotizacion_costeos" ? CLAVES_SCHEMA_COSTEOS : esperadas;
    expect(claves(create(sql, tabla))).toEqual(final);
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
    expect(costeos).toMatch(/perfil_snapshot JSON NOT NULL[\s\S]*parametros_snapshot JSON NOT NULL[\s\S]*input_snapshot JSON NOT NULL[\s\S]*motor_version VARCHAR\((20|40)\) NOT NULL/);
    // schema.sql refleja producción (VARCHAR(40), ampliada manualmente); la migración 2026-09 es histórica y conserva VARCHAR(20).
    expect(costeos).toContain(nombre === "sql/schema.sql" ? "motor_version VARCHAR(40) NOT NULL" : "motor_version VARCHAR(20) NOT NULL");
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
    expect(sinAdicionesExcel(create(schema, tabla))).toBe(create(migracion, tabla));
  });
  it("no siembra perfiles ni parámetros", () => {
    expect(schema).not.toMatch(/INSERT INTO tms_cotizacion_costeo/i);
  });
});
