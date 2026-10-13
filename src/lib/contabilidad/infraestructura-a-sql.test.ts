import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const leer = (n: string) => readFileSync("sql/" + n, "utf8").replaceAll("\r\n", "\n");
const sinComentarios = (s: string) => s.replace(/--[^\n]*/g, "");
it.each(["preflight", "verify"])("%s es solo lectura de tablas", nombre => {
  const s = sinComentarios(leer(nombre + "-2026-10-contabilidad-infraestructura-a.sql"));
  const tokens = s.replace(/'(?:''|[^'])*'/g, "''").replace(/SHOW\s+CREATE\s+TABLE/gi, "SHOW_TABLE_DDL");
  expect(tokens).not.toMatch(/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|CALL)\b/i);
});
it("migrate preserva datos y solo reemplaza CHECK conocido tras la compuerta", () => {
  const s = sinComentarios(leer("migrate-2026-10-contabilidad-infraestructura-a.sql"));
  const tokens = s.replace(/'(?:''|[^'])*'/g, "''");
  expect(tokens.replace(/ON\s+DELETE/gi, "")).not.toMatch(/\b(INSERT|DELETE|TRUNCATE)\b/i);
  expect(tokens).not.toMatch(/DROP\s+(TABLE|INDEX|FOREIGN|DATABASE)|CONVERT\s+TO|MODIFY\s+COLUMN/i);
  expect(tokens.match(/ALTER TABLE/g)).toHaveLength(1);
  expect(tokens).toContain("DROP CONSTRAINT ck_cont_rol_valido");
  expect(tokens.indexOf("SIGNAL")).toBeLessThan(tokens.indexOf("ALTER TABLE"));
  expect(s).toContain("APTO_COMPATIBILIDAD");
  expect(s.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);
  expect(s).toContain("'VENTAS_BIENES'");
  expect(s).not.toMatch(/periodo_id|confirmacion_id/);
});
it("schema y migrate contienen exactamente el mismo contrato nuevo", () => {
  const m = leer("migrate-2026-10-contabilidad-infraestructura-a.sql");
  const s = leer("schema.sql");
  for (const nombre of ["cont_cuentas_rol", "cont_eventos"]) {
    const i = m.indexOf("CREATE TABLE IF NOT EXISTS " + nombre + " (");
    expect(s).toContain(m.slice(i, m.indexOf(";", i) + 1));
  }
});
it.each(["preflight", "migrate", "verify"])("%s asocia CHECK por TABLE_CONSTRAINTS, sin cc.TABLE_NAME", nombre => {
  const s = sinComentarios(leer(nombre + "-2026-10-contabilidad-infraestructura-a.sql"));
  const referencias = [...s.matchAll(/\b(FROM|JOIN)\s+information_schema\.CHECK_CONSTRAINTS\b/gi)];
  expect(referencias.length).toBeGreaterThan(0);
  for (const r of referencias) expect(r[1].toUpperCase()).toBe("JOIN");
  expect(s).not.toMatch(/\b(?:cc|CHECK_CONSTRAINTS)\s*\.\s*TABLE_NAME\b/i);
  const compacto = s.replace(/\s+/g, "");
  expect(compacto).toContain("cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA");
  expect(compacto).toContain("cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME");
  expect(compacto).toContain("tc.CONSTRAINT_TYPE='CHECK'");
  expect(s).toMatch(/tc\.TABLE_NAME\s*(?:=|IN)/);
});
