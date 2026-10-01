import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * VIATICOS-COMPROBANTE-ADMIN-1 (corrección pre-merge) — inspección de fuente del renderer administrativo del
 * PDF, en un archivo PROPIO (sin mockear "fs", a diferencia de viaticos-comprobante-pdf.test.ts) para poder
 * leer el código real. Confirma que el módulo dejó de usar dibujarTablaEnDoc() (helper COMPARTIDO con otros
 * reportes de RRHH, con fondo navy/zebra — src/lib/rrhh/export-files.ts, que NO se modifica) y usa en su
 * lugar un renderer LOCAL y privado, exclusivo de este comprobante.
 */
const src = readFileSync("src/lib/tms/viaticos-comprobante-pdf.ts", "utf8").replace(/\r\n/g, "\n");

describe("VIATICOS-COMPROBANTE-ADMIN-1 — el módulo no depende del helper compartido navy/zebra", () => {
  it("ya no importa ni invoca dibujarTablaEnDoc de @/lib/rrhh/export-files (el nombre puede seguir mencionado en comentarios explicando el porqué del cambio)", () => {
    expect(src).not.toMatch(/from\s+["']@\/lib\/rrhh\/export-files["']/);
    expect(src).not.toMatch(/dibujarTablaEnDoc\(doc\b/);
  });

  it("define y usa su propio renderer local dibujarTablaAdministrativaViaticos", () => {
    expect(src).toContain("function dibujarTablaAdministrativaViaticos(");
    expect(src).toContain("dibujarTablaAdministrativaViaticos(doc, {");
  });

  it("el renderer local no es exportado (uso exclusivo de este módulo, no un framework nuevo reutilizable)", () => {
    expect(src).not.toMatch(/export\s+function\s+dibujarTablaAdministrativaViaticos/);
  });

  it("src/lib/rrhh/export-files.ts (helper compartido) no fue tocado por este PR", () => {
    // No se puede comparar contra git aquí sin acoplar el test a comandos externos; esta prueba documenta la
    // expectativa — la verificación real de "sin diff" la hace el checklist de git diff/PR, no vitest.
    const compartido = readFileSync("src/lib/rrhh/export-files.ts", "utf8");
    expect(compartido).toContain("fill(\"#1e3a5f\")"); // sigue existiendo TAL CUAL para los demás reportes
  });
});
