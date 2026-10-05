import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * COTIZACIONES — PARIDAD CON «Cotizador 2026.xlsx»: SQL propuesto (NO ejecutado). Tres columnas aditivas nuevas (viáticos y hotel + dos banderas
 * «por cada día») en tms_cotizacion_costeo_perfiles; la migración ya aplicada del PR #406 no se toca.
 */
const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const migracion = leer("sql/migrate-2026-10-cotizaciones-paridad-cotizador-2026.sql");
const preflight = leer("sql/preflight-2026-10-cotizaciones-paridad-cotizador-2026.sql");
const schema = leer("sql/schema.sql");
const migracion406 = leer("sql/migrate-2026-10-cotizaciones-costeo-excel.sql");

describe("migración nueva", () => {
  it("es UNA sola sentencia con las TRES columnas nuevas, todas ADD COLUMN IF NOT EXISTS ... NULL DEFAULT NULL", () => {
    const sentencias = sinComentarios(migracion).split(";").map((x) => x.trim()).filter(Boolean);
    expect(sentencias).toHaveLength(1);
    expect(sentencias[0].replace(/\s+/g, " ")).toBe(
      "ALTER TABLE tms_cotizacion_costeo_perfiles ADD COLUMN IF NOT EXISTS viaticos_hotel_viaje DECIMAL(12,2) NULL DEFAULT NULL, " +
        "ADD COLUMN IF NOT EXISTS auxiliar_multiplica_dias TINYINT(1) NULL DEFAULT NULL, " +
        "ADD COLUMN IF NOT EXISTS viaticos_hotel_multiplica_dias TINYINT(1) NULL DEFAULT NULL",
    );
  });
  it("es aditiva: sin DROP/UPDATE/DELETE/INSERT/TRUNCATE/RENAME/MODIFY ni seeds (no se siembran valores por perfil)", () => {
    expect(sinComentarios(migracion)).not.toMatch(/\b(DROP|UPDATE|DELETE|INSERT|TRUNCATE|RENAME|MODIFY|CHANGE|REPLACE)\b/i);
    expect(sinComentarios(migracion)).not.toMatch(/\bDEFAULT\s+(?!NULL\b)/i); // ninguna columna con default distinto de NULL
  });
  it("declara que NO fue ejecutada y que no modifica la migración ya aplicada del PR #406", () => {
    expect(migracion).toContain("NO ejecutada");
    expect(migracion).toMatch(/PR #406/);
    expect(migracion406).not.toContain("viaticos_hotel_viaje"); // la migración aplicada en producción permanece intacta
    expect(migracion406).not.toContain("multiplica_dias");
  });
  it("schema.sql incluye las tres columnas dentro de tms_cotizacion_costeo_perfiles, junto a las del PR #406", () => {
    const ini = schema.indexOf("CREATE TABLE IF NOT EXISTS tms_cotizacion_costeo_perfiles (");
    const fin = schema.indexOf(") ENGINE=InnoDB", ini);
    const ddl = schema.slice(ini, fin);
    expect(ddl).toContain("viaticos_hotel_viaje DECIMAL(12,2) NULL DEFAULT NULL");
    expect(ddl).toContain("salario_auxiliar_mensual DECIMAL(12,2) NULL DEFAULT NULL");
    expect(ddl).toContain("auxiliar_multiplica_dias TINYINT(1) NULL DEFAULT NULL");
    expect(ddl).toContain("viaticos_hotel_multiplica_dias TINYINT(1) NULL DEFAULT NULL");
    expect((schema.match(/viaticos_hotel_viaje/g) ?? [])).toHaveLength(1);
    expect((schema.match(/auxiliar_multiplica_dias/g) ?? [])).toHaveLength(1);
    expect((schema.match(/viaticos_hotel_multiplica_dias/g) ?? [])).toHaveLength(1);
  });
});

describe("preflight nuevo", () => {
  it("es SOLO lectura: únicamente SELECT y SHOW, sin information_schema", () => {
    for (const sentencia of sinComentarios(preflight).split(";").map((x) => x.trim()).filter(Boolean)) expect(sentencia).toMatch(/^(?:SELECT|SHOW)\b/i);
    expect(preflight).not.toContain("information_schema");
  });
  it("revisa las columnas del PR #406 (prerrequisito) y las tres columnas nuevas, con criterios APLICAR / NOOP / DETENER", () => {
    for (const col of ["viajes_mes", "precio_llanta", "cantidad_llantas", "salario_piloto_mensual", "salario_auxiliar_mensual"]) {
      expect(preflight).toContain(`SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE '${col}';`);
    }
    for (const col of ["viaticos_hotel_viaje", "auxiliar_multiplica_dias", "viaticos_hotel_multiplica_dias"]) {
      expect(preflight).toContain(`SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE '${col}';`);
    }
    expect(preflight).toContain("SHOW CREATE TABLE tms_cotizacion_costeo_perfiles;");
    for (const palabra of ["APLICAR", "NOOP", "DETENER"]) expect(preflight).toContain(palabra);
  });
});
