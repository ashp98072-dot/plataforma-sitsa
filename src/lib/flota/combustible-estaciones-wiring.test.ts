import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const read = (path: string) => readFileSync(path, "utf8");
it("mantenimiento separado enlazado desde Combustibles, no incrustado en captura", () => {
  expect(read("src/components/flota/combustibles-client.tsx")).toContain("/combustibles/estaciones");
  const pagina = read("src/app/e/[slug]/combustibles/estaciones/page.tsx");
  expect(pagina).toContain('requireTenantFlotaCombustible(slug, "gestionar_estaciones")');
  const form = read("src/components/flota/combustible-registro.tsx");
  expect(form).toContain('name="estacionId"');
  expect(form).not.toContain('name="gasolinera"');
  // El proveedor ya no se captura: se deriva de la estación en el servidor.
  expect(form).not.toContain('name="proveedorId"'); expect(form).not.toContain('label="Proveedor"');
  expect(form).toContain('label="Estación / gasolinera"'); expect(form).toContain('label="Unidad / placa"');
  expect(form).toContain("/combustibles/estaciones"); expect(form).toContain("MENSAJE_SIN_ESTACIONES");
  expect(form).toContain("Texto histórico conservado");
  expect(form).not.toContain("Nueva estación");
});
it("CRUD solo ofrece GET/POST/PATCH y no ejecuta DDL ni borra estaciones", () => {
  const rutas = read("src/app/api/empresas/[slug]/flota/combustible/estaciones/route.ts") + read("src/app/api/empresas/[slug]/flota/combustible/estaciones/[id]/route.ts");
  expect(rutas).toMatch(/GET/); expect(rutas).toMatch(/POST/); expect(rutas).toMatch(/PATCH/); expect(rutas).not.toMatch(/DELETE/);
  expect(read("src/lib/flota/combustible-estaciones.ts")).not.toMatch(/\b(?:CREATE TABLE|ALTER TABLE|DELETE FROM)\b/i);
});
it("scripts sin backfill y verificación posterior de referencias", () => {
  const sql = read("sql/migrate-2026-10-combustibles-estaciones.sql");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS flota_combustible_estaciones");
  expect(sql).toContain("ADD COLUMN IF NOT EXISTS estacion_id INT NULL");
  expect(sql).toContain("FOREIGN KEY IF NOT EXISTS fk_fcc_estacion (empresa_id, proveedor_id, estacion_id)");
  expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE flota|DELETE FROM|DROP TABLE)/i);
  expect(read("sql/verificar-2026-10-combustibles-estaciones.sql")).toContain("LEFT JOIN flota_combustible_estaciones");
});
