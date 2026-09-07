import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "sql/migrate-2026-09-rutas-personal-tarifario.sql"), "utf8");

describe("migración RUTAS-PREDETERMINADOS-1", () => {
  it("detecta índices padre por composición y es reejecutable", () => {
    expect(sql.match(/information_schema\.statistics/g)?.length).toBe(2);
    expect(sql.match(/GROUP_CONCAT\(column_name ORDER BY seq_in_index\) = 'empresa_id,id'/g)?.length).toBe(2);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS tarifa_referencia");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS tms_cliente_ruta_personal");
  });

  it("usa VARCHAR y conserva FKs multiempresa con borrados correctos", () => {
    expect(sql).toContain("rol VARCHAR(20) NOT NULL");
    expect(sql).not.toContain("rol ENUM");
    expect(sql).toContain("REFERENCES tms_cliente_rutas (empresa_id, id)");
    expect(sql).toContain("REFERENCES empleados (empresa_id, id)");
    expect(sql).toContain("ON DELETE CASCADE");
    expect(sql).toContain("ON DELETE RESTRICT");
  });
});
