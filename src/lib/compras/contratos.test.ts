import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProveedoresComercialesClient, camposFormulario } from "@/components/compras/proveedores-comerciales-client";
const leer = (p: string) => readFileSync(p, "utf8");
it("menú/rutas y formulario sin funcionalidad de requerimientos", () => {
  const shell = leer("src/components/app-shell.tsx"); expect(shell).toContain('tienePermiso(permisos, "compras_proveedores", "ver")'); expect(shell).toContain('label: "Compras / Repuestos"'); expect(shell).toContain('label: "Proveedores comerciales"');
  expect(leer("src/app/e/[slug]/compras/page.tsx")).toContain("compras/proveedores");
  const html = renderToStaticMarkup(createElement(ProveedoresComercialesClient, { slug: "a", puedeCrear: true, puedeEditar: true })); expect(html).toContain("Proveedores comerciales"); expect(html).toContain("Nuevo proveedor"); expect(html).toContain("Buscar por nombre comercial");
  expect(renderToStaticMarkup(createElement(ProveedoresComercialesClient, { slug: "a", puedeCrear: false, puedeEditar: false }))).not.toContain("Nuevo proveedor");
  expect(camposFormulario.map(([c]) => c)).toContain("tipo_cuenta"); expect(camposFormulario).toHaveLength(16);
});
it("migración canónica coincide y no altera/borrra datos", () => {
  const sql = leer("sql/migrate-2026-09-compras-base.sql"); const schema = leer("sql/schema.sql");
  const bloques = sql.match(/CREATE TABLE IF NOT EXISTS [\s\S]*?COLLATE=utf8mb4_unicode_ci;/g)!;
  expect(bloques).toHaveLength(4); for (const bloque of bloques) expect(schema).toContain(bloque);
  const sinComentarios = sql.replace(/^--.*$/gm, ""); expect(sinComentarios).not.toMatch(/\b(ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b\s+(TABLE|INTO|FROM|compras_)/i);
  expect(sql).not.toMatch(/UNIQUE[^\n]*nit/i); expect(sql).toContain("FOREIGN KEY (empresa_id, requerimiento_id, linea_id)"); expect(sql).toContain("ON DELETE RESTRICT");
});
it("preflight lectura, cuatro contratos y decisiones", () => {
  const sql = leer("sql/preflight-2026-09-compras-base.sql").replace(/^--.*$/gm, "");
  expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|CALL)\s+(TABLE|INTO|FROM|PROCEDURE)/i);
  for (const tabla of ["compras_proveedores", "compras_requerimientos", "compras_requerimiento_lineas", "compras_linea_documentos"]) expect(sql).toContain(tabla);
  for (const s of ["APLICAR", "NOOP", "DETENER", "VERSION()", "COLUMN_TYPE", "TABLE_COLLATION", "REFERENTIAL_CONSTRAINTS", "STATISTICS"]) expect(sql).toContain(s);
});
it("no modifica RRHH, credenciales ni APIs de Fondos/Gastos", () => {
  const files = execFileSync("git", ["diff", "--name-only", "8fcc7cc575acaefd55207ba3715e93849ede854d"], { encoding: "utf8" }).trim().split(/\r?\n/);
  expect(files.some(p => /src\/(lib\/rrhh|app\/api\/.*\/(fondos|gastos)\/|.*portales-proveedores)/.test(p))).toBe(false);
});
