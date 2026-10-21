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
      expect(sql).not.toMatch(/(?:^|[;\n])\s*(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
      const preparadas = [...sql.matchAll(/SET @c2b_lectura='(.*)';/g)];
      expect(preparadas.length).toBeGreaterThan(0);
      expect(preparadas.every(m => m[1].startsWith("SELECT "))).toBe(true);
    }
    const sql = readFileSync("sql/migrate-2026-10-combustibles-c2b-importaciones.sql", "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/(?:^|;)\s*(INSERT|DELETE|TRUNCATE|DROP|UPDATE)\b/i);
    expect(sql).not.toContain("flota_combustible_cargas"); expect(sql).not.toContain("CREATE TABLE");
    expect(sql).toContain("uq_fcci_archivo (empresa_id,proveedor_id,archivo_sha256)");
    expect(sql).toContain("(empresa_id,conciliacion_id,duplicado_de_linea_id)"); expect(sql).toContain("ON UPDATE RESTRICT ON DELETE RESTRICT");
    expect(sql).toContain("hoja_origen VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL");
    expect(sql).not.toMatch(/\bIF NOT EXISTS\b/);
    for (const estado of ["CLEAN", "PARTIAL_HEADER_COMPLETE", "FINAL", "DIVERGENTE"]) expect(sql).toContain(estado);
    expect(sql).toContain("SIGNAL SQLSTATE '45000'");
  });
  it("columnas, UNIQUE y FKs son ALTERs separados con certificación física entre B y D", () => {
    const sql = readFileSync("sql/migrate-2026-10-combustibles-c2b-importaciones.sql", "utf8");
    const fase = (nombre: string) => sql.split(`-- BEGIN FILAS ${nombre}`)[1].split(`-- END FILAS ${nombre}`)[0];
    expect(fase("A COLUMNAS")).not.toMatch(/ADD (INDEX|UNIQUE|CONSTRAINT|FOREIGN)/);
    expect(fase("B INDICES")).toContain("ADD UNIQUE KEY uq_fccif_empresa_import_id");
    expect(fase("B INDICES")).not.toContain("FOREIGN KEY");
    expect(fase("C FK CABECERA")).not.toContain("fk_fccif_canonica");
    expect(fase("D FK CANONICA")).not.toContain("ADD UNIQUE");
    expect(sql.indexOf("SELECT COUNT(*) INTO indice_fisico")).toBeGreaterThan(sql.indexOf("-- END FILAS B INDICES"));
    expect(sql.indexOf("SELECT COUNT(*) INTO indice_fisico")).toBeLessThan(sql.indexOf("-- BEGIN FILAS D FK CANONICA"));
  });
  it("los tres scripts usan exactamente el mismo contrato de metadata y de datos", () => {
    for (const marcador of ["C2B CONTRACT AUDIT", "C2B DATA AUDIT"]) {
      const bloques = ["preflight", "migrate", "postcheck"].flatMap(tipo => {
        const sql = readFileSync(`sql/${tipo}-2026-10-combustibles-c2b-importaciones.sql`, "utf8");
        return sql.split(`-- BEGIN ${marcador}`).slice(1).map(s => s.split(`-- END ${marcador}`)[0]);
      });
      expect(bloques).toHaveLength(4);
      expect(new Set(bloques).size).toBe(1);
    }
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
