import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { lineaEditable, RequerimientoFormClient } from "@/components/compras/requerimiento-form-client";
import { RequerimientosClient } from "@/components/compras/requerimientos-client";
import type { DetalleCompra } from "./requerimiento-schema";
const leer = (p: string) => readFileSync(p, "utf8");
const detalle = { id: 12, codigo: "RC-2026-000012", fecha_requerimiento: "2026-09-17", estado: "Autorizada", version: 3, entidad_requirente_nombre: "Empresa real", requirente_nombre: "Persona real", solicitante_nombre: "Autor original", encargado_compras_usuario_id: 10, encargado_compras_nombre: "Gestor original", total: "10.25", lineas: [{ id: 21, fecha: "2026-09-17", unidad_descripcion: "C-123ABC · Cabezal", vehiculo_id: 5, proveedor_id: 3, proveedor_nombre_snapshot: "Proveedor histórico", repuesto_descripcion: "Filtro", total: "10.25", metodo_pago: "Efectivo", condicion_pago: "Contado" }] } as DetalleCompra;
it("detalle solo lectura usa snapshots históricos y conserva total sin acciones futuras", () => {
  const html = renderToStaticMarkup(createElement(RequerimientoFormClient, { slug: "a", detalle, editable: false, solicitante: "Editor actual", puedeEliminar: false, puedeVerProveedores: false, fechaHoy: "2026-09-17" }));
  for (const texto of ["Empresa real", "Persona real", "Autor original", "Gestor original", "Proveedor histórico", "C-123ABC", "10.25"]) expect(html).toContain(texto);
  for (const texto of ["Guardar requerimiento", "Eliminar línea", "Agregar línea", "Autorizar", "Rechazar", "Editor actual"]) expect(html).not.toContain(texto);
  expect(html).toContain("disabled");
});
it("alta tiene todos los campos, múltiples líneas, tarjetas responsive y permisos de listado", () => {
  const html = renderToStaticMarkup(createElement(RequerimientoFormClient, { slug: "a", editable: true, solicitante: "Usuario actual", puedeEliminar: false, puedeVerProveedores: false, fechaHoy: "2026-09-17" }));
  for (const texto of ["Empresa requirente", "Persona que requiere", "Encargado de compras", "Usuario actual", "Serie factura", "Número factura", "Repuesto a comprar", "Método de pago", "Condición de pago", "Contado", "Crédito", "Agregar línea", "md:grid-cols-2"]) expect(html).toContain(texto);
  expect(renderToStaticMarkup(createElement(RequerimientosClient, { slug: "a", puedeCrear: false, puedeEditar: false }))).not.toContain("Nuevo requerimiento");
  expect(renderToStaticMarkup(createElement(RequerimientosClient, { slug: "a", puedeCrear: true, puedeEditar: false }))).toContain("Nuevo requerimiento");
});
it("landing, menú y página proveedores tienen gates independientes", () => {
  const landing = leer("src/app/e/[slug]/compras/page.tsx");
  for (const permiso of ["compras_proveedores", "compras_requerimientos"]) expect(landing).toContain(`tienePermiso(guard.permisos, "${permiso}", "ver")`);
  expect(leer("src/app/e/[slug]/compras/proveedores/page.tsx")).toContain('obtenerAccesoComprasPagina(slug, "compras_proveedores")');
  expect(leer("src/components/app-shell.tsx")).toContain('tienePermiso(permisos, "compras_requerimientos", "ver")');
});
it("expansión SQL únicamente del encargado, sin RRHH, Fondos/Gastos, uploads ni credenciales", () => {
  const files = execFileSync("git", ["diff", "--name-only", "608df8a55f75157c826350f3c131230a92db90ba"], { encoding: "utf8" }).trim().split(/\r?\n/);
  expect(files.some(p => /rrhh|planillas|portales-proveedores|src\/lib\/tms\/|\/(fondos|gastos|programacion)\//i.test(p))).toBe(false);
  expect(files.filter(p => p.startsWith("sql/")).every(p => ["sql/schema.sql", "sql/migrate-2026-09-compras-encargado.sql", "sql/preflight-2026-09-compras-encargado.sql"].includes(p))).toBe(true);
  const modelo = leer("src/lib/compras/requerimientos.ts");
  expect(modelo).not.toMatch(/MAX\(id\)|DELETE FROM compras_requerimientos\b|writeFile|unlink|UPDATE compras_linea_documentos/);
  expect(leer("src/app/api/empresas/[slug]/compras/requerimientos/[id]/route.ts")).not.toContain("function DELETE");
});
it("abrir edición conserva métodos históricos/desconocidos, sin normalizar por cargar", () => {
  for (const metodo of ["Tarjeta", "TARJETA DE CREDITO", "Pago especial local"]) {
    const linea = { ...detalle.lineas[0], metodo_pago: metodo };
    expect(lineaEditable(linea).metodo_pago).toBe(metodo);
    const html = renderToStaticMarkup(createElement(RequerimientoFormClient, { slug: "a", detalle: { ...detalle, lineas: [linea] }, editable: true, solicitante: "Actual", puedeEliminar: false, puedeVerProveedores: false, fechaHoy: "2026-09-17" }));
    expect(html).toContain(`value="${metodo}" selected=""`);
  }
});
