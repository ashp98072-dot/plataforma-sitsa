import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ETIQUETAS_TIPO_LINEA_DOCUMENTO, TIPOS_LINEA_DOCUMENTO } from "./linea-documentos-schema";
import { TIPOS_LINEA_DOCUMENTO as REEXPORTADO } from "./linea-documentos";

/**
 * COMPRAS-FASE-3-DOCUMENTOS-LINEA (corrección post-revisión) —
 * linea-documentos-client.tsx es "use client" pero originalmente importaba
 * el catálogo desde linea-documentos.ts, que sí depende de mysql2/@/lib/db
 * (server-only). Un Client Component nunca debe depender, ni siquiera
 * transitivamente, de un módulo server/DB — el bundler de Next.js podría
 * arrastrar ese código (o fallar) en el bundle del navegador.
 *
 * Fix: linea-documentos-schema.ts es la fuente única del catálogo, SIN
 * ninguna dependencia server-only; linea-documentos.ts la re-exporta para
 * no romper a sus consumidores existentes (route.ts, linea-documentos-api.ts).
 * Este test es el guard explícito pedido: falla si alguien vuelve a
 * importar mysql2/@/lib/db/fs/server-only en el módulo cliente-seguro.
 */
const src = readFileSync(join(__dirname, "linea-documentos-schema.ts"), "utf-8");

describe("linea-documentos-schema.ts — módulo cliente-seguro", () => {
  it("no importa mysql2", () => {
    expect(src).not.toMatch(/from\s+["']mysql2/);
  });

  it("no importa @/lib/db", () => {
    expect(src).not.toMatch(/from\s+["']@\/lib\/db["']/);
  });

  it("no importa fs / node:fs", () => {
    expect(src).not.toMatch(/from\s+["'](node:)?fs["']/);
  });

  it("no importa server-only", () => {
    expect(src).not.toMatch(/from\s+["']server-only["']/);
    expect(src).not.toContain('import "server-only"');
  });

  it("no tiene ningún import (es un módulo de catálogo puro)", () => {
    expect(src).not.toMatch(/^import\s/m);
  });

  it("linea-documentos.ts (server) re-exporta el MISMO catálogo, sin duplicarlo", () => {
    expect(REEXPORTADO).toBe(TIPOS_LINEA_DOCUMENTO);
  });

  it("catálogo completo: 6 tipos con etiquetas", () => {
    expect(TIPOS_LINEA_DOCUMENTO).toHaveLength(6);
    for (const tipo of TIPOS_LINEA_DOCUMENTO) expect(ETIQUETAS_TIPO_LINEA_DOCUMENTO[tipo]).toBeTruthy();
  });
});
