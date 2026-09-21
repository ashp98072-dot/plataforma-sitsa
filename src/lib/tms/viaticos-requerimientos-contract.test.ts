import { readFileSync } from "node:fs";import { join } from "node:path";import { describe,expect,it } from "vitest";
const root=process.cwd();const read=(p:string)=>readFileSync(join(root,p),"utf8");
describe("contrato SQL y aislamiento",()=>{
  const migration=read("sql/migrate-2026-09-viaticos-requerimientos-manuales.sql");const preflight=read("sql/preflight-2026-09-viaticos-requerimientos-manuales.sql");const model=read("src/lib/tms/viaticos-requerimientos.ts");
  it("crea solo las dos tablas separadas y conserva plan nullable",()=>{expect(migration.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);expect(migration).toContain("plan_id INT NULL");expect(migration).not.toMatch(/ALTER TABLE tms_viaticos|DROP\s/i);});
  it("preflight es solo lectura Hostinger sin information_schema",()=>{expect(preflight).not.toMatch(/information_schema|INSERT|UPDATE|DELETE|ALTER|DROP/i);expect(preflight).toMatch(/SHOW TABLES/);expect(preflight).toMatch(/SHOW CREATE TABLE/);});
  it("todas las lecturas de catálogos y entidades están acotadas por empresa",()=>{expect(model).toMatch(/tp\.empresa_id=\?/);expect(model).toMatch(/flota_vehiculos WHERE empresa_id=\?/);expect(model).toMatch(/tms_clientes WHERE empresa_id=\?/);expect(model).toMatch(/WHERE empresa_id=\? AND id=\?/);});
  it("calcula total en servidor y congela estados posteriores a pendiente",()=>{expect(model).toContain("Math.round(cantidad * unitario / 100)");expect(model).toContain('["BORRADOR","PENDIENTE"]');expect(model).toContain("ya está congelado");});
  it("audita las cinco transiciones y captura firma interna al autorizar",()=>{for(const a of ["enviar","autorizar","rechazar","entregar","liquidar"])expect(model).toContain(`${a}:`);expect(model).toContain("crearFirmaInterna");expect(model).toContain("AUTORIZAR_REQUERIMIENTO_VIATICO");});
});
