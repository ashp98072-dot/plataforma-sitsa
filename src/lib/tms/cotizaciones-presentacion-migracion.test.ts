import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("migración y preflight — presentación comercial (mensaje/cierre de la cotización)", () => {
  const migracion = leer("sql/migrate-2026-09-cotizaciones-presentacion-comercial.sql");
  const preflight = leer("sql/preflight-2026-09-cotizaciones-presentacion-comercial.sql");

  it("la migración es aditiva e idempotente: solo ALTER TABLE tms_cotizaciones ... ADD COLUMN IF NOT EXISTS", () => {
    const sentencias = sinComentarios(migracion);
    expect(sentencias.match(/ALTER TABLE/g)).toHaveLength(1);
    expect(sentencias).toMatch(/ALTER TABLE tms_cotizaciones\b/);
    expect(sentencias.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(2);
    expect(sentencias).toContain("ADD COLUMN IF NOT EXISTS mensaje_comercial TEXT NULL");
    expect(sentencias).toContain("ADD COLUMN IF NOT EXISTS cierre_comercial TEXT NULL");
    expect(sentencias.trim().endsWith(";")).toBe(true);
    expect(sentencias.match(/;/g)).toHaveLength(1);
  });

  it("no destruye ni reescribe nada: sin DROP/UPDATE/INSERT/DELETE/CREATE ni cambios de PK/FK/índices", () => {
    const sentencias = sinComentarios(migracion);
    expect(sentencias).not.toMatch(/\b(DROP|UPDATE|INSERT|DELETE|TRUNCATE|MODIFY|CHANGE|RENAME|CREATE|GRANT)\b/i);
    expect(sentencias).not.toMatch(/PRIMARY KEY|FOREIGN KEY|CONSTRAINT|\bINDEX\b|\bKEY\b/i);
  });

  it("las dos columnas TEXT NULL quedan después de unidad_descripcion, en el mismo orden que sql/schema.sql", () => {
    const sentencias = sinComentarios(migracion);
    expect(sentencias).toContain("AFTER unidad_descripcion");
    expect(sentencias.indexOf("mensaje_comercial")).toBeLessThan(sentencias.indexOf("cierre_comercial"));
  });

  it("el preflight usa SHOW COLUMNS por columna + SHOW CREATE TABLE, sin metadatos del sistema ni escritura", () => {
    const sentencias = sinComentarios(preflight);
    for (const columna of ["mensaje_comercial", "cierre_comercial"]) {
      expect(sentencias).toContain(`SHOW COLUMNS FROM tms_cotizaciones\nLIKE '${columna}';`);
    }
    expect(sentencias).toContain("SHOW CREATE TABLE tms_cotizaciones;");
    expect(preflight).not.toMatch(/information_schema/i);
    expect(sentencias).not.toMatch(/\b(ALTER|DROP|DELETE|UPDATE|INSERT|TRUNCATE)\b/i);
    expect(sentencias).not.toMatch(/^\s*CREATE TABLE/im);
    expect(sentencias.match(/SHOW COLUMNS/g)).toHaveLength(2);
  });

  it("el preflight documenta APLICAR / NOOP / DETENER y la definición esperada", () => {
    for (const palabra of ["APLICAR", "NOOP", "DETENER"]) expect(preflight).toContain(palabra);
    expect(preflight).toMatch(/mensaje_comercial\s+text\s+YES\s+NULL/);
    expect(preflight).toMatch(/cierre_comercial\s+text\s+YES\s+NULL/);
  });

  it("sql/schema.sql (instalaciones nuevas) declara las mismas dos columnas en tms_cotizaciones", () => {
    const schema = leer("sql/schema.sql");
    const inicio = schema.indexOf("CREATE TABLE IF NOT EXISTS tms_cotizaciones (");
    const tabla = schema.slice(inicio, schema.indexOf(") ENGINE=InnoDB", inicio));
    expect(tabla).toContain("mensaje_comercial TEXT NULL");
    expect(tabla).toContain("cierre_comercial TEXT NULL");
    expect(tabla.indexOf("unidad_descripcion")).toBeLessThan(tabla.indexOf("mensaje_comercial"));
    expect(tabla.indexOf("cierre_comercial")).toBeLessThan(tabla.indexOf("creado_por"));
  });

  it("el código lee y escribe exactamente esas columnas (SELECT, INSERT y UPDATE)", () => {
    const fuente = leer("src/lib/tms/cotizaciones.ts");
    const select = fuente.slice(fuente.indexOf("const SELECT = `"), fuente.indexOf("export type FiltrosCotizaciones"));
    expect(select).toContain("mensaje_comercial, cierre_comercial");
    expect(fuente).toContain("mensaje_comercial, cierre_comercial)");
    expect(fuente).toContain("mensaje_comercial = ?, cierre_comercial = ?");
  });

  it("no requiere migración para los mensajes PREDETERMINADOS por marca: reutilizan `configuracion`, ya existente", () => {
    expect(migracion).toContain("configuracion");
    expect(migracion).not.toMatch(/CREATE TABLE.*configuracion/i);
    const fuente = leer("src/lib/tms/cotizacion-presentacion.ts");
    expect(fuente).toContain("FROM configuracion");
    expect(fuente).toContain("INTO configuracion");
  });
});
