import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { ProveedorCompraPicker, fusionarProveedorEnCatalogo, hayCoincidenciaExactaProveedor, opcionesProveedoresCompra } from "./proveedor-compra-picker";

const p1 = { id: 1, nombre_comercial: "Repuestos López", nit: "1234-56789-0101", contacto_nombre: null, contacto_telefono: null, telefono: null, metodo_pago_habitual: "Transferencia", banco: null, numero_cuenta: null, dias_credito: null };
const p2 = { id: 2, nombre_comercial: "Llantas y Mangueras", nit: null, contacto_nombre: null, contacto_telefono: null, telefono: null, metodo_pago_habitual: null, banco: null, numero_cuenta: null, dias_credito: null };

describe("COMPRAS-PROVEEDOR-INLINE (sección 2) — hayCoincidenciaExactaProveedor", () => {
  it("22/26) sin texto de búsqueda -> true (no se ofrece crear con el campo vacío)", () => {
    expect(hayCoincidenciaExactaProveedor([p1, p2], "")).toBe(true);
    expect(hayCoincidenciaExactaProveedor([p1, p2], "   ")).toBe(true);
  });
  it("hay coincidencia EXACTA normalizada (mayúsculas/acentos/espacios) -> true", () => {
    expect(hayCoincidenciaExactaProveedor([p1, p2], "REPUESTOS LOPEZ")).toBe(true);
    expect(hayCoincidenciaExactaProveedor([p1, p2], "  repuestos   lópez  ")).toBe(true);
  });
  it("2) sin coincidencia exacta -> false (se ofrece '+ Crear')", () => {
    expect(hayCoincidenciaExactaProveedor([p1, p2], "Ferretería Central")).toBe(false);
  });
  it("una coincidencia PARCIAL (no exacta) sigue ofreciendo crear", () => {
    expect(hayCoincidenciaExactaProveedor([p1, p2], "Repuestos")).toBe(false);
  });
});

describe("COMPRAS-PROVEEDOR-INLINE (sección 4) — fusionarProveedorEnCatalogo", () => {
  it("23) proveedor nuevo se agrega al catálogo local", () => {
    const nuevo = { ...p1, id: 3, nombre_comercial: "Ferretería Central" };
    expect(fusionarProveedorEnCatalogo([p1, p2], nuevo)).toEqual([p1, p2, nuevo]);
  });
  it("28) proveedor ya existente (mismo id, p.ej. reactivado) se REEMPLAZA, no se duplica", () => {
    const actualizado = { ...p1, metodo_pago_habitual: "Tarjeta" };
    const r = fusionarProveedorEnCatalogo([p1, p2], actualizado);
    expect(r).toHaveLength(2);
    expect(r.find(v => v.id === 1)).toEqual(actualizado);
  });
  it("25) no altera las demás entradas del catálogo", () => {
    const nuevo = { ...p1, id: 3, nombre_comercial: "Ferretería Central" };
    const r = fusionarProveedorEnCatalogo([p1, p2], nuevo);
    expect(r[0]).toBe(p1);
    expect(r[1]).toBe(p2);
  });
});

describe("COMPRAS-PROVEEDOR-INLINE — estructura y permisos (render estático)", () => {
  const props = { slug: "a", proveedores: [p1], value: 0, inputClassName: "x", onChange: vi.fn(), onProveedorCreado: vi.fn() };

  it("19) sin compras_proveedores:crear, la acción inline nunca aparece en el HTML inicial", () => {
    const html = renderToStaticMarkup(createElement(ProveedorCompraPicker, { ...props, puedeCrear: false }));
    expect(html).not.toContain("Crear proveedor");
    expect(html).toContain("Buscar proveedor...");
  });

  it("con compras_proveedores:crear pero SIN texto de búsqueda escrito todavía, tampoco aparece (busqueda inicial vacía)", () => {
    const html = renderToStaticMarkup(createElement(ProveedorCompraPicker, { ...props, puedeCrear: true }));
    expect(html).not.toContain("Crear proveedor");
  });

  it("sigue usando CatalogoSearchSelect (no se duplicó su lógica de búsqueda/selección)", () => {
    const source = readFileSync("src/components/compras/proveedor-compra-picker.tsx", "utf8");
    expect(source).toContain("<CatalogoSearchSelect");
    expect(source).toContain("onSearchChange={setBusqueda}");
  });
});

describe("regresión — opcionesProveedoresCompra sigue disponible desde requerimiento-form-client (compat)", () => {
  it("re-exporta la misma función (no duplica la lógica)", () => {
    const source = readFileSync("src/components/compras/requerimiento-form-client.tsx", "utf8");
    expect(source).toContain('export { opcionesProveedoresCompra };');
    expect(opcionesProveedoresCompra([p1], 1)).toEqual([{ value: "1", label: "Repuestos López", searchText: "Repuestos López 1234-56789-0101" }]);
  });
});

describe("HOTFIX (bug de producción) — proveedorListo es la ÚNICA autoridad de selección", () => {
  const source = readFileSync("src/components/compras/proveedor-compra-picker.tsx", "utf8");
  const fn = source.slice(source.indexOf("function proveedorListo"), source.indexOf("return ("));

  it("6) onProveedorCreado se llama exactamente una vez dentro de proveedorListo", () => {
    expect(fn.match(/onProveedorCreado\(/g)).toHaveLength(1);
  });

  it("7) NO existe una segunda llamada a onChange dentro de proveedorListo (agregarProveedorYSeleccionar del padre ya selecciona)", () => {
    expect(fn).not.toContain("onChange(");
  });

  it("11/12/13) proveedorListo limpia la búsqueda (busqueda local Y el input interno de CatalogoSearchSelect vía resetKey) para los tres flujos: alta, usar existente y reactivar", () => {
    expect(fn).toContain('setBusqueda("");');
    expect(fn).toContain("setResetKey((k) => k + 1);");
    // Los tres flujos del modal (crear/usar existente/reactivar) llaman al MISMO onCreado={proveedorListo}.
    expect(source).toContain("onCreado={proveedorListo}");
  });

  it("searchResetKey se pasa a CatalogoSearchSelect (opt-in, sin afectar otros consumidores)", () => {
    expect(source).toContain("searchResetKey={resetKey}");
  });

  it("modal se cierra después de cualquiera de los tres flujos", () => {
    expect(fn).toContain("setModalAbierto(false);");
  });
});
