import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync("sql/migrate-2026-08-contabilidad-entidad-preparacion.sql", "utf8")
  .replace(/--[^\r\n]*/g, "").trim();
const schema = readFileSync("sql/schema.sql", "utf8");
const tablas = ["cont_cuentas", "cont_asientos", "cont_asiento_detalle", "cont_cxc", "cont_cxp"];
const indices = ["idx_cont_cuentas_entidad", "idx_cont_asientos_entidad", "idx_cont_detalle_entidad", "idx_cont_cxc_entidad", "idx_cont_cxp_entidad"];
it("solo altera las cinco tablas contables, sin datos ni catálogos compartidos", () => {
  const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
  expect(statements).toHaveLength(5);
  expect([...sql.matchAll(/ALTER TABLE (\w+)/g)].map((m) => m[1])).toEqual(tablas);
  expect(sql).not.toMatch(/\b(DELETE|UPDATE|INSERT|DROP|TRUNCATE|REPLACE|MODIFY|CHANGE|FOREIGN_KEY_CHECKS|CASCADE)\b/i);
  expect(sql).not.toMatch(/\b(clientes|tms_clientes|facturas|empleados|cont_entidades|cont_entidad_usuarios)\b/);
});
it.each(tablas)("prepara %s sin hacer obligatoria la entidad ni cambiar unicidad", (tabla) => {
  const alter = sql.split(";").find((s) => s.includes("ALTER TABLE " + tabla + "\n"))!;
  expect(alter).toContain("ADD COLUMN IF NOT EXISTS entidad_id INT NULL DEFAULT NULL");
  expect(alter).toContain("ADD INDEX IF NOT EXISTS " + indices[tablas.indexOf(tabla)] + " (empresa_id, entidad_id)");
  const ddl = schema.split("CREATE TABLE IF NOT EXISTS " + tabla + " (")[1].split(") ENGINE=")[0];
  expect(ddl).toContain("entidad_id INT NULL DEFAULT NULL");
  expect(ddl).toContain("INDEX " + indices[tablas.indexOf(tabla)] + " (empresa_id, entidad_id)");
  if (tabla === "cont_asiento_detalle") {
    expect(alter).toContain("ADD COLUMN IF NOT EXISTS empresa_id INT NULL DEFAULT NULL");
    expect(ddl).toContain("empresa_id INT NULL DEFAULT NULL");
  }
  // El esquema final incorpora C2B; la migración histórica C2A no cambia unicidad.
  expect(alter).not.toContain("UNIQUE");
});
