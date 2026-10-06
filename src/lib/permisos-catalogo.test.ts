import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { PermisoModulo } from "./permisos-shared";
import { mergePermisosConCatalogo } from "./permisos-shared";
import { CATALOGO_PERMISOS, VERSION_PERMISOS, adaptarPermisosLegacy, cambiarAccion, marcarArea, materializarAcciones, normalizarMatriz, tieneAccionCatalogo, tienePermisoBase } from "./permisos-catalogo";
const p = (modulo: string, datos: Partial<PermisoModulo> = {}): PermisoModulo => ({modulo,puedeVer:false,puedeCrear:false,puedeEditar:false,puedeEliminar:false,...datos});
describe("catálogo de acciones reales", () => {
  it.each([["cms","publicar"],["reciclaje","gestionar"],["tarimas","gestionar"]])("%s oculta el formulario sin acción propia", (modulo,accion) => {
    const src = readFileSync(new URL(`../app/e/[slug]/${modulo}/page.tsx`,import.meta.url),"utf8");
    expect(src).toContain(`tieneAccionCatalogo(permisos, "${modulo}", "${accion}")`);
    expect(src).toContain("{puedeGestionar ? <form");
    expect(src).toContain("if (!puedeGestionar) return;");
  });
  it("editor usa catálogo/dependencias centrales y explica Administración sin conceder Admin", () => {
    const src = readFileSync(new URL("../app/e/[slug]/usuarios/page.tsx",import.meta.url),"utf8");
    expect(src).toContain("modulo.acciones.map");
    expect(src).toContain("cambiarAccion(prev, modulo, accion, value)");
    expect(src).toContain("marcarArea(prev");
    expect(src).toContain("Usuarios y limpieza de datos son exclusivos del rol Admin.");
    expect(src).not.toContain("FLAGS.map");
  });
  it("IDs únicos por módulo, etiquetas y claves compatibles con VARCHAR(40)", () => {
    expect(new Set(CATALOGO_PERMISOS.map(m => m.id)).size).toBe(CATALOGO_PERMISOS.length);
    for (const m of CATALOGO_PERMISOS) {
      expect(m.acciones[0]?.id).toBe("ver");
      expect(new Set(m.acciones.map(a=>a.id)).size).toBe(m.acciones.length);
      for (const a of m.acciones) { expect(a.label.trim()).not.toBe(""); expect(a.modulo.length).toBeLessThanOrEqual(40); }
    }
  });
  it("reportes no ofrece CRUD y emitir/anular NO derivan de eliminar", () => {
    expect(CATALOGO_PERMISOS.find(m=>m.id==="reportes")?.acciones.map(a=>a.id)).toEqual(["ver"]);
    const permisos = [p("facturacion",{puedeVer:true,puedeEliminar:true})];
    expect(tieneAccionCatalogo(permisos,"facturacion","emitir")).toBe(false);
    expect(tieneAccionCatalogo(permisos,"facturacion","anular")).toBe(false);
  });
  it("no muestra módulo por una acción aislada", () => {
    expect(tienePermisoBase([p("facturacion",{puedeEditar:true})],"facturacion")).toBe(false);
  });
  it("Compras legacy crear sin Ver no concede listado; gestionar por rol no concede CRUD a otros módulos", () => {
    expect(tienePermisoBase(adaptarPermisosLegacy([p("compras_requerimientos",{puedeCrear:true})]),"compras_requerimientos")).toBe(false);
    const legacy = adaptarPermisosLegacy([p("tms",{puedeVer:true})],"Operaciones");
    expect(tieneAccionCatalogo(legacy,"tms","gestionar")).toBe(true);
    expect(legacy.find(p=>p.modulo==="rutas")?.puedeEditar).toBe(false);
    expect(tieneAccionCatalogo(cambiarAccion(legacy,"tms","gestionar",false),"tms","gestionar")).toBe(false);
  });
  it("acción activa Ver y desmarcar Ver limpia hijas", () => {
    const permisos = cambiarAccion([],"facturacion","emitir",true);
    expect(tienePermisoBase(permisos,"facturacion")).toBe(true);
    expect(tieneAccionCatalogo(permisos,"facturacion","emitir")).toBe(true);
    const quitados = cambiarAccion(permisos,"facturacion","ver",false);
    for (const a of CATALOGO_PERMISOS.find(m=>m.id==="facturacion")!.acciones) expect(tieneAccionCatalogo(quitados,"facturacion",a.id)).toBe(false);
  });
  it("masivos activan solo acciones reales y Solo Ver borra específicas", () => {
    const todos = marcarArea([],["facturacion","reportes"],"todo");
    expect(tieneAccionCatalogo(todos,"facturacion","emitir")).toBe(true);
    const solo = marcarArea(todos,["facturacion","reportes"],"ver");
    expect(tienePermisoBase(solo,"facturacion")).toBe(true);
    expect(tieneAccionCatalogo(solo,"facturacion","emitir")).toBe(false);
    expect(solo.find(p=>p.modulo==="reportes")?.puedeCrear).toBe(false);
    expect(tienePermisoBase(marcarArea(solo,["facturacion"],"quitar"),"facturacion")).toBe(false);
  });
  it("mantiene equivalencias legacy y denegaciones explícitas nuevas", () => {
    const legacy = adaptarPermisosLegacy([p("tms",{puedeVer:true,puedeCrear:true,puedeEditar:true})]);
    expect(tienePermisoBase(legacy,"cotizaciones")).toBe(true);
    expect(tieneAccionCatalogo(materializarAcciones(legacy),"cotizaciones","estado")).toBe(true);
    const explicit = materializarAcciones([p("facturacion",{puedeVer:true,puedeEditar:true}),p("facturacion_emitir")]);
    expect(tieneAccionCatalogo(explicit,"facturacion","emitir")).toBe(false);
    expect(tieneAccionCatalogo(explicit,"facturacion","anular")).toBe(true);
  });
  it("preserva lecturas especializadas legacy y quitar base limpia también sus GET", () => {
    const permisos = adaptarPermisosLegacy([p("viaticos_liquidar",{puedeEditar:true})]);
    expect(tienePermisoBase(permisos,"viaticos")).toBe(true);
    expect(permisos.find(p=>p.modulo==="viaticos_liquidar")?.puedeVer).toBe(true);
    const quitados = cambiarAccion(permisos,"viaticos","ver",false);
    expect(quitados.find(p=>p.modulo==="viaticos_liquidar")).toEqual(p("viaticos_liquidar"));
    const nuevos = cambiarAccion([], "viaticos", "autorizar", true);
    expect(nuevos.find(p=>p.modulo==="viaticos_autorizar")?.puedeVer).toBe(true);
  });
  it("preserva extras al guardar/editar y no rehereda un desmarque V2", () => {
    const input = [p(VERSION_PERMISOS,{puedeVer:true}),p("facturacion"),p("facturacion_emitir"),p("legacy_custom",{puedeVer:true})];
    const result = normalizarMatriz(mergePermisosConCatalogo("Operaciones",input));
    expect(result.find(p=>p.modulo==="legacy_custom")?.puedeVer).toBe(true);
    expect(tienePermisoBase(result,"facturacion")).toBe(false);
  });
});
