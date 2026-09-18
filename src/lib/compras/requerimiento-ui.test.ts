import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { lineaEditable, nuevaLinea, opcionesUnidadesCompra, opcionesProveedoresCompra, RequerimientoFormClient } from "@/components/compras/requerimiento-form-client";
import { filtrarOpcionesBusqueda } from "@/components/tms/catalogo-search-select";
import { seleccionarProveedorCompra } from "./metodos-pago";
import { RequerimientosClient } from "@/components/compras/requerimientos-client";
import type { DetalleCompra } from "./requerimiento-schema";
const leer = (p: string) => readFileSync(p, "utf8");
const detalle = { id: 12, codigo: "RC-2026-000012", fecha_requerimiento: "2026-09-17", estado: "Autorizada", version: 3, entidad_requirente_nombre: "Empresa real", requirente_nombre: "Persona real", solicitante_nombre: "Autor original", encargado_compras_usuario_id: 10, encargado_compras_nombre: "Gestor original", total: "10.25", lineas: [{ id: 21, fecha: "2026-09-17", unidad_descripcion: "C-123ABC · Cabezal", vehiculo_id: 5, proveedor_id: 3, proveedor_nombre_snapshot: "Proveedor histórico", repuesto_descripcion: "Filtro", total: "10.25", metodo_pago: "Efectivo", condicion_pago: "Contado" }] } as DetalleCompra;

it("unidad y proveedor reutilizan CatalogoSearchSelect y conservan históricos/inactivos", () => {
  const source = leer("src/components/compras/requerimiento-form-client.tsx");
  for (const label of ["Unidad / placa", "Proveedor"]) expect(source).toContain(`<CatalogoSearchSelect label="${label}"`);
  const html = renderToStaticMarkup(createElement(RequerimientoFormClient, { slug: "a", detalle, editable: true, solicitante: "Actual", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: false, fechaHoy: "2026-09-17" }));
  for (const texto of ["Buscar placa o unidad...", "Buscar proveedor...", "C-123ABC · Cabezal (histórico)", "Proveedor histórico (histórico)"]) expect(html).toContain(texto);
  expect(html).toContain('value="5" selected=""');
  expect(html).toContain('value="3" selected=""');
  expect(opcionesUnidadesCompra([], 5, "Cabezal")).toEqual([{ value: "5", label: "Cabezal (histórico)" }]);
  expect(opcionesProveedoresCompra([], 3, "Proveedor original")).toEqual([{ value: "3", label: "Proveedor original (histórico)" }]);
});

it("busca unidades por placa, descripción, marca y modelo aunque no estén en la etiqueta", () => {
  const opciones = opcionesUnidadesCompra([{ id: 5, placa: "C-123ABC", descripcion: "Cabezal", marca: "Freightliner", modelo: "Cascadia" }], 5, "Anterior");
  for (const texto of ["123abc", "cabezal", "freightliner", "cascadia"]) expect(filtrarOpcionesBusqueda(opciones, texto).map(o => o.value)).toEqual(["5"]);
  expect(opciones).toHaveLength(1);
  expect(filtrarOpcionesBusqueda(opciones, "inexistente")).toEqual([]);
});

it("busca proveedores por nombre, NIT, contacto y ambos teléfonos", () => {
  const opciones = opcionesProveedoresCompra([{ id: 3, nombre_comercial: "LLANTAS Y MANGUERAS", nit: "123456-7", contacto_nombre: "Ana", contacto_telefono: "55550001", telefono: "22220001", metodo_pago_habitual: "TARJETA DE CREDITO", banco: null, numero_cuenta: null, dias_credito: null }], 3);
  for (const texto of ["llantas", "123456-7", "ana", "55550001", "22220001"]) expect(filtrarOpcionesBusqueda(opciones, texto).map(o => o.value)).toEqual(["3"]);
  expect(opciones).toHaveLength(1);
});

