import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProveedorInlineModal } from "./proveedor-inline-modal";

const src = readFileSync("src/components/compras/proveedor-inline-modal.tsx", "utf8");

describe("COMPRAS-PROVEEDOR-INLINE (sección 3) — modal de alta rápida, render inicial", () => {
  it("3) nombre comercial es obligatorio y viene precargado con el texto buscado; el resto es opcional", () => {
    const html = renderToStaticMarkup(createElement(ProveedorInlineModal, { slug: "a", nombreInicial: "Ferretería Central", puedeEditar: false, onClose: vi.fn(), onCreado: vi.fn() }));
    expect(html).toContain("Nombre comercial");
    expect(html).toContain("Ferretería Central");
    expect(html).toContain('required=""');
  });

  it("3) no muestra banco/cuenta/tipo de cuenta/titular/dirección/observaciones (alta rápida compacta)", () => {
    const html = renderToStaticMarkup(createElement(ProveedorInlineModal, { slug: "a", nombreInicial: "X", puedeEditar: false, onClose: vi.fn(), onCreado: vi.fn() }));
    for (const campo of ["Banco", "Número de cuenta", "Tipo de cuenta", "Titular de cuenta", "Dirección", "Observaciones"]) {
      expect(html).not.toContain(campo);
    }
  });

  it("3) indica que el resto de datos se completa después en Proveedores comerciales", () => {
    const html = renderToStaticMarkup(createElement(ProveedorInlineModal, { slug: "a", nombreInicial: "X", puedeEditar: false, onClose: vi.fn(), onCreado: vi.fn() }));
    expect(html).toContain("Podés completar los demás datos después en Proveedores comerciales.");
  });

  it("es un diálogo modal accesible", () => {
    const html = renderToStaticMarkup(createElement(ProveedorInlineModal, { slug: "a", nombreInicial: "X", puedeEditar: false, onClose: vi.fn(), onCreado: vi.fn() }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });
});

describe("COMPRAS-PROVEEDOR-INLINE (secciones 10-11) — flujo de duplicado (por código fuente)", () => {
  it("10) POST a /compras/proveedores; 409 con codigo+proveedorExistente activa el estado 'duplicado'", () => {
    expect(src).toContain("res.status === 409 && data.codigo && data.proveedorExistente");
    expect(src).toContain("setDuplicado({ codigo: data.codigo, existente: data.proveedorExistente })");
  });

  it("10) duplicado ACTIVO ofrece 'Usar proveedor existente' sin más peticiones", () => {
    expect(src).toContain('duplicado.codigo === "PROVEEDOR_DUPLICADO"');
    expect(src).toContain("Usar proveedor existente");
    expect(src).toContain("onClick={() => onCreado(proveedorMinimoDesdeExistente(duplicado.existente))}");
  });

  it("11) duplicado INACTIVO con permiso editar ofrece 'Reactivar y usar' vía PATCH del endpoint existente (nunca SQL directo)", () => {
    expect(src).toContain("reactivarYUsar");
    expect(src).toContain("Reactivar y usar");
    expect(src).toMatch(/fetch\(`\$\{api\}\/\$\{duplicado\.existente\.id\}`, \{ method: "PATCH"/);
    expect(src).toContain('body: JSON.stringify({ activo: true })');
  });

  it("11) duplicado INACTIVO sin permiso editar muestra el mensaje de solicitar ayuda, sin botón de reactivar", () => {
    const html = readFileSync("src/components/compras/proveedor-inline-modal.tsx", "utf8");
    expect(html).toContain("Solicitá a un usuario con permiso de edición que reactive el proveedor.");
  });
});
