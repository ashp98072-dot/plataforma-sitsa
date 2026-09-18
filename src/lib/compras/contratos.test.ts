import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProveedoresComercialesClient, camposFormulario } from "@/components/compras/proveedores-comerciales-client";
const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
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
  const baseSinExpansion = schema.replace(/  encargado_compras_usuario_id INT NULL DEFAULT NULL,\n  encargado_compras_nombre VARCHAR\(200\) NULL DEFAULT NULL,\n/, "");
  expect(bloques).toHaveLength(4); for (const bloque of bloques) expect(baseSinExpansion).toContain(bloque);
  const sinComentarios = sql.replace(/^--.*$/gm, ""); expect(sinComentarios).not.toMatch(/\b(ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b\s+(TABLE|INTO|FROM|compras_)/i);
  expect(sql).not.toMatch(/UNIQUE[^\n]*nit/i); expect(sql).toContain("FOREIGN KEY (empresa_id, requerimiento_id, linea_id)"); expect(sql).toContain("ON DELETE RESTRICT");
});
it("preflight lectura, cuatro contratos y decisiones", () => {
  const sql = leer("sql/preflight-2026-09-compras-base.sql").replace(/^--.*$/gm, "");
  expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|CALL)\s+(TABLE|INTO|FROM|PROCEDURE)/i);
  for (const tabla of ["compras_proveedores", "compras_requerimientos", "compras_requerimiento_lineas", "compras_linea_documentos"]) expect(sql).toContain(tabla);
  for (const s of ["APLICAR", "NOOP", "DETENER", "VERSION()", "COLUMN_TYPE", "TABLE_COLLATION", "REFERENTIAL_CONSTRAINTS", "STATISTICS"]) expect(sql).toContain(s);
});
it("no modifica RRHH, credenciales ni esquema SQL", () => {
  const files = execFileSync("git", ["diff", "--name-only", "aebfdc1ee46f6fe2bac4b80612db928e0a10c71b"], { encoding: "utf8" }).trim().split(/\r?\n/);
  // COMPRAS-FASE-3-DOCUMENTOS-LINEA agregó una migración/preflight reales
  // (amplía el CHECK de compras_linea_documentos.tipo — ver auditoría en
  // src/lib/compras/linea-documentos.ts), pedidos explícitamente por ese
  // ticket y sin ejecutar. Se excluyen por nombre solo esos 2 archivos, no
  // cualquier sql/ futuro — mismo criterio ya aplicado en
  // requerimiento-ui.test.ts.
  expect(files.some(p => /(src\/lib\/rrhh|portales-proveedores)/.test(p) || (p.startsWith("sql/") && !p.includes("compras-documentos-linea-tipo")))).toBe(false);
});

it("preflight compara DEFAULT 0 de DECIMAL(12,2) con 0.00 de MariaDB por valor numérico", () => {
  const sql = leer("sql/preflight-2026-09-compras-base.sql");
  expect(sql).toContain("'compras_requerimientos' tabla, 'total' columna, 12 posicion, 'decimal' tipo, NULL longitud, 12 precision_num, 2 escala, 'NO' nullable, '0' defecto");
  expect(leer("sql/migrate-2026-09-compras-base.sql")).toContain("total DECIMAL(12,2) NOT NULL DEFAULT 0");
  const bloque = sql.match(/OR NOT \(CASE WHEN e\.tipo IN \('int','bigint','tinyint','decimal'\) THEN[\s\S]*?END\)/)?.[0];
  expect(bloque).toBeDefined();
  expect(bloque).toContain("THEN e.defecto IS NULL");
  expect(bloque).toContain("AND e.defecto REGEXP '^[-+]?[0-9]+([.][0-9]+)?$'");
  expect(bloque).toContain("THEN CAST(REPLACE(c.COLUMN_DEFAULT, CHAR(39), '') AS DECIMAL(65,30))\n        <=> CAST(e.defecto AS DECIMAL(65,30))");
  expect(bloque).toContain("ELSE 0");
  expect(bloque).toContain("ELSE NULLIF(LOWER(REPLACE(REPLACE(c.COLUMN_DEFAULT, CHAR(39), ''), '()', '')), 'null') <=> LOWER(e.defecto)");

  // Contrato local, no ejecución SQL: replica la conversión decimal exacta
  // usando la expresión regular y escala capturadas del bloque comprobado.
  const patron = bloque!.match(/REGEXP '([^']+)'/)![1];
  const escala = Number(bloque!.match(/DECIMAL\(65,(\d+)\)/)![1]);
  const decimal = (value: string) => {
    const [entero, fraccion = ""] = value.replace(/^[-+]/, "").split(".");
    return BigInt(`${entero}${fraccion.padEnd(escala, "0")}`) * BigInt(value.startsWith("-") ? -1 : 1);
  };
  const equivalentes = (actual: string | null, esperado: string | null) => {
    const normal = actual === null || actual.toLowerCase() === "null" ? null : actual.replaceAll("'", "");
    if (normal === null) return esperado === null;
    if (esperado === null || !new RegExp(patron).test(normal) || !new RegExp(patron).test(esperado)) return false;
    return decimal(normal) === decimal(esperado);
  };
  expect(equivalentes("0.00", "0")).toBe(true);
  expect(equivalentes("1.0", "1")).toBe(true);
  expect(equivalentes("'0.00'", "0")).toBe(true);
  expect(equivalentes("0.01", "0")).toBe(false);
  expect(equivalentes("1", "0")).toBe(false);
  expect(equivalentes(null, "0")).toBe(false);
  expect(equivalentes("0", null)).toBe(false);
  expect(equivalentes(null, null)).toBe(true);
  expect(equivalentes("texto", "0")).toBe(false);
  expect(equivalentes("0abc", "0")).toBe(false);
  expect(equivalentes("9007199254740993", "9007199254740992")).toBe(false);
});
