import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/e/[slug]/cotizaciones/page.tsx", "utf8");

describe("Acciones visibles del listado de Cotizaciones", () => {
  it("no ofrece botón ni enlace Duplicar", () => {
    expect(page).not.toMatch(/<(?:button|a)\b[^>]*>\s*Duplicar\s*<\//);
    expect(page).not.toContain("onClick={() => void duplicar(c.id)}");
  });

  it("conserva Ver detalle y PDF comercial", () => {
    expect(page).toContain('expandidoId === c.id ? "Ocultar detalle" : "Ver detalle"');
    expect(page).toMatch(/<a\b[^>]*cotizaciones\/\$\{c.id\}\/pdf[^>]*>PDF comercial<\/a>/);
  });

  it("conserva Editar y Marcar enviada exclusivamente para Borrador", () => {
    expect(page).toMatch(/c.estado === "Borrador" \? <button[^\n]*onClick=\{\(\) => editar\(c\)\}[^\n]*>Editar<\/button> : null/);
    expect(page).toMatch(/puedeCambiarEstado && c.estado === "Borrador" \? <button[^\n]*cambiarEstado\(c.id, "Enviada"\)[^\n]*>Marcar enviada<\/button> : null/);
  });
});
