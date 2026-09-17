import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const migration = leer("sql/migrate-2026-09-compras-encargado.sql");
const preflight = leer("sql/preflight-2026-09-compras-encargado.sql");
it("migración incremental nullable y reejecutable, sin backfill ni reinterpretar históricos", () => {
  const sql = migration.replace(/^--.*$/gm, "");
  expect(sql).not.toMatch(/\b(DROP|DELETE|UPDATE|INSERT|CREATE|MODIFY|CHANGE|FOREIGN KEY)\b|\bREPLACE\s+INTO\b/i);
  expect(sql.match(/ALTER TABLE compras_requerimientos/g)).toHaveLength(1);
  expect(sql).toContain("ADD COLUMN IF NOT EXISTS encargado_compras_usuario_id INT NULL DEFAULT NULL");
  expect(sql).toContain("ADD COLUMN IF NOT EXISTS encargado_compras_nombre VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL");
  const schema = leer("sql/schema.sql");
  expect(schema).toContain("encargado_compras_usuario_id INT NULL DEFAULT NULL,"); expect(schema).toContain("encargado_compras_nombre VARCHAR(200) NULL DEFAULT NULL,");
});
it("preflight solo lectura y base explícita, sin depender de contexto phpMyAdmin", () => {
  const sql = preflight.replace(/^--.*$/gm, "");
  expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP|UPDATE|INSERT|DELETE|CALL)\b/i);
  expect(sql).toContain("SET @compras_encargado_schema = 'u611730801_Plataforma'");
  for (const valor of ["APLICAR", "NOOP", "DETENER", "VERSION()", "11.8.%MariaDB%", "InnoDB", "utf8mb4_unicode_ci", "COLUMN_TYPE NOT LIKE '%unsigned%'", "IS_NULLABLE = 'YES'", "CHARACTER_MAXIMUM_LENGTH", "COLUMN_DEFAULT", "EXTRA"]) expect(sql).toContain(valor);
});
it("migración revalida esquema antes de ALTER, bloque anónimo sin objetos persistentes", () => {
  for (const valor of ["BEGIN NOT ATOMIC", "SIGNAL SQLSTATE '45000'", "11.8.%MariaDB%", "InnoDB", "COLUMN_TYPE NOT LIKE '%unsigned%'", "IS_NULLABLE = 'YES'", "CHARACTER_MAXIMUM_LENGTH = 200", "COLUMN_DEFAULT", "EXTRA"]) expect(migration).toContain(valor);
  expect(migration.indexOf("THEN SIGNAL")).toBeLessThan(migration.indexOf("ALTER TABLE compras_requerimientos"));
  expect(migration).toContain("USE u611730801_Plataforma;"); expect(migration).toContain("SET @compras_encargado_schema = DATABASE();");
});
