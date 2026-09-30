import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProveedorInlineModal, resolverProveedorExistente } from "./proveedor-inline-modal";
import type { ProveedorPickerOpt } from "./proveedor-compra-picker";

const src = readFileSync("src/components/compras/proveedor-inline-modal.tsx", "utf8");

const proveedorA: ProveedorPickerOpt = { id: 9, nombre_comercial: "Proveedor A", nit: "123", contacto_nombre: "Ana", contacto_telefono: "5555-0001", telefono: "2222-0001", metodo_pago_habitual: "Cheque", banco: "Banco X", numero_cuenta: "111", dias_credito: 30 };

describe("COMPRAS-PROVEEDOR-INLINE (sección 3) — modal de alta rápida, render inicial", () => {
  it("3) nombre comercial es obligatorio y viene precargado con el texto buscado; el resto es opcional", () => {
    const html = renderToStaticMarkup(createElement(ProveedorInlineModal, { slug: "a", nombreInicial: "Ferretería Central", proveedores: [], puedeEditar: false, onClose: vi.fn(), onCreado: vi.fn() }));
    expect(html).toContain("Nombre comercial");
    expect(html).toContain("Ferretería Central");
    expect(html).toContain('required=""');
  });

  it("3) no muestra banco/cuenta/tipo de cuenta/titular/dirección/observaciones (alta rápida compacta)", () => {
    const html = renderToStaticMarkup(createElement(ProveedorInlineModal, { slug: "a", nombreInicial: "X", proveedores: [], puedeEditar: false, onClose: vi.fn(), onCreado: vi.fn() }));
    for (const campo of ["Banco", "Número de cuenta", "Tipo de cuenta", "Titular de cuenta", "Dirección", "Observaciones"]) {
      expect(html).not.toContain(campo);
    }
  });

  it("3) indica que el resto de datos se completa después en Proveedores comerciales", () => {
    const html = renderToStaticMarkup(createElement(ProveedorInlineModal, { slug: "a", nombreInicial: "X", proveedores: [], puedeEditar: false, onClose: vi.fn(), onCreado: vi.fn() }));
    expect(html).toContain("Podés completar los demás datos después en Proveedores comerciales.");
  });

  it("es un diálogo modal accesible", () => {
    const html = renderToStaticMarkup(createElement(ProveedorInlineModal, { slug: "a", nombreInicial: "X", proveedores: [], puedeEditar: false, onClose: vi.fn(), onCreado: vi.fn() }));
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
    expect(src).toContain("onClick={() => onCreado(resolverProveedorExistente(proveedores, duplicado.existente))}");
  });

  it("corrección pre-SQL (sección 2-3) — 'Usar proveedor existente' resuelve el objeto COMPLETO ya cargado en catálogo, no el mínimo del 409, para no perder método de pago habitual/contacto/banco/etc.", () => {
    expect(src).toContain("export function resolverProveedorExistente(proveedores: ProveedorPickerOpt[], existente: DuplicadoInfo): ProveedorPickerOpt {");
    expect(src).toContain("proveedores.find(p => p.id === existente.id) ?? proveedorMinimoDesdeExistente(existente)");
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

describe("corrección pre-SQL (secciones 2-4) — resolverProveedorExistente NO degrada un registro ya conocido", () => {
  it("6/7) mismo id ya en catálogo -> devuelve el objeto COMPLETO (método de pago, contacto, teléfono, banco, cuenta, días de crédito intactos)", () => {
    const existente = { id: 9, nombre_comercial: "Proveedor A Guatemala", nit: "123", activo: true }; // nombre distinto: el backend detectó el duplicado por NIT
    const r = resolverProveedorExistente([proveedorA], existente);
    expect(r).toBe(proveedorA);
    expect(r.metodo_pago_habitual).toBe("Cheque");
    expect(r.contacto_nombre).toBe("Ana");
    expect(r.telefono).toBe("2222-0001");
    expect(r.banco).toBe("Banco X");
    expect(r.numero_cuenta).toBe("111");
    expect(r.dias_credito).toBe(30);
  });

  it("8) duplicado detectado por NIT con nombre_comercial DIFERENTE en el 409 igual selecciona el proveedor existente correcto por id", () => {
    const existente = { id: 9, nombre_comercial: "Nombre distinto en el 409", nit: "123", activo: true };
    expect(resolverProveedorExistente([proveedorA], existente).id).toBe(9);
  });

  it("9) el método de pago habitual del existente queda disponible para aplicar seleccionarProveedorCompra", () => {
    const r = resolverProveedorExistente([proveedorA], { id: 9, nombre_comercial: "X", nit: null, activo: true });
    expect(r.metodo_pago_habitual).toBe("Cheque");
  });

  it("no está en el catálogo local (defensa extraordinaria) -> usa el mínimo del 409, sin inventar datos", () => {
    const existente = { id: 999, nombre_comercial: "Desconocido", nit: null, activo: true };
    const r = resolverProveedorExistente([proveedorA], existente);
    expect(r).toEqual({ id: 999, nombre_comercial: "Desconocido", nit: null, contacto_nombre: null, contacto_telefono: null, telefono: null, metodo_pago_habitual: null, banco: null, numero_cuenta: null, dias_credito: null });
  });

  it("10) un proveedor realmente nuevo (no relacionado con ningún duplicado) no pasa por este resolver — se agrega tal cual via fusionarProveedorEnCatalogo", () => {
    expect(src).not.toContain("resolverProveedorExistente(proveedores, data.proveedor");
  });
});

describe("HOTFIX (bug de producción) — sin <form> anidado dentro del requerimiento", () => {
  it("1/15) ProveedorInlineModal NO renderiza ningún <form> en su código fuente (ni abierto ni cerrado)", () => {
    expect(src).not.toMatch(/<form[\s>]/);
    expect(src).not.toContain("</form>");
  });

  it("1/15) tampoco aparece un <form> en el HTML renderizado (formulario de alta, sin duplicado)", () => {
    const html = renderToStaticMarkup(createElement(ProveedorInlineModal, { slug: "a", nombreInicial: "INTELAF", proveedores: [], puedeEditar: false, onClose: vi.fn(), onCreado: vi.fn() }));
    expect(html).not.toMatch(/<form[\s>]/);
  });

  it("2) el botón 'Crear proveedor' es type=\"button\" (nunca type=\"submit\")", () => {
    expect(src).toMatch(/onClick=\{\(\) => void guardar\(\)\}>\{guardando \? "Creando…" : "Crear proveedor"\}/);
    expect(src).not.toContain('type="submit"');
  });

  it("3) guardar() ya no recibe FormEvent ni depende de onSubmit/preventDefault", () => {
    expect(src).toContain("async function guardar() {");
    expect(src).not.toContain("onSubmit={guardar}");
    expect(src).not.toContain("e.preventDefault()");
  });

  it("4) nombre_comercial vacío se rechaza ANTES del fetch (validación explícita del lado cliente)", () => {
    const fn = src.slice(src.indexOf("async function guardar()"), src.indexOf("async function reactivarYUsar"));
    const antesDelFetch = fn.slice(0, fn.indexOf("fetch("));
    expect(antesDelFetch).toContain('if (!form.nombre_comercial.trim()) { setError("El nombre comercial es obligatorio."); return; }');
  });

  it("5) éxito del POST exige data.proveedor con id antes de llamar onCreado (nunca selecciona algo inválido)", () => {
    expect(src).toContain("if (!data.proveedor || !data.proveedor.id) throw new Error(");
    const fn = src.slice(src.indexOf("async function guardar()"), src.indexOf("async function reactivarYUsar"));
    expect(fn.indexOf("if (!data.proveedor")).toBeLessThan(fn.indexOf("onCreado(data.proveedor)"));
  });
});
