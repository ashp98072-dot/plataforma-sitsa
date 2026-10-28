import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepararMigracion, sentencias } from "../../../scripts/ci/c3c1/safety.mjs";
const archivo = (tipo: string) => readFileSync(`sql/${tipo}-2026-10-contabilidad-calendario-c3c1.sql`, "utf8");
describe("C3C-1: revisión estática de artefactos SQL, NO ejecuta SQL", () => {
  it("preflight y postcheck contienen solo consultas (sin DDL/DML)", () => {
    for (const tipo of ["preflight", "postcheck"]) {
      const texto = archivo(tipo).replace(/--[^\n]*/g, "");
      expect(texto).not.toMatch(/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|CALL)\b/i);
      expect(texto).toContain("DATABASE()");
    }
  });
  it("crea únicamente dos tablas, sin asientos ni seeds y con ámbito compuesto", () => {
    const s = archivo("migrate");
    const sql = prepararMigracion(s, "c3c1_lab_" + "a".repeat(32));
    expect(sql).toHaveLength(2);
    expect(sql.join("\n")).not.toMatch(/\b(PROCEDURE|DELIMITER|CALL|DROP|ALTER|TRUNCATE)\b/i);
    expect(s).toContain("FOREIGN KEY (empresa_id, entidad_id, ejercicio_id)");
    expect(s.match(/CHECK \(estado = 'CONFIGURADO'\)/g)).toHaveLength(2);
    expect(() => prepararMigracion(s, "novalvion_pruebas")).toThrow();
    expect(s).toContain("{{C3C1_SCHEMA}}");
  });
  it("postcheck portable une CHECK_CONSTRAINTS con TABLE_CONSTRAINTS y verifica acciones de FK", () => {
    const sql = archivo("postcheck");
    expect(sql).toContain("JOIN information_schema.CHECK_CONSTRAINTS c");
    expect(sql).toContain("information_schema.TABLE_CONSTRAINTS t");
    for (const check of sentencias(sql).filter((s: string) => s.includes("information_schema.CHECK_CONSTRAINTS"))) {
      expect(check).not.toMatch(/\bc\.TABLE_NAME\b/i);
    }
    expect(sql).toContain("information_schema.REFERENTIAL_CONSTRAINTS");
    expect(sql).toContain("r.DELETE_RULE='RESTRICT'");
    for (const tipo of ["preflight", "postcheck"]) for (const s of sentencias(archivo(tipo))) {
      expect(s).toMatch(/^SELECT\b/i); expect(s).toContain("AS control"); expect(s).toContain("AS errores");
    }
    expect(archivo("preflight")).toContain("'empresas','cont_entidades','usuarios','auditoria'");
  });
});
