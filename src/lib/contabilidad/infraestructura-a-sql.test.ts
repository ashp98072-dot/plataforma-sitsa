import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const leer = (n: string) => readFileSync("sql/" + n, "utf8").replaceAll("\r\n", "\n");
const sinComentarios = (s: string) => s.replace(/--[^\n]*/g, "");
it.each(["preflight", "verify"])("%s es solo lectura", nombre => {
  const s = sinComentarios(leer(nombre + "-2026-10-contabilidad-infraestructura-a.sql"));
  for (const sentencia of s.split(";").map(t => t.trim()).filter(Boolean)) {
    expect(sentencia).toMatch(/^(SELECT|SHOW)\b/i);
    expect(sentencia).not.toMatch(/^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|CALL)\b/i);
  }
});
it("migrate crea únicamente dos tablas y no inventa configuración", () => {
  const s = sinComentarios(leer("migrate-2026-10-contabilidad-infraestructura-a.sql"));
  for (const sentencia of s.split(";").map(t => t.trim()).filter(Boolean)) expect(sentencia).toMatch(/^CREATE TABLE IF NOT EXISTS\b/);
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
