import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FilasImportacion } from "@/components/flota/combustible-importaciones-client";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
describe("contrato de importaciones sin ejecución SQL", () => {
  it("scripts de diagnóstico SELECT/SHOW, migración aditiva sin datos ni cargas", () => {
    for (const tipo of ["preflight", "postcheck"]) {
      const sql = readFileSync(`sql/${tipo}-2026-10-combustibles-c2b-importaciones.sql`, "utf8").replace(/--[^\n]*/g, "");
      expect(sql.split(";").map(s => s.trim()).filter(Boolean).every(s => /^(SELECT|SHOW)\b/i.test(s))).toBe(true);
    }
    const sql = readFileSync("sql/migrate-2026-10-combustibles-c2b-importaciones.sql", "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/(?:^|;)\s*(INSERT|DELETE|TRUNCATE|DROP|UPDATE)\b/i);
    expect(sql).not.toContain("flota_combustible_cargas"); expect(sql).not.toContain("CREATE TABLE");
    expect(sql).toContain("uq_fcci_archivo (empresa_id,proveedor_id,archivo_sha256)");
    expect(sql).toContain("(empresa_id,conciliacion_id,duplicado_de_linea_id)"); expect(sql).toContain("ON UPDATE RESTRICT ON DELETE RESTRICT");
    expect(sql).toContain("hoja_origen VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL");
  });
  it("legacy excluye explícitamente HALEL de listado, detalle y descarga", () => {
    const sql = readFileSync("src/lib/flota/combustible-conciliacion-consultas.ts", "utf8");
    expect(sql.match(/perfil_parser IS NULL/g)).toHaveLength(3);
  });
  it("tabla de preview renderiza filtros y fecha neutral sin match ni total financiero", () => {
    const html = renderToStaticMarkup(createElement(FilasImportacion, { filas: [] }));
    for (const etiqueta of ["Hoja", "Fila", "Fecha de reporte", "Placa", "Vale", "Kilometraje", "Piloto (proveedor)", "Serie", "Factura", "Parsing", "Duplicado"]) expect(html).toContain(etiqueta);
    expect(html).not.toContain("MATCH_COMPLETO"); expect(html).not.toContain("Entregado");
  });
});
