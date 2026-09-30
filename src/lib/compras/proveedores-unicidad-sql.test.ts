import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const schema = leer("sql/schema.sql");
const migration = leer("sql/migrate-2026-09-compras-proveedores-unicidad.sql");

/**
 * COMPRAS-PROVEEDOR-INLINE (corrección pre-SQL, punto 1) — sql/schema.sql representa una instalación NUEVA
 * (scripts/init-db.mjs la lee directamente). Debe quedar sincronizado con la estructura FINAL que deja la
 * migración para que una base nueva sea compatible con guardarProveedor() sin necesitar aplicar la migración
 * (que además no tiene sentido en una base sin filas históricas).
 */
describe("schema.sql sincronizado con la migración de unicidad de proveedores", () => {
  it("1/2) compras_proveedores contiene nombre_normalizado y nit_normalizado", () => {
    expect(schema).toContain("nombre_normalizado VARCHAR(200) NULL");
    expect(schema).toContain("nit_normalizado VARCHAR(30) NULL");
  });

  it("3/4) contiene los dos UNIQUE KEY por empresa, con las mismas columnas que la migración crea", () => {
    expect(schema).toContain("UNIQUE KEY uq_cb_proveedor_nombre (empresa_id, nombre_normalizado)");
    expect(schema).toContain("UNIQUE KEY uq_cb_proveedor_nit (empresa_id, nit_normalizado)");
    expect(migration).toContain("ADD UNIQUE KEY uq_cb_proveedor_nombre (empresa_id, nombre_normalizado)");
    expect(migration).toContain("ADD UNIQUE KEY uq_cb_proveedor_nit (empresa_id, nit_normalizado)");
  });

  it("5) columnas ubicadas junto a su par visible (nombre_comercial/nombre_normalizado, nit/nit_normalizado)", () => {
    const tabla = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS compras_proveedores"), schema.indexOf(") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;", schema.indexOf("CREATE TABLE IF NOT EXISTS compras_proveedores")));
    expect(tabla.indexOf("nombre_comercial")).toBeLessThan(tabla.indexOf("nombre_normalizado"));
    expect(tabla.indexOf("nit VARCHAR(30)")).toBeLessThan(tabla.indexOf("nit_normalizado"));
  });

  it("mantiene ENGINE=InnoDB, utf8mb4 y utf8mb4_unicode_ci (sin alterar el resto del esquema)", () => {
    const tabla = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS compras_proveedores"), schema.indexOf("compras_proveedores (\n") + 5000);
    expect(tabla).toContain("ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;");
    // Resto de columnas/índices/FK originales siguen presentes tal cual.
    for (const col of ["razon_social VARCHAR(250) NULL", "direccion VARCHAR(500) NULL", "activo TINYINT(1) NOT NULL DEFAULT 1"]) expect(schema).toContain(col);
    expect(schema).toContain("UNIQUE KEY uq_compras_proveedor_empresa (empresa_id, id)");
    expect(schema).toContain("CONSTRAINT fk_cb_proveedores_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT");
  });

  it("schema.sql NO necesita backfill (instalación nueva, tabla nace vacía) — la migración sigue siendo necesaria para producción existente", () => {
    expect(schema).not.toMatch(/UPDATE compras_proveedores/);
    expect(migration).toContain("UPDATE compras_proveedores");
  });
});