it("seleccionar proveedor conserva callback de método habitual y no afecta otras líneas", () => {
  const source = leer("src/components/compras/requerimiento-form-client.tsx");
  expect(source).toMatch(/label="Proveedor"[^\n]*onChange=\{value =>[^\n]*seleccionarProveedorCompra\(v, id, habitual\)/);
  const original = lineaEditable(detalle.lineas[0]);
  const nueva = nuevaLinea("2026-09-18", "nueva-2");
  const lineas = [original, nueva].map(v => v.key === nueva.key ? seleccionarProveedorCompra(v, 7, "TARJETA DE CREDITO") : v);
  expect(lineas[0]).toEqual(original);
  expect(lineas[1]).toMatchObject({ proveedor_id: 7, metodo_pago: "Tarjeta de crédito", condicion_pago: "Contado", vehiculo_id: null, fecha: "2026-09-18", key: "nueva-2" });
  expect(nueva.proveedor_id).toBe(0);
  expect(source).toContain("[...actual, nuevaLinea(fecha, crypto.randomUUID())]");
});

it("unidad manual/sin unidad sigue disponible y línea nueva no hereda selección", () => {
  const nueva = nuevaLinea("2026-09-18", "nueva-2");
  expect(nueva).toMatchObject({ vehiculo_id: null, unidad_descripcion: null, proveedor_id: 0, metodo_pago: "Transferencia" });
  expect(opcionesUnidadesCompra([], nueva.vehiculo_id, nueva.unidad_descripcion)).toEqual([]);
  const html = renderToStaticMarkup(createElement(RequerimientoFormClient, { slug: "a", editable: true, solicitante: "Actual", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: false, fechaHoy: "2026-09-17" }));
  expect(html).toContain("Unidad manual / sin unidad");
  expect(html).toContain("Descripción manual de unidad");
  expect(leer("src/components/compras/requerimiento-form-client.tsx")).toContain("vehiculo_id: value ? Number(value) : null, unidad_descripcion: null");
});
it("detalle solo lectura usa snapshots históricos y conserva total sin acciones futuras", () => {
  const html = renderToStaticMarkup(createElement(RequerimientoFormClient, { slug: "a", detalle, editable: false, solicitante: "Editor actual", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: false, fechaHoy: "2026-09-17" }));
  for (const texto of ["Empresa real", "Persona real", "Autor original", "Gestor original", "Proveedor histórico", "C-123ABC", "10.25"]) expect(html).toContain(texto);
  for (const texto of ["Guardar requerimiento", "Eliminar línea", "Agregar línea", "Autorizar", "Rechazar", "Editor actual"]) expect(html).not.toContain(texto);
  expect(html).toContain("disabled");
});
it("alta tiene todos los campos, múltiples líneas, tarjetas responsive y permisos de listado", () => {
  const html = renderToStaticMarkup(createElement(RequerimientoFormClient, { slug: "a", editable: true, solicitante: "Usuario actual", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: false, fechaHoy: "2026-09-17" }));
  for (const texto of ["Empresa requirente", "Persona que requiere", "Encargado de compras", "Usuario actual", "Serie factura", "Número factura", "Repuesto a comprar", "Método de pago", "Condición de pago", "Contado", "Crédito", "Agregar línea", "md:grid-cols-2"]) expect(html).toContain(texto);
  expect(html).toContain('placeholder="Buscar requirente..."');
  expect(html).toContain('placeholder="Buscar encargado de compras..."');
  expect(html).not.toContain("Nombre manual");
  expect(renderToStaticMarkup(createElement(RequerimientosClient, { slug: "a", puedeCrear: false, puedeEditar: false }))).not.toContain("Nuevo requerimiento");
  expect(renderToStaticMarkup(createElement(RequerimientosClient, { slug: "a", puedeCrear: true, puedeEditar: false }))).toContain("Nuevo requerimiento");
});

it("buscadores reutilizados con catálogos distintos, histórico visible y sin entrada libre", () => {
  const compras = leer("src/components/compras/requerimiento-form-client.tsx");
  expect(compras).toContain('from "@/components/tms/catalogo-search-select"');
  expect(compras).toMatch(/label="Persona que requiere"[^\n]*catalogos\?\.requirentesOperaciones/);
  expect(compras).toMatch(/label="Encargado de compras"[^\n]*catalogos\?\.usuarios/);
  for (const modulo of ["fondos", "gastos"]) {
    const source = leer(`src/app/e/[slug]/${modulo}/page.tsx`);
    const campo = source.split("\n").find(l => l.includes('label="Requirente"') && l.includes("requirenteHistorico"))!;
    expect(campo).toContain("catalogos.usuariosOperaciones");
    expect(campo).not.toContain("onTextChange");
    expect(source).toMatch(/label="Solicitante"[^\n]*catalogos\.solicitantes/);
    expect(source).toContain("Requirente histórico:");
  }
  const html = renderToStaticMarkup(createElement(RequerimientoFormClient, {
    slug: "a", detalle: { ...detalle, requirente_usuario_id: 99 }, editable: true, solicitante: "Actual", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: false, fechaHoy: "2026-09-17",
  }));
  expect(html).toContain('value="99" selected=""');
  expect(html).toContain("Persona real (histórico)");
});
it("landing, menú y página proveedores tienen gates independientes", () => {
  const landing = leer("src/app/e/[slug]/compras/page.tsx");
  for (const permiso of ["compras_proveedores", "compras_requerimientos"]) expect(landing).toContain(`tienePermiso(guard.permisos, "${permiso}", "ver")`);
  expect(leer("src/app/e/[slug]/compras/proveedores/page.tsx")).toContain('obtenerAccesoComprasPagina(slug, "compras_proveedores")');
  expect(leer("src/components/app-shell.tsx")).toContain('tienePermiso(permisos, "compras_requerimientos", "ver")');
});
it("ajuste transversal sin SQL, RRHH, programación ni credenciales", () => {
  const files = execFileSync("git", ["diff", "--name-only", "aebfdc1ee46f6fe2bac4b80612db928e0a10c71b"], { encoding: "utf8" }).trim().split(/\r?\n/);
  expect(files.some(p => /rrhh|planillas|portales-proveedores|\/programacion\//i.test(p))).toBe(false);
  // COMPRAS-FASE-3-DOCUMENTOS-LINEA agregó una migración/preflight reales
  // (amplía el CHECK de compras_linea_documentos.tipo — ver auditoría en
  // src/lib/compras/linea-documentos.ts), pedidos explícitamente por ese
  // ticket y sin ejecutar. Este guard seguía protegiendo el diff de la
  // Fase 2 original contra SQL no pedido; se excluyen por nombre solo los
  // 2 archivos de esa Fase 3, no cualquier sql/ futuro.
  expect(files.filter(p => p.startsWith("sql/") && !p.includes("compras-documentos-linea-tipo"))).toEqual([]);
  const modelo = leer("src/lib/compras/requerimientos.ts");
  expect(modelo).not.toMatch(/MAX\(id\)|DELETE FROM compras_requerimientos\b|writeFile|unlink|UPDATE compras_linea_documentos/);
  expect(leer("src/app/api/empresas/[slug]/compras/requerimientos/[id]/route.ts")).not.toContain("function DELETE");
});
it("abrir edición conserva métodos históricos/desconocidos, sin normalizar por cargar", () => {
  for (const metodo of ["Tarjeta", "TARJETA DE CREDITO", "Pago especial local"]) {
    const linea = { ...detalle.lineas[0], metodo_pago: metodo };
    expect(lineaEditable(linea).metodo_pago).toBe(metodo);
    const html = renderToStaticMarkup(createElement(RequerimientoFormClient, { slug: "a", detalle: { ...detalle, lineas: [linea] }, editable: true, solicitante: "Actual", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: false, fechaHoy: "2026-09-17" }));
    expect(html).toContain(`value="${metodo}" selected=""`);
  }
});

/**
 * COMPRAS-FASE-3-DOCUMENTOS-LINEA — "Documentos" solo tiene sentido para
 * una línea ya persistida (compras_linea_documentos exige requerimiento_id/
 * linea_id reales): se monta cuando detalle existe Y la línea tiene id, no
 * al dar de alta un requerimiento nuevo (nuevaLinea() nunca trae id).
 */
it("sección Documentos se monta por cada línea con id al ver/editar un requerimiento existente", () => {
  const html = renderToStaticMarkup(createElement(RequerimientoFormClient, { slug: "a", detalle, editable: true, solicitante: "Actual", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: true, fechaHoy: "2026-09-17" }));
  expect(html).toContain("Documentos (0)");
});

it("sección Documentos NO se monta al dar de alta un requerimiento nuevo (líneas sin id todavía)", () => {
  const html = renderToStaticMarkup(createElement(RequerimientoFormClient, { slug: "a", editable: true, solicitante: "Actual", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: true, fechaHoy: "2026-09-17" }));
  expect(html).not.toContain("Documentos (");
});

it("puedeSubirDocumentos controla el formulario de subida independientemente de puedeEliminar", () => {
  const conSubida = renderToStaticMarkup(createElement(RequerimientoFormClient, { slug: "a", detalle, editable: true, solicitante: "Actual", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: true, fechaHoy: "2026-09-17" }));
  expect(conSubida).toContain("Subir documento");
  const sinSubida = renderToStaticMarkup(createElement(RequerimientoFormClient, { slug: "a", detalle, editable: true, solicitante: "Actual", puedeEliminar: false, puedeVerProveedores: false, puedeSubirDocumentos: false, fechaHoy: "2026-09-17" }));
  expect(sinSubida).not.toContain("Subir documento");
});

it("eliminar documentos exige permiso Y estado Pendiente (regla documentada, más restrictiva que subir)", () => {
  const source = leer("src/components/compras/requerimiento-form-client.tsx");
  expect(source).toContain('puedeEliminar={puedeEliminar && detalle.estado === "Pendiente"}');
  // La sección se sigue mostrando (para Ver/consultar) aunque el
  // requerimiento ya esté Autorizada — solo cambia si permite eliminar.
  const autorizada = renderToStaticMarkup(createElement(RequerimientoFormClient, { slug: "a", detalle: { ...detalle, estado: "Autorizada" }, editable: false, solicitante: "Actual", puedeEliminar: true, puedeVerProveedores: false, puedeSubirDocumentos: true, fechaHoy: "2026-09-17" }));
  expect(autorizada).toContain("Documentos (0)");
});
