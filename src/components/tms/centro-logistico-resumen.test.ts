import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ACCESOS_LOGISTICOS, resumenLogistico, TmsQuickLinks, TmsSummaryCards } from "./centro-logistico-resumen";

const pagina = readFileSync(resolve(process.cwd(), "src/app/e/[slug]/tms/page.tsx"), "utf8");

describe("Centro logístico: navegación y resumen visual", () => {
  it("presenta el título y las secciones en el orden requerido", () => {
    expect(pagina).toContain('>Centro logístico</h1>');
    const orden = ["<TmsQuickLinks", "<TmsSummaryCards", "Seguimiento rápido\n", '>Configuración logística</h2>', '>Administración de clientes</summary>', '>Administración</h2>', '>Bitácora de operaciones</summary>', "Catálogos operativos\n"];
    const posiciones = orden.map((texto) => pagina.indexOf(texto));
    expect(posiciones.every((p) => p >= 0)).toBe(true);
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
  });

  it.each(ACCESOS_LOGISTICOS)("enlaza $titulo al módulo existente de la empresa", ({ ruta, titulo }) => {
    const html = renderToStaticMarkup(createElement(TmsQuickLinks, { slug: "empresa-a" }));
    expect(html).toContain(`href="/e/empresa-a/${ruta}"`);
    expect(html).toContain(titulo);
    expect(existsSync(resolve(process.cwd(), `src/app/e/[slug]/${ruta}/page.tsx`))).toBe(true);
    expect(html).not.toContain("empresa-b");
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("md:grid-cols-2");
    expect(html).toContain("xl:grid-cols-3");
  });

  it("calcula solo desde viajes recibidos, con el flag existente de pendiente de cierre", () => {
    const planes = [
      { estado: "Programado", pendiente_cierre: 0 },
      { estado: "En ruta", pendiente_cierre: 0 },
      { estado: "En ruta", pendiente_cierre: 1 },
      { estado: "Descargado", pendiente_cierre: 0 },
      { estado: "Cerrado", pendiente_cierre: 0 },
      { estado: "Cancelado", pendiente_cierre: 0 },
    ];
    expect(resumenLogistico(planes)).toEqual({ visibles: 6, enRuta: 2, pendientes: 1, cerrados: 1 });
    expect(resumenLogistico([])).toEqual({ visibles: 0, enRuta: 0, pendientes: 0, cerrados: 0 });
    expect(pagina).toContain("<TmsSummaryCards planes={planesFiltrados} loading={loadingPlanes} />");
    const html = renderToStaticMarkup(createElement(TmsSummaryCards, { planes, loading: false }));
    for (const titulo of ["Resumen operativo", "Viajes visibles", "En ruta", "Pendientes de cierre", "Cerrados"]) expect(html).toContain(titulo);
    expect(html).toContain("no representa el histórico completo");
  });

  it("no muestra ceros engañosos mientras está cargando", () => {
    const html = renderToStaticMarkup(createElement(TmsSummaryCards, { planes: [], loading: true }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("…");
  });

  it("conserva filtros, tabla, detalle y navegación a Programación", () => {
    for (const filtro of ["fCodigo", "fCliente", "fFecha", "fEstado"]) expect(pagina).toContain(`value={${filtro}}`);
    expect(pagina).toContain("{planesFiltrados.map((p) => {");
    expect(pagina).toContain("Ver detalle");
    expect(pagina).toContain("Ver en Programación");
    expect(pagina).toContain("/programacion?plan=${p.id}");
    expect(pagina).toContain("onClick={() => void cargarPlanes()}");
    expect(pagina).toContain("disabled={loadingPlanes}");
  });

  it.each(["Administración de clientes", "Bitácora de operaciones", "Catálogos operativos"])("%s es colapsable y cerrado por defecto", (titulo) => {
    const bloques = [...pagina.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g)];
    const bloque = bloques.find((b) => b[2].includes(titulo));
    expect(bloque).toBeDefined();
    expect(bloque![1]).not.toMatch(/\bopen\b/);
    expect(bloque![2]).toContain("<summary");
  });

  it("conserva contactos/ubicaciones separados de configuración y sin nuevos formularios", () => {
    expect(pagina).toContain("<ClienteContactosAdmin slug={slug} clientes={clientesCat} />");
    expect(pagina).toContain("<ClienteUbicacionesAdmin slug={slug} clientes={clientesCat} />");
    expect(pagina).toContain('<div id="cliente-contactos">');
    expect(pagina).toContain("<ViaticosConfigPanel slug={slug} />");
    const config = pagina.slice(pagina.indexOf('aria-labelledby="configuracion-logistica"'), pagina.indexOf("{/* Siguiente paso"));
    expect(config).not.toContain("ClienteContactosAdmin");
    expect(config).not.toContain("ClienteUbicacionesAdmin");
    expect(config).toContain("/viaticos");
  });

  it("preserva cierre normal/manual, permisos, evidencias y disabled", () => {
    for (const texto of [
      'tienePermiso(permisosTms, "viajes_cerrar", "editar")', "puedeCerrarManualmente(",
      "p.pendiente_cierre && puedeCerrarViaje", "onClick={() => void cerrarViajeTms(p.id)}",
      "Cierre manual", "disabled={enviandoManual}", "disabled={cerrandoId === p.id}",
      "evidenciasPorPlan[p.id]", "const POLLING_MS = 30_000;",
      'document.visibilityState === "visible"', "if (enVuelo) return;",
    ]) expect(pagina).toContain(texto);
    expect(pagina).not.toContain("TMS es solo consulta");
    expect(pagina).not.toContain("cada 5 segundos");
  });

  it("preserva las llamadas a endpoints y la carga manual de bitácora", () => {
    const rutas = [...pagina.matchAll(/fetch\(`([^`]+)`/g)].map((m) => m[1]);
    expect(rutas).toEqual([
      "/api/empresas/${slug}/tms/catalogos",
      "/api/empresas/${slug}/tms/planes",
      "/api/empresas/${slug}/tms/planes?pendienteCierre=1",
      "/api/empresas/${slug}/tms/planes/${planId}/cerrar",
      "/api/empresas/${slug}/tms/planes/${planId}/cerrar",
      "/api/empresas/${slug}/tms/evidencias?planId=${planId}",
      "/api/empresas/${slug}/auditoria?modulo=tms&limite=150",
      "/api/empresas/${slug}/tms/catalogos",
    ]);
    expect(pagina).toContain("if (!mostrarBitacora) void cargarBitacora();");
    expect(pagina).toContain("setMostrarBitacora(true);");
    expect(pagina).toContain("+ Cliente rápido");
    expect(pagina).not.toContain("onToggle=");
    for (const boton of pagina.matchAll(/<button\b([^>]+)>/g)) expect(boton[1]).toContain('type="button"');
  });
});
