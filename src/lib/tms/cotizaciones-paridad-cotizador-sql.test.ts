import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * COTIZACIONES — PARIDAD CON «Cotizador 2026.xlsx»: SQL propuesto (NO ejecutado). Una sola columna aditiva nueva en
 * tms_cotizacion_costeo_perfiles; la migración ya aplicada del PR #406 no se toca.
 */
const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const migracion = leer("sql/migrate-2026-10-cotizaciones-paridad-cotizador-2026.sql");
const preflight = leer("sql/preflight-2026-10-cotizaciones-paridad-cotizador-2026.sql");
const schema = leer("sql/schema.sql");
const migracion406 = leer("sql/migrate-2026-10-cotizaciones-costeo-excel.sql");

describe("migración nueva", () => {
  it("es UNA sola sentencia: ADD COLUMN IF NOT EXISTS viaticos_hotel_viaje DECIMAL(12,2) NULL DEFAULT NULL", () => {
    const sentencias = sinComentarios(migracion).split(";").map((x) => x.trim()).filter(Boolean);
    expect(sentencias).toHaveLength(1);
    expect(sentencias[0].replace(/\s+/g, " ")).toBe("ALTER TABLE tms_cotizacion_costeo_perfiles ADD COLUMN IF NOT EXISTS viaticos_hotel_viaje DECIMAL(12,2) NULL DEFAULT NULL");
  });
  it("es aditiva: sin DROP/UPDATE/DELETE/INSERT/TRUNCATE/RENAME/MODIFY ni seeds", () => {
    expect(sinComentarios(migracion)).not.toMatch(/\b(DROP|UPDATE|DELETE|INSERT|TRUNCATE|RENAME|MODIFY|CHANGE|REPLACE)\b/i);
  });
  it("declara que NO fue ejecutada y que no modifica la migración ya aplicada del PR #406", () => {
    expect(migracion).toContain("NO ejecutada");
    expect(migracion).toMatch(/PR #406/);
    expect(migracion406).not.toContain("viaticos_hotel_viaje"); // la migración aplicada en producción permanece intacta
  });
  it("schema.sql incluye la columna dentro de tms_cotizacion_costeo_perfiles, junto a las del PR #406", () => {
    const ini = schema.indexOf("CREATE TABLE IF NOT EXISTS tms_cotizacion_costeo_perfiles (");
    const fin = schema.indexOf(") ENGINE=InnoDB", ini);
    const ddl = schema.slice(ini, fin);
    expect(ddl).toContain("viaticos_hotel_viaje DECIMAL(12,2) NULL DEFAULT NULL");
    expect(ddl).toContain("salario_auxiliar_mensual DECIMAL(12,2) NULL DEFAULT NULL");
    expect((schema.match(/viaticos_hotel_viaje/g) ?? [])).toHaveLength(1);
  });
});

describe("preflight nuevo", () => {
  it("es SOLO lectura: únicamente SELECT y SHOW, sin information_schema", () => {
    for (const sentencia of sinComentarios(preflight).split(";").map((x) => x.trim()).filter(Boolean)) expect(sentencia).toMatch(/^(?:SELECT|SHOW)\b/i);
    expect(preflight).not.toContain("information_schema");
  });
  it("revisa las columnas del PR #406 (prerrequisito) y la columna nueva, con criterios APLICAR / NOOP / DETENER", () => {
    for (const col of ["viajes_mes", "precio_llanta", "cantidad_llantas", "salario_piloto_mensual", "salario_auxiliar_mensual"]) {
      expect(preflight).toContain(`SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE '${col}';`);
    }
    expect(preflight).toContain("SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'viaticos_hotel_viaje';");
    expect(preflight).toContain("SHOW CREATE TABLE tms_cotizacion_costeo_perfiles;");
    for (const palabra of ["APLICAR", "NOOP", "DETENER"]) expect(preflight).toContain(palabra);
  });
});
