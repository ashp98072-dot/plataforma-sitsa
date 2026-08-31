import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const sql = readFileSync("sql/migrate-2026-08-contabilidad-entidad-integridad.sql", "utf8").replace(/--[^\r\n]*/g, "");
const schema = readFileSync("sql/schema.sql", "utf8");
it("solo DDL contable, no reasigna datos, no toca clientes ni desactiva FKs", () => {
  expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE FROM|TRUNCATE|REPLACE|FOREIGN_KEY_CHECKS|CASCADE)\b/);
  expect(sql).not.toMatch(/\b(clientes|tms_clientes|facturas|empleados)\b/);
  expect([...new Set([...sql.matchAll(/ALTER TABLE (\w+)/g)].map((m) => m[1]))].sort())
    .toEqual(["cont_asiento_detalle", "cont_asientos", "cont_cuentas", "cont_cxc", "cont_cxp"]);
});
it("unicidad por empresa y entidad, no por tenant compartido", () => {
  for (const [nombre, campo, antigua] of [["uq_cuenta_entidad", "codigo", "uq_cuenta"], ["uq_asiento_entidad", "numero", "uq_asiento"]]) {
    expect(sql).toContain("ADD UNIQUE INDEX IF NOT EXISTS " + nombre + " (empresa_id, entidad_id, " + campo + ")");
    expect(schema).toContain("UNIQUE KEY " + nombre + " (empresa_id, entidad_id, " + campo + ")");
    expect(sql.indexOf("ADD UNIQUE INDEX IF NOT EXISTS " + nombre)).toBeLessThan(sql.indexOf("DROP INDEX IF EXISTS " + antigua));
  }
});
it("FKs de detalle impiden cuentas/asientos de otra entidad en los nuevos registros", () => {
  for (const [ref, campo] of [["cont_cuentas", "cuenta_id"], ["cont_asientos", "asiento_id"]]) {
    expect(sql).toContain("FOREIGN KEY IF NOT EXISTS (empresa_id, entidad_id, " + campo + ")");
    expect(sql).toContain("REFERENCES " + ref + "(empresa_id, entidad_id, id) ON DELETE RESTRICT");
  }
});
