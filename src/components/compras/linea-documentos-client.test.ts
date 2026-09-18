import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineaDocumentosClient } from "./linea-documentos-client";
import { ETIQUETAS_TIPO_LINEA_DOCUMENTO, TIPOS_LINEA_DOCUMENTO } from "@/lib/compras/linea-documentos-schema";

const src = readFileSync(join(__dirname, "linea-documentos-client.tsx"), "utf-8");

/**
 * COMPRAS-FASE-3-DOCUMENTOS-LINEA — mismo patrón ya usado en
 * requerimiento-ui.test.ts: renderToStaticMarkup renderiza el estado
 * INICIAL del componente (useEffect nunca corre en un render estático, así
 * que el fetch de cargar() no se dispara) — sirve para verificar la
 * estructura/props estáticas: el <select> de tipos, el formulario de
 * subida y los botones "Ver"/"Eliminar" condicionados por permiso.
 */
function render(props: Partial<Parameters<typeof LineaDocumentosClient>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(LineaDocumentosClient, {
      slug: "a",
      requerimientoId: 12,
      lineaId: 21,
      puedeSubir: true,
      puedeEliminar: true,
      ...props,
    }),
  );
}

describe("LineaDocumentosClient — estructura estática", () => {
  it("muestra 'Documentos (0)' y 'Cargando…' antes de que resuelva el fetch inicial (loading arranca en true, sin setState síncrono en el efecto)", () => {
    const html = render();
    expect(html).toContain("Documentos (0)");
    expect(html).toContain("Cargando…");
  });

  it("el selector de tipo ofrece los 6 tipos con las etiquetas del catálogo compartido", () => {
    const html = render();
    for (const tipo of TIPOS_LINEA_DOCUMENTO) expect(html).toContain(`>${ETIQUETAS_TIPO_LINEA_DOCUMENTO[tipo]}<`);
  });

  it("puedeSubir=false oculta el formulario de subida (Tipo documento / Seleccionar archivo / Subir documento)", () => {
    const html = render({ puedeSubir: false });
    expect(html).not.toContain("Tipo documento");
    expect(html).not.toContain("Subir documento");
  });

  it("puedeSubir=true muestra el formulario de subida", () => {
    const html = render({ puedeSubir: true });
    expect(html).toContain("Tipo documento");
    expect(html).toContain("Subir documento");
  });

  it("acepta exactamente PDF/JPG/JPEG/PNG/WEBP en el input de archivo (sin BMP ni wildcard image/*)", () => {
    const html = render();
    expect(html).toContain('accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"');
    expect(html).not.toContain("image/*");
    expect(html).not.toContain(".bmp");
  });

  it("botón Subir documento arranca deshabilitado (sin archivo seleccionado)", () => {
    const html = render();
    expect(html).toMatch(/disabled="">\s*Subir documento/);
  });

  it("GET de listar usa cache: 'no-store' (no mostrar datos stale entre líneas)", () => {
    expect(src).toMatch(/fetch\(base, \{ cache: "no-store" \}\)/);
  });

  it("react-hooks/set-state-in-effect: cargar() no llama a un setState de forma síncrona antes del fetch (todo vive en .then()/.catch()/.finally())", () => {
    const cuerpo = src.match(/const cargar = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[base\]\);/)?.[1] ?? "";
    expect(cuerpo).not.toBe("");
    const antesDelFetch = cuerpo.split("fetch(base")[0];
    expect(antesDelFetch).not.toMatch(/set[A-Z]\w*\(/);
    expect(cuerpo).toMatch(/\.then\(/);
    expect(cuerpo).toMatch(/\.catch\(/);
    expect(cuerpo).toMatch(/\.finally\(\(\) => setLoading\(false\)\)/);
  });

  it("useEffect de montaje solo llama a cargar(), sin ningún setState directo en su cuerpo", () => {
    const cuerpo = src.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[cargar\]\);/)?.[1] ?? "";
    expect(cuerpo.trim()).toBe("void cargar();");
  });
});
